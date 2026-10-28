import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = 'http://127.0.0.1:8766';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9391;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.id = 1;
        this.pending = new Map();
        this.ready = new Promise((resolve) => { this.ws.onopen = resolve; });
        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.id && this.pending.has(message.id)) {
                const entry = this.pending.get(message.id);
                this.pending.delete(message.id);
                message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
            } else if (message.method) {
                const p = message.params;
                if (message.method === 'Runtime.consoleAPICalled') {
                    console.log('[console.' + p.type + ']', p.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
                } else if (message.method === 'Runtime.exceptionThrown') {
                    const d = p.exceptionDetails;
                    console.log('[exception]', d.text, d.exception?.description || '', d.url || '', d.lineNumber, d.columnNumber);
                } else if (message.method === 'Log.entryAdded') {
                    console.log('[log.' + p.entry.level + ']', p.entry.text, p.entry.url || '');
                }
            }
        };
    }
    async send(method, params = {}) {
        await this.ready;
        const id = this.id++;
        const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
        this.ws.send(JSON.stringify({ id, method, params }));
        return result;
    }
}

const profile = await mkdtemp(path.join(tmpdir(), 'buffit-console-'));
const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
        await sleep(250);
    }
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`${BASE}/pages/Editor.html`)}`, { method: 'PUT' })).json();
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await sleep(5000);
    const probe = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
            const out = {};
            for (const name of ['editorKit', 'featureKit', 'wallKit', 'deckKit', 'electricalKit', 'framingKit']) out[name] = typeof window[name];
            try { await import('/features/wall/preview.js'); out.wallPreview = 'ok'; } catch (e) { out.wallPreview = String(e); }
            try { await import('/features/deck/studio-panel.js'); out.deckPanel = 'ok'; } catch (e) { out.deckPanel = String(e); }
            return out;
        })()`,
        awaitPromise: true,
        returnByValue: true
    });
    console.log('probe', JSON.stringify(probe.result.value, null, 2));
} finally {
    chrome.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
}
