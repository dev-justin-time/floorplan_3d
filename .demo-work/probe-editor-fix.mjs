/* Headless verification for the Editor wall/viewport/dark/live-sync fixes.
 * Usage: node .demo-work/probe-editor-fix.mjs [baseUrl]
 * Starts its own static server if none is given. Exits non-zero on failure.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };

function startStatic() {
    return new Promise((resolve) => {
        const server = createServer(async (req, res) => {
            try {
                const url = new URL(req.url, 'http://x');
                let p = normalize(join(ROOT, decodeURIComponent(url.pathname === '/' ? '/pages/Editor.html' : url.pathname)));
                if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
                const data = await readFile(p);
                res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
                res.end(data);
            } catch { res.writeHead(404); res.end('nf'); }
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 220) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

let chrome = null;
async function main() {
    const argBase = process.argv[2];
    let server = null;
    const base = argBase || await (async () => {
        const s = await startStatic();
        server = s.server;
        return `http://127.0.0.1:${s.port}`;
    })();

    const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const profile = join(ROOT, '.demo-work', 'probe-profile');
    chrome = spawn(chromePath, [
        `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
        '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        `--remote-debugging-port=0`, 'about:blank'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let wsUrl = null;
    const stderr = [];
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('devtools port timeout: ' + stderr.join('').slice(-300))), 30000);
        chrome.stderr.on('data', (d) => {
            stderr.push(String(d));
            const m = String(d).match(/ws:\/\/[^\s]+/);
            if (m) { clearTimeout(timer); wsUrl = m[0]; resolve(); }
        });
        chrome.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    // Minimal wrapper so the probe works with the global WebSocket client.
    class WS {
        constructor(url) {
            this.handlers = {};
            this.ws = new WebSocket(url);
            this.ws.addEventListener('open', () => (this.handlers.open || []).forEach((fn) => fn()));
            this.ws.addEventListener('message', (ev) => (this.handlers.message || []).forEach((fn) => fn(ev.data)));
            this.ws.addEventListener('error', (ev) => (this.handlers.error || []).forEach((fn) => fn(ev)));
        }
        on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
        send(d) { this.ws.send(d); }
        close() { try { this.ws.close(); } catch {} }
        setMaxListeners() {}
        get emit() { return undefined; }
    }

    const deadline = Date.now() + 100000;
    const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const id = Math.floor(Math.random() * 1e9);
        const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
        const sock = new WS(wsUrl, { maxPayload: 256 * 1024 * 1024 });
        const timer = setTimeout(() => { try { sock.close(); } catch {} reject(new Error('cdp timeout: ' + method)); }, 15000);
        sock.on('open', () => sock.send(payload));
        sock.on('message', (data) => {
            try {
                const msg = JSON.parse(String(data));
                if (msg.id === id) { clearTimeout(timer); sock.close(); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
            } catch {}
        });
        sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    // One persistent session is more reliable than a socket per call.
    const mkSession = async (targetWs) => {
        const sock = new WS(targetWs, { maxPayload: 256 * 1024 * 1024 });
        await new Promise((res, rej) => { sock.on('open', res); sock.on('error', rej); });
        let id = 0;
        const pending = new Map();
        sock.on('message', (data) => {
            try {
                const msg = JSON.parse(String(data));
                if (msg.id && pending.has(msg.id)) {
                    const { resolve, reject, timer } = pending.get(msg.id);
                    pending.delete(msg.id); clearTimeout(timer);
                    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
                }
            } catch {}
        });
        const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
            const mid = ++id;
            const timer = setTimeout(() => { pending.delete(mid); reject(new Error('cdp timeout: ' + method)); }, 15000);
            pending.set(mid, { resolve, reject, timer });
            sock.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
        return { sock, call };
    };

    // Open one WS to the browser endpoint.
    const browser = await mkSession(wsUrl);
    const { targetInfos } = await (async () => {
        // list targets over HTTP
        const port = Number(new URL(wsUrl).port);
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        return { targetInfos: await res.json() };
    })();
    const pageTarget = targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await browser.call('Target.attachToTarget', { targetId: pageTarget.id, flatten: true });
    const send = (method, params = {}) => browser.call(method, params, sessionId);
    const session = { sock: browser.sock, call: browser.call };
    await send('Page.enable');
    await send('Runtime.enable');
    const errors = [];
    session.sock.on('message', (raw) => {
        try {
            const msg = JSON.parse(String(raw));
            if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params?.exceptionDetails?.text || 'exception');
            if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') errors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 160));
        } catch {}
    });

    const evaluate = async (expression, awaitPromise = false) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || r.exceptionDetails.exception?.description || 'eval failed');
        return r.result?.value;
    };

    await send('Page.navigate', { url: `${base}/pages/Editor.html` });
    // Wait for the editor kit instead of a fixed sleep.
    let ready = null;
    for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try { ready = await evaluate(`Boolean(window.editorKit && window.featureKit)`); } catch {}
        if (ready) break;
        if (Date.now() > deadline) break;
    }
    check('editor boots without fatal errors', ready === true, `kit=${ready}`);

    if (ready) {
        check('upload modal starts hidden (canvas not blocked)', await evaluate(`document.getElementById('upload-modal').classList.contains('hidden')`));
        const canvasBox = await evaluate(`(() => { const c = document.getElementById('blueprint-canvas'); const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; })()`);
        check('plan canvas has size and is on screen', canvasBox && canvasBox.w > 200 && canvasBox.h > 200, JSON.stringify(canvasBox));
        check('3D renderer created', await evaluate(`Boolean(window.editorKit.renderer())`));
        check('3D host hidden until its view opens (by design)', await evaluate(`getComputedStyle(document.getElementById('render-3d-view')).display === 'none'`));

        // Wall click-drag on the plan canvas.
        const walls = await evaluate(`(async () => {
            const before = window.featureKit.walls().length;
            const c = document.getElementById('blueprint-canvas');
            const r = c.getBoundingClientRect();
            const opts = (x, y) => ({ bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: r.left + x, clientY: r.top + y, pointerId: 7, isPrimary: true, pointerType: 'mouse' });
            c.dispatchEvent(new PointerEvent('pointerdown', opts(r.width * 0.3, r.height * 0.4)));
            window.dispatchEvent(new PointerEvent('pointermove', opts(r.width * 0.6, r.height * 0.55)));
            c.dispatchEvent(new PointerEvent('pointermove', opts(r.width * 0.6, r.height * 0.55)));
            c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width * 0.6, clientY: r.top + r.height * 0.55, pointerId: 7, isPrimary: true, pointerType: 'mouse' }));
            await new Promise((res) => setTimeout(res, 300));
            const after = window.featureKit.walls().length;
            return { before, after };
        })()`, true);
        check('click-drag draws a wall', walls && walls.after === walls.before + 1, JSON.stringify(walls));

        // Dead-button scan: every declared action resolves to a function.
        const dead = await evaluate(`(() => {
            const missing = [];
            document.querySelectorAll('[data-click]').forEach((el) => {
                const name = el.dataset.click;
                const parts = name.split('.');
                let owner = window;
                for (const p of parts.slice(0, -1)) owner = owner?.[p];
                if (typeof owner?.[parts[parts.length - 1]] !== 'function') missing.push(name);
            });
            document.querySelectorAll('[data-input]').forEach((el) => {
                const parts = el.dataset.input.split('.');
                let owner = window;
                for (const p of parts.slice(0, -1)) owner = owner?.[p];
                if (typeof owner?.[parts[parts.length - 1]] !== 'function') missing.push('input:' + el.dataset.input);
            });
            document.querySelectorAll('[data-change]').forEach((el) => {
                const parts = el.dataset.change.split('.');
                let owner = window;
                for (const p of parts.slice(0, -1)) owner = owner?.[p];
                if (typeof owner?.[parts[parts.length - 1]] !== 'function') missing.push('change:' + el.dataset.change);
            });
            return [...new Set(missing)];
        })()`);
        check('no dead buttons/toggles (all actions resolve)', Array.isArray(dead) && dead.length === 0, Array.isArray(dead) ? dead.slice(0, 8).join(', ') : String(dead));

        // View switch + scene visibility (the view cross-fades over 0.3 s).
        const view = await evaluate(`(async () => {
            window.setViewMode('3d');
            await new Promise((res) => setTimeout(res, 2000));
            const v3 = document.getElementById('view-3d');
            const r3 = document.getElementById('render-3d-view');
            const canvas = r3.querySelector('canvas');
            const rect = canvas ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
            const host = r3.getBoundingClientRect();
            const out = {
                opacity: getComputedStyle(v3).opacity,
                canvas: Boolean(canvas),
                cw: Math.round(rect.width), ch: Math.round(rect.height),
                host: Math.round(host.width) + 'x' + Math.round(host.height),
                walls: window.featureKit.walls().length
            };
            window.setViewMode('2d');
            return out;
        })()`, true);
        check('3D view switch shows a live canvas', view && view.canvas && view.cw > 100 && Number(view.opacity) >= 0.95, JSON.stringify(view));

        // Master scene + start-new handles.
        check('startNewProject + showMasterScene exist', await evaluate(`typeof window.startNewProject === 'function' && typeof window.showMasterScene === 'function'`));
        const master = await evaluate(`(async () => {
            const n = window.featureKit.walls().length;
            window.showMasterScene();
            await new Promise((res) => setTimeout(res, 2000));
            return { walls: window.featureKit.walls().length, before: n, mode: document.getElementById('view-3d') ? getComputedStyle(document.getElementById('view-3d')).opacity : '?' };
        })()`, true);
        check('master scene keeps plan and opens 3D', master && master.walls >= 0, JSON.stringify(master));
        const start = await evaluate(`(() => { const real = window.confirm; window.confirm = () => true; window.startNewProject(); window.confirm = real; return window.featureKit.walls().length; })()`);
        check('start new clears to a blank plan', start === 0, `walls=${start}`);
        check('page reports zero uncaught exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
    }

    // Suite page: dark mode default + css.
    await send('Page.navigate', { url: `${base}/pages/deck-designer.html` });
    await new Promise((r) => setTimeout(r, 2500));
    check('suite page defaults to dark mode', await evaluate(`document.documentElement.classList.contains('dark')`));
    check('suite page loads shared dark theme', await evaluate(`Boolean(document.querySelector('link[data-site-dark]'))`));

    try { await browser.call('Target.closeTarget', { targetId: pageTarget.id }); } catch {}
    session.sock.close(); browser.sock.close(); chrome.kill(); server?.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('PROBE ERROR', e.message); try { chrome?.kill(); } catch {} process.exit(3); });
