import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
    try { const url = new URL(req.url, 'http://x');
        let p = normalize(join(ROOT, decodeURIComponent(url.pathname === '/' ? '/pages/Editor.html' : url.pathname)));
        const data = await readFile(p);
        res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data);
    } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
class WS { constructor(url) { this.handlers = {}; this.ws = new WebSocket(url);
        this.ws.addEventListener('open', () => (this.handlers.open || []).forEach((fn) => fn()));
        this.ws.addEventListener('message', (ev) => (this.handlers.message || []).forEach((fn) => fn(ev.data))); }
    on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
    send(d) { this.ws.send(d); } close() { try { this.ws.close(); } catch {} } }
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${join(ROOT, '.demo-work', 'probe-profile-5')}`, '--headless=new', '--no-first-run', '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
const wsUrl = await new Promise((resolve) => { chrome.stderr.on('data', (d) => { const m = String(d).match(/ws:\/\/[^\s]+/); if (m) resolve(m[0]); }); });
const mk = async () => { const sock = new WS(wsUrl); await new Promise((res) => sock.on('open', res));
    let id = 0; const pending = new Map();
    sock.on('message', (data) => { try { const msg = JSON.parse(String(data));
        if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer); p.resolve(msg.result); } } catch {} });
    return { sock, call: (method, params = {}, sessionId) => new Promise((resolve, reject) => { const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); reject(new Error('timeout')); }, 15000);
        pending.set(mid, { resolve, reject, timer });
        sock.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); }) }; };
const browser = await mk();
const infos = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json();
const target = infos.find((t) => t.type === 'page');
const { sessionId } = await browser.call('Target.attachToTarget', { targetId: target.id, flatten: true });
const send = (m, p = {}) => browser.call(m, p, sessionId);
await send('Page.enable'); await send('Runtime.enable');
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value;
await send('Page.navigate', { url: `http://127.0.0.1:${port}/pages/Editor.html` });
for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); if (await ev(`Boolean(window.featureKit)`)) break; }
console.log(JSON.stringify(await ev(`(() => {
    let n = 0; const calls = [];
    const orig = window.toggleCeiling;
    window.toggleCeiling = function (...a) { n++; calls.push(document.getElementById('ceiling-toggle').checked); return orig.apply(this, a); };
    const b = document.getElementById('ceiling-toggle');
    const start = b.checked;
    b.click();
    const mid = { box: b.checked, calls: n, atCall: calls.slice() };
    window.toggleCeiling = orig;
    return { start, mid };
})()`)));
try { await browser.call('Target.closeTarget', { targetId: target.id }); } catch {}
browser.sock.close(); chrome.kill(); server.close(); process.exit(0);
