const DEBUG_PORT = 9344;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res) => { ws.onopen = res; ws.onerror = res; });
let nextId = 1;
const pending = new Map();
const events = [];
ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
    } else if (m.method) events.push(m);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout: ' + method)); } }, 20000);
});
const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) return { __ex: result.exceptionDetails?.exception?.description || result.exceptionDetails?.text || 'eval failed' };
    return result.result.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8766/pages/Editor.html' });
let boot = null;
for (let i = 0; i < 50; i += 1) {
    boot = await evaluate("({ kit: typeof window.editorKit, clear: typeof window.clearProject })").catch(() => null);
    if (boot && boot.kit === 'object' && boot.clear === 'function') break;
    await sleep(300);
}
console.log('boot:', JSON.stringify(boot));

// 1. Inventory every clickable control.
const controls = await evaluate(`(() => {
    const out = [];
    document.querySelectorAll('[data-click]').forEach((el) => out.push({ kind: 'click', name: el.dataset.click, tag: el.tagName, id: el.id || null, text: (el.textContent || '').trim().slice(0, 40) }));
    document.querySelectorAll('[data-tool]').forEach((el) => out.push({ kind: 'tool', name: el.dataset.tool, tag: el.tagName, id: el.id || null, text: (el.textContent || '').trim().slice(0, 30) }));
    document.querySelectorAll('[data-view-mode]').forEach((el) => out.push({ kind: 'view', name: el.dataset.viewMode, tag: el.tagName, id: el.id || null, text: '' }));
    document.querySelectorAll('.elevation-btn').forEach((el) => out.push({ kind: 'elev', name: el.dataset.side ?? el.id, tag: el.tagName, id: el.id || null, text: '' }));
    document.querySelectorAll('[data-input]').forEach((el) => out.push({ kind: 'input', name: el.dataset.input, tag: el.tagName, id: el.id || null, text: '' }));
    document.querySelectorAll('[data-change]').forEach((el) => out.push({ kind: 'change', name: el.dataset.change, tag: el.tagName, id: el.id || null, text: '' }));
    return out;
})()`);
console.log('control count:', controls.length);

// 2. Click every data-click tool-safe control (skip destructive ones), record errors.
const dead = await evaluate(`(async () => {
    const skip = new Set(['clearProject']);
    const bad = [];
    const els = [...document.querySelectorAll('[data-click]')].filter((el) => !skip.has(el.dataset.click));
    for (const el of els) {
        try {
            el.click();
            await new Promise((r) => setTimeout(r, 60));
        } catch (e) { bad.push(el.dataset.click + ': threw ' + e.message); }
    }
    // view modes + elevation sides + tools
    for (const b of document.querySelectorAll('[data-view-mode]')) { try { b.click(); await new Promise((r) => setTimeout(r, 120)); } catch (e) { bad.push('view:' + b.dataset.viewMode + ' threw'); } }
    for (const b of document.querySelectorAll('.elevation-btn[data-side]')) { try { b.click(); await new Promise((r) => setTimeout(r, 120)); } catch (e) { bad.push('elev:' + b.dataset.side + ' threw'); } }
    for (const b of document.querySelectorAll('[data-tool]')) { try { b.click(); } catch (e) { bad.push('tool:' + b.dataset.tool + ' threw'); } }
    window.setViewMode('2d');
    return { clicked: els.length, bad };
})()`);
console.log('click sweep:', JSON.stringify(dead));
const exc1 = events.filter((e) => e.method === 'Runtime.exceptionThrown');
console.log('exceptions after sweep:', exc1.length);

// 3. Trusted wall drag via Input.dispatchMouseEvent on the 2D canvas.
await evaluate(`(() => { window.clearProject(); window.setViewMode('2d'); document.querySelector('[data-tool="wall"]')?.click(); })()`);
await sleep(300);
const rect = await evaluate(`(() => { const r = document.getElementById('blueprint-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
console.log('canvas rect:', JSON.stringify(rect));
const x1 = Math.round(rect.x + rect.w * 0.3), y1 = Math.round(rect.y + rect.h * 0.4);
const x2 = Math.round(rect.x + rect.w * 0.7), y2 = Math.round(rect.y + rect.h * 0.4);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
for (let i = 1; i <= 5; i += 1) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x1 + ((x2 - x1) * i) / 5), y: y1, button: 'left' });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
await sleep(600);
const walls = await evaluate(`window.featureKit.walls().length`);
console.log('walls after trusted drag:', walls);

// 4. Scene/viewport: renderer, canvas size, frames drawn, screenshot variance.
const scene = await evaluate(`(() => {
    const kit = window.editorKit;
    const cv = document.querySelector('#render-3d-view canvas');
    const r = cv?.getBoundingClientRect();
    return {
        renderer: typeof kit.renderer === 'function' ? Boolean(kit.renderer()) : 'NO HANDLE',
        canvas: Boolean(cv),
        size: r ? { w: Math.round(r.width), h: Math.round(r.height), bw: cv.width, bh: cv.height } : null,
        frames: kit.render ? kit.render().stats || kit.render() : 'NO HANDLE'
    };
})()`);
console.log('scene:', JSON.stringify(scene));
const shot = await send('Page.captureScreenshot', { format: 'png' });
console.log('screenshot bytes:', (shot.data || '').length);
const exc2 = events.filter((e) => e.method === 'Runtime.exceptionThrown');
console.log('total exceptions:', exc2.length);
exc2.slice(0, 4).forEach((e, i) => console.log(`--- exc${i}:`, String(e.params.exceptionDetails?.text || '?').slice(0, 300)));
ws.close();
process.exit(0);
