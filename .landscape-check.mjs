import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = 'http://127.0.0.1:8766';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9347;
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
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        }
        return result.result?.value;
    }
    errors() {
        return this.events
            .filter((event) => event.method === 'Runtime.exceptionThrown')
            .map((event) => event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text)
            .filter(Boolean);
    }
}

const profile = await mkdtemp(path.join(tmpdir(), 'landscape-check-'));
const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed += 1; console.log(`  ok  ${name}${detail ? ' — ' + detail : ''}`); }
    else { failed += 1; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

try {
    for (let i = 0; i < 60; i++) {
        try {
            if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break;
        } catch { /* wait */ }
        await sleep(250);
    }

    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/pages/landscape-designer.html')}`, { method: 'PUT' })).json();
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(5000);

    const boot = await cdp.evaluate(`(() => {
        const canvas = document.getElementById('plan');
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let painted = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]) painted += 1;
        return {
            title: document.title,
            area: document.getElementById('m-area').textContent,
            flow: document.getElementById('m-flow').textContent,
            cost: document.getElementById('m-cost').textContent,
            checks: document.querySelectorAll('#checks li').length,
            headings: document.querySelectorAll('h1').length,
            painted,
            width: canvas.width
        };
    })()`);
    check('page boots with the suite title', /Landscape suite/.test(boot.title), boot.title);
    check('plan canvas is drawn', boot.painted > 10000, `${boot.painted} px at ${boot.width}w`);
    check('surface metric filled', /m²/.test(boot.area), boot.area);
    check('flow metric filled', /gpm/.test(boot.flow), boot.flow);
    check('estimate filled', /\$/.test(boot.cost), boot.cost);

    const spa = await cdp.evaluate(`(async () => {
        const type = document.getElementById('feature-type');
        type.value = 'spa';
        type.dispatchEvent(new Event('change'));
        await new Promise((resolve) => setTimeout(resolve, 300));
        return {
            turnover: document.getElementById('m-turnover').textContent,
            area: document.getElementById('m-area').textContent,
            volume: document.getElementById('m-volume').textContent,
            note: document.getElementById('feature-note').textContent
        };
    })()`);
    check('switching to a spa updates the model', /0\.50 h/.test(spa.turnover), spa.turnover);
    check('spa volume recomputed', /gal/.test(spa.volume), spa.volume);

    const tabs = await cdp.evaluate(`(async () => {
        const click = (name) => document.querySelector('[data-tab="' + name + '"]').click();
        click('rules');
        await new Promise((resolve) => setTimeout(resolve, 120));
        const rules = document.querySelectorAll('#rules-list article').length;
        document.getElementById('rules-search').value = 'bonding';
        document.getElementById('rules-search').dispatchEvent(new Event('input'));
        await new Promise((resolve) => setTimeout(resolve, 80));
        const filtered = document.querySelectorAll('#rules-list article').length;
        click('schedule');
        const scheduleRows = document.querySelectorAll('#schedule-table tbody tr').length;
        click('takeoff');
        const bomRows = document.querySelectorAll('#takeoff-bom tbody tr').length;
        click('glossary');
        const terms = document.querySelectorAll('#glossary-list article').length;
        const formulas = document.querySelectorAll('#formula-list > div').length;
        return { rules, filtered, scheduleRows, bomRows, terms, formulas };
    })()`);
    check('rules tab lists the register', tabs.rules >= 20, `${tabs.rules} rules`);
    check('rule search filters', tabs.filtered > 0 && tabs.filtered < tabs.rules, `${tabs.filtered} matches`);
    check('schedule table populated', tabs.scheduleRows >= 6, `${tabs.scheduleRows} rows`);
    check('takeoff table populated', tabs.bomRows >= 8, `${tabs.bomRows} rows`);
    check('glossary terms and formulas rendered', tabs.terms >= 20 && tabs.formulas >= 6, `${tabs.terms} terms, ${tabs.formulas} formulas`);

    const interaction = await cdp.evaluate(`(async () => {
        document.querySelector('[data-tab="design"]').click();
        const input = document.getElementById('f-deep');
        input.value = '3.2';
        input.dispatchEvent(new Event('change'));
        await new Promise((resolve) => setTimeout(resolve, 250));
        document.getElementById('s-public').checked = true;
        document.getElementById('s-public').dispatchEvent(new Event('change'));
        await new Promise((resolve) => setTimeout(resolve, 250));
        const text = document.getElementById('checks').textContent;
        return {
            checks: text,
            summary: document.getElementById('check-summary').textContent,
            stored: Boolean(JSON.parse(localStorage.getItem('landscape-suite-plan') || 'null')?.feature)
        };
    })()`);
    check('invalid public pool raises an ADA error', /accessible lift|ADA/i.test(interaction.checks), interaction.checks.slice(0, 90));
    check('check summary counts the error', /error/.test(interaction.summary), interaction.summary);
    check('design persists to local storage', interaction.stored === true);

    // --- Editor hand-off --------------------------------------------------
    await cdp.send('Page.navigate', { url: BASE + '/pages/Editor.html' });
    await sleep(4500);
    const seeded = await cdp.evaluate(`(() => {
        localStorage.setItem('landscape-editor-draft', JSON.stringify({
            feature: { type: 'spa', code: 'ISPSC2021', shape: 'circular', width: 2.4, length: 2.4, shallow: 0.9, deep: 0.9, deck: 1.0, barrier: true, jets: 6, waterTempF: 102 },
            site: { width: 8, depth: 10 }
        }));
        return true;
    })()`);
    await cdp.send('Page.reload');
    await sleep(6000);
    const handoff = await cdp.evaluate(`(() => {
        if (!window.featureKit) return { ready: false };
        const fixtures = window.featureKit.fixtures();
        const spa = fixtures.filter((item) => item.type === 'spa');
        return {
            ready: true,
            count: fixtures.length,
            spas: spa.length,
            size: spa[0]?.size || null,
            selected: spa[0]?.id === window.featureKit.fixtures().find((item) => item.id === spa[0]?.id)?.id
        };
    })()`);
    check('editor boots after the hand-off', handoff.ready === true);
    check('landscape draft becomes a placed spa', handoff.spas === 1, `${handoff.spas} spa(s), ${handoff.count} fixtures`);
    check('placed spa is sized from the suite footprint', handoff.size && handoff.size.width >= 4 && handoff.size.depth >= 4, JSON.stringify(handoff.size));

    const errors = cdp.errors().filter((error) => !/textures\//.test(error));
    check('no uncaught runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
    cdp.ws.close();
} finally {
    chrome.kill();
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
}
