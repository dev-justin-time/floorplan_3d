const DEBUG_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
        this.events = [];
        this.ready = new Promise((resolve) => {
            this.ws.onopen = resolve;
            this.ws.onerror = () => resolve();
            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.id && this.pending.has(message.id)) {
                    const { resolve: done, reject: fail } = this.pending.get(message.id);
                    this.pending.delete(message.id);
                    if (message.error) fail(new Error(message.error.message));
                    else done(message.result);
                } else if (message.method) {
                    this.events.push(message);
                }
            };
        });
    }
    async send(method, params = {}) {
        await this.ready;
        const id = this.nextId;
        this.nextId += 1;
        const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
        this.ws.send(JSON.stringify({ id, method, params }));
        return promise;
    }
    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) return { __ex: result.exceptionDetails?.exception?.description || result.exceptionDetails?.text || 'eval failed' };
        return result.result.value;
    }
}

import { readFileSync } from 'node:fs';
const auto = readFileSync('assets/southern-farmhouse-plan.json', 'utf8');

const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const cdp = new CDP(page.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Log.enable');
await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8766/pages/plan-studio.html' });
for (let i = 0; i < 40; i += 1) {
    const done = await cdp.evaluate("document.readyState === 'complete'").catch(() => false);
    if (done === true) break;
    await sleep(250);
}
await sleep(2500);
const seeded = await cdp.evaluate(`(() => { try {
    localStorage.clear();
    localStorage.setItem('floorplan3d_autosave', ${JSON.stringify(auto)});
    localStorage.setItem('lighting-suite-plan', JSON.stringify({ width: 5.2, depth: 4.2, height: 2.7, mountingHeight: 2.4, roomType: 'living', devices: [{ kind: 'luminaire', typeId: 'r1', x: 1, y: 1 }, { kind: 'luminaire', typeId: 'r2', x: 4, y: 3 }, { kind: 'switch', typeId: 's1', x: 2, y: 4 }], circuits: [{ id: 'c1' }] }));
    localStorage.setItem('site-plan-draft', JSON.stringify({ lotW: 30, lotD: 24, front: 6, side: 3, rear: 5, maxcov: 40, houseW: 18, houseD: 13, houseX: 6, houseY: 6 }));
    window.dispatchEvent(new Event('resize'));
    return 'seeded';
} catch (e) { return 'seed-failed:' + e.message; } })()`);
console.log('seed:', seeded);
await sleep(1500);
const report = await cdp.evaluate(`(() => ({
    cards: document.querySelectorAll('#uc-cards > div').length,
    checks: document.querySelectorAll('#uc-checks > div').length,
    cardStatus: [...document.querySelectorAll('#uc-cards > div')].map((d) => d.querySelector('b')?.textContent + ' :: ' + [...d.querySelectorAll('span')].map((s) => s.textContent.trim()).join(' / ')),
    canvases: ['v-interiors', 'v-rcp', 'v-section'].map((id) => ({ id, w: document.getElementById(id)?.width || 0 }))
}))()`);
console.log('hub report:', JSON.stringify(report));
const exceptions = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || 'unknown');
const consoleErrors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry.text);
console.log('exceptions:', exceptions.length ? exceptions.slice(0, 5) : 'none');
console.log('console errors:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'none');
cdp.ws.close();
process.exit(exceptions.length ? 1 : 0);
