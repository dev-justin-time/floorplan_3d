import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
        if (await cdp.evaluate('Boolean(window.editorKit && window.featureKit)')) break;
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
        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, ...start }));
        canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, ...end }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, ...end }));
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
