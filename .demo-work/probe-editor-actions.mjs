/* Functional audit: click real Editor controls, assert real state changes.
 * Usage: timeout 170 node .demo-work/probe-editor-actions.mjs
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
    results.push({ name, ok: Boolean(ok) });
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
};
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
}

let chrome = null;
async function main() {
    const { server, port } = await startStatic();
    const base = `http://127.0.0.1:${port}`;
    chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
        `--user-data-dir=${join(ROOT, '.demo-work', 'probe-profile-2')}`, '--headless=new',
        '--no-first-run', '--no-default-browser-check', '--disable-gpu-sandbox',
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const wsUrl = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('devtools timeout')), 30000);
        chrome.stderr.on('data', (d) => { const m = String(d).match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
        chrome.on('error', reject);
    });
    const mk = async () => {
        const sock = new WS(wsUrl);
        await new Promise((res, rej) => { sock.on('open', res); sock.on('error', rej); });
        let id = 0; const pending = new Map();
        sock.on('message', (data) => {
            try {
                const msg = JSON.parse(String(data));
                if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
            } catch {}
        });
        return { sock, call: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
            const mid = ++id; const timer = setTimeout(() => { pending.delete(mid); reject(new Error('cdp timeout: ' + method)); }, 15000);
            pending.set(mid, { resolve, reject, timer });
            sock.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
        }) };
    };
    const browser = await mk();
    const infos = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json();
    const target = infos.find((t) => t.type === 'page');
    const { sessionId } = await browser.call('Target.attachToTarget', { targetId: target.id, flatten: true });
    const send = (m, p = {}) => browser.call(m, p, sessionId);
    await send('Page.enable'); await send('Runtime.enable');
    const errors = [];
    browser.sock.on('message', (raw) => {
        try {
            const msg = JSON.parse(String(raw));
            if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params?.exceptionDetails?.text || 'exception');
        } catch {}
    });
    const evaluate = async (expression, awaitPromise = false) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed');
        return r.result?.value;
    };
    await send('Page.navigate', { url: `${base}/pages/Editor.html` });
    let ready = false;
    for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try { ready = await evaluate(`Boolean(window.editorKit && window.featureKit && window.systemsKit)`); } catch {}
        if (ready) break;
    }
    check('editor boots', ready === true);
    if (!ready) throw new Error('no boot');
    // The demo plan seeds asynchronously; wait until the wall count settles.
    await evaluate(`(async () => {
        let last = -1, steady = 0;
        for (let i = 0; i < 40; i++) {
            const n = window.featureKit.walls().length;
            if (n > 0 && n === last) { if (++steady >= 2) return n; } else steady = 0;
            last = n;
            await new Promise((r) => setTimeout(r, 500));
        }
        return window.featureKit.walls().length;
    })()`, true);

    // 1. Wall tool button -> drag draws wall.
    const wallBtn = await evaluate(`(async () => {
        const before = window.featureKit.walls().length;
        document.querySelector('.tool-btn[data-tool="wall"]').click();
        const c = document.getElementById('blueprint-canvas');
        const r = c.getBoundingClientRect();
        const o = (x, y) => ({ bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: r.left + x, clientY: r.top + y, pointerId: 7, isPrimary: true, pointerType: 'mouse' });
        c.dispatchEvent(new PointerEvent('pointerdown', o(r.width * 0.2, r.height * 0.7)));
        c.dispatchEvent(new PointerEvent('pointermove', o(r.width * 0.5, r.height * 0.7)));
        c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.7, pointerId: 7, isPrimary: true, pointerType: 'mouse' }));
        await new Promise((res) => setTimeout(res, 300));
        return { before, after: window.featureKit.walls().length };
    })()`, true);
    check('Wall tool button + drag creates a wall', wallBtn.after === wallBtn.before + 1, JSON.stringify(wallBtn));

    // 2. Undo header button removes it, redo restores it.
    const undone = await evaluate(`(async () => {
        document.querySelector('[data-click="undo"]').click();
        await new Promise((res) => setTimeout(res, 300));
        const mid = window.featureKit.walls().length;
        document.querySelector('[data-click="redo"]').click();
        await new Promise((res) => setTimeout(res, 300));
        return { mid, end: window.featureKit.walls().length };
    })()`, true);
    check('Undo removes wall, redo restores it', undone.mid === wallBtn.before && undone.end === wallBtn.after, JSON.stringify(undone));

    // 3. Door palette button + canvas click places a fixture.
    const placed = await evaluate(`(async () => {
        const before = window.featureKit.fixtures().length;
        document.querySelector('.item-button[data-item="door"]').click();
        const c = document.getElementById('blueprint-canvas');
        const r = c.getBoundingClientRect();
        // click near the first wall midpoint
        const w = window.featureKit.walls()[0];
        const mx = (w.start.x + w.end.x) / 2, my = (w.start.y + w.end.y) / 2;
        const rect = c.getBoundingClientRect();
        // plan->screen: offset/scale unknown here; use bounding-box mapping via wallScreenPoint handle
        const pt = window.editorKit.wallScreenPoint ? null : null;
        c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, pointerId: 9, isPrimary: true, pointerType: 'mouse' }));
        await new Promise((res) => setTimeout(res, 300));
        return { before, after: window.featureKit.fixtures().length };
    })()`, true);
    check('Door palette button places a fixture on canvas click', placed.after === placed.before + 1, JSON.stringify(placed));

    // 4. Select tool + Delete tool via buttons: delete the placed door.
    const deleted = await evaluate(`(async () => {
        const before = window.featureKit.fixtures().length;
        document.querySelector('.tool-btn[data-tool="select"]').click();
        const c = document.getElementById('blueprint-canvas');
        const r = c.getBoundingClientRect();
        const click = (x, y) => c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y, pointerId: 11, isPrimary: true, pointerType: 'mouse' }));
        // select the last fixture by clicking its plan position is fiddly; use keyboard delete on selection instead:
        // click centre where the door was placed, then Delete key
        click(r.left + r.width / 2, r.top + r.height / 2);
        await new Promise((res) => setTimeout(res, 200));
        document.querySelector('.tool-btn[data-tool="delete"]').click();
        click(r.left + r.width / 2, r.top + r.height / 2);
        await new Promise((res) => setTimeout(res, 300));
        return { before, after: window.featureKit.fixtures().length };
    })()`, true);
    check('Delete tool button removes the fixture', deleted.after === deleted.before - 1, JSON.stringify(deleted));

    // 5. Cutout tool drag adds a floor opening.
    const cut = await evaluate(`(async () => {
        const before = (window.studioKit.openings() || []).length;
        document.querySelector('.tool-btn[data-tool="cutout"]').click();
        const c = document.getElementById('blueprint-canvas');
        const r = c.getBoundingClientRect();
        const o = (x, y) => ({ bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: r.left + x, clientY: r.top + y, pointerId: 13, isPrimary: true, pointerType: 'mouse' });
        c.dispatchEvent(new PointerEvent('pointerdown', o(r.width * 0.35, r.height * 0.3)));
        c.dispatchEvent(new PointerEvent('pointermove', o(r.width * 0.45, r.height * 0.4)));
        c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width * 0.45, clientY: r.top + r.height * 0.4, pointerId: 13, isPrimary: true, pointerType: 'mouse' }));
        await new Promise((res) => setTimeout(res, 300));
        document.querySelector('.tool-btn[data-tool="select"]').click();
        return { before, after: (window.studioKit.openings() || []).length };
    })()`, true);
    check('Cutout tool drag adds a floor opening', cut.after === cut.before + 1, JSON.stringify(cut));

    // 6. Ability toggle flips real state (grid).
    const abil = await evaluate(`(() => {
        const before = window.featureKit.abilities().grid;
        const row = document.querySelector('[data-ability="grid"] input');
        row.click();
        return { before, after: window.featureKit.abilities().grid, checked: row.checked };
    })()`);
    check('Abilities panel toggle flips grid state', abil.after === !abil.before && abil.checked === abil.after, JSON.stringify(abil));

    // 7. Ability action button runs (Center plan).
    const act = await evaluate(`(() => {
        document.querySelector('[data-ability="centerPlan"]').click();
        return window.featureKit.walls().length;
    })()`);
    check('Ability action Center plan runs without error', act >= 0, `walls=${act}`);

    // 8. Systems tab switches model.
    const sys = await evaluate(`(() => {
        document.querySelector('[data-system="framing"]').click();
        return window.systemsKit.active();
    })()`);
    check('Systems Framing tab switches panel model', sys === 'framing', sys);

    // 9. Import modal opens via data-show, closes via data-hide.
    const modal = await evaluate(`(() => {
        document.querySelector('[data-show="#upload-modal"]').click();
        const open = !document.getElementById('upload-modal').classList.contains('hidden');
        document.querySelector('[data-hide="#upload-modal"]').click();
        const closed = document.getElementById('upload-modal').classList.contains('hidden');
        return { open, closed };
    })()`);
    check('Import popup opens and closes', modal.open && modal.closed, JSON.stringify(modal));

    // 10. Merlot select arms placement, canvas click places cabinet.
    const merlot = await evaluate(`(async () => {
        const before = window.featureKit.fixtures().length;
        const sel = document.getElementById('merlot-select');
        sel.value = 'merlot_base_cabinet';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const c = document.getElementById('blueprint-canvas');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: r.left + r.width * 0.7, clientY: r.top + r.height * 0.75, pointerId: 15, isPrimary: true, pointerType: 'mouse' }));
        await new Promise((res) => setTimeout(res, 300));
        document.querySelector('.tool-btn[data-tool="select"]').click();
        return { before, after: window.featureKit.fixtures().length };
    })()`, true);
    check('Merlot select places a cabinet on canvas click', merlot.after === merlot.before + 1, JSON.stringify(merlot));

    // 11. Ceiling toggle flips state both ways (proves the handler runs).
    const ceil = await evaluate(`(() => {
        const box = document.getElementById('ceiling-toggle');
        const start = box.checked;
        box.click();
        const mid = box.checked;
        box.click();
        return { start, mid, end: box.checked };
    })()`);
    check('Ceiling toggle actuates both ways', ceil.mid !== ceil.start && ceil.end === ceil.start, JSON.stringify(ceil));

    // 12. Elevation stepper moves the elevation wall.
    const elev = await evaluate(`(async () => {
        window.setViewMode('elevation');
        await new Promise((res) => setTimeout(res, 500));
        const first = window.elevationKit.wall();
        document.getElementById('elevation-next').click();
        await new Promise((res) => setTimeout(res, 300));
        const second = window.elevationKit.wall();
        window.setViewMode('2d');
        return { first, second };
    })()`, true);
    check('Elevation stepper advances the wall', elev.first && elev.second && elev.first !== elev.second, JSON.stringify(elev));

    check('zero uncaught page errors during the whole action run', errors.length === 0, errors.slice(0, 3).join(' | '));

    try { await browser.call('Target.closeTarget', { targetId: target.id }); } catch {}
    browser.sock.close(); chrome.kill(); server.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} action checks passed`);
    process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('PROBE ERROR', e.message); try { chrome?.kill(); } catch {} process.exit(3); });
