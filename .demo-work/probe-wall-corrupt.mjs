/* Corrupt-state survival: poison autosave + drafts, boot must still draw walls. */
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
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${join(ROOT, '.demo-work', 'probe-profile-8')}`, '--headless=new', '--no-first-run', '--window-size=1280,900', '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
const ev = async (e, awaitPromise = false) => {
    try {
        const r = await send('Runtime.evaluate', { expression: e, awaitPromise, returnByValue: true });
        if (!r || r.exceptionDetails) return { threw: true };
        return r.result?.value;
    } catch { return { threw: true }; }
};
const CASES = {
    garbageWalls: JSON.stringify({ version: 41, stories: [{ id: 's1', name: 'G', walls: [null, 7, 'x', { start: null }, { start: { x: 1 }, end: { x: 2 } }, { start: { x: NaN, y: 0 }, end: { x: 1, y: 1 } }], fixtures: [null, { nope: 1 }], openings: 'bogus', visible: true }], currentStoryIndex: 0 }),
    wrongShape: JSON.stringify({ foo: 1, walls: 'nope' }),
    deckJunk: JSON.stringify({ config: null, sentAt: 'x' }),
};
await send('Page.navigate', { url: `http://127.0.0.1:${port}/pages/Editor.html` });
await new Promise((r) => setTimeout(r, 1500));
await ev(`localStorage.setItem('floorplan3d_autosave', ${JSON.stringify(CASES.garbageWalls)});
    localStorage.setItem('deck-editor-draft', ${JSON.stringify(CASES.deckJunk)});
    localStorage.setItem('roof-editor-draft', '[truncated');
    localStorage.setItem('floorplan-editor-draft', ${JSON.stringify(CASES.wrongShape)});`);
await send('Page.navigate', { url: `http://127.0.0.1:${port}/pages/Editor.html` });
let ready = false;
for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); if (await ev(`Boolean(window.featureKit && window.systemsKit && window.toggleCeiling)`)) break; else if (i === 39) ready = false; else continue; ready = true; }
ready = await ev(`Boolean(window.featureKit && window.systemsKit && window.toggleCeiling)`);
check('editor boots with corrupt autosave + drafts', ready === true);
if (ready) {
    const kit = await ev(`(() => { const c = document.getElementById('blueprint-canvas'); const r = c.getBoundingClientRect(); return { walls: window.featureKit.walls().length, cw: Math.round(r.width), ch: Math.round(r.height) }; })()`);
    check('canvas sized, walls array usable', kit && kit.cw > 200 && kit.walls === 0, JSON.stringify(kit));
    const before = kit.walls;
    const box = await ev(`(() => { const c = document.getElementById('blueprint-canvas'); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 180 * i / 8, y: box.y + 40 * i / 8, button: 'left' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 180, y: box.y + 40, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 800));
    const after = await ev(`window.featureKit.walls().length`);
    check('trusted drag draws a wall on the recovered blank plan', after === before + 1, `before=${before} after=${after}`);
    const hist = await ev(`window.advancedKit.historyDepth()`);
    const undo = await ev(`(async () => { document.querySelector('[data-click="undo"]').click(); await new Promise((r) => setTimeout(r, 300)); return window.featureKit.walls().length; })()`, true);
    check('buttons alive after corrupt boot (undo works)', undo === before, `hist=${hist} walls=${undo}`);
}
check('zero uncaught errors on corrupt boot', errs.length === 0, errs.slice(0, 3).join(' | '));
try { await browser.call('Target.closeTarget', { targetId: target.id }); } catch {}
browser.sock.close(); chrome.kill(); server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} corrupt-state checks passed`);
process.exit(failed ? 1 : 0);
