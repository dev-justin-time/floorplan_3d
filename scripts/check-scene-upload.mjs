import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8767;
const DEBUG_PORT = 9334;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.glb': 'model/gltf-binary',
    '.svg': 'image/svg+xml'
};

function startServer() {
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const file = path.join(ROOT, decodeURIComponent(url.pathname));
        try {
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404).end('not found');
        }
    });
    return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

class CDP {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
        this.events = [];
        this.ready = new Promise((resolve, reject) => {
            this.ws.onopen = () => resolve();
            this.ws.onerror = (event) => reject(new Error('CDP socket error ' + event.message));
            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.id && this.pending.has(message.id)) {
                    const { resolve: done, reject: fail } = this.pending.get(message.id);
                    this.pending.delete(message.id);
                    if (message.error) fail(new Error(message.error.message));
                    else done(message.result);
                } else if (message.method) {
                    this.events.push(message);
                }
            };
        });
    }

    async send(method, params = {}) {
        await this.ready;
        const id = this.nextId++;
        const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
        this.ws.send(JSON.stringify({ id, method, params }));
        return promise;
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) {
            const details = result.exceptionDetails;
            throw new Error(details.exception?.description || details.text || 'evaluate failed');
        }
        return result.result.value;
    }

    errors() {
        return this.events
            .filter((event) => event.method === 'Runtime.exceptionThrown')
            .map((event) => event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text);
    }
}

async function waitForVersion() {
    for (let i = 0; i < 100; i += 1) {
        try {
            const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
            if (response.ok) return;
        } catch {
            // Chrome is still starting.
        }
        await sleep(200);
    }
    throw new Error('Chrome debug endpoint never came up');
}

async function main() {
    const server = await startServer();
    const profile = await mkdtemp(path.join(tmpdir(), 'scene-check-'));
    const chrome = spawn(CHROME, [
        '--headless=new',
        '--disable-gpu',
        '--enable-unsafe-swiftshader',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${profile}`,
        'about:blank'
    ], { stdio: 'ignore' });

    let passed = 0;
    let failed = 0;
    const check = (name, ok, detail = '') => {
        if (ok) {
            passed += 1;
            console.log(`  ok  ${name}${detail ? ' — ' + detail : ''}`);
        } else {
            failed += 1;
            console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
        }
    };

    try {
        await waitForVersion();
        const target = await (await fetch(
            `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(`http://127.0.0.1:${PORT}/pages/index.html`)}`,
            { method: 'PUT' }
        )).json();
        const cdp = new CDP(target.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        await cdp.send('DOM.enable');

        async function waitFor(expression, timeout = 30000) {
            const started = Date.now();
            while (Date.now() - started < timeout) {
                try {
                    if (await cdp.evaluate(expression)) return true;
                } catch {
                    // Module graph still loading.
                }
                await sleep(200);
            }
            return false;
        }

        check('upload page wired', await waitFor("Boolean(document.getElementById('floorplan-upload'))"));
        check('page module executed', await waitFor("typeof window.showToast === 'function'"), String(await cdp.evaluate("typeof window.showToast")));
        check('viewer starts empty', (await cdp.evaluate("document.getElementById('shared-viewer-container').classList.contains('hidden')")) === true);

        const doc = await cdp.send('DOM.getDocument');
        const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#floorplan-upload' });
        await cdp.send('DOM.setFileInputFiles', {
            nodeId: node.nodeId,
            files: [path.join(ROOT, 'assets', 'blueprint.png')]
        });
        // Not every Chrome build emits change for CDP file injection.
        await cdp.evaluate("document.getElementById('floorplan-upload').dispatchEvent(new Event('change'))");

        const loaded = await waitFor("Boolean(window.sharedViewer && window.sharedViewer.stats().plan)", 45000);
        check('uploaded plan reaches the scene', loaded);

        const stats = await cdp.evaluate('window.sharedViewer?.stats() || null');
        check('scene built walls from the upload', Boolean(stats && stats.walls > 0), `${stats?.walls} walls`);
        check('scene built a floor slab per detected room', Boolean(stats && stats.rooms > 1), `${stats?.rooms} slabs`);
        const slabs = await cdp.evaluate(`(() => {
            const viewer = window.sharedViewer;
            const meshes = viewer.roomSlabs || [];
            return {
                count: meshes.length,
                named: meshes.every((slab) => slab.userData.room?.id),
                flat: meshes.every((slab) => Math.abs(slab.rotation.x) < 1e-6 && Math.abs(slab.position.y) <= 0.01),
                inPlan: meshes.every((slab) => viewer.planGroup.children.includes(slab))
            };
        })()`);
        check('room slabs are named, flat, and inside the plan group',
            slabs.count === stats?.rooms && slabs.named && slabs.flat && slabs.inPlan,
            JSON.stringify(slabs));
        check('edit-in-studio appears after a conversion',
            (await cdp.evaluate("!document.getElementById('edit-in-studio').classList.contains('hidden')")) === true);
        check('uploaded plan replaces the sample bathroom', stats?.sample === false && stats?.plan === true);
        check('scene switched to the 3D view', stats?.view === '3d', stats?.view);
        check('plan bounds are in world-space metres',
            Boolean(stats?.bounds && stats.bounds.maxX - stats.bounds.minX > 0.5),
            stats?.bounds ? `${(stats.bounds.maxX - stats.bounds.minX).toFixed(2)} x ${(stats.bounds.maxZ - stats.bounds.minZ).toFixed(2)} m` : 'none');

        const dom = await cdp.evaluate(`(() => ({
            walls: document.getElementById('stats-walls').textContent,
            time: document.getElementById('stats-time').textContent,
            toggle: document.getElementById('viewer-toggle').checked,
            view3d: !document.getElementById('viewer-3d-view').classList.contains('hidden'),
            canvas: Boolean(document.querySelector('#viewer-3d-view canvas')),
            uploadValue: document.getElementById('floorplan-upload').value
        }))()`);
        check('stats overlay reports the walls', /\d+ Walls/.test(dom.walls), dom.walls);
        check('stats overlay reports a processing time', /\d+ms Processing/.test(dom.time), dom.time);
        check('toggle reflects the 3D view', dom.toggle === true);
        check('3D container is visible with its canvas', dom.view3d === true && dom.canvas === true);
        check('file input reset for a second upload', dom.uploadValue === '', dom.uploadValue);

        const errors = cdp.errors().filter((error) => error && !error.includes('favicon'));
        check('no uncaught runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));

        // --- Uploaded plan -> studio handoff --------------------------------
        // The click writes the draft and then navigates. Fail that navigation
        // request so the page (and its localStorage) stays inspectable.
        await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*Editor.html*', requestStage: 'Request' }] });
        await cdp.evaluate("document.getElementById('edit-in-studio').click()");
        let aborted = false;
        let editorUrl = '';
        for (let i = 0; i < 60; i += 1) {
            const paused = cdp.events.find((event) => event.method === 'Fetch.requestPaused'
                && event.params.request.url.includes('Editor.html'));
            if (paused) {
                editorUrl = paused.params.request.url;
                await cdp.send('Fetch.failRequest', { requestId: paused.params.requestId, errorReason: 'Aborted' });
                aborted = true;
                break;
            }
            await sleep(100);
        }
        await cdp.send('Fetch.disable');
        check('edit-in-studio opens the studio page', aborted);
        // The hand-off must stay inside pages/: the root index.html only
        // redirects to the landing page and has no editor of its own.
        check('edit-in-studio targets the landing page\'s editor',
            editorUrl === `${ORIGIN}/pages/Editor.html`, editorUrl || 'no request');

        const draft = await cdp.evaluate("JSON.parse(localStorage.getItem('floorplan-editor-draft') || 'null')");
        check('studio draft carries the uploaded walls',
            Boolean(draft && draft.walls?.length === stats.walls),
            `${draft?.walls?.length ?? 0} walls`);

        const editorTarget = await (await fetch(
            `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(`http://127.0.0.1:${PORT}/pages/Editor.html`)}`,
            { method: 'PUT' }
        )).json();
        const editor = new CDP(editorTarget.webSocketDebuggerUrl);
        await editor.send('Runtime.enable');
        await editor.send('Page.enable');
        const waitEditor = async (expression, timeout = 60000) => {
            const started = Date.now();
            while (Date.now() - started < timeout) {
                try {
                    if (await editor.evaluate(expression)) return true;
                } catch {
                    // Module graph still loading.
                }
                await sleep(250);
            }
            return false;
        };

        check('studio boots on the imported plan', await waitEditor("Boolean(window.featureKit && window.featureKit.walls())"));
        const imported = await editor.evaluate(`(() => {
            const walls = window.featureKit.walls();
            const box = walls.reduce((acc, wall) => ({
                minX: Math.min(acc.minX, wall.start.x, wall.end.x),
                maxX: Math.max(acc.maxX, wall.start.x, wall.end.x),
                minY: Math.min(acc.minY, wall.start.y, wall.end.y),
                maxY: Math.max(acc.maxY, wall.start.y, wall.end.y)
            }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
            const canvas = document.getElementById('blueprint-canvas');
            return {
                walls: walls.length,
                centreX: (box.minX + box.maxX) / 2,
                centreY: (box.minY + box.maxY) / 2,
                canvasWidth: canvas.width,
                canvasHeight: canvas.height,
                draftLeft: localStorage.getItem('floorplan-editor-draft'),
                scene: Boolean(document.querySelector('#render-3d-view canvas'))
            };
        })()`);
        check('studio imported every uploaded wall', imported.walls === draft.walls.length, `${imported.walls} walls`);
        check('imported plan is centred in the plan view',
            Math.abs(imported.centreX - imported.canvasWidth / 2) < 3
            && Math.abs(imported.centreY - imported.canvasHeight / 2) < 3,
            `${imported.centreX.toFixed(1)},${imported.centreY.toFixed(1)} in ${imported.canvasWidth}x${imported.canvasHeight}`);
        check('studio keeps the converted 3D scene', imported.scene === true);
        check('studio draft is consumed, not replayed', imported.draftLeft === null);

        const edit = await editor.evaluate(`(() => {
            const wall = window.featureKit.walls()[0];
            window.selectWallById(wall.id);
            window.setWallHeight(3.25);
            const after = window.featureKit.walls().find((entry) => entry.id === wall.id);
            return { id: wall.id, height: after?.height, selected: window.editorKit.selectedWall() };
        })()`);
        check('imported walls are editable in the studio',
            edit.height === 3.25 && edit.selected === edit.id,
            `height=${edit.height} selected=${edit.selected}`);
        check('studio exposes openings and items on the imported plan',
            (await editor.evaluate("typeof window.deleteCutoutSelection === 'function' && typeof window.setItemSize === 'function'")) === true);

        const editorErrors = editor.errors().filter((error) => error && !error.includes('favicon'));
        check('studio has no runtime errors', editorErrors.length === 0, editorErrors.slice(0, 2).join(' | '));

        // Autosave keeps the imported plan and the edit across a reload.
        await editor.evaluate('window.flushAutosave()');
        await sleep(800);
        // Mark the old document so the wait cannot pass on it before the reload
        // actually replaces the execution context.
        await editor.evaluate('window.__beforeReload = true');
        await editor.send('Page.reload');
        check('studio restores the plan after a reload', await waitEditor(
            "Boolean(!window.__beforeReload && window.featureKit && window.featureKit.walls().length)"
        ));
        const restored = await editor.evaluate(`(() => {
            const wall = window.featureKit.walls().find((entry) => entry.id === ${JSON.stringify(edit.id)});
            return { walls: window.featureKit.walls().length, height: wall?.height ?? null };
        })()`);
        check('imported plan survives a studio reload',
            restored.walls === draft.walls.length && restored.height === 3.25,
            `${restored.walls} walls, height=${restored.height}`);
        editor.ws.close();

        // The sample-bathroom scene is shared with the marketing pages.
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/pages/about.html` });
        await waitFor("Boolean(document.querySelector('#viewer-3d-view canvas'))", 30000);
        const marketing = await cdp.evaluate(`(() => ({
            canvas: Boolean(document.querySelector('#viewer-3d-view canvas')),
            panorama: Boolean(document.querySelector('#viewer-panorama-canvas')),
            hidden: document.getElementById('shared-viewer-container')?.classList.contains('hidden') ?? null
        }))()`);
        check('marketing page still boots the viewer', marketing.canvas && marketing.panorama && marketing.hidden === false, JSON.stringify(marketing));
        const marketingErrors = cdp.errors().filter((error) => error && !error.includes('favicon'));
        check('marketing page has no runtime errors', marketingErrors.length === 0, marketingErrors.slice(0, 2).join(' | '));

        console.log(`\n${passed} passed, ${failed} failed`);
        process.exitCode = failed ? 1 : 0;
        cdp.ws.close();
    } finally {
        chrome.kill();
        server.close();
        await sleep(300);
        await rm(profile, { recursive: true, force: true }).catch(() => {});
    }
}

main().catch((error) => {
    console.error('Scene check crashed:', error);
    process.exitCode = 1;
});
