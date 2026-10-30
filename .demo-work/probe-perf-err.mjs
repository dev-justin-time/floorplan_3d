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

const created = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent('http://127.0.0.1:8766/pages/Editor.html')}`, { method: 'PUT' })).json();
const cdp = new CDP(created.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Log.enable');
for (let i = 0; i < 60; i += 1) {
    const k = await cdp.evaluate("({ rs: document.readyState, kit: typeof window.editorKit, svm: typeof window.setViewMode })").catch(() => null);
    if (i % 10 === 9 || (k && k.kit !== 'undefined')) { console.log(`t=${i * 250}ms`, JSON.stringify(k)); if (k && k.kit !== 'undefined') break; }
    await sleep(250);
}
await sleep(1500);
const exc = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown');
console.log('exception count:', exc.length);
exc.slice(0, 3).forEach((e, i) => {
    const d = e.params.exceptionDetails;
    console.log(`--- exc ${i}:`, (d?.exception?.description || d?.text || '?').slice(0, 500));
});
cdp.ws.close();
process.exit(0);
