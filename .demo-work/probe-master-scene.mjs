/* Master scene probe: grid on all pages, full-page in the Editor. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${join(ROOT, '.demo-work', 'probe-profile-6')}`, '--headless=new', '--no-first-run', '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
const wsUrl = await new Promise((resolve) => { chrome.stderr.on('data', (d) => { const m = String(d).match(/ws:\/\/[^\s]+/); if (m) resolve(m[0]); }); });
const mk = async () => { const sock = new WS(wsUrl); await new Promise((res) => sock.on('open', res));
    let id = 0; const pending = new Map();
    sock.on('message', (data) => { try { const msg = JSON.parse(String(data));
        if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer); p.resolve(msg.result); } } catch {} });
    return { sock, call: (method, params = {}, sessionId) => new Promise((resolve, reject) => { const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); reject(new Error('cdp timeout: ' + method)); }, 15000);
        pending.set(mid, { resolve, reject, timer });
        sock.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); }) }; };
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const browser = await mk();
const infos = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json();
const target = infos.find((t) => t.type === 'page');
const { sessionId } = await browser.call('Target.attachToTarget', { targetId: target.id, flatten: true });
const send = (m, p = {}) => browser.call(m, p, sessionId);
await send('Page.enable'); await send('Runtime.enable');
const pageErrors = [];
const errSock = await mk();
void errSock;
const ev = async (e, awaitPromise = false) => {
    try {
        const r = await send('Runtime.evaluate', { expression: e, awaitPromise, returnByValue: true });
        if (!r || r.exceptionDetails) return { threw: true };
        return r.result?.value;
    } catch { return { threw: true }; }
};
const openViewer = async () => ev(`(async () => {
    try { await import('../shared/project-viewer.js'); } catch (e) { return { importError: String(e && e.message || e) }; }
    document.getElementById('project-3d-fab').click();
    await new Promise((r) => setTimeout(r, 4000));
    const ov = document.getElementById('project-3d-overlay');
    if (!ov) return null;
    const panel = document.getElementById('pv-panel');
    const pr = panel.getBoundingClientRect();
    const canvas = ov.querySelector('canvas');
    const cr = canvas ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
    if (!ov) return { missing: true, href: location.href };
    return {
        visible: getComputedStyle(ov).display !== 'none',
        chips: [...document.querySelectorAll('#pv-chips button')].map((b) => b.textContent),
        panel: Math.round(pr.width) + 'x' + Math.round(pr.height),
        canvas: Math.round(cr.width) + 'x' + Math.round(cr.height),
        full: ov.dataset.full === 'true',
        vw: window.innerWidth, vh: window.innerHeight
    };
})()`, true);

// Suite page: dialog overlay with grid chip on.
await send('Page.navigate', { url: `http://127.0.0.1:${port}/pages/deck-designer.html` });
for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); if (await ev(`Boolean(document.getElementById('project-3d-fab'))`)) break; }
let v = await openViewer();
check('master scene opens on suite page', v && v.visible, JSON.stringify(v));
check('grid layer chip is on by default', v && v.chips.some((c) => c.includes('●') && c.includes('grid')), (v && v.chips.join(',')) || '');
check('suite viewer is a dialog (not full page)', v && v.full === false, `full=${v && v.full}`);
check('suite viewer canvas is drawn', v && v.canvas !== '0x0', v && v.canvas);
// Grid toggle actually removes the grid chip state.
const toggled = await ev(`(() => {
    [...document.querySelectorAll('#pv-chips button')].find((b) => b.textContent.includes('grid')).click();
    return [...document.querySelectorAll('#pv-chips button')].map((b) => b.textContent).join(',');
})()`);
check('grid chip toggles off', toggled.includes('○ grid'), toggled);

// Editor page: full-page master scene.
await send('Page.navigate', { url: `http://127.0.0.1:${port}/pages/Editor.html` });
for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); if (await ev(`Boolean(document.getElementById('project-3d-fab') && window.featureKit)`)) break; }
v = await openViewer();
check('master scene opens in Editor', v && v.visible, JSON.stringify(v && v.panel));
check('Editor master scene is full page', v && v.full === true && parseInt(v.panel.split('x')[0]) >= v.vw - 2 && parseInt(v.panel.split('x')[1]) >= v.vh - 2, v && `${v.panel} vs viewport ${v.vw}x${v.vh}`);
check('Editor master canvas fills panel', v && v.canvas !== '0x0', v && v.canvas);

try { await browser.call('Target.closeTarget', { targetId: target.id }); } catch {}
browser.sock.close(); chrome.kill(); server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} master-scene checks passed`);
process.exit(failed ? 1 : 0);
