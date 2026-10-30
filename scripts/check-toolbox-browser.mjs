/**
 * Browser checks for `pages/toolbox.html`: every panel's DOM and the three
 * downloads.
 *
 * `check-toolbox.mjs` pins the maths in Node; this harness drives the real page,
 * because a panel that renders a blank preview or names a download wrongly is
 * invisible to a unit test. Each tool is mounted through the same `select()` the
 * navigation uses, its known controls are asserted present, and the image tools
 * are exercised end to end: a synthetic image goes in, the readouts and preview
 * canvas are checked, and the download button's blob is read back and parsed as
 * a PNG (signature and IHDR) or as the packing sidecar.
 *
 * Downloads are captured the way `check-editor-wiring.mjs` captures the BIM CSV:
 * `URL.createObjectURL` and the anchor click are stubbed for the duration of the
 * run, so nothing is written to disk and the gate asserts our own bytes rather
 * than Chrome's save dialog.
 *
 * Needs Chrome and the server the runner starts (`BASE_URL`).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8766';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9352;
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
        const result = await this.send('Runtime.evaluate', {
            expression, awaitPromise: true, returnByValue: true, userGesture: true
        });
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
    consoleErrors() {
        return this.events
            .filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
            .map((event) => event.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' ').trim())
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

/** Signature, IHDR dimensions and colour type of a PNG's first 33 bytes. */
function pngHead(bytes) {
    if (!Array.isArray(bytes)) return { png: false };
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const signed = signature.every((byte, index) => bytes[index] === byte);
    const chunk = bytes.slice(12, 16).map((byte) => String.fromCharCode(byte)).join('');
    const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
    return { png: signed && chunk === 'IHDR', width, height, colourType: bytes[25] };
}

/** Page helpers: a synthetic image factory and the download capture. */
const PAGE_TOOLS = `
    window.__makeImage = (width, height, fill) => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const offset = (y * width + x) * 4;
                const value = fill(x, y);
                data[offset] = value[0];
                data[offset + 1] = value[1];
                data[offset + 2] = value[2];
                data[offset + 3] = value.length > 3 ? value[3] : 255;
            }
        }
        return { width, height, data };
    };
    window.__downloads = [];
    URL.createObjectURL = (blob) => {
        window.__downloads.push({ blob, name: null });
        return 'blob:toolbox-probe';
    };
    HTMLAnchorElement.prototype.click = function () {
        if (!this.download) return;
        const last = window.__downloads[window.__downloads.length - 1];
        if (last) last.name = this.download;
    };
    window.__waitForDownload = async (previous) => {
        for (let attempt = 0; attempt < 120; attempt += 1) {
            if (window.__downloads.length > previous && window.__downloads[previous].name) {
                return { index: previous, name: window.__downloads[previous].name };
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return { index: -1, name: null };
    };
    window.__pngHead = async (index) => {
        const entry = window.__downloads[index];
        if (!entry) return null;
        const buffer = await entry.blob.arrayBuffer();
        return Array.from(new Uint8Array(buffer).slice(0, 33));
    };
    window.__blobText = async (index) => {
        const entry = window.__downloads[index];
        return entry ? entry.blob.text() : null;
    };
    window.__canvasColours = (element) => {
        const context = element.getContext('2d');
        const pixels = context.getImageData(0, 0, element.width, element.height).data;
        const seen = new Set();
        for (let offset = 0; offset < pixels.length; offset += 4) {
            seen.add((pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]);
        }
        return seen.size;
    };
`;

/** A minimal self-contained GLB: one quad, positions and UVs in one buffer. */
function buildGlb() {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const bin = Buffer.concat([
        Buffer.from(positions.buffer),
        Buffer.from(uvs.buffer),
        Buffer.from(indices.buffer)
    ]);
    const json = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: 'Quad' }],
        meshes: [{ name: 'Quad', primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2 }] }],
        buffers: [{ byteLength: bin.length }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 48, target: 34962 },
            { buffer: 0, byteOffset: 48, byteLength: 32, target: 34962 },
            { buffer: 0, byteOffset: 80, byteLength: 12, target: 34963 }
        ],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 0, 1] },
            { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
            { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' }
        ]
    };
    const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
    const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
    const binChunk = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonChunk.length, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binChunk.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

const profile = await mkdtemp(path.join(tmpdir(), 'buffit-toolbox-browser-'));
const fixtures = {
    obj: path.join(profile, 'quad.obj'),
    glb: path.join(profile, 'quad.glb'),
    stl: path.join(profile, 'tri.stl'),
    ply: path.join(profile, 'quad.ply'),
    text: path.join(profile, 'notes.txt')
};
await writeFile(fixtures.obj, [
    'v 0 0 0', 'v 1 0 0', 'v 1 0 1', 'v 0 0 1',
    'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
    'f 1/1 2/2 3/3', 'f 1/1 3/3 4/4', ''
].join('\n'), 'utf8');
await writeFile(fixtures.glb, buildGlb());
await writeFile(fixtures.stl, [
    'solid tri',
    '  facet normal 0 1 0',
    '    outer loop',
    '      vertex 0 0 0',
    '      vertex 1 0 0',
    '      vertex 1 0 1',
    '    endloop',
    '  endfacet',
    'endsolid tri', ''
].join('\n'), 'utf8');
await writeFile(fixtures.ply, [
    'ply', 'format ascii 1.0',
    'element vertex 4',
    'property float x', 'property float y', 'property float z',
    'property float s', 'property float t',
    'element face 2',
    'property list uchar int vertex_indices',
    'end_header',
    '0 0 0 0 0',
    '1 0 0 1 0',
    '1 0 1 1 1',
    '0 0 1 0 1',
    '3 0 1 2',
    '3 0 2 3', ''
].join('\n'), 'utf8');
await writeFile(fixtures.text, 'not a model\n', 'utf8');
const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
        try {
            ready = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok;
        } catch {
            // Chrome is still starting.
        }
        if (!ready) await sleep(250);
    }
    if (!ready) throw new Error('Chrome never exposed its debug endpoint.');

    const target = await (await fetch(
        `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`${BASE}/pages/toolbox.html?tool=texture-memory`)}`,
        { method: 'PUT' }
    )).json();
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    let booted = false;
    for (let attempt = 0; attempt < 100 && !booted; attempt += 1) {
        booted = await cdp.evaluate("document.readyState === 'complete' && Boolean(window.toolboxKit)").catch(() => false);
        if (!booted) await sleep(150);
    }
    check('the toolbox page boots', booted === true);

    const shell = await cdp.evaluate(`(() => ({
        tools: window.toolboxKit.registry.map((tool) => tool.id),
        groups: window.toolboxKit.groups.map((group) => group.label),
        nav: [...document.querySelectorAll('#toolbox-list button[data-tool]')].map((button) => button.dataset.tool),
        active: window.toolboxKit.active,
        title: document.getElementById('toolbox-title').textContent,
        summary: document.getElementById('toolbox-summary').textContent,
        status: document.getElementById('toolbox-status').getAttribute('aria-live'),
        deepLink: new URL(window.location.href).searchParams.get('tool'),
        pristine: document.querySelectorAll('#toolbox-work [role="alert"]').length
    }))()`);
    check('seven tools are listed in the navigation', shell.nav.length === 7 && shell.nav.join(',') === shell.tools.join(','), shell.nav.join(','));
    check('the deep link opens the requested tool', shell.active === 'texture-memory' && shell.title === 'Texture memory' && shell.deepLink === 'texture-memory', JSON.stringify({ active: shell.active, title: shell.title, deepLink: shell.deepLink }));
    check('the tool summary is filled from the registry', shell.summary.length > 40, shell.summary.slice(0, 40));
    check('the status line is a polite live region', shell.status === 'polite');

    await cdp.evaluate(PAGE_TOOLS);

    // --- every panel mounts with its own DOM ------------------------------
    console.log('\nPanels');

    const PANELS = [
        { id: 'color-space', label: 'Color space converter', selectors: ['#color-hex', '#color-linear', '#color-luminance'] },
        { id: 'units', label: 'Unit converter', selectors: ['#unit-value', '#unit-from', '#unit-result'] },
        { id: 'texel-density', label: 'Texel density', selectors: ['#texel-density', '#texel-required'] },
        { id: 'texture-memory', label: 'Texture memory', selectors: ['#mem-total', '#mem-table'] },
        { id: 'seamless-texture', label: 'Seamless texture', selectors: ['#seamless-drop', '#seamless-blend', '#seamless-download'] },
        { id: 'channel-packer', label: 'PBR channel packer', selectors: ['#pack-preset', '#pack-preview', '#pack-png', '#pack-json'] },
        { id: 'normal-flip', label: 'Normal map flipper', selectors: ['#flip-drop', '#flip-target', '#flip-list'] }
    ];

    for (const panel of PANELS) {
        const report = await cdp.evaluate(`(async () => {
            await window.toolboxKit.select('${panel.id}');
            await new Promise((resolve) => setTimeout(resolve, 80));
            const pressed = document.querySelector('#toolbox-list button[aria-pressed="true"]');
            return {
                title: document.getElementById('toolbox-title').textContent,
                documentTitle: document.title,
                pressed: pressed ? pressed.dataset.tool : null,
                missing: ${JSON.stringify(panel.selectors)}.filter((selector) => !document.querySelector(selector)),
                work: document.getElementById('toolbox-work').children.length,
                // The panels ship an empty role="alert" container; only a
                // message in it means the panel actually failed.
                alerts: [...document.querySelectorAll('#toolbox-work [role="alert"]')]
                    .filter((node) => node.textContent.trim()).length,
                url: new URL(window.location.href).searchParams.get('tool'),
                disabled: {
                    seamless: document.getElementById('seamless-download')?.disabled ?? null,
                    pack: document.getElementById('pack-png')?.disabled ?? null
                }
            };
        })()`);
        check(`${panel.id} mounts with its controls`, report.title === panel.label
            && report.pressed === panel.id
            && report.missing.length === 0
            && report.work > 0
            && report.url === panel.id,
        JSON.stringify(report));
        check(`${panel.id} mounts without a panel error`, report.alerts === 0, `${report.alerts} alert(s)`);
    }

    // The empty state is part of the DOM contract: no download before a source.
    const empty = await cdp.evaluate(`(async () => {
        await window.toolboxKit.select('channel-packer');
        await new Promise((resolve) => setTimeout(resolve, 80));
        const before = window.__downloads.length;
        document.getElementById('pack-png').click();
        document.getElementById('pack-json').click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        return {
            pngDisabled: document.getElementById('pack-png').disabled,
            jsonDisabled: document.getElementById('pack-json').disabled,
            size: document.getElementById('pack-size').textContent,
            notes: document.getElementById('pack-notes').textContent,
            downloads: window.__downloads.length - before,
            painted: document.getElementById('pack-preview').style.width !== ''
        };
    })()`);
    check('the packer starts with both downloads disabled', empty.pngDisabled === true && empty.jsonDisabled === true);
    check('a disabled packer button starts no download', empty.downloads === 0, `${empty.downloads} download(s)`);
    check('the packer starts empty and unpainted', empty.size === '—' && empty.notes === '' && empty.painted === false, JSON.stringify(empty));

    // --- the nav button is the same path as select() ----------------------
    const navClick = await cdp.evaluate(`(async () => {
        document.querySelector('#toolbox-list button[data-tool="units"]').click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const pressed = document.querySelector('#toolbox-list button[aria-pressed="true"]');
        return {
            title: document.getElementById('toolbox-title').textContent,
            pressed: pressed ? pressed.dataset.tool : null,
            url: new URL(window.location.href).searchParams.get('tool'),
            work: Boolean(document.querySelector('#unit-value'))
        };
    })()`);
    check('a navigation click mounts the tool and records the route',
        navClick.title === 'Unit converter' && navClick.pressed === 'units' && navClick.url === 'units' && navClick.work === true,
        JSON.stringify(navClick));

    // --- seamless: readouts, painted preview, PNG download ----------------
    console.log('\nSeamless texture');

    const seamless = await cdp.evaluate(`(async () => {
        await window.toolboxKit.select('seamless-texture');
        await new Promise((resolve) => setTimeout(resolve, 100));
        const disabledAtMount = document.getElementById('seamless-download').disabled;
        const image = window.__makeImage(64, 64, (x) => {
            const value = Math.round((255 * x) / 63);
            return [value, value, value, 255];
        });
        window.toolboxKit.panel.load(image, 'probe.png');
        await new Promise((resolve) => setTimeout(resolve, 120));

        const canvas = document.getElementById('seamless-result-view');
        const source = document.getElementById('seamless-source-view');
        const before = window.__downloads.length;
        document.getElementById('seamless-download').click();
        const download = await window.__waitForDownload(before);
        return {
            disabledAtMount,
            state: window.toolboxKit.panel.state(),
            readouts: {
                sourceSize: document.getElementById('seamless-source-size').textContent,
                resultSize: document.getElementById('seamless-result-size').textContent,
                before: document.getElementById('seamless-seam-before').textContent,
                after: document.getElementById('seamless-seam-after').textContent,
                note: document.getElementById('seamless-result-note').textContent,
                sourceNote: document.getElementById('seamless-source-note').textContent
            },
            canvas: { width: canvas.width, height: canvas.height, colours: window.__canvasColours(canvas) },
            sourceCanvas: { width: source.width, height: source.height },
            download: { name: download.name, head: await window.__pngHead(download.index) }
        };
    })()`);
    check('the seamless download starts disabled', seamless.disabledAtMount === true);
    check('the source readouts describe the loaded file', seamless.readouts.sourceSize === '64 × 64' && seamless.readouts.sourceNote === 'probe.png', JSON.stringify(seamless.readouts));
    check('the effect readouts show the seam closing', seamless.readouts.before === '255 / 255' && seamless.readouts.after === '0 / 255' && seamless.readouts.resultSize === '64 × 64', JSON.stringify(seamless.readouts));
    check('the result note names the file as tileable', /probe\.png is tileable/.test(seamless.readouts.note), seamless.readouts.note);
    check('the 2x2 preview is painted with real pixels', seamless.canvas.width === 128 && seamless.canvas.height === 128 && seamless.canvas.colours > 3, JSON.stringify(seamless.canvas));
    check('the source preview is tiled as well', seamless.sourceCanvas.width === 128 && seamless.sourceCanvas.height === 128, JSON.stringify(seamless.sourceCanvas));
    check('the seamless PNG is named for the source', seamless.download.name === 'probe_seamless.png', seamless.download.name);
    const seamlessPng = pngHead(seamless.download.head);
    check('the seamless download is a 64x64 PNG', seamlessPng.png && seamlessPng.width === 64 && seamlessPng.height === 64, JSON.stringify(seamlessPng));

    // --- packer: readouts, preset remap, PNG and JSON ---------------------
    console.log('\nChannel packer');

    const packer = await cdp.evaluate(`(async () => {
        await window.toolboxKit.select('channel-packer');
        await new Promise((resolve) => setTimeout(resolve, 100));
        window.toolboxKit.panel.load('r', window.__makeImage(4, 4, () => [30, 30, 30, 255]), 'ao.png');
        window.toolboxKit.panel.load('g', window.__makeImage(4, 4, () => [120, 120, 120, 255]), 'rough.png');
        window.toolboxKit.panel.load('b', window.__makeImage(4, 4, () => [200, 200, 200, 255]), 'metal.png');
        await new Promise((resolve) => setTimeout(resolve, 120));

        const orm = {
            state: window.toolboxKit.panel.state(),
            size: document.getElementById('pack-size').textContent,
            sources: document.getElementById('pack-sources').textContent,
            resized: document.getElementById('pack-resized').textContent,
            notes: document.getElementById('pack-notes').textContent,
            status: document.getElementById('pack-status-r').textContent,
            colours: window.__canvasColours(document.getElementById('pack-preview'))
        };
        const pngBefore = window.__downloads.length;
        document.getElementById('pack-png').click();
        const png = await window.__waitForDownload(pngBefore);

        const select = document.getElementById('pack-preset');
        select.value = 'unity-mask';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 120));
        const unity = {
            state: window.toolboxKit.panel.state(),
            notes: document.getElementById('pack-notes').textContent,
            size: document.getElementById('pack-size').textContent
        };
        const unityPngBefore = window.__downloads.length;
        document.getElementById('pack-png').click();
        const unityPng = await window.__waitForDownload(unityPngBefore);
        const jsonBefore = window.__downloads.length;
        document.getElementById('pack-json').click();
        const json = await window.__waitForDownload(jsonBefore);

        return {
            orm,
            unity,
            png: { name: png.name, head: await window.__pngHead(png.index) },
            unityPng: { name: unityPng.name, head: await window.__pngHead(unityPng.index) },
            json: { name: json.name, text: await window.__blobText(json.index) }
        };
    })()`);
    check('the packed readouts show the size and sources', packer.orm.size === '4 × 4' && packer.orm.sources === '3' && packer.orm.resized === 'none', JSON.stringify(packer.orm));
    check('every packed channel is reported', JSON.stringify(packer.orm.state.pixels) === '[30,120,200,255]', JSON.stringify(packer.orm.state.pixels));
    check('the defaulted alpha is named in the notes', /A is constant 255/.test(packer.orm.notes), packer.orm.notes);
    check('the source row shows the loaded file', /ao\.png/.test(packer.orm.status), packer.orm.status);
    check('the packed preview is painted', packer.orm.colours === 1, String(packer.orm.colours));
    check('the ORM PNG is named for the preset', packer.png.name === 'ao_gltf-orm.png', packer.png.name);
    const packPng = pngHead(packer.png.head);
    check('the packed PNG is a 4x4 RGBA sheet', packPng.png && packPng.width === 4 && packPng.height === 4 && packPng.colourType === 6, JSON.stringify(packPng));

    check('the Unity preset remaps the channels', packer.unity.state.preset === 'unity-mask'
        && packer.unity.state.channels.r === 'metalness'
        && packer.unity.state.channels.a === 'smoothness', JSON.stringify(packer.unity.state.channels));
    check('the Unity repack keeps the same maps', JSON.stringify(packer.unity.state.pixels) === '[200,30,255,255]', JSON.stringify(packer.unity.state.pixels));
    check('the Unity notes name the defaulted channels', /B is filled with 255/.test(packer.unity.notes) && /A is filled with 255/.test(packer.unity.notes), packer.unity.notes);
    check('the repacked PNG is named for the new preset', packer.unityPng.name === 'metal_unity-mask.png', packer.unityPng.name);
    const unityPng = pngHead(packer.unityPng.head);
    check('the repacked sheet is still a 4x4 PNG', unityPng.png && unityPng.width === 4 && unityPng.height === 4, JSON.stringify(unityPng));

    let sidecar = null;
    try {
        sidecar = JSON.parse(packer.json.text);
    } catch {
        sidecar = null;
    }
    check('the mapping JSON downloads beside the PNG', packer.json.name === 'metal_unity-mask.json' && sidecar !== null, packer.json.name);
    check('the sidecar records the preset and size', sidecar?.tool === 'channel-packer' && sidecar?.preset === 'unity-mask' && sidecar?.size?.width === 4, JSON.stringify(sidecar?.size));
    check('the sidecar names the source behind each channel', sidecar?.channels?.r?.slot === 'metalness' && sidecar?.channels?.r?.file === 'metal.png', JSON.stringify(sidecar?.channels?.r));
    check('the sidecar records the defaulted alpha', sidecar?.channels?.a?.slot === 'smoothness' && sidecar?.channels?.a?.value === 255 && sidecar?.channels?.a?.file === null, JSON.stringify(sidecar?.channels?.a));

    // --- normal flip: list, preview, per-file download --------------------
    console.log('\nNormal map flipper');

    const flip = await cdp.evaluate(`(async () => {
        await window.toolboxKit.select('normal-flip');
        await new Promise((resolve) => setTimeout(resolve, 100));
        const image = window.__makeImage(2, 1, (x) => (x === 0 ? [120, 200, 250, 255] : [10, 5, 0, 40]));
        window.toolboxKit.panel.load([{ image, name: 'rock_n.png' }]);
        await new Promise((resolve) => setTimeout(resolve, 120));

        const button = document.querySelector('#flip-list button');
        const before = window.__downloads.length;
        button.click();
        const download = await window.__waitForDownload(before);
        const listBefore = {
            count: document.querySelectorAll('#flip-list button').length,
            name: document.querySelector('#flip-list span')?.textContent,
            target: button.dataset.target,
            note: document.getElementById('flip-note').textContent
        };
        const target = document.getElementById('flip-target');
        target.value = 'opengl';
        target.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
            state: window.toolboxKit.panel.state(),
            listBefore,
            listAfter: {
                target: document.querySelector('#flip-list button').dataset.target,
                before: document.getElementById('flip-before-label').textContent,
                after: document.getElementById('flip-after-label').textContent
            },
            canvases: {
                before: document.getElementById('flip-before').width,
                after: document.getElementById('flip-after').width
            },
            download: { name: download.name, head: await window.__pngHead(download.index) }
        };
    })()`);
    check('the flip lists the loaded map', flip.listBefore.count === 1 && flip.listBefore.name === 'rock_n.png', JSON.stringify(flip.listBefore));
    check('the flip shows the channel result', JSON.stringify(flip.state.pixels) === '[120,55,250,255]', JSON.stringify(flip.state.pixels));
    check('the flip note names the convention', /DirectX \(\+Y down\)/.test(flip.listBefore.note), flip.listBefore.note);
    check('both preview canvases are painted', flip.canvases.before === 2 && flip.canvases.after === 2, JSON.stringify(flip.canvases));
    check('the flipped file downloads as rock_n_dx.png', flip.download.name === 'rock_n_dx.png', flip.download.name);
    const flipPng = pngHead(flip.download.head);
    check('the flipped download is a 2x1 PNG', flipPng.png && flipPng.width === 2 && flipPng.height === 1, JSON.stringify(flipPng));
    check('switching the target renames the download', flip.listAfter.target === 'rock_n_gl.png', flip.listAfter.target);
    check('switching the target relabels the previews', /OpenGL/.test(flip.listAfter.after) && /DirectX/.test(flip.listAfter.before), JSON.stringify(flip.listAfter));

    // --- model check: real files through the file input -------------------
    console.log('\nTexel density on a model');

    await cdp.evaluate(`(async () => {
        await window.toolboxKit.select('texel-density');
        await new Promise((resolve) => setTimeout(resolve, 100));
    })()`);

    const setModelFile = async (filePath) => {
        const document = await cdp.send('DOM.getDocument', { depth: -1 });
        const input = await cdp.send('DOM.querySelector', {
            nodeId: document.root.nodeId,
            selector: '#texel-model-file'
        });
        if (!input.nodeId) throw new Error('The model file input is not in the document.');
        await cdp.send('DOM.setFileInputFiles', { files: [filePath], nodeId: input.nodeId });
    };

    const waitForModel = (fileName) => cdp.evaluate(`(async () => {
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const state = window.toolboxKit.panel.state();
            if (state.error || (state.file === ${JSON.stringify(fileName)} && !/^Reading/.test(state.note))) return state;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return window.toolboxKit.panel.state();
    })()`);

    await setModelFile(fixtures.obj);
    const objModel = await waitForModel('quad.obj');
    const objRow = await cdp.evaluate(`(() => ({
        header: document.getElementById('texel-model-file-name').textContent,
        cells: [...document.querySelectorAll('#texel-model-table tr:first-child td')].map((cell) => cell.textContent.trim())
    }))()`);
    check('an OBJ imports through the file input', objModel.islands === 1 && objModel.triangles === 2, JSON.stringify(objModel));
    check('the OBJ quad reads 1024 px/m on a 1024 sheet', Math.abs(objModel.density - 1024) < 0.01, String(objModel.density));
    check('the model note names the sheet', /1 UV shell measured at 1024 × 1024/.test(objModel.note), objModel.note);
    check('the shell table has one row with its density', objModel.rows === 1 && objRow.cells[4] === '1024', JSON.stringify(objRow.cells));
    check('the table names the imported mesh', /quad\.obj/.test(objRow.cells[0]), objRow.cells[0]);
    check('the header names the file and its format', /quad\.obj · OBJ/.test(objRow.header), objRow.header);

    const halfSheet = await cdp.evaluate(`(async () => {
        const select = document.getElementById('texel-model-sheet');
        select.value = '512';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 150));
        return {
            ...window.toolboxKit.panel.state(),
            cell: document.querySelector('#texel-model-table tr:first-child td:nth-child(5)').textContent.trim()
        };
    })()`);
    check('changing the sheet remeasures without reloading', Math.abs(halfSheet.density - 512) < 0.01 && halfSheet.cell === '512', JSON.stringify({ density: halfSheet.density, cell: halfSheet.cell }));

    await cdp.evaluate(`(() => {
        const select = document.getElementById('texel-model-sheet');
        select.value = '1024';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await setModelFile(fixtures.glb);
    const glbModel = await waitForModel('quad.glb');
    const glbHeader = await cdp.evaluate("document.getElementById('texel-model-file-name').textContent");
    check('a GLB imports through the same path', glbModel.islands === 1 && Math.abs(glbModel.density - 1024) < 0.01, JSON.stringify(glbModel));
    check('the header names the GLB and its format', /quad\.glb · GLB/.test(glbHeader), glbHeader);

    await setModelFile(fixtures.stl);
    const stlModel = await waitForModel('tri.stl');
    const stlDensity = await cdp.evaluate("document.getElementById('texel-model-density').textContent");
    check('an STL reports its surface without UV shells', stlModel.islands === 0 && stlModel.triangles === 1, JSON.stringify(stlModel));
    check('the STL warning explains the missing UVs', /no UVs/.test(stlModel.warnings), stlModel.warnings);
    check('the STL density cell says no UVs', stlDensity === 'no UVs', stlDensity);

    await setModelFile(fixtures.ply);
    const plyModel = await waitForModel('quad.ply');
    check('a PLY imports with its texture coordinates', plyModel.islands === 1 && Math.abs(plyModel.density - 1024) < 0.5, JSON.stringify(plyModel));

    await setModelFile(fixtures.text);
    const rejected = await cdp.evaluate(`(async () => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const error = document.getElementById('texel-model-error').textContent;
            if (error) return { error, note: document.getElementById('texel-model-note').textContent, rows: document.querySelectorAll('#texel-model-table tr').length };
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return { error: '', note: '', rows: -1 };
    })()`);
    check('an unsupported file is refused with a reason', /Unsupported format/.test(rejected.error), rejected.error);
    check('a failed load clears the previous result', rejected.note === 'notes.txt could not be read.' && rejected.rows === 0, JSON.stringify(rejected));

    // --- console ---------------------------------------------------------
    const errors = cdp.errors();
    const consoleErrors = cdp.consoleErrors();
    check('no runtime error on the toolbox page', errors.length === 0, errors.slice(0, 2).join(' | '));
    check('no console error on the toolbox page', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
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
