/* Trusted-input wall drag: real mouse pipeline (hit-test, capture, listeners).
 * Fails where synthetic dispatchEvent passes if anything intercepts the canvas.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://x');
        let p = normalize(join(ROOT, decodeURIComponent(url.pathname === '/' ? '/pages/Editor.html' : url.pathname)));
        const data = await readFile(p);
        res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
        res.end(data);
    } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
class WS {
    constructor(url) { this.handlers = {}; this.ws = new WebSocket(url);
        this.ws.addEventListener('open', () => (this.handlers.open || []).forEach((fn) => fn()));
        this.ws.addEventListener('message', (ev) => (this.handlers.message || []).forEach((fn) => fn(ev.data))); }
    on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
    send(d) { this.ws.send(d); } close() { try { this.ws.close(); } catch {} }
}
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${join(ROOT, '.demo-work', 'probe-profile-7')}`, '--headless=new', '--no-first-run', '--window-size=1280,900', '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
const wsUrl = await new Promise((resolve) => { chrome.stderr.on('data', (d) => { const m = String(d).match(/ws:\/\/[^\s]+/); if (m) resolve(m[0]); }); });
const mk = async () => { const sock = new WS(wsUrl); await new Promise((res) => sock.on('open', res));
    let id = 0; const pending = new Map();
    sock.on('message', (data) => { try { const msg = JSON.parse(String(data));
        if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer); p.resolve(msg.result); } } catch {} });
    return { sock, call: (method, params = {}, sessionId) => new Promise((resolve, reject) => { const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); reject(new Error('cdp timeout: ' + method)); }, 20000);
        pending.set(mid, { resolve, reject, timer });
        sock.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); }) }; };
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? ' — ' + String(d).slice(0, 300) : ''}`); };
const browser = await mk();
const infos = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json();
const target = infos.find((t) => t.type === 'page');
const { sessionId } = await browser.call('Target.attachToTarget', { targetId: target.id, flatten: true });
const send = (m, p = {}) => browser.call(m, p, sessionId);
await send('Page.enable'); await send('Runtime.enable');
const errs = [];
browser.sock.on('message', (raw) => {
    try { const msg = JSON.parse(String(raw));
        if (msg.method === 'Runtime.exceptionThrown') errs.push(msg.params?.exceptionDetails?.text || 'exception');
    } catch {}
});
const ev = async (e) => {
    try {
        const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
        if (!r || r.exceptionDetails) return { threw: true };
        return r.result?.value;
    } catch { return { threw: true }; }
};
await send('Page.navigate', { url: `http://127.0.0.1:${port}/pages/Editor.html` });
for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); if (await ev(`Boolean(window.featureKit && window.featureKit.walls().length > 0)`)) break; }

// What is actually under the drag point? (interception audit)
const hit = await ev(`(() => {
    const c = document.getElementById('blueprint-canvas');
    const r = c.getBoundingClientRect();
    const x = r.left + r.width * 0.3, y = r.top + r.height * 0.5;
    const el = document.elementFromPoint(x, y);
    const path = [];
    let n = el;
    while (n && path.length < 6) { path.push(n.id ? '#' + n.id : n.className ? '.' + String(n.className).split(' ')[0] : n.tagName); n = n.parentElement; }
    return { x: Math.round(x), y: Math.round(y), top: el ? (el.id || el.tagName + '.' + String(el.className).split(' ')[0]) : 'NONE', path,
        canvasRect: { w: Math.round(r.width), h: Math.round(r.height) },
        modalHidden: document.getElementById('upload-modal').classList.contains('hidden'),
        tool: null };
})()`);
check('drag point hit-tests to the canvas (nothing on top)', hit && hit.top === 'blueprint-canvas', JSON.stringify(hit));
const before = await ev(`window.featureKit.walls().length`);
check('seed plan loaded', before > 0, `walls=${before}`);

// Trusted drag: press, move in steps, release.
const drag = async (x0, y0, x1, y1) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / 10, y: y0 + (y1 - y0) * i / 10, button: 'left' });
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
};
await drag(hit.x, hit.y, hit.x + 200, hit.y + 60);
await new Promise((r) => setTimeout(r, 800));
const after = await ev(`window.featureKit.walls().length`);
check('TRUSTED mouse drag creates a wall', after === before + 1, `before=${before} after=${after}`);

// Trusted click on Wall tool button first (in case tool wasn't wall), then drag again.
await ev(`document.querySelector('.tool-btn[data-tool="wall"]').click()`);
await drag(hit.x, hit.y - 80, hit.x + 180, hit.y - 20);
await new Promise((r) => setTimeout(r, 800));
const after2 = await ev(`window.featureKit.walls().length`);
check('trusted drag after Wall-button click creates a wall', after2 === after + 1, `after=${after} after2=${after2}`);
check('zero uncaught errors', errs.length === 0, errs.slice(0, 3).join(' | '));

try { await browser.call('Target.closeTarget', { targetId: target.id }); } catch {}
browser.sock.close(); chrome.kill(); server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} trusted-input checks passed`);
process.exit(failed ? 1 : 0);
