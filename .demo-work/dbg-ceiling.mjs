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
    constructor(url) {
        this.handlers = {}; this.ws = new WebSocket(url);
        this.ws.addEventListener('open', () => (this.handlers.open || []).forEach((fn) => fn()));
        this.ws.addEventListener('message', (ev) => (this.handlers.message || []).forEach((fn) => fn(ev.data)));
        this.ws.addEventListener('error', (ev) => (this.handlers.error || []).forEach((fn) => fn(ev)));
    }
    on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
    send(d) { this.ws.send(d); } close() { try { this.ws.close(); } catch {} }
}
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    `--user-data-dir=${join(ROOT, '.demo-work', 'probe-profile-3')}`, '--headless=new', '--no-first-run',
    '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
    chrome.stderr.on('data', (d) => { const m = String(d).match(/ws:\/\/[^\s]+/); if (m) resolve(m[0]); });
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
const errs = [];
browser.sock.on('message', (raw) => {
    try {
        const msg = JSON.parse(String(raw));
        if (msg.method === 'Runtime.exceptionThrown') errs.push(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || 'exception');
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') errs.push('console.error');
    } catch {}
});
const ev = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) return { threw: r.exceptionDetails.text };
    return { value: r.result?.value };
};
await send('Page.navigate', { url: `http://127.0.0.1:${port}/pages/Editor.html` });
for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); const r = await ev(`Boolean(window.toggleCeiling)`); if (r.value) break; }
console.log('instrumented:', JSON.stringify(await ev(`(() => {
    const b = document.getElementById('ceiling-toggle');
    const log = [];
    const orig = window.toggleCeiling;
    window.toggleCeiling = (...a) => { log.push('handler'); return orig(...a); };
    document.addEventListener('click', (e) => { if (e.target === b) log.push('doc-bubble:' + e.defaultPrevented); }, true);
    document.addEventListener('click', (e) => { if (e.target === b) log.push('doc-capture'); });
    b.addEventListener('click', () => log.push('box-checked=' + b.checked));
    b.click();
    const out = { log, checked: b.checked };
    window.toggleCeiling = orig;
    return out;
})()`)));
console.log('errors:', JSON.stringify(errs.slice(0, 5)));
try { await browser.call('Target.closeTarget', { targetId: target.id }); } catch {}
browser.sock.close(); chrome.kill(); server.close(); process.exit(0);
