import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ItemFactory } from '../core/items.js';
import { fixtureAt } from '../scene/scene-drag.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8766';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9341;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result?.value;
    }
    errors() {
        return this.events
            .filter((event) => event.method === 'Runtime.exceptionThrown')
            .map((event) => event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text)
            .filter((text) => text && !text.includes('favicon'));
    }
}

let passed = 0;
const failures = [];
function check(name, condition, detail = '') {
    if (condition) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

console.log('Model helpers');
const testWall = { start: { x: 0, y: 0 }, end: { x: 300, y: 0 } };
const cabinet = ItemFactory.create('kitchen_cabinet', 100, 30);
cabinet.size = { width: 1, depth: 0.6, height: 0.9 };
check('a snapped cabinet clears the wall', cabinet.isValidPosition(100, 30, { walls: [testWall] }) === true);
check('a cabinet through the wall is invalid', cabinet.isValidPosition(100, 2, { walls: [testWall] }) === false);
const wideItem = { id: 'wide', x: 100, y: 100, rotation: 0, visible: true, metadata: { type: 'floor', width: 0.5, depth: 0.5 }, size: { width: 2, depth: 0.5 } };
check('hit testing uses the resized footprint', Boolean(fixtureAt([wideItem], { x: 128, y: 100 }, { slack: 2 })) === true);
check('the old metadata rectangle no longer limits the hit', Boolean(fixtureAt([{ ...wideItem, size: null }], { x: 128, y: 100 }, { slack: 2 })) === false);

const profile = await mkdtemp(path.join(tmpdir(), 'buffit-editor-wiring-'));
const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break;
        } catch {
            // Chrome is still starting.
        }
        await sleep(250);
    }

    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`${BASE}/pages/Editor.html`)}`, { method: 'PUT' })).json();
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await cdp.evaluate('Boolean(window.editorKit && window.featureKit && window.clearProject && window.systemsKit)')) break;
        await sleep(250);
    }

    const wallFlow = await cdp.evaluate(`(async () => {
        window.clearProject();
        document.querySelector('[data-tool="wall"]')?.click();
        const canvas = document.getElementById('blueprint-canvas');
        const rect = canvas.getBoundingClientRect();
        const at = (x, y) => ({
            clientX: rect.left + (x / canvas.width) * rect.width,
            clientY: rect.top + (y / canvas.height) * rect.height
        });
        const start = at(canvas.width * 0.25, canvas.height * 0.4);
        const end = at(canvas.width * 0.75, canvas.height * 0.4);
        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, isPrimary: true, pointerId: 7, ...start }));
        canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, isPrimary: true, pointerId: 7, ...end }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, isPrimary: true, pointerId: 7, ...end }));
        await new Promise((resolve) => setTimeout(resolve, 500));
        const wall = window.featureKit.walls()[0];
        const selected = window.selectWallById(wall.id);
        return {
            walls: window.featureKit.walls().length,
            id: wall.id,
            selected,
            stored: window.editorKit.selectedWall(),
            inspector: !document.getElementById('selection-wall').classList.contains('hidden'),
            length: document.getElementById('sel-wall-len').textContent,
            finish: document.getElementById('finish-status').textContent,
            convert: window.studioKit.convert()
        };
    })()`);
    check('a wall can be drawn for selection', wallFlow.walls === 1, `${wallFlow.walls} walls`);
    check('selectWallById drives the editor selection', wallFlow.selected === wallFlow.id && wallFlow.stored === wallFlow.id, `${wallFlow.selected}`);
    check('the wall inspector opens', wallFlow.inspector === true);
    check('the inspector uses the world-space wall length', /m .*m high/.test(wallFlow.length), wallFlow.length);
    check('the finish panel adds the recommended texture', /suggested/.test(wallFlow.finish), wallFlow.finish);
    check('the wall is in the 3D scene', wallFlow.convert?.walls?.built + wallFlow.convert?.walls?.reused >= 1, JSON.stringify(wallFlow.convert?.walls || {}));

    const pickFlow = await cdp.evaluate(`(async () => {
        window.setViewMode('3d');
        await new Promise((resolve) => setTimeout(resolve, 900));
        const point = window.editorKit.wallScreenPoint(window.featureKit.walls()[0].id);
        const canvas = document.querySelector('#render-3d-view canvas');
        const rect = canvas.getBoundingClientRect();
        if (!point || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) {
            const host = document.getElementById('render-3d-view').getBoundingClientRect();
            return {
                point,
                rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                host: { left: host.left, top: host.top, width: host.width, height: host.height },
                css: { width: canvas.width, height: canvas.height, style: canvas.getAttribute('style') },
                badPoint: true
            };
        }
        const inView = point.clientX > rect.left && point.clientX < rect.right
            && point.clientY > rect.top && point.clientY < rect.bottom;
        // Use the pick path directly: synthetic pointer events have no active
        // pointer capture in headless Chrome, which OrbitControls reports as an
        // exception after a real selection has already happened.
        window.editorKit.selectAt({ clientX: point.clientX, clientY: point.clientY });
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
            point,
            inView,
            selected: window.editorKit.selectedWall(),
            expected: window.featureKit.walls()[0].id,
            inspector: !document.getElementById('selection-wall').classList.contains('hidden')
        };
    })()`);
    check('the wall midpoint projects into the 3D view', pickFlow.inView === true, JSON.stringify(pickFlow));
    check('a 3D wall click selects the wall', pickFlow.selected === pickFlow.expected, `${pickFlow.selected} vs ${pickFlow.expected}`);
    check('the 3D pick opens the wall inspector', pickFlow.inspector === true);

    // DXF import: the CAD tile loads a drawing through the same hidden input as
    // the image and JSON imports, and the linework becomes plan walls.
    const dxfLines = [
        [0, 0, 4000, 0], [4000, 0, 4000, 3000],
        [4000, 3000, 0, 3000], [0, 3000, 0, 0]
    ];
    const dxfPath = path.join(profile, 'plan.dxf');
    await writeFile(dxfPath, [
        '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
        '0', 'SECTION', '2', 'ENTITIES',
        ...dxfLines.flatMap(([x1, y1, x2, y2]) => ['0', 'LINE', '8', 'WALLS',
            '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2)]),
        '0', 'ENDSEC', '0', 'EOF'
    ].join('\n'), 'utf8');

    const dxfTile = await cdp.evaluate(`(() => {
        window.setViewMode('2d');
        document.getElementById('upload-modal').classList.remove('hidden');
        document.getElementById('upload-dxf-btn').click();
        return {
            accept: document.getElementById('hidden-file-input').accept,
            modalHidden: document.getElementById('upload-modal').classList.contains('hidden')
        };
    })()`);
    check('the drawing tile targets DXF and geo files', dxfTile.accept === '.dxf,.kml,.kmz,.geojson', JSON.stringify(dxfTile));

    const documentRoot = await cdp.send('DOM.getDocument');
    const fileInput = await cdp.send('DOM.querySelector', { nodeId: documentRoot.root.nodeId, selector: '#hidden-file-input' });
    await cdp.send('DOM.setFileInputFiles', { files: [dxfPath], nodeId: fileInput.nodeId });
    await sleep(1200);
    const dxfFlow = await cdp.evaluate(`(() => {
        const walls = window.featureKit.walls();
        const plan = document.getElementById('blueprint-canvas').getBoundingClientRect();
        return {
            walls: walls.length,
            lengths: walls.map((wall) => Math.round(Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y))),
            inside: walls.every((wall) => wall.start.x >= 0 && wall.start.x <= plan.width && wall.start.y >= 0 && wall.start.y <= plan.height),
            modalHidden: document.getElementById('upload-modal').classList.contains('hidden'),
            background: window.planOcr.debug().image
        };
    })()`);
    check('a DXF becomes plan walls', dxfFlow.walls === 4, `${dxfFlow.walls} walls`);
    check('the DXF walls keep their real size (4 m x 3 m at 30 px/m)',
        JSON.stringify(dxfFlow.lengths) === JSON.stringify([120, 90, 120, 90]),
        JSON.stringify(dxfFlow.lengths));
    check('the imported drawing sits inside the plan', dxfFlow.inside === true, JSON.stringify(dxfFlow));
    check('the import closes the modal and drops the old image', dxfFlow.modalHidden === true && dxfFlow.background === false, JSON.stringify(dxfFlow));

    // The same tile takes a surveyed site boundary. GeoJSON is lon/lat, so the
    // walls have to be projected, scaled and centred, not read as pixels.
    const geoPath = path.join(profile, 'site.geojson');
    const lonSize = 20 / (111320 * Math.cos((12 * Math.PI) / 180));
    const latSize = 20 / 110540;
    const ring = [[-77, -12], [-77 + lonSize, -12], [-77 + lonSize, -12 + latSize], [-77, -12 + latSize], [-77, -12]];
    await writeFile(geoPath, JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { name: 'Site' }, geometry: { type: 'Polygon', coordinates: [ring] } }]
    }), 'utf8');
    await cdp.send('DOM.setFileInputFiles', { files: [geoPath], nodeId: fileInput.nodeId });
    await sleep(1200);
    const geoFlow = await cdp.evaluate(`(() => {
        const walls = window.featureKit.walls();
        const plan = document.getElementById('blueprint-canvas').getBoundingClientRect();
        const lengths = walls.map((wall) => Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y));
        const xs = walls.flatMap((wall) => [wall.start.x, wall.end.x]);
        const ys = walls.flatMap((wall) => [wall.start.y, wall.end.y]);
        return {
            walls: walls.length,
            lengths,
            widthM: Math.max(...lengths) / 30,
            centre: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 },
            plan: { width: plan.width, height: plan.height }
        };
    })()`);
    check('a GeoJSON site boundary becomes plan walls', geoFlow.walls === 4, `${geoFlow.walls} walls`);
    check('the site keeps its real size (about 20 m)', geoFlow.widthM > 18 && geoFlow.widthM < 22, `${geoFlow.widthM.toFixed(2)} m`);
    check('the site is square on the plan',
        Math.max(...geoFlow.lengths) - Math.min(...geoFlow.lengths) < geoFlow.lengths[0] * 0.02,
        JSON.stringify(geoFlow.lengths.map((length) => Math.round(length))));
    check('the site is centred in the plan',
        Math.abs(geoFlow.centre.x - geoFlow.plan.width / 2) < 2 && Math.abs(geoFlow.centre.y - geoFlow.plan.height / 2) < 2,
        JSON.stringify(geoFlow.centre) + ' in ' + JSON.stringify(geoFlow.plan));

    // BIM: the panel classifies the plan on screen and its CSV carries exactly
    // the quantities the panel shows.
    const bimFlow = await cdp.evaluate(`(async () => {
        const tab = document.querySelector('[data-system="bim"]');
        tab?.click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        const model = window.systemsKit.model('bim');
        const snapshot = window.systemsKit.bim();

        const captured = {};
        const realClick = HTMLAnchorElement.prototype.click;
        const realCreate = URL.createObjectURL;
        HTMLAnchorElement.prototype.click = function () {
            if (this.download) captured.name = this.download;
            else realClick.call(this);
        };
        URL.createObjectURL = (blob) => { captured.blob = blob; return 'blob:test'; };
        try {
            window.systemsKit.action('bim-csv');
        } finally {
            HTMLAnchorElement.prototype.click = realClick;
            URL.createObjectURL = realCreate;
        }
        captured.text = captured.blob ? await captured.blob.text() : '';

        window.setViewMode('3d');
        await new Promise((resolve) => setTimeout(resolve, 900));
        return {
            tabs: [...document.querySelectorAll('#systems-tabs [data-system]')].map((button) => button.dataset.system),
            active: window.systemsKit.active(),
            body: document.getElementById('systems-body').textContent,
            model,
            rows: snapshot.takeoff.rows,
            totals: snapshot.takeoff.totals,
            download: { name: captured.name, text: captured.text }
        };
    })()`);
    check('the studio has a BIM tab', bimFlow.tabs.includes('bim'), JSON.stringify(bimFlow.tabs));
    check('the BIM tab is selected', bimFlow.active === 'bim');
    check('the BIM panel classifies the drawing', /IfcWall/.test(bimFlow.body), bimFlow.body.slice(0, 120));
    check('the takeoff follows the imported walls', bimFlow.rows.length === 4 && bimFlow.totals.walls === 4, JSON.stringify(bimFlow.totals));
    check('the BIM panel is ready on a clean plan', bimFlow.model.ok === true, JSON.stringify(bimFlow.model.checks));
    check('the panel headline matches the takeoff', /^4 walls · .* m² · .* m³$/.test(bimFlow.model.headline), bimFlow.model.headline);
    check('the CSV downloads as ifc-takeoff.csv', bimFlow.download.name === 'ifc-takeoff.csv', JSON.stringify(bimFlow.download.name));
    const csvLines = bimFlow.download.text.trim().split('\n');
    check('the CSV has the IFC header', csvLines[0] === 'IfcClass,Name,Count,LengthM,AreaM2,VolumeM3', csvLines[0]);
    check('the CSV has one row per element', csvLines.length === 5, `${csvLines.length} lines`);
    const csvArea = csvLines.slice(1).reduce((sum, line) => sum + Number(line.split(',')[4] || 0), 0);
    check('the CSV area matches the panel total', Math.abs(csvArea - bimFlow.totals.netAreaM2) < 0.02, `${csvArea} vs ${bimFlow.totals.netAreaM2}`);

    // A blank 3D view used to pass every assertion above, because a wall can be
    // in the scene while the canvas never drew a frame. These checks cover the
    // drawing itself: the buffers are sized for the display, the loop has run,
    // and the composited panel actually contains pixels.
    const viewFlow = await cdp.evaluate(`(() => {
        const host = document.getElementById('render-3d-view');
        const canvas = host.querySelector('canvas');
        const plan = document.getElementById('blueprint-canvas');
        const hostRect = host.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const planRect = plan.getBoundingClientRect();
        return {
            host: { width: hostRect.width, height: hostRect.height },
            canvas: { cssWidth: canvasRect.width, cssHeight: canvasRect.height, width: canvas.width, height: canvas.height },
            plan: { cssWidth: planRect.width, cssHeight: planRect.height, width: plan.width, height: plan.height },
            dpr: window.devicePixelRatio,
            loop: window.studioKit?.render?.() || null,
            fallback: Boolean(document.getElementById('render-3d-fallback'))
        };
    })()`);
    const pixelRatio = Math.min(viewFlow.dpr || 1, 2);
    check('the 3D canvas fills its panel',
        Math.abs(viewFlow.canvas.cssWidth - viewFlow.host.width) < 2 && Math.abs(viewFlow.canvas.cssHeight - viewFlow.host.height) < 2,
        JSON.stringify({ canvas: viewFlow.canvas, host: viewFlow.host }));
    check('the 3D backing store matches the pixel ratio',
        viewFlow.canvas.width === Math.round(viewFlow.canvas.cssWidth * pixelRatio)
        && viewFlow.canvas.height === Math.round(viewFlow.canvas.cssHeight * pixelRatio),
        JSON.stringify({ canvas: viewFlow.canvas, pixelRatio }));
    check('the plan backing store matches the pixel ratio',
        viewFlow.plan.width === Math.round(viewFlow.plan.cssWidth * pixelRatio)
        && viewFlow.plan.height === Math.round(viewFlow.plan.cssHeight * pixelRatio),
        JSON.stringify({ plan: viewFlow.plan, pixelRatio }));
    check('the render loop has drawn a frame', (viewFlow.loop?.frames || 0) > 0, JSON.stringify(viewFlow.loop));
    check('no 3D fallback while WebGL works', viewFlow.fallback === false);

    // The composited panel, not the drawing buffer: WebGL clears its buffer after
    // compositing, so only a screenshot shows what the user sees. Two things are
    // asserted: the panel is not one flat colour, and it repaints when the plan
    // changes. A view that never drew (0×0 buffer, stopped loop, black context)
    // is both flat and frozen, so it fails here.
    await sleep(300);
    const capture3D = async () => {
        const rect = await cdp.evaluate(`(() => {
            const r = document.getElementById('render-3d-view').getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        })()`);
        const shot = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 }
        });
        return shot.data;
    };
    const analyse = async (before, after = null) => cdp.evaluate(`(async () => {
        const load = async (base64) => {
            const image = new Image();
            image.src = 'data:image/png;base64,' + base64;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = 160;
            canvas.height = 120;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, 160, 120);
            return ctx.getImageData(0, 0, 160, 120).data;
        };
        const first = await load('${before}');
        const colours = new Set();
        let luma = 0;
        for (let i = 0; i < first.length; i += 4) {
            colours.add((first[i] << 16) | (first[i + 1] << 8) | first[i + 2]);
            luma += (first[i] + first[i + 1] + first[i + 2]) / 3;
        }
        const result = { colours: colours.size, luma: Math.round(luma / (first.length / 4)), changed: null };
        if (${JSON.stringify(after)}) {
            const second = await load('${after || ''}');
            let differing = 0;
            for (let i = 0; i < first.length; i += 4) {
                if (first[i] !== second[i] || first[i + 1] !== second[i + 1] || first[i + 2] !== second[i + 2]) differing += 1;
            }
            result.changed = differing / (first.length / 4);
        }
        return result;
    })()`);

    const beforeShot = await capture3D();
    const beforeStats = await analyse(beforeShot);
    check('the 3D view is not a flat colour', beforeStats.colours > 1, JSON.stringify(beforeStats));

    const clearFlow = await cdp.evaluate(`(async () => {
        const frames = window.studioKit?.render?.()?.frames ?? 0;
        window.clearProject();
        await new Promise((resolve) => setTimeout(resolve, 900));
        return { framesBefore: frames, framesAfter: window.studioKit?.render?.()?.frames ?? 0 };
    })()`);
    const afterShot = await capture3D();
    const afterStats = await analyse(beforeShot, afterShot);
    check('the 3D view repaints when the plan changes',
        afterStats.changed !== null && afterStats.changed > 0.01,
        `changed ${((afterStats.changed || 0) * 100).toFixed(1)}% of the panel`);
    check('clearing the plan advances the render loop',
        clearFlow.framesAfter > clearFlow.framesBefore,
        `${clearFlow.framesBefore} -> ${clearFlow.framesAfter}`);

    // Same buffers on a 2× display: the canvas has to re-measure and repaint when
    // the window moves between screens or the panel changes size.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
    await sleep(400);
    await cdp.evaluate(`window.dispatchEvent(new Event('resize'))`);
    await sleep(700);
    const hiDpi = await cdp.evaluate(`(() => {
        const host = document.getElementById('render-3d-view');
        const canvas = host.querySelector('canvas');
        const plan = document.getElementById('blueprint-canvas');
        const canvasRect = canvas.getBoundingClientRect();
        const planRect = plan.getBoundingClientRect();
        return {
            dpr: window.devicePixelRatio,
            threeD: { cssWidth: canvasRect.width, cssHeight: canvasRect.height, width: canvas.width, height: canvas.height },
            plan: { cssWidth: planRect.width, cssHeight: planRect.height, width: plan.width, height: plan.height },
            loop: window.studioKit?.render?.() || null
        };
    })()`);
    const hiRatio = Math.min(hiDpi.dpr || 1, 2);
    check('the 3D canvas follows a 2x device',
        hiRatio === 2
        && hiDpi.threeD.width === Math.round(hiDpi.threeD.cssWidth * hiRatio)
        && hiDpi.threeD.height === Math.round(hiDpi.threeD.cssHeight * hiRatio),
        JSON.stringify({ dpr: hiDpi.dpr, threeD: hiDpi.threeD }));
    check('the plan canvas follows a 2x device',
        hiRatio === 2
        && hiDpi.plan.width === Math.round(hiDpi.plan.cssWidth * hiRatio)
        && hiDpi.plan.height === Math.round(hiDpi.plan.cssHeight * hiRatio),
        JSON.stringify({ dpr: hiDpi.dpr, plan: hiDpi.plan }));
    check('the render loop keeps drawing after a resize',
        (hiDpi.loop?.frames || 0) > (viewFlow.loop?.frames || 0),
        `${viewFlow.loop?.frames} -> ${hiDpi.loop?.frames}`);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await sleep(300);

    const errors = cdp.errors();
    check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
    chrome.kill();
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
    failures.forEach((failure) => console.log(` - ${failure}`));
    process.exitCode = 1;
}
