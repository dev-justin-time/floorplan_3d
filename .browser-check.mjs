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

        console.log('\nStair models');
        const modelFlow = await cdp.evaluate(`(async () => {
            window.setStairField('model', 'alt-tread');
            const design = window.stairKit.design();
            const item = window.stairKit.selected();
            const { buildStairGeometry } = await import('./features/stairs/geometry.js');
            const group = buildStairGeometry(item, { storeyHeight: 2.7 });
            let altTreads = 0;
            group.traverse((child) => { if (child.name && child.name.startsWith('alt-tread-')) altTreads += 1; });
            const modelSelect = document.querySelector('#stair-controls select');
            const summary = document.getElementById('stair-summary').textContent;
            const first = {
                key: design.model?.key,
                width: design.width / 0.0254,
                slope: design.model?.slopeDegrees,
                altTreads,
                itemModel: item?.stair?.model,
                options: modelSelect ? modelSelect.querySelectorAll('option').length : 0,
                groups: modelSelect ? modelSelect.querySelectorAll('optgroup').length : 0,
                summary
            };

            window.setStairField('model', 'mono-straight');
            const monoDesign = window.stairKit.design();
            const monoGroup = buildStairGeometry(window.stairKit.selected(), { storeyHeight: 2.7 });
            let monoStringers = 0;
            monoGroup.traverse((child) => { if (child.name === 'mono-stringer') monoStringers += 1; });

            window.setStairField('model', 'ships-ladder');
            const ladderDesign = window.stairKit.design();

            const convert = window.studioKit.convert();
            return {
                first,
                mono: { key: monoDesign.model?.key, stringers: monoStringers, width: monoDesign.width / 0.0254 },
                ladder: { key: ladderDesign.model?.key, slope: ladderDesign.model?.slopeDegrees },
                convert: Boolean(convert)
            };
        })()`);
        check('model selector lists every family', modelFlow.first.options === 13, `${modelFlow.first.options} options in ${modelFlow.first.groups} groups`);
        check('model applies to the selected stair', modelFlow.first.key === 'alt-tread' && modelFlow.first.itemModel === 'alt-tread');
        check('alternating tread sized at 24 in', Math.round(modelFlow.first.width) === 24, `${modelFlow.first.width.toFixed(1)} in`);
        check('alternating tread model geometry in the scene graph', modelFlow.first.altTreads > 6, `${modelFlow.first.altTreads} half treads`);
        check('panel summary names the model', modelFlow.first.summary.includes('Alternating tread device'), modelFlow.first.summary.slice(-160));
        check('switching models rebuilds the run', modelFlow.mono.key === 'mono-straight' && modelFlow.mono.stringers === 1, `${modelFlow.mono.key}, ${modelFlow.mono.stringers} stringer`);
        check('ships ladder switches to the steep profile', modelFlow.ladder.key === 'ships-ladder' && modelFlow.ladder.slope > 55, `${modelFlow.ladder.slope}°`);
        check('3D rebuilt after model changes', modelFlow.convert === true);

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

        console.log('\nPlan footprint');
        const planBounds = await cdp.evaluate(`(async () => {
            const { stairPlanBounds, buildStairGeometry } = await import('./features/stairs/index.js');
            const THREE = await import('three');
            const item = { type: 'stair_deck', x: 300, y: 300, rotation: 0,
                metadata: { width: 0.9144, depth: 4.6, height: 2.7 },
                stair: { system: 'deck', type: 'straight', code: 'IRC2021', width: 0.9144, availableRun: 4.4, availableWidth: 1.2 } };
            const bounds = stairPlanBounds(item, { storeyHeight: 2.7 });
            const group = buildStairGeometry(item, { storeyHeight: 2.7 });
            const box = new THREE.Box3().setFromObject(group);
            window.setStairField('system', 'deck');
            window.addStairFromPanel();
            const itemSize = window.stairKit.selected()?.size;
            return {
                depth: bounds.depth,
                landings: bounds.landings.length,
                threeD: box.max.z - box.min.z,
                sizeDepth: itemSize?.depth,
                sizeWidth: itemSize?.width
            };
        })()`);
        check('plan footprint carries both landings', planBounds.landings === 2, `${planBounds.landings} landings`);
        check('plan footprint depth matches the 3D build', Math.abs(planBounds.depth - planBounds.threeD) < 0.05,
            `${planBounds.depth.toFixed(2)} m plan vs ${planBounds.threeD.toFixed(2)} m 3D`);
        check('item size follows the landed footprint', Math.abs(planBounds.sizeDepth - planBounds.depth) < 0.05,
            `${planBounds.sizeDepth?.toFixed(2)} m size vs ${planBounds.depth.toFixed(2)} m bounds`);

        const picking = await cdp.evaluate(`(async () => {
            const { stairPlanBounds } = await import('./features/stairs/index.js');
            const { PIXELS_PER_METER } = await import('./world-space.js');
            const canvas = document.getElementById('blueprint-canvas');
            const rect = canvas.getBoundingClientRect();
            const click = (x, y) => {
                const point = {
                    clientX: rect.left + (x / canvas.width) * rect.width,
                    clientY: rect.top + (y / canvas.height) * rect.height
                };
                canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, ...point }));
                canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, ...point }));
            };
            // A stair straight from the palette, not the panel: no explicit size.
            document.querySelector('[data-item="stair"]').click();
            click(canvas.width / 2, canvas.height / 2);
            const placed = window.featureKit.fixtures().slice(-1)[0];
            const bounds = stairPlanBounds(placed, { storeyHeight: 2.7 });
            const bottom = bounds.landings.find((landing) => landing.end === 'bottom');
            document.querySelector('[data-tool="select"]')?.click();
            click(canvas.width - 30, canvas.height - 30);
            const cleared = !window.stairKit.selected();
            const lx = placed.x + ((bottom.minX + bottom.maxX) / 2) * PIXELS_PER_METER;
            const ly = placed.y + ((bottom.minZ + bottom.maxZ) / 2) * PIXELS_PER_METER;
            click(lx, ly);
            return {
                width: placed.size?.width,
                depth: placed.size?.depth,
                bounds: { width: bounds.width, depth: bounds.depth },
                cleared,
                selectedLanding: window.stairKit.selected()?.id === placed.id
            };
        })()`);
        check('palette-placed stair is sized with its landings',
            Math.abs(picking.depth - picking.bounds.depth) < 0.05 && Math.abs(picking.width - picking.bounds.width) < 0.05,
            `${picking.width?.toFixed(2)} × ${picking.depth?.toFixed(2)} m`);
        check('clicking a landing selects the stair', picking.cleared && picking.selectedLanding === true,
            picking.selectedLanding ? 'selected' : 'missed');

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

        console.log('\nStoreys, cutouts and roof');
        await load(BASE + '/Editor.html');
        check('studio kit survives the reload', await waitFor('Boolean(window.studioKit)'));
        const storeyFlow = await cdp.evaluate(`(() => {
            window.clearProject();
            const canvas = document.getElementById('blueprint-canvas');
            const rect = canvas.getBoundingClientRect();
            const at = (x, y) => ({
                clientX: rect.left + (x / canvas.width) * rect.width,
                clientY: rect.top + (y / canvas.height) * rect.height
            });
            const drag = (from, to) => {
                canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, ...at(from.x, from.y) }));
                canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, ...at(to.x, to.y) }));
                canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, ...at(to.x, to.y) }));
            };
            const click = (point) => {
                canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, ...at(point.x, point.y) }));
                canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, ...at(point.x, point.y) }));
            };
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            const corners = [
                { x: cx - 300, y: cy - 240 }, { x: cx + 300, y: cy - 240 },
                { x: cx + 300, y: cy + 240 }, { x: cx - 300, y: cy + 240 }
            ];
            document.querySelector('[data-tool="wall"]').click();
            corners.forEach((corner, index) => drag(corner, corners[(index + 1) % corners.length]));
            // Off-centre partition: the footprint centre stays walkable.
            drag({ x: cx - 120, y: cy - 240 }, { x: cx - 120, y: cy + 240 });
            document.querySelector('[data-item="window"]').click();
            click({ x: cx + 60, y: cy - 240 });

            const key = (wall) => [wall.start.x, wall.start.y, wall.end.x, wall.end.y]
                .map((value) => Number(value).toFixed(2)).join(',');
            const groundWalls = window.featureKit.walls();
            const groundKeys = new Set(groundWalls.map(key));
            const groundWindows = window.featureKit.fixtures().filter((fixture) => fixture.type === 'window');

            window.addStorey();
            const upperWalls = window.featureKit.walls();
            const upperWindows = window.featureKit.fixtures().filter((fixture) => fixture.type === 'window');
            const upperIds = upperWalls.map((wall) => wall.id);
            const storeys = window.studioKit.storeys();
            const construction = window.studioKit.construction();
            const convert = window.studioKit.convert();
            return {
                groundWalls: groundWalls.length,
                groundWindows: groundWindows.length,
                groundWindowWall: groundWindows[0]?.boundToWallId || null,
                upperWalls: upperWalls.length,
                sameFootprint: upperWalls.every((wall) => groundKeys.has(key(wall))),
                upperWindows: upperWindows.length,
                rebound: upperWindows[0]?.boundToWallId || null,
                upperIds,
                storeys: storeys.map((story) => ({
                    name: story.name, elevation: story.elevation, height: story.height,
                    walls: story.walls, fixtures: story.fixtures
                })),
                construction,
                convert,
                cutoutButton: document.querySelectorAll('.tool-btn[data-tool="cutout"]').length,
                pitchText: document.getElementById('storey-pitch')?.textContent
            };
        })()`);
        check('cutout tool is in the palette', storeyFlow.cutoutButton === 1, `${storeyFlow.cutoutButton} button`);
        check('storey pitch is 96 in plus an 8 in joist',
            Math.abs(storeyFlow.construction.wallHeight - 2.4384) < 1e-6
            && Math.abs(storeyFlow.construction.floorDepth - 0.2032) < 1e-6
            && Math.abs(storeyFlow.construction.pitch - 2.6416) < 1e-6,
            `${storeyFlow.construction.wallHeight.toFixed(4)} + ${storeyFlow.construction.floorDepth.toFixed(4)} = ${storeyFlow.construction.pitch.toFixed(4)} m`);
        check('storey panel quotes the construction', /96 in walls/.test(storeyFlow.pitchText || ''), storeyFlow.pitchText);
        check('adding a storey stacks it one pitch up',
            storeyFlow.storeys.length === 2 && storeyFlow.storeys[1].name === 'Floor 2'
            && Math.abs(storeyFlow.storeys[1].elevation - 2.6416) < 1e-6,
            `${storeyFlow.storeys[1]?.name} at ${storeyFlow.storeys[1]?.elevation?.toFixed(2)} m`);
        check('second floor repeats the exterior footprint',
            storeyFlow.groundWalls === 5 && storeyFlow.upperWalls === 4 && storeyFlow.sameFootprint,
            `${storeyFlow.upperWalls} of ${storeyFlow.groundWalls} walls`);
        check('second floor copies the windows',
            storeyFlow.groundWindows === 1 && storeyFlow.upperWindows === 1,
            `${storeyFlow.upperWindows} window(s)`);
        check('copied window binds to the new wall',
            storeyFlow.upperIds.includes(storeyFlow.rebound) && storeyFlow.rebound !== storeyFlow.groundWindowWall,
            `${storeyFlow.rebound}`);
        check('top storey carries the truss roof',
            Boolean(storeyFlow.convert?.roof) && storeyFlow.convert.roof.trusses >= 20 && storeyFlow.convert.roof.joists === storeyFlow.convert.roof.trusses,
            storeyFlow.convert?.roof ? `${storeyFlow.convert.roof.trusses} trusses, ${storeyFlow.convert.roof.rise.toFixed(2)} m rise` : 'none');

        const cutoutFlow = await cdp.evaluate(`(() => {
            const canvas = document.getElementById('blueprint-canvas');
            const rect = canvas.getBoundingClientRect();
            const at = (x, y) => ({
                clientX: rect.left + (x / canvas.width) * rect.width,
                clientY: rect.top + (y / canvas.height) * rect.height
            });
            const drag = (from, to) => {
                canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, ...at(from.x, from.y) }));
                canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, ...at(to.x, to.y) }));
                canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, ...at(to.x, to.y) }));
            };
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            document.querySelector('[data-tool="cutout"]').click();
            drag({ x: cx - 120, y: cy - 60 }, { x: cx + 120, y: cy + 60 });
            const created = window.studioKit.openings();
            const before = created[0] ? created[0].points.map((point) => ({ ...point })) : [];

            // Drag one corner further out.
            if (before.length) drag(before[0], { x: before[0].x - 30, y: before[0].y - 30 });
            const reshaped = window.studioKit.openings()[0];

            // Bend an edge with a double-click, then Delete the new point.
            let bentPoints = 0;
            let deletedPoints = 0;
            if (reshaped) {
                const a = reshaped.points[0];
                const b = reshaped.points[1];
                canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, ...at((a.x + b.x) / 2, (a.y + b.y) / 2) }));
                bentPoints = window.studioKit.openings()[0]?.points.length || 0;
                document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
                deletedPoints = window.studioKit.openings()[0]?.points.length || 0;
            }

            window.undo();
            const undoPoints = window.studioKit.openings()[0]?.points.length || 0;
            window.redo();
            const redoPoints = window.studioKit.openings()[0]?.points.length || 0;

            const convert = window.studioKit.convert();
            window.flushAutosave();
            const saved = JSON.parse(localStorage.getItem('floorplan3d_autosave') || 'null');
            const savedStory = saved?.stories?.[1];
            return {
                count: created.length,
                area: created[0]?.area || 0,
                corner: reshaped?.points[0],
                bentPoints,
                deletedPoints,
                undoPoints,
                redoPoints,
                convert,
                saved: savedStory ? {
                    openings: savedStory.openings?.length ?? null,
                    wallHeight: savedStory.wallHeight,
                    floorDepth: savedStory.floorDepth,
                    height: savedStory.height
                } : null,
                panel: document.getElementById('openings-list')?.textContent.trim()
            };
        })()`);
        check('cutout drag makes one opening', cutoutFlow.count === 1, `${cutoutFlow.count} opening(s)`);
        check('cutout area is measured in metres', cutoutFlow.area > 20, `${cutoutFlow.area.toFixed(1)} m²`);
        check('dragging a point reshapes the hole',
            cutoutFlow.corner && cutoutFlow.corner.x !== undefined && cutoutFlow.corner.y !== undefined,
            cutoutFlow.corner ? `${cutoutFlow.corner.x.toFixed(0)}, ${cutoutFlow.corner.y.toFixed(0)}` : 'none');
        check('double-click bends the edge', cutoutFlow.bentPoints === 5, `${cutoutFlow.bentPoints} points`);
        check('Delete removes the extra point', cutoutFlow.deletedPoints === 4, `${cutoutFlow.deletedPoints} points`);
        check('undo restores the point', cutoutFlow.undoPoints === 5, `${cutoutFlow.undoPoints} points`);
        check('redo removes it again', cutoutFlow.redoPoints === 4, `${cutoutFlow.redoPoints} points`);
        check('3D floor is cut by the opening', cutoutFlow.convert?.openings >= 1, `${cutoutFlow.convert?.openings} hole(s)`);
        check('opening is listed in the storey panel', /Hole 1/.test(cutoutFlow.panel || ''), cutoutFlow.panel);
        check('openings persist in the project payload',
            cutoutFlow.saved?.openings === 1 && Math.abs(cutoutFlow.saved.wallHeight - 2.4384) < 1e-6,
            JSON.stringify(cutoutFlow.saved));

        console.log('\nFirst-person walk');
        const walkFlow = await cdp.evaluate(`(async () => {
            const canvas = document.getElementById('blueprint-canvas');
            const button = document.getElementById('walk-btn');
            window.toggleWalk();
            const started = window.studioKit.walk();
            const hudShown = !document.getElementById('walk-hud').classList.contains('hidden');
            const viewMode = window.studioKit.walk() ? document.getElementById('view-3d').style.opacity : null;

            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 700));
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
            const moved = window.studioKit.walk();

            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 200));
            return {
                button: Boolean(button),
                started,
                moved,
                hudShown,
                viewMode,
                ended: window.studioKit.walk().active,
                hudHidden: document.getElementById('walk-hud').classList.contains('hidden'),
                restoredY: window.studioKit.walk().position.y,
                canvasPixels: canvas.width
            };
        })()`);
        check('walk button is in the toolbar', walkFlow.button === true);
        check('walk starts at eye height on the active storey',
            walkFlow.started?.active === true && Math.abs(walkFlow.started.position.y - (2.6416 + 1.6)) < 0.05,
            `${walkFlow.started?.position.y?.toFixed(2)} m`);
        check('walk shows its HUD in the 3D view',
            walkFlow.hudShown === true && walkFlow.viewMode === '1', `opacity ${walkFlow.viewMode}`);
        check('WASD moves the walker',
            Math.hypot(walkFlow.moved.position.x - walkFlow.started.position.x, walkFlow.moved.position.z - walkFlow.started.position.z) > 0.5,
            `${Math.hypot(walkFlow.moved.position.x - walkFlow.started.position.x, walkFlow.moved.position.z - walkFlow.started.position.z).toFixed(2)} m`);
        check('Escape leaves the walk and restores the orbit camera',
            walkFlow.ended === false && walkFlow.hudHidden === true && walkFlow.restoredY > 3,
            `camera y ${walkFlow.restoredY.toFixed(2)} m`);

        console.log('\nFinishes palette');
        const finishFlow = await cdp.evaluate(`(() => {
            window.setFinishTarget('wall');
            const wallButtons = document.querySelectorAll('#finish-textures [data-finish-texture]').length;
            document.querySelector('#finish-textures [data-finish-texture="wood"]').click();
            const afterWood = window.studioKit.finishes();
            const convert = window.studioKit.convert();

            window.setFinishTarget('floor');
            const floorButtons = document.querySelectorAll('#finish-textures [data-finish-texture]').length;
            document.querySelector('#finish-textures [data-finish-texture="carpet"]').click();
            const afterCarpet = window.studioKit.finishes();
            const floorStatus = document.getElementById('finish-status').textContent;

            document.getElementById('finish-target-wall').click();
            const targetAfterClick = window.studioKit.finishes().target;
            return {
                wallButtons,
                floorButtons,
                afterWood,
                afterCarpet,
                floorStatus,
                targetAfterClick,
                converted: Boolean(convert) && convert.walls.built + convert.walls.reused >= 4
            };
        })()`);
        check('wall palette lists every wall texture', finishFlow.wallButtons === 6, `${finishFlow.wallButtons} textures`);
        check('wall texture applies to every wall', finishFlow.afterWood.wallTexture === 'wood' && finishFlow.converted, finishFlow.afterWood.wallTexture);
        check('floor palette lists every floor texture', finishFlow.floorButtons === 6, `${finishFlow.floorButtons} textures`);
        check('floor texture applies to the storey', finishFlow.afterCarpet.floorTexture === 'carpet', finishFlow.afterCarpet.floorTexture);
        check('finish status names the target and texture', /Floors · carpet/.test(finishFlow.floorStatus), finishFlow.floorStatus);
        check('palette target toggles back to walls', finishFlow.targetAfterClick === 'wall');

        const finishUpload = await cdp.evaluate(`(async () => {
            window.setFinishTarget('floor');
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#336699';
            ctx.fillRect(0, 0, 32, 32);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            const file = new File([blob], 'finish.png', { type: 'image/png' });
            const transfer = new DataTransfer();
            transfer.items.add(file);
            const input = document.getElementById('finish-upload');
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 600));
            return {
                texture: window.studioKit.finishes().floorTexture,
                options: [...document.querySelectorAll('#room-floors-list option')].map((option) => option.textContent),
                status: document.getElementById('finish-status').textContent,
                convert: window.studioKit.convert()
            };
        })()`);
        check('custom image becomes the floor finish',
            String(finishUpload.texture || '').startsWith('data:image/png'),
            String(finishUpload.texture || '').slice(0, 30));
        check('room floor select offers the custom image', finishUpload.options.includes('Custom image'), finishUpload.options.join(', '));
        check('custom finish still renders the 3D scene', Boolean(finishUpload.convert));
        check('finish status says custom image', /custom image/.test(finishUpload.status), finishUpload.status);

        const colourFlow = await cdp.evaluate(`(() => {
            window.setViewMode('2d');
            document.querySelector('[data-tool="select"]').click();
            const canvas = document.getElementById('blueprint-canvas');
            const rect = canvas.getBoundingClientRect();
            const point = {
                clientX: rect.left + ((canvas.width / 2) / canvas.width) * rect.width,
                clientY: rect.top + ((canvas.height / 2 - 240) / canvas.height) * rect.height
            };
            canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, ...point }));
            canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, ...point }));
            const selectedWall = !document.getElementById('selection-wall').classList.contains('hidden');
            const swatches = document.querySelectorAll('#finish-colours [data-finish-color]').length;
            document.querySelector('#finish-colours [data-finish-color="#8b5a2b"]').click();
            return {
                selectedWall,
                swatches,
                finish: window.studioKit.finishes(),
                activeSwatches: document.querySelectorAll('#finish-colours .ring-2').length
            };
        })()`);
        check('clicking a wall selects it for finishing', colourFlow.selectedWall === true);
        check('colour row has every swatch', colourFlow.swatches === 6, `${colourFlow.swatches} swatches`);
        check('a swatch colours the selected wall',
            colourFlow.finish.wall?.color === '#8b5a2b' && colourFlow.activeSwatches === 1,
            colourFlow.finish.wall?.color || 'none');

        console.log('\nStair gallery');
        await load(BASE + '/stair-gallery.html');
        check('gallery page boots', await waitFor('Boolean(window.stairGallery)'));
        const stairGallery = await cdp.evaluate(`(() => {
            const gallery = window.stairGallery;
            const entries = gallery.entries;
            const cellWidth = Math.max(...entries.map((entry) => entry.size[0])) + 0.8;
            const cellDepth = Math.max(...entries.map((entry) => entry.size[2])) + 0.8;
            const outside = entries.filter((entry) => {
                const [minX, minY, minZ] = entry.world.min;
                const [maxX, maxY, maxZ] = entry.world.max;
                return Math.abs(minX - entry.cell.x) > cellWidth / 2
                    || Math.abs(maxX - entry.cell.x) > cellWidth / 2
                    || Math.abs(minZ - entry.cell.z) > cellDepth / 2
                    || Math.abs(maxZ - entry.cell.z) > cellDepth / 2
                    || Math.abs(minY) > 0.01;
            }).map((entry) => entry.key);
            let overlaps = 0;
            for (let i = 0; i < entries.length; i += 1) {
                for (let j = i + 1; j < entries.length; j += 1) {
                    const a = entries[i].world;
                    const b = entries[j].world;
                    if (a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[2] < b.max[2] && a.max[2] > b.min[2]) overlaps += 1;
                }
            }

            // Every family has to be on screen in the opening frame.
            const view = document.querySelector('#stage canvas').getBoundingClientRect();
            const visible = new Set();
            for (let gx = 0.05; gx <= 0.95; gx += 0.02) {
                for (let gy = 0.05; gy <= 0.95; gy += 0.02) {
                    const key = gallery.pickAt(view.left + view.width * gx, view.top + view.height * gy);
                    if (key) visible.add(key);
                }
            }

            document.querySelector('.model-button[data-key="alt-tread"]').click();
            const list = {
                selected: gallery.selected,
                title: document.getElementById('info-title').textContent
            };
            gallery.clearSelection();
            const reset = {
                selected: gallery.selected,
                active: document.querySelectorAll('.model-button.active').length,
                hidden: document.getElementById('info-size').classList.contains('hidden')
            };
            gallery.select('pan-stair');
            const info = {
                title: document.getElementById('info-title').textContent,
                size: document.getElementById('info-size').textContent,
                code: document.getElementById('info-code').textContent,
                checks: document.getElementById('info-checks').textContent,
                summary: document.getElementById('info-summary').textContent
            };

            const canvas = document.querySelector('#stage canvas');
            const rect = canvas.getBoundingClientRect();
            let pick = null;
            for (let gx = 0.2; gx <= 0.9 && !pick; gx += 0.03) {
                for (let gy = 0.2; gy <= 0.9 && !pick; gy += 0.03) {
                    if (gallery.pickAt(rect.left + rect.width * gx, rect.top + rect.height * gy) === 'pan-stair') {
                        pick = { gx: Number(gx.toFixed(2)), gy: Number(gy.toFixed(2)) };
                    }
                }
            }
            const miss = gallery.pickAt(rect.left + 2, rect.top + 2);

            document.getElementById('toggle-labels').click();
            const labelsOff = document.getElementById('toggle-labels').textContent.trim();
            document.getElementById('toggle-labels').click();

            return {
                count: gallery.count,
                labelCount: gallery.labelCount,
                buttons: document.querySelectorAll('.model-button').length,
                uniqueX: new Set(entries.map((entry) => entry.cell.x.toFixed(3))).size,
                uniqueZ: new Set(entries.map((entry) => entry.cell.z.toFixed(3))).size,
                outside,
                overlaps,
                visible: [...visible],
                list,
                reset,
                info,
                pick,
                miss,
                labelsOff,
                labelsOn: document.getElementById('toggle-labels').textContent.trim(),
                gl: Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')),
                canvas: { width: canvas.width, height: canvas.height }
            };
        })()`);
        check('gallery renders all 12 models', stairGallery.count === 12 && stairGallery.buttons === 12 && stairGallery.labelCount === 12,
            `${stairGallery.count} models, ${stairGallery.buttons} buttons, ${stairGallery.labelCount} labels`);
        check('models are laid out side by side', stairGallery.uniqueX === 4 && stairGallery.uniqueZ === 3 && stairGallery.overlaps === 0,
            `${stairGallery.uniqueX} columns × ${stairGallery.uniqueZ} rows, ${stairGallery.overlaps} overlaps`);
        check('every model sits in its own bay', stairGallery.outside.length === 0, stairGallery.outside.join(', ') || 'all inside');
        check('all 12 models are on screen at once', stairGallery.visible.length === 12,
            `${stairGallery.visible.length} visible`);
        check('gallery list selects a model', stairGallery.list.selected === 'alt-tread' && stairGallery.list.title.includes('Alternating'), stairGallery.list.title);
        check('gallery resets to all models', stairGallery.reset.selected === null && stairGallery.reset.active === 0 && stairGallery.reset.hidden,
            `${stairGallery.reset.active} active buttons`);
        check('model card shows the family numbers',
            stairGallery.info.title.includes('pan stair') && stairGallery.info.size.includes('° slope') && stairGallery.info.size.includes('m footprint')
            && stairGallery.info.code.includes('IBC') && stairGallery.info.checks.length > 0 && stairGallery.info.summary.length > 20,
            stairGallery.info.size);
        check('a rendered model picks from the scene', Boolean(stairGallery.pick),
            stairGallery.pick ? `hit at ${stairGallery.pick.gx}, ${stairGallery.pick.gy}` : 'no ray hit');
        check('empty space picks nothing', stairGallery.miss === null);
        check('labels can be turned off and on', stairGallery.labelsOff === 'Labels off' && stairGallery.labelsOn === 'Labels on',
            `${stairGallery.labelsOff} → ${stairGallery.labelsOn}`);
        check('gallery WebGL canvas is live', stairGallery.gl && stairGallery.canvas.width > 0 && stairGallery.canvas.height > 0,
            `${stairGallery.canvas.width}×${stairGallery.canvas.height}`);

        console.log('\nStair glossary');
        await load(BASE + '/stair-glossary.html');
        check('glossary page boots', await waitFor('Boolean(window.stairGlossary)'));
        const glossary = await cdp.evaluate(`(() => {
            const api = window.stairGlossary;
            const cards = document.querySelectorAll('.term-card').length;
            const filtered = api.filter('headroom');
            const visible = [...document.querySelectorAll('.term-card')]
                .filter((card) => !card.hidden)
                .map((card) => card.dataset.term);
            const miss = api.filter('zzzz-nothing');
            const emptyShown = !document.getElementById('glossary-empty').classList.contains('hidden');
            const input = document.getElementById('glossary-search');
            input.value = 'riser';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const viaInput = [...document.querySelectorAll('.term-card')].filter((card) => !card.hidden).length;
            api.filter('');
            const restored = [...document.querySelectorAll('.term-card')].filter((card) => !card.hidden).length;
            const text = document.body.innerText;
            return {
                terms: api.terms,
                formulas: api.formulas,
                cards,
                formulaRows: document.querySelectorAll('#formula-list > div').length,
                filtered,
                visible,
                miss,
                emptyShown,
                viaInput,
                restored,
                adjustmentRows: document.querySelectorAll('#adjustments tbody tr').length,
                failing: document.querySelectorAll('#adjustments td.text-rose-700').length,
                angleRows: document.querySelectorAll('#angles tbody tr').length,
                worked: {
                    steps: text.includes('16 / 17'),
                    rise: text.includes('176.47 mm'),
                    going: text.includes('277.06 mm'),
                    angle: text.includes('32.49°'),
                    run: text.includes('4482.96 mm'),
                    headroom: text.includes('1947.45 mm')
                },
                overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
            };
        })()`);
        check('glossary lists every term', glossary.terms === 24 && glossary.cards === 24, `${glossary.cards} cards`);
        check('every formula is listed', glossary.formulas === 10 && glossary.formulaRows === 10, `${glossary.formulaRows} rows`);
        check('glossary filter narrows the list', glossary.filtered === 1 && glossary.visible.includes('headroom'), glossary.visible.join(', '));
        check('search input is wired to the filter', glossary.viaInput > 0, `${glossary.viaInput} matches for “riser”`);
        check('no match shows the empty state', glossary.miss === 0 && glossary.emptyShown);
        check('clearing the filter restores every term', glossary.restored === 24, `${glossary.restored} terms`);
        check('worked example shows every result', Object.values(glossary.worked).every(Boolean), JSON.stringify(glossary.worked));
        check('adjustment table has ten rows and two failing headrooms', glossary.adjustmentRows === 10 && glossary.failing === 2,
            `${glossary.adjustmentRows} rows, ${glossary.failing} below 1900 mm`);
        check('angle bands table has four bands', glossary.angleRows === 4, `${glossary.angleRows} rows`);
        check('glossary page fits without sideways scroll', glossary.overflow <= 1, `${glossary.overflow}px`);

        console.log('\nStair designer');
        await load(BASE + '/stair-designer.html');
        check('designer page boots', await waitFor('Boolean(window.stairDesigner)'));
        const designer = await cdp.evaluate(`(() => {
            const result = window.stairDesigner.compute();
            const canvas = document.getElementById('elevation');
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let painted = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) painted += 1;
            return {
                risers: result.steps,
                stepHeight: Math.round(result.stepHeight),
                going: Math.round(result.going),
                headroom: Math.round(result.headroom),
                comfort: result.comfort,
                checks: document.querySelectorAll('#checks li').length,
                painted,
                canvas3d: document.querySelectorAll('#stage canvas').length,
                results: document.getElementById('results').textContent,
                canvasSize: (() => {
                    const canvas = document.querySelector('#stage canvas');
                    const stage = document.getElementById('stage');
                    const rect = canvas.getBoundingClientRect();
                    return { width: Math.round(rect.width), stageWidth: Math.round(stage.clientWidth), height: Math.round(rect.height), stageHeight: Math.round(stage.clientHeight) };
                })(),
                overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
            };
        })()`);
        check('designer computes the flight', designer.risers >= 3 && designer.stepHeight > 100, `${designer.risers} × ${designer.stepHeight} mm`);
        check('designer elevation is drawn', designer.painted > 5000, `${designer.painted} painted pixels`);
        check('designer 3D canvas present', designer.canvas3d === 1, `${designer.canvas3d} canvas`);
        check('designer result card filled', designer.results.includes('Step height') && designer.results.includes('Headroom'));
        check('designer checks rendered', designer.checks >= 5, `${designer.checks} checks`);
        check('3D canvas fills its pane', Math.abs(designer.canvasSize.width - designer.canvasSize.stageWidth) <= 2
            && Math.abs(designer.canvasSize.height - designer.canvasSize.stageHeight) <= 2,
            `${designer.canvasSize.width}×${designer.canvasSize.height} in ${designer.canvasSize.stageWidth}×${designer.canvasSize.stageHeight}`);
        check('designer page does not scroll sideways', designer.overflow <= 1, `${designer.overflow}px`);

        const designerFlow = await cdp.evaluate(`(() => {
            const set = (id, value) => {
                const el = document.getElementById(id);
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            };
            set('height', 3000);
            const tall = window.stairDesigner.compute();
            set('opening-length', 1500);
            const shortOpening = window.stairDesigner.compute();
            const errors = document.querySelectorAll('#checks .check-error').length;
            document.getElementById('reset').click();
            return {
                tallSteps: tall.steps,
                tallRise: Math.round(tall.stepHeight),
                shortHeadroom: Math.round(shortOpening.headroom),
                errors,
                resetHeadroom: Math.round(window.stairDesigner.compute().headroom)
            };
        })()`);
        check('height input resizes the flight', designerFlow.tallSteps !== designer.risers || designerFlow.tallRise !== designer.stepHeight,
            `${designerFlow.tallSteps} × ${designerFlow.tallRise} mm`);
        check('short opening fails headroom', designerFlow.shortHeadroom < 1900 && designerFlow.errors > 0, `${designerFlow.shortHeadroom} mm`);
        check('reset restores the defaults', designerFlow.resetHeadroom >= 1900, `${designerFlow.resetHeadroom} mm`);

        const draft = await cdp.evaluate(`(() => {
            document.getElementById('add-to-plan').click();
            return JSON.parse(localStorage.getItem('stair-designer-draft'));
        })()`);
        check('designer saves a draft for the editor', Boolean(draft?.stair), JSON.stringify(draft?.stair || {}));
        await sleep(3000);
        const placed = await cdp.evaluate(`({
            path: location.pathname,
            selected: Boolean(window.stairKit && window.stairKit.selected()),
            risers: window.stairKit?.selected()?.stair?.risers,
            tread: Math.round((window.stairKit?.selected()?.stair?.treadDepth || 0) * 1000),
            draftCleared: localStorage.getItem('stair-designer-draft') === null
        })`);
        check('designer hands the stair to the editor', placed.path.endsWith('/Editor.html') && placed.selected === true, placed.path);
        check('placed stair keeps the designed step count', placed.risers === 15, `${placed.risers} risers`);
        check('placed stair keeps the designed going', Math.abs(placed.tread - Math.round(draft.stair.treadDepth * 1000)) <= 1, `${placed.tread} mm`);
        check('designer draft is consumed once', placed.draftCleared === true);

        console.log('\nSaved stair presets');
        const savedPreset = await cdp.evaluate(`(() => {
            window.setStairField('model', 'mono-straight');
            const preset = window.saveStairPreset('Mono preset 42');
            const buttons = document.querySelectorAll('#stair-preset-items button.item-button');
            return {
                id: preset?.id,
                name: preset?.name,
                model: preset?.stair?.model,
                count: buttons.length,
                buttonText: buttons[0]?.textContent.trim(),
                badge: document.getElementById('stair-preset-count').textContent,
                status: document.getElementById('stair-preset-status').textContent
            };
        })()`);
        check('selected stair saved as a preset', savedPreset.model === 'mono-straight' && Boolean(savedPreset.id), savedPreset.name);
        check('preset appears in the palette', savedPreset.count === 1 && savedPreset.buttonText.includes('Mono preset'), `${savedPreset.count} button(s)`);
        check('palette shows the preset count', savedPreset.badge === '1', savedPreset.badge);
        check('save status shown', savedPreset.status.includes('Mono preset'), savedPreset.status);

        const armed = await cdp.evaluate(`(() => {
            document.querySelector('#stair-preset-items button.item-button').click();
            const design = window.stairKit.design();
            return {
                model: design.model?.key,
                risers: design.risers,
                status: document.getElementById('stair-preset-status').textContent
            };
        })()`);
        check('palette preset arms the stair tool', armed.model === 'mono-straight', `${armed.model}, ${armed.risers} risers`);
        check('palette shows a placement hint', armed.status.includes('Click the plan'), armed.status);

        const placedPreset = await cdp.evaluate(`(() => {
            const before = window.stairKit.stairs().length;
            const canvas = document.getElementById('blueprint-canvas');
            const rect = canvas.getBoundingClientRect();
            const click = (offsetX = 0) => canvas.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, button: 0, buttons: 1,
                clientX: rect.left + rect.width / 2 + offsetX,
                clientY: rect.top + rect.height / 2
            }));
            click(0);
            const stairs = window.stairKit.stairs();
            const last = stairs[stairs.length - 1];
            const first = {
                count: stairs.length, before,
                model: last?.stair?.model,
                risers: last?.stair?.risers,
                width: last?.size?.width,
                depth: last?.size?.depth
            };
            // The preset is one-shot: the next stair uses the type defaults.
            click(60);
            const after = window.stairKit.stairs();
            return { first, second: { count: after.length, model: after[after.length - 1]?.stair?.model || null } };
        })()`);
        check('preset places on the next plan click', placedPreset.first.count === placedPreset.first.before + 1, `${placedPreset.first.before} → ${placedPreset.first.count}`);
        check('placed preset keeps the saved model', placedPreset.first.model === 'mono-straight', placedPreset.first.model);
        check('placed preset keeps the pinned risers', placedPreset.first.risers === 15, `${placedPreset.first.risers} risers`);
        check('placed preset is sized with its landings', placedPreset.first.width > 1 && placedPreset.first.depth > 2, `${placedPreset.first.width?.toFixed(2)} × ${placedPreset.first.depth?.toFixed(2)} m`);
        check('preset is one-shot', placedPreset.second.count === placedPreset.first.count + 1 && placedPreset.second.model === null, placedPreset.second.model || 'type default');

        await load(BASE + '/Editor.html');
        const persisted = await cdp.evaluate(`(() => {
            const buttons = document.querySelectorAll('#stair-preset-items button.item-button');
            const stored = JSON.parse(localStorage.getItem('stair-presets') || '[]');
            const before = buttons.length;
            window.removeStairPreset(stored[0]?.id);
            return {
                before,
                text: buttons[0]?.textContent.trim(),
                after: document.querySelectorAll('#stair-preset-items button.item-button').length,
                empty: document.getElementById('stair-preset-items').textContent,
                stored: JSON.parse(localStorage.getItem('stair-presets') || '[]').length
            };
        })()`);
        check('presets persist across reloads', persisted.before === 1, persisted.text);
        check('preset removal clears the palette', persisted.after === 0 && persisted.stored === 0 && persisted.empty.includes('bookmark'), persisted.empty.slice(0, 50));

        console.log('\nRoof suite');
        await load(BASE + '/roof-designer.html');
        check('roof suite boots', await waitFor('Boolean(window.roofSuite && window.roofSuite.design)'));
        const roofPage = await cdp.evaluate(`(() => {
            const design = window.roofSuite.design;
            const canvas = document.getElementById('elevation');
            const ctx = canvas.getContext('2d');
            let painted = 0;
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) painted += 1;
            return {
                cards: document.querySelectorAll('#roof-style-grid [data-style]').length,
                style: design.style.key,
                area: design.areas.roof,
                squares: design.areas.squares,
                planes: design.geometry.planes.length,
                rows: document.querySelectorAll('#roof-takeoff-body tr').length,
                checks: document.querySelectorAll('#roof-checks li').length,
                terms: document.querySelectorAll('#roof-glossary dt').length,
                formulas: document.querySelectorAll('#roof-formulas tr').length,
                canvases: document.querySelectorAll('#stage canvas').length,
                cost: document.getElementById('roof-cost').textContent,
                results: document.getElementById('roof-area').textContent,
                painted,
                csv: window.roofSuite.csv().includes('"Summary","Total"')
            };
        })()`);
        check('roof suite lists ten styles', roofPage.cards === 10, `${roofPage.cards} cards`);
        check('roof suite computes the default gable', roofPage.style === 'gable-king' && roofPage.area > 100, `${roofPage.area} m²`);
        check('roof result card is filled', /m²/.test(roofPage.results) && /\$/.test(roofPage.cost), `${roofPage.results} · ${roofPage.cost}`);
        check('roof takeoff table is populated', roofPage.rows >= 18, `${roofPage.rows} rows`);
        check('roof checks are listed', roofPage.checks >= 8, `${roofPage.checks} checks`);
        check('roof glossary renders every term', roofPage.terms >= 60, `${roofPage.terms} terms`);
        check('roof formulas are listed', roofPage.formulas >= 8, `${roofPage.formulas} formulas`);
        check('roof 3D canvas present', roofPage.canvases === 1, `${roofPage.canvases} canvas`);
        check('roof elevation is drawn', roofPage.painted > 5000, `${roofPage.painted} painted pixels`);
        check('roof CSV carries the summary', roofPage.csv === true);

        const roofFlow = await cdp.evaluate(`(async () => {
            document.querySelector('#roof-style-grid [data-style="hip"]').click();
            const hip = window.roofSuite.design;
            const select = (id, value) => {
                const element = document.getElementById(id);
                element.value = value;
                element.dispatchEvent(new Event('change', { bubbles: true }));
            };
            select('covering', 'clay-tile');
            select('spacing', '0.4');
            const tile = window.roofSuite.design;
            select('spacing', '0.61');
            const tileError = window.roofSuite.design.checks.some((entry) => entry.id === 'truss-spacing' && entry.severity === 'error');
            select('spacing', '0.4');
            const gutters = document.getElementById('gutters');
            gutters.checked = false;
            gutters.dispatchEvent(new Event('change', { bubbles: true }));
            const noGutters = window.roofSuite.design;
            gutters.checked = true;
            gutters.dispatchEvent(new Event('change', { bubbles: true }));
            const pitch = document.getElementById('pitch-number');
            pitch.value = '1';
            pitch.dispatchEvent(new Event('input', { bubbles: true }));
            select('covering', 'asphalt-arch');
            await new Promise((resolve) => setTimeout(resolve, 250));
            const low = window.roofSuite.design;
            return {
                hipPlanes: hip.geometry.planes.length,
                hipStyle: hip.style.key,
                tileUnit: tile.layers.coveringUnit,
                tileUnits: tile.layers.coveringUnits,
                tileError,
                noGutters: { lf: noGutters.gutterPackage.gutterLf, downspouts: noGutters.gutterPackage.downspouts },
                lowError: low.checks.some((entry) => entry.id === 'pitch-covering' && entry.severity === 'error'),
                errorCount: document.querySelectorAll('#roof-checks .severity-error').length,
                hipCards: document.querySelectorAll('#roof-style-grid .style-card.active').length
            };
        })()`);
        check('style card switches to the hip', roofFlow.hipStyle === 'hip' && roofFlow.hipPlanes === 4, `${roofFlow.hipPlanes} planes`);
        check('one active style card', roofFlow.hipCards === 1, `${roofFlow.hipCards} active`);
        check('tile is counted in pieces', roofFlow.tileUnit === 'tile' && roofFlow.tileUnits > 500, `${roofFlow.tileUnits} tiles`);
        check('tile at 24 in spacing raises an error', roofFlow.tileError === true);
        check('gutter toggle removes the package', roofFlow.noGutters.lf === 0 && roofFlow.noGutters.downspouts === 0);
        check('low pitch shingle raises an error', roofFlow.lowError === true, `${roofFlow.errorCount} errors shown`);

        const glossarySearch = await cdp.evaluate(`(() => {
            const input = document.getElementById('glossary-search');
            input.value = 'valley';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const hits = [...document.querySelectorAll('#roof-glossary dt')].map((dt) => dt.textContent);
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return { hits, after: document.querySelectorAll('#roof-glossary dt').length };
        })()`);
        check('glossary search filters the terms',
            glossarySearch.hits.length > 0 && glossarySearch.hits.length < 10
            && glossarySearch.hits.some((text) => /valley/i.test(text)),
            glossarySearch.hits.join(', ').slice(0, 80));
        check('clearing the search restores every term', glossarySearch.after >= 60, `${glossarySearch.after} terms`);

        await cdp.evaluate(`document.getElementById('send-editor').click()`);
        await sleep(3200);
        const roofEditor = await cdp.evaluate(`(() => {
            const config = window.roofKit?.config() || {};
            const design = window.roofKit?.design();
            const convert = window.studioKit?.convert();
            return {
                path: location.pathname,
                config,
                styleSelect: document.getElementById('roof-style-select')?.value,
                coveringSelect: document.getElementById('roof-covering-select')?.value,
                gutterSelect: document.getElementById('roof-gutter-select')?.value,
                pitch: document.getElementById('roof-pitch')?.value,
                gutters: document.getElementById('roof-gutters')?.checked,
                roofOn: document.getElementById('roof-toggle')?.checked,
                summary: document.getElementById('roof-summary')?.textContent,
                area: design?.areas?.roof ?? null,
                roofBuilt: Boolean(convert?.roof),
                builtStyle: convert?.roof?.style || null,
                planes: document.querySelectorAll('#scene-3d').length
            };
        })()`);
        check('designer hands the roof to the editor', roofEditor.path.endsWith('/Editor.html'), roofEditor.path);
        check('editor keeps the designed style', roofEditor.config.style === 'hip' && roofEditor.styleSelect === 'hip', roofEditor.styleSelect);
        check('editor keeps the covering and gutter', roofEditor.config.covering === 'asphalt-arch' && roofEditor.coveringSelect === 'asphalt-arch'
            && roofEditor.gutterSelect === 'k5-alum', `${roofEditor.coveringSelect} / ${roofEditor.gutterSelect}`);
        check('editor keeps the designed pitch', Number(roofEditor.config.pitch) === 1 && roofEditor.pitch === '1', `${roofEditor.pitch}:12`);
        check('editor switches the roof on for the draft', roofEditor.roofOn === true);
        check('editor roof panel summarises the area', /sq/.test(roofEditor.summary || ''), roofEditor.summary);
        check('editor builds the roof from the draft', roofEditor.roofBuilt === true && roofEditor.builtStyle === 'hip', `${roofEditor.builtStyle}`);

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
