import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8766';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9335;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.id = 1;
        this.pending = new Map();
        this.events = [];
        this.ready = new Promise((resolve) => { this.ws.onopen = resolve; });
        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.id && this.pending.has(message.id)) {
                const entry = this.pending.get(message.id);
                this.pending.delete(message.id);
                message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
            } else if (message.method) this.events.push(message);
        };
    }
    async send(method, params = {}) {
        await this.ready;
        const id = this.id++;
        const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
        this.ws.send(JSON.stringify({ id, method, params }));
        return result;
    }
    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result?.value;
    }
    errors() {
        return this.events.filter((event) => event.method === 'Runtime.exceptionThrown')
            .map((event) => event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text)
            .concat(this.events.filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
                .map((event) => event.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')));
    }
}

const profile = await mkdtemp(path.join(tmpdir(), 'lighting-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
    if (ok) {
        passed += 1;
        console.log(`  ok  ${name}${detail ? ' — ' + detail : ''}`);
    } else {
        failed += 1;
        console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
    }
};

try {
    for (let i = 0; i < 60; i++) {
        try {
            if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break;
        } catch (error) { /* waiting */ }
        await sleep(250);
    }
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/lighting-designer.html')}`, { method: 'PUT' })).json();
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(2500);

    const start = await cdp.evaluate(`(() => {
        const s = window.lightingSuite;
        return {
            suite: Boolean(s),
            room: s?.plan.roomType,
            lights: s?.plan.devices.filter(d => d.kind === 'luminaire').length,
            sockets: s?.plan.devices.filter(d => d.kind === 'socket').length,
            switches: s?.plan.devices.filter(d => d.kind === 'switch').length,
            circuits: s?.plan.circuits.length,
            lux: s?.design.metrics.averageLux,
            target: s?.design.metrics.targetLux,
            canvas: document.querySelector('canvas').width,
            metric: document.getElementById('m-lux').textContent,
            errors: s?.design.errors.length,
            warns: s?.design.warnings.length
        };
    })()`);
    check('suite boots', start.suite);
    check('living plan auto-designed', start.room === 'living' && start.lights >= 1 && start.sockets > 0 && start.switches === 1, `${start.lights}L ${start.sockets}R ${start.switches}S`);
    check('circuits generated', start.circuits >= 2, `${start.circuits}`);
    check('metrics rendered', start.metric.includes('lx') && start.lux > 0, `${start.lux} lx / ${start.target}`);
    check('canvas has pixels', start.canvas > 100, `${start.canvas}px`);
    check('auto design has no errors', start.errors === 0, `${start.errors} errors ${start.warns} warnings`);

    await cdp.evaluate(`document.querySelector('[data-tab="schedule"]').click()`);
    await sleep(300);
    const schedule = await cdp.evaluate(`({
        rows: document.querySelectorAll('#schedule-table tbody tr').length,
        tag: document.querySelector('#schedule-table tbody tr td')?.textContent,
        summary: document.getElementById('schedule-summary').textContent
    })`);
    check('schedule lists every device', schedule.rows === start.lights + start.sockets + start.switches, `${schedule.rows} rows`);
    check('schedule row tagged', /^[LSR]\d+$/.test(schedule.tag.trim()), schedule.tag);
    check('schedule summary has room and lux', schedule.summary.includes('lx') && schedule.summary.includes('m²'), schedule.summary);

    await cdp.evaluate(`document.querySelector('[data-tab="rules"]').click()`);
    await sleep(300);
    const rules = await cdp.evaluate(`({
        count: document.querySelectorAll('#rules-list .rule').length,
        categories: document.querySelectorAll('#rules-chips [data-rule-category]').length,
        summary: document.getElementById('rules-summary').textContent,
        code: document.querySelector('#rules-list .rule .font-mono')?.textContent
    })`);
    check('rules list renders', rules.count === 22, `${rules.count} rules`);
    check('rules categories render', rules.categories === 7, `${rules.categories} chips`);
    check('rules status summary', rules.summary.includes('pass') && rules.summary.includes('review'), rules.summary);
    check('rules carry code citations', Boolean(rules.code && rules.code.includes('IRC')), rules.code);

    await cdp.evaluate(`(() => {
        const input = document.getElementById('rules-search');
        input.value = 'GFCI';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(250);
    const filtered = await cdp.evaluate(`({ count: document.querySelectorAll('#rules-list .rule').length, text: document.getElementById('rules-list').textContent })`);
    check('rules search filters', filtered.count > 0 && filtered.count < 22 && filtered.text.includes('GFCI'), `${filtered.count} results`);
    await cdp.evaluate(`(() => { const input = document.getElementById('rules-search'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);

    await cdp.evaluate(`window.lightingSuite.setRoom('kitchen')`);
    await sleep(600);
    const kitchen = await cdp.evaluate(`(() => {
        const s = window.lightingSuite;
        return {
            room: s.plan.roomType,
            target: s.design.metrics.targetLux,
            circuits: s.plan.circuits.map(c => c.type),
            sockets: s.plan.devices.filter(d => d.kind === 'socket').length,
            gfci: s.design.sockets.every(d => d.gfci),
            errors: s.design.errors.map(e => e.id)
        };
    })()`);
    check('kitchen regenerates', kitchen.room === 'kitchen' && kitchen.target === 300, `${kitchen.target} lx target`);
    check('kitchen gets two small-appliance circuits', kitchen.circuits.filter((c) => c === 'kitchen').length === 2, kitchen.circuits.join(','));
    check('kitchen sockets are GFCI', kitchen.gfci && kitchen.sockets >= 6, `${kitchen.sockets} sockets`);
    check('kitchen layout has no errors', kitchen.errors.length === 0, kitchen.errors.join(',') || 'none');

    await cdp.evaluate(`document.querySelector('[data-tab="design"]').click()`);
    await sleep(300);
    const toggle = await cdp.evaluate(`(() => {
        const before = window.lightingSuite.design.metrics.litCount;
        document.querySelector('[data-switch-id]')?.click();
        const after = window.lightingSuite.design.metrics.litCount;
        return { before, after, master: document.getElementById('master-state').textContent };
    })()`);
    check('switch toggles controlled lights', toggle.before !== toggle.after, `${toggle.before} → ${toggle.after}, ${toggle.master}`);

    const addSocket = await cdp.evaluate(`(() => {
        const before = window.lightingSuite.plan.devices.filter(d => d.kind === 'socket').length;
        document.querySelector('[data-tool="socket"]').click();
        const canvas = document.getElementById('plan');
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
        const after = window.lightingSuite.plan.devices.filter(d => d.kind === 'socket').length;
        return { before, after, inspector: !document.getElementById('inspector').classList.contains('hidden') };
    })()`);
    check('click places a socket', addSocket.after === addSocket.before + 1, `${addSocket.before} → ${addSocket.after}`);
    check('placed device opens inspector', addSocket.inspector);

    await cdp.evaluate(`document.querySelector('[data-tab="takeoff"]').click()`);
    await sleep(300);
    const takeoff = await cdp.evaluate(`({
        rows: document.querySelectorAll('#takeoff-bom tbody tr').length,
        cards: document.querySelectorAll('#takeoff-cards > div').length,
        total: document.getElementById('m-cost').textContent,
        notes: document.querySelectorAll('#takeoff-notes li').length
    })`);
    check('takeoff lists costed rows', takeoff.rows > 5 && takeoff.cards === 4, `${takeoff.rows} rows, ${takeoff.total}`);
    check('takeoff shows assumptions', takeoff.notes >= 3, `${takeoff.notes} notes`);

    const csv = await cdp.evaluate(`(() => {
        const text = window.lightingSuite.exportCsv();
        const rows = text.split('\\n');
        return { lines: rows.length, header: rows[0], cells: rows[1].split(',').length };
    })()`);
    check('schedule CSV exports', csv.lines > 3 && csv.header.includes('Tag') && csv.cells >= 9, `${csv.lines} lines`);

    await cdp.evaluate(`window.lightingSuite.autoDesign()`);
    await sleep(300);
    const final = await cdp.evaluate(`({ deviceCount: window.lightingSuite.plan.devices.length, errors: window.lightingSuite.design.errors.length })`);
    check('auto design restores a clean plan', final.deviceCount > 5 && final.errors === 0, `${final.deviceCount} devices`);

    const errors = cdp.errors();
    check('no console exceptions', errors.length === 0, errors.slice(0, 2).join(' | '));
    console.log(`\n${passed} passed, ${failed} failed`);
} finally {
    chrome.kill();
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exitCode = failed ? 1 : 0;
