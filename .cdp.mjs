// Throwaway CDP harness: loads a page in headless Chrome, records console
// messages + uncaught exceptions, then evaluates an expression after a real
// wall-clock wait (import maps + CDN fetches need real time, not virtual time).
//
//   node .cdp.mjs <url> <waitMs> "<expression>"
import { spawn } from 'node:child_process';

import { readFileSync } from 'node:fs';

let [url, waitMs = '6000', expression = 'document.title'] = process.argv.slice(2);
if (expression.startsWith('@')) expression = readFileSync(expression.slice(1), 'utf8');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9300 + Math.floor(Math.random() * 400);

const chrome = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1440,900',
    `--remote-debugging-port=${port}`,
    'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
            const page = list.find((t) => t.type === 'page');
            if (page) return page.webSocketDebuggerUrl;
        } catch { /* chrome not up yet */ }
        await sleep(250);
    }
    throw new Error('no CDP target');
}

const ws = new WebSocket(await targetWs());
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
        return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
        events.push(`[console.${msg.params.type}] ${text}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        events.push(`[exception] ${d.text} ${d.exception?.description || ''}`.trim());
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        events.push(`[log.error] ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
    }
};

const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(Number(waitMs));

const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
});

console.log('--- console/errors');
console.log(events.length ? events.join('\n') : '(none)');
console.log('--- evaluate');
console.log(JSON.stringify(result.result?.result?.value ?? result.result, null, 2));

ws.close();
chrome.kill();
process.exit(0);
