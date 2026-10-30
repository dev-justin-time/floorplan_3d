const DEBUG_PORT = 9343;
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

async function openPage(url) {
    const created = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    const cdp = new CDP(created.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    return cdp;
}

// Editor: 3D view -> HUD visible with numbers; toggle off -> hidden; perf() handle.
{
    const cdp = await openPage('http://127.0.0.1:8766/pages/Editor.html');
    for (let i = 0; i < 60; i += 1) {
        const k = await cdp.evaluate("typeof window.editorKit").catch(() => null);
        if (k === 'object') break;
        await sleep(250);
    }
    const out = await cdp.evaluate(`(async () => {
        window.setViewMode('3d');
        await new Promise((r) => setTimeout(r, 1600));
        const hud = document.getElementById('perf-hud');
        const shown = { hidden: hud.classList.contains('hidden'), text: hud.textContent };
        const reading = window.editorKit.perf ? window.editorKit.perf() : 'NO HANDLE';
        // toggle the ability off via the abilities system
        const before = window.featureKit.abilities().perfHud;
        window.editorKit.abilities ? window.editorKit.abilities() : null;
        return { shown, reading, perfHudDefault: before };
    })()`);
    console.log('editor 3d hud:', JSON.stringify(out));
    // flip the toggle off through the ability host used by the panel
    const off = await cdp.evaluate(`(() => {
        const ab = window.featureKit.abilities();
        ab.perfHud = false;
        return true;
    })()`);
    await sleep(900);
    const hidden = await cdp.evaluate(`document.getElementById('perf-hud').classList.contains('hidden')`);
    console.log('editor hud hidden after toggle off:', hidden);
    const exc = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails?.text || '?');
    console.log('editor exceptions:', exc.length ? exc.slice(0, 5) : 'none');
    cdp.ws.close();
}
// Demo: 3D view -> chip visible.
{
    const cdp = await openPage('http://127.0.0.1:8766/pages/demo.html');
    await sleep(2500);
    const out = await cdp.evaluate(`(async () => {
        const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('3D'));
        if (btn) btn.click();
        await new Promise((r) => setTimeout(r, 1600));
        const hud = document.getElementById('demo-perf-hud');
        return hud ? { hidden: hud.classList.contains('hidden'), text: hud.textContent } : 'NO CHIP';
    })()`);
    console.log('demo 3d hud:', JSON.stringify(out));
    const exc = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails?.text || '?');
    console.log('demo exceptions:', exc.length ? exc.slice(0, 5) : 'none');
    cdp.ws.close();
}
process.exit(0);
