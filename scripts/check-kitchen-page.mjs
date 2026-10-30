/**
 * Kitchen suite + editor check.
 *
 * Serves the project, exercises the kitchen page (layout, gaps, checks, shared
 * nav/footer), intercepts its "Send to editor" navigation to capture the
 * draft, then opens the editor with a measured two-wall plan and verifies the
 * run lands in the plan, that elevation shows one wall at a time, and that the
 * Add level button adds a storey.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8769;
const DEBUG_PORT = 9337;
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
        const url = new URL(req.url, ORIGIN);
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
            this.ws.onerror = () => reject(new Error('CDP socket error'));
            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.id && this.pending.has(message.id)) {
                    const { resolve: done, reject: fail } = this.pending.get(message.id);
                    this.pending.delete(message.id);
                    message.error ? fail(new Error(message.error.message)) : done(message.result);
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
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        }
        return result.result?.value;
    }
    errors() {
        return this.events
            .filter((event) => event.method === 'Runtime.exceptionThrown')
            .map((event) => event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text)
            .filter((text) => text && !text.includes('favicon'));
    }
    clear() {
        this.events = [];
    }
}

async function newTarget(cdp, url) {
    const target = await (await fetch(
        `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`,
        { method: 'PUT' }
    )).json();
    const page = new CDP(target.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    return page;
}

async function waitFor(page, expression, timeout = 60000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        try {
            if (await page.evaluate(expression)) return true;
        } catch {
            // Module graph still loading.
        }
        await sleep(200);
    }
    return false;
}

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
    if (condition) {
        passed += 1;
        console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`);
    } else {
        failed += 1;
        console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
    }
}

async function main() {
    const server = await startServer();
    const profile = await mkdtemp(path.join(tmpdir(), 'kitchen-check-'));
    const chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
        '--no-default-browser-check', '--disable-extensions',
        `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: 'ignore' });

    try {
        for (let i = 0; i < 100; i += 1) {
            try {
                if ((await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok) break;
            } catch {
                // Chrome is still starting.
            }
            await sleep(200);
        }

        // --- Kitchen suite page -------------------------------------------
        const suite = await newTarget(null, `${ORIGIN}/pages/kitchen-designer.html`);
        check('kitchen page boots the suite', await waitFor(suite, 'Boolean(window.kitchenKit)'));

        const initial = await suite.evaluate(`(() => {
            const design = window.kitchenKit.design();
            const canvas = document.getElementById('run-canvas');
            return {
                modules: design.modules.length,
                gaps: design.gaps.length,
                fillers: design.fillers.length,
                used: design.totals.used,
                length: design.length,
                score: design.score,
                canvas: { width: canvas.width, height: canvas.height },
                rows: document.querySelectorAll('#gap-rows tr').length,
                checks: document.querySelectorAll('#check-list > *').length,
                nav: Boolean(document.getElementById('site-nav-menu')),
                navLinks: document.querySelectorAll('#site-nav-menu a').length,
                footer: Boolean(document.getElementById('site-footer')),
                kitchenNav: Array.from(document.querySelectorAll('#site-nav-menu a'))
                    .some((link) => link.getAttribute('href') === 'kitchen-designer.html')
            };
        })()`);
        check('default run lays out six modules', initial.modules === 6, String(initial.modules));
        check('the run closes to the measured wall',
            Math.abs(initial.used - initial.length) < 0.003,
            `${initial.used.toFixed(2)} / ${initial.length} m`);
        check('the canvas is drawn at device pixels', initial.canvas.width > 0 && initial.canvas.height > 0, JSON.stringify(initial.canvas));
        check('the gap table lists every gap', initial.rows === initial.gaps, `${initial.rows}/${initial.gaps}`);
        check('the checks panel is rendered', initial.checks > 0, String(initial.checks));
        check('the shared page menu is on the page', initial.nav === true, `${initial.navLinks} links`);
        check('the menu lists the kitchen suite', initial.kitchenNav === true);
        check('the shared footer is on the page', initial.footer === true);
        check('the default run scores full marks', initial.score === 100, String(initial.score));

        const added = await suite.evaluate(`(() => {
            const picker = document.getElementById('k-module');
            picker.value = 'base-24';
            document.getElementById('add-module').click();
            return window.kitchenKit.design().modules.length;
        })()`);
        check('a module can be added from the suite', added === initial.modules + 1, String(added));

        const wide = await suite.evaluate(`(() => {
            const input = document.getElementById('k-length');
            input.value = '6.6';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const design = window.kitchenKit.design();
            return {
                filler: design.checks.some((entry) => entry.id === 'wide-filler'),
                dims: design.gaps.filter((gap) => gap.kind === 'wall').map((gap) => gap.width)
            };
        })()`);
        check('a wide wall gap warns in the suite', wide.filler === true, JSON.stringify(wide.dims));

        const narrow = await suite.evaluate(`(() => {
            const input = document.getElementById('k-aisle');
            input.value = '0.9';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return window.kitchenKit.design().checks.some((entry) => entry.id === 'aisle');
        })()`);
        check('a narrow aisle is flagged', narrow === true);

        // Back to the default before handing over a sensible run.
        await suite.evaluate("document.getElementById('reset').click()");
        await sleep(300);

        await suite.send('Fetch.enable', { patterns: [{ urlPattern: '*Editor.html*', requestStage: 'Request' }] });
        await suite.evaluate("document.getElementById('send-editor').click()");
        let aborted = false;
        for (let i = 0; i < 60; i += 1) {
            const paused = suite.events.find((event) => event.method === 'Fetch.requestPaused'
                && event.params.request.url.includes('Editor.html'));
            if (paused) {
                await suite.send('Fetch.failRequest', { requestId: paused.params.requestId, errorReason: 'Aborted' });
                aborted = true;
                break;
            }
            await sleep(100);
        }
        await suite.send('Fetch.disable');
        check('send to editor opens the studio', aborted);

        const draftJson = await suite.evaluate("localStorage.getItem('kitchen-editor-draft')");
        // Versioned payload: `{ version, savedAt, data }` (core/drafts.js).
        const draft = JSON.parse(draftJson || 'null')?.data ?? null;
        check('the kitchen draft carries the run', Boolean(draft && draft.modules?.length === 6), `${draft?.modules?.length ?? 0} modules`);

        // --- Editor -------------------------------------------------------
        const editor = await newTarget(null, `${ORIGIN}/pages/Editor.html`);
        check('editor boots', await waitFor(editor, 'Boolean(window.featureKit && window.editorKit)'));

        await editor.evaluate(`(async () => {
            window.clearProject();
            document.querySelector('[data-tool="wall"]')?.click();
            const canvas = document.getElementById('blueprint-canvas');
            const rect = canvas.getBoundingClientRect();
            const at = (x, y) => ({
                clientX: rect.left + (x / canvas.width) * rect.width,
                clientY: rect.top + (y / canvas.height) * rect.height
            });
            const draw = (x1, y1, x2, y2) => {
                canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, isPrimary: true, pointerId: 7, ...at(x1, y1) }));
                canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, isPrimary: true, pointerId: 7, ...at(x2, y2) }));
                canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, isPrimary: true, pointerId: 7, ...at(x2, y2) }));
            };
            draw(canvas.width * 0.18, canvas.height * 0.4, canvas.width * 0.82, canvas.height * 0.4);
            draw(canvas.width * 0.18, canvas.height * 0.68, canvas.width * 0.82, canvas.height * 0.68);
            await new Promise((resolve) => setTimeout(resolve, 600));
            await window.flushAutosave();
            await new Promise((resolve) => setTimeout(resolve, 400));
            return window.featureKit.walls().length;
        })()`);
        check('two measured walls are on the plan', (await editor.evaluate('window.featureKit.walls().length')) === 2);

        await editor.evaluate(`localStorage.setItem('kitchen-editor-draft', ${JSON.stringify(draftJson)})`);
        await editor.evaluate('window.__beforeKitchenReload = true');
        await editor.send('Page.reload');
        check('editor reloads with the kitchen run', await waitFor(editor,
            "Boolean(!window.__beforeKitchenReload && window.featureKit && window.kitchenKit && window.kitchenKit.added)"));

        const imported = await editor.evaluate(`(() => ({
            added: window.kitchenKit.added(),
            fixtures: window.featureKit.fixtures().length,
            types: window.featureKit.fixtures().map((fixture) => fixture.type),
            draftLeft: localStorage.getItem('kitchen-editor-draft')
        }))()`);
        check('the run lands in the plan', imported.added === 6, String(imported.added));
        check('the cabinets exist as 3D fixtures', imported.fixtures >= 6, JSON.stringify(imported.types));
        check('the kitchen draft is consumed', imported.draftLeft === null);

        // --- Elevation: one wall at a time --------------------------------
        const elevation = await editor.evaluate(`(async () => {
            window.setElevationView('front');
            await new Promise((resolve) => setTimeout(resolve, 700));
            const first = window.elevationKit.wall();
            const visibleFirst = window.elevationKit.visible();
            const walls = window.elevationKit.walls();
            window.stepElevationWall(1);
            await new Promise((resolve) => setTimeout(resolve, 500));
            const second = window.elevationKit.wall();
            const visibleSecond = window.elevationKit.visible();
            return { first, second, walls, visibleFirst, visibleSecond };
        })()`);
        check('the elevation lists both walls', elevation.walls.length === 2, JSON.stringify(elevation.walls));
        check('the elevation shows a single wall', new Set(elevation.visibleFirst).size === 1, JSON.stringify(elevation.visibleFirst));
        check('the shown wall is the framed one',
            elevation.visibleFirst.every((id) => id === elevation.first),
            `${elevation.first} vs ${JSON.stringify(elevation.visibleFirst)}`);
        check('stepping moves to the other wall', elevation.second && elevation.second !== elevation.first);
        check('stepping still shows one wall', new Set(elevation.visibleSecond).size === 1, JSON.stringify(elevation.visibleSecond));

        const levels = await editor.evaluate(`(async () => {
            const before = window.studioKit.storeys().length;
            document.getElementById('add-level-btn').click();
            await new Promise((resolve) => setTimeout(resolve, 700));
            return { before, after: window.studioKit.storeys().length, label: document.getElementById('add-level-btn').textContent.trim() };
        })()`);
        check('the add-level button adds a storey', levels.after === levels.before + 1, `${levels.before} → ${levels.after}`);
        check('the add-level button is labelled', /Add level/.test(levels.label), levels.label);

        const errors = [...suite.errors(), ...editor.errors()].filter((error) => !error.includes('favicon'));
        check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));

        console.log(`\n${passed} passed, ${failed} failed`);
        process.exitCode = failed ? 1 : 0;
        suite.ws.close();
        editor.ws.close();
    } finally {
        chrome.kill();
        server.close();
        await sleep(300);
        await rm(profile, { recursive: true, force: true }).catch(() => {});
    }
}

main().catch((error) => {
    console.error('Kitchen check crashed:', error);
    process.exitCode = 1;
});
