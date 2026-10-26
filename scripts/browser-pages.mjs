import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8766';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ['pages/app.html', 'pages/app-demo.html', 'pages/demo.html', 'pages/stair-gallery.html', 'pages/stair-glossary.html'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.id = 1;
        this.pending = new Map();
        this.events = [];
        this.ready = new Promise((resolve) => {
            this.ws.onopen = resolve;
            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.id && this.pending.has(message.id)) {
                    const entry = this.pending.get(message.id);
                    this.pending.delete(message.id);
                    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
                } else if (message.method) {
                    this.events.push(message);
                }
            };
        });
    }
    async send(method, params = {}) {
        await this.ready;
        const id = this.id++;
        const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
        this.ws.send(JSON.stringify({ id, method, params }));
        return result;
    }
    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result?.value;
    }
    errors() {
        return this.events
            .filter((event) => event.method === 'Runtime.exceptionThrown')
            .map((event) => event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text)
            .filter((text) => text && !text.includes('textures/'));
    }
}

(async () => {
    const profile = await mkdtemp(path.join(tmpdir(), 'buffit-pages-'));
    const chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
        '--no-default-browser-check', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: 'ignore' });

    try {
        for (let i = 0; i < 60; i++) {
            try {
                if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break;
            } catch {
                // waiting
            }
            await sleep(250);
        }

        for (const page of PAGES) {
            const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/' + page)}`, { method: 'PUT' })).json();
            const cdp = new CDP(target.webSocketDebuggerUrl);
            await cdp.send('Runtime.enable');
            await cdp.send('Page.enable');
            await sleep(4000);
            const info = await cdp.evaluate(`({
                canvases: document.querySelectorAll('canvas').length,
                title: document.title,
                body: document.body ? document.body.childElementCount : 0
            })`);
            const errors = cdp.errors();
            console.log(`${page}: canvases=${info.canvases} bodyNodes=${info.body} errors=${errors.length}`);
            errors.slice(0, 3).forEach((error) => console.log('   ', error.split('\n')[0]));
            cdp.ws.close();
        }
    } finally {
        chrome.kill();
        await sleep(300);
        await rm(profile, { recursive: true, force: true }).catch(() => {});
    }
})();
