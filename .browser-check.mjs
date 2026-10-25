import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8766';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        }
        return result.result?.value;
    }

    errors() {
        return this.events
            .filter((event) => event.method === 'Runtime.exceptionThrown')
            .map((event) => event.params.exceptionDetails?.exception?.description
                || event.params.exceptionDetails?.text
                || 'unknown exception')
            .concat(this.events
                .filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
                .map((event) => event.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')));
    }
}

async function waitForVersion() {
    for (let i = 0; i < 60; i++) {
        try {
            const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
            if (response.ok) return await response.json();
        } catch {
            // Chrome is still starting.
        }
        await sleep(250);
    }
    throw new Error('Chrome debug endpoint never came up');
}

async function main() {
    const profile = await mkdtemp(path.join(tmpdir(), 'buffit-chrome-'));
    const chrome = spawn(CHROME, [
        '--headless=new',
        '--disable-gpu',
        '--enable-unsafe-swiftshader',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--remote-debugging-port=${PORT}`,
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
        const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/stair-parts.html')}`, { method: 'PUT' })).json();
        const cdp = new CDP(target.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');

        async function load(url) {
            await cdp.send('Page.navigate', { url });
            await sleep(2500);
        }

        async function waitFor(expression, timeout = 8000) {
            const started = Date.now();
            while (Date.now() - started < timeout) {
                try {
                    if (await cdp.evaluate(expression)) return true;
                } catch {
                    // Not loaded yet.
                }
                await sleep(200);
            }
            return false;
        }

        console.log('\nParts gallery');
        check('gallery page exposes its API', await waitFor('Boolean(window.partsGallery)'));
        const gallery = await cdp.evaluate(`(() => {
            const buttons = document.querySelectorAll('.part-button');
            window.partsGallery.select('pole-shaft');
            return {
                count: window.partsGallery.count,
                buttons: buttons.length,
                categories: window.partsGallery.categories.length,
                selected: document.getElementById('info-title').textContent,
                size: document.getElementById('info-size').textContent,
                canvas: Boolean(document.querySelector('canvas'))
            };
        })()`);
        check('all parts are in the 3D gallery', gallery.count === 39, `${gallery.count} parts`);
        check('sidebar lists every part', gallery.buttons === 39, `${gallery.buttons} buttons`);
        check('parts grouped by category', gallery.categories >= 6, `${gallery.categories} categories`);
        check('selecting a part fills the card', gallery.selected.includes('Fire pole shaft'), gallery.selected);
        check('card shows real dimensions', gallery.size.includes('in') && gallery.size.includes('m'), gallery.size);
        check('WebGL canvas created', gallery.canvas);

        console.log('\nEditor boot');
        await load(BASE + '/Editor.html');
        check('stair kit is installed', await waitFor('Boolean(window.stairKit)'));
        check('landscape kit is installed', await waitFor('Boolean(window.landscapeKit)'));
        const boot = await cdp.evaluate(`({
            stairControls: document.querySelectorAll('#stair-controls select, #stair-controls input').length,
            stairSummary: document.getElementById('stair-summary')?.textContent.trim().slice(0, 60),
            landscapeControls: document.querySelectorAll('#landscape-controls select, #landscape-controls input').length,
            landscapeSummary: document.getElementById('landscape-summary')?.textContent.trim().slice(0, 60),
            canvases: document.querySelectorAll('canvas').length,
            outdoorButtons: document.querySelectorAll('[data-item^="stair_"], [data-item="fire_pole"]').length,
            waterButtons: document.querySelectorAll('[data-item="pool"], [data-item="spa"], [data-item="fountain"], [data-item="pond"], [data-item="waterfall"], [data-item="water_wall"]').length
        })`);
        check('stair option bar rendered', boot.stairControls >= 7, `${boot.stairControls} controls`);
        check('stair summary rendered', boot.stairSummary.length > 10, boot.stairSummary);
        check('landscape option bar rendered', boot.landscapeControls >= 7, `${boot.landscapeControls} controls`);
        check('landscape summary rendered', boot.landscapeSummary.length > 10, boot.landscapeSummary);
        check('3D and plan canvases present', boot.canvases >= 2, `${boot.canvases} canvases`);
        check('outdoor stair palette buttons', boot.outdoorButtons === 6, `${boot.outdoorButtons} buttons`);
        check('water feature palette buttons', boot.waterButtons === 6, `${boot.waterButtons} buttons`);

        console.log('\nStair interaction');
        const stairFlow = await cdp.evaluate(`(() => {
            window.setStairField('system', 'egress');
            const drafted = window.stairKit.design();
            window.addStairFromPanel();
            const selected = window.stairKit.assembly();
            window.setViewMode('3d');
            return {
                draftedSystem: drafted.system,
                guard: drafted.guard.height / 0.0254,
                width: drafted.width / 0.0254,
                type: window.stairKit.selected()?.type,
                selectedSystem: selected.system,
                landings: window.stairKit.assembly().subTypes.landing.automatic,
                convert: window.studioKit.convert()
            };
        })()`);
        check('egress preset applied to the draft', stairFlow.draftedSystem === 'egress', stairFlow.draftedSystem);
        check('egress guard is 42 in', Math.round(stairFlow.guard) === 42, `${stairFlow.guard.toFixed(1)} in`);
        check('egress width is 44 in', Math.round(stairFlow.width) === 44, `${stairFlow.width.toFixed(1)} in`);
        check('stair added and selected', stairFlow.type === 'stair_egress', stairFlow.type);
        check('automatic landings on the placed stair', stairFlow.landings === true);
        check('3D rebuilt with the stair', stairFlow.convert && stairFlow.convert.stories >= 1, JSON.stringify(stairFlow.convert?.walls || {}));

        const geometry = await cdp.evaluate(`(async () => {
            const { buildStairGeometry, buildStairAssembly, computeOutdoorStair } = await import('./features/stairs/index.js');
            const item = { type: 'stair_deck', x: 300, y: 300, rotation: 0,
                metadata: { width: 0.9144, depth: 4.4, height: 2.7 },
                stair: { system: 'deck', type: 'straight', code: 'IRC2021', width: 0.9144, availableRun: 4.4, availableWidth: 1.2 } };
            const group = buildStairGeometry(item, { storeyHeight: 2.7 });
            let meshes = 0; const names = [];
            group.traverse((child) => { if (child.isMesh) meshes += 1; if (child.name) names.push(child.name); });
            const design = computeOutdoorStair({ system: 'deck', storeyHeight: 2.7 });
            return { meshes, top: names.includes('top-landing'), bottom: names.includes('bottom-landing'),
                piers: names.filter((name) => name === 'pier-footing').length, treads: design.treads, parts: design.bom.totals.parts };
        })()`);
        check('browser builds the stair meshes', geometry.meshes > 20, `${geometry.meshes} meshes`);
        check('browser builds both landings', geometry.top && geometry.bottom);
        check('browser builds four piers', geometry.piers === 4, `${geometry.piers}`);
        check('deck takeoff has parts', geometry.parts > 20, `${geometry.parts} parts`);

        console.log('\nLandscape interaction');
        const landscapeFlow = await cdp.evaluate(`(() => {
            window.setLandscapeField('type', 'spa');
            window.setLandscapeField('waterTempF', 106);
            const hot = window.landscapeKit.design();
            window.setLandscapeField('waterTempF', 102);
            window.addLandscapeFromPanel();
            const placed = window.landscapeKit.design();
            return {
                type: placed.type,
                gallons: placed.gallons,
                flow: placed.flowGpm,
                barrier: placed.barrier.height / 0.0254,
                selected: document.getElementById('landscape-summary').textContent.includes('Spa'),
                hotRejected: hot.errors.some((issue) => issue.code === 'spa-temp'),
                convert: window.studioKit.convert()
            };
        })()`);
        check('spa added from the panel', landscapeFlow.type === 'spa', landscapeFlow.type);
        check('spa volume computed', landscapeFlow.gallons > 500, `${Math.round(landscapeFlow.gallons)} gal`);
        check('spa circulation computed', landscapeFlow.flow > 10, `${landscapeFlow.flow.toFixed(1)} gpm`);
        check('spa barrier is 48 in', Math.round(landscapeFlow.barrier) === 48);
        check('over-temperature spa rejected', landscapeFlow.hotRejected === true);
        check('3D rebuilt with the water feature', landscapeFlow.convert && landscapeFlow.convert.stories >= 1);

        const waterGeometry = await cdp.evaluate(`(async () => {
            const { buildWaterFeature, computeWaterFeature } = await import('./features/landscape/index.js');
            const item = { type: 'pool', x: 100, y: 100, rotation: 0,
                metadata: { width: 4, depth: 9, height: 0.1 },
                landscape: { type: 'pool', shape: 'rectangle', width: 4, length: 9, shallow: 1.1, deep: 1.9, deck: 1.22 } };
            const group = buildWaterFeature(item);
            let meshes = 0; let water = 0;
            group.traverse((child) => { if (child.isMesh) meshes += 1; if (child.userData.isWater) water += 1; });
            const design = computeWaterFeature({ type: 'pool' });
            return { meshes, water, gallons: Math.round(design.gallons) };
        })()`);
        check('browser builds the pool meshes', waterGeometry.meshes > 10, `${waterGeometry.meshes} meshes`);
        check('pool has a single water surface', waterGeometry.water === 1);

        console.log('\nWalkable stairs');
        const walk = await cdp.evaluate(`(() => {
            const started = window.walkStairs();
            const walker = window.stairKit.walker();
            const status = document.getElementById('stair-walk-status').textContent;
            const after = walker?.update(0.1);
            walker?.stop();
            return { started, active: Boolean(walker), status, sample: after };
        })()`);
        check('walk mode starts', walk.started === true, walk.status);
        check('walker exposes a height sample', Boolean(walk.sample), walk.sample ? `${walk.sample.height.toFixed(2)} m at storey ${walk.sample.storeyIndex}` : 'none');

        console.log('\nPlan drawing');
        const plan = await cdp.evaluate(`(() => {
            const canvas = document.getElementById('blueprint-canvas');
            const ctx = canvas.getContext('2d');
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let painted = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) painted += 1;
            return { width: canvas.width, height: canvas.height, painted };
        })()`);
        check('plan canvas has the drawn stair', plan.painted > 500, `${plan.painted} painted pixels`);

        const errors = cdp.errors().filter((error) => !error.includes('textures/') && !error.includes('favicon'));
        check('no uncaught runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));

        console.log(`\n${passed} passed, ${failed} failed`);
        process.exitCode = failed ? 1 : 0;
        cdp.ws.close();
    } finally {
        chrome.kill();
        await sleep(300);
        await rm(profile, { recursive: true, force: true }).catch(() => {});
    }
}

main().catch((error) => {
    console.error('Browser check crashed:', error);
    process.exitCode = 1;
});
