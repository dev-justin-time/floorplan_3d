import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8766';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9337;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
        this.events = [];
        this.ready = new Promise((resolve, reject) => {
            this.ws.onopen = () => resolve();
            this.ws.onerror = (event) => reject(new Error('CDP socket error ' + event.message));
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
        const id = this.nextId++;
        const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
        this.ws.send(JSON.stringify({ id, method, params }));
        return promise;
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        }
        return result.result?.value;
    }

    errors() {
        return this.events
            .filter((event) => event.method === 'Runtime.exceptionThrown')
            .map((event) => event.params.exceptionDetails?.exception?.description
                || event.params.exceptionDetails?.text
                || 'unknown exception')
            .concat(this.events
                .filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
                .map((event) => event.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')))
            .filter((text) => text && !text.includes('favicon'));
    }
}

let passed = 0;
const failures = [];
function check(name, condition, detail = '') {
    if (condition) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

async function waitFor(cdp, expression, timeout = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        try {
            const value = await cdp.evaluate(expression);
            if (value) return value;
        } catch {
            // The page is mid-navigation.
        }
        await sleep(250);
    }
    throw new Error(`Timed out waiting for ${expression}`);
}

const profile = await mkdtemp(path.join(tmpdir(), 'buffit-framing-'));
const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break;
        } catch {
            // Chrome is still starting.
        }
        await sleep(250);
    }

    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`${BASE}/pages/framing-designer.html`)}`, { method: 'PUT' })).json();
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await waitFor(cdp, 'Boolean(window.framingSuite)');

    console.log('Framing designer');
    const initial = await cdp.evaluate(`(() => {
        const design = window.framingSuite.design();
        const config = window.framingSuite.config();
        return {
            storeys: design.storeys.length,
            walls: design.walls.length,
            studs: design.metrics.studs,
            sheets: design.metrics.sheets,
            material: design.bom.material,
            labour: design.bom.labour,
            total: design.bom.total,
            errors: design.errors,
            warnings: design.warnings,
            studSize: config.studSize,
            spacing: config.studSpacingIn,
            precut: config.studLengthIn,
            kinds: [...new Set(design.walls.flatMap(wall => wall.members.map(member => member.kind)))].sort(),
            headers: design.walls.flatMap(wall => wall.openings.map(opening => opening.header.size)),
            cutRows: design.cutRows.length,
            checks: design.checks.length,
            rules: document.querySelectorAll('#rules-list .rule').length,
            glossary: document.querySelectorAll('#glossary-list article').length,
            canvasPixels: (() => {
                const canvas = document.getElementById('plan');
                const ctx = canvas.getContext('2d');
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                let painted = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) painted += 1;
                }
                return painted;
            })()
        };
    })()`);

    check('two-storey plan loads', initial.storeys === 2, `storeys=${initial.storeys}`);
    check('frames every wall', initial.walls === 10, `walls=${initial.walls}`);
    check('uses 2x4 studs at 16 in', initial.studSize === '2x4' && initial.spacing === 16, `${initial.studSize} @ ${initial.spacing}`);
    check('uses 92.5 in precut studs', initial.precut === 92.5, `${initial.precut}`);
    check('produces studs, kings, jacks, headers and plates', ['stud', 'king', 'jack', 'header', 'plate-bottom', 'plate-top', 'cripple'].every((kind) => initial.kinds.includes(kind)), initial.kinds.join(','));
    check('frames openings with sized headers', initial.headers.length >= 5 && initial.headers.every((size) => size), initial.headers.join(','));
    check('no failing checks on the sample', initial.errors === 0, `errors=${initial.errors}`);
    check('quantities and prices are present', initial.studs > 100 && initial.sheets > 20 && initial.material > 0 && initial.labour > 0, `${initial.studs} studs, $${initial.total}`);
    check('cut list is populated', initial.cutRows > 5, `${initial.cutRows} rows`);
    check('plan canvas is painted', initial.canvasPixels > 1000, `${initial.canvasPixels} px`);
    check('rule register renders', initial.rules === 30, `${initial.rules} rules`);
    check('glossary renders', initial.glossary > 25, `${initial.glossary} terms`);

    console.log('Calculators');
    const calcBoot = await cdp.evaluate(`(() => {
        document.querySelector('[data-tab="calculators"]').click();
        return {
            buttons: document.querySelectorAll('#calc-list [data-calculator]').length,
            ids: [...document.querySelectorAll('#calc-list [data-calculator]')].map((button) => button.dataset.calculator),
            groups: document.querySelectorAll('#calc-list p').length,
            title: document.getElementById('calc-title').textContent.trim(),
            fields: document.querySelectorAll('#calc-form [data-calc-field]').length,
            primary: (document.querySelector('#calc-result p.text-3xl')?.textContent || '').trim()
        };
    })()`);
    const expectedCalculators = ['lumber-span', 'span-table', '2x4-span', '2x6', 'floor-joist-span', 'ceiling-joist-span', 'roof-span', 'rafter-span', 'beam-span', 'lvl-beam-span', 'lvl-beam-size', 'glulam-beam-size', '2x4-load', 'framing-lumber', 'ceiling-joist', 'floor-truss'];
    const missingCalculators = expectedCalculators.filter((id) => !calcBoot.ids.includes(id));
    check('calculator tab lists the full library', calcBoot.buttons === expectedCalculators.length && calcBoot.groups === 3 && missingCalculators.length === 0,
        `${calcBoot.buttons} calculators in ${calcBoot.groups} groups${missingCalculators.length ? ` · missing ${missingCalculators.join(',')}` : ''}`);
    check('the first calculator renders a form and a result', calcBoot.fields >= 4 && calcBoot.primary.length > 0, `${calcBoot.title}: ${calcBoot.primary}`);

    const calcAll = await cdp.evaluate(`(() => {
        const ids = [...document.querySelectorAll('#calc-list [data-calculator]')].map((button) => button.dataset.calculator);
        const rows = [];
        for (const id of ids) {
            document.querySelector('[data-calculator="' + id + '"]')?.click();
            rows.push({
                id,
                title: document.getElementById('calc-title').textContent.trim(),
                primary: (document.querySelector('#calc-result p.text-3xl')?.textContent || '').trim(),
                fields: document.querySelectorAll('#calc-form [data-calc-field]').length,
                results: document.querySelectorAll('#calc-result div.flex.justify-between').length,
                notes: document.querySelectorAll('#calc-result li').length
            });
        }
        return { rows, broken: rows.filter((row) => !row.primary || !row.fields || !row.results || !row.notes) };
    })()`);
    check('every calculator renders a result without errors', calcAll.broken.length === 0, calcAll.broken.map((row) => row.id).join(','));

    const calcSearch = await cdp.evaluate(`(() => {
        const input = document.getElementById('calc-search');
        const type = (value) => {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        type('beam');
        const beam = [...document.querySelectorAll('#calc-list [data-calculator]')].map((button) => button.dataset.calculator);
        type('zzzz');
        const none = document.getElementById('calc-list').textContent;
        type('');
        return { beam, none, restored: document.querySelectorAll('#calc-list [data-calculator]').length };
    })()`);
    check('calculator search narrows the list', calcSearch.beam.length >= 2 && calcSearch.beam.every((id) => id.includes('beam')), calcSearch.beam.join(','));
    check('calculator search reports no match', calcSearch.none.includes('No calculator matches'), calcSearch.none.trim());
    check('clearing the search restores the library', calcSearch.restored === 16, `${calcSearch.restored}`);

    const spanFeet = (label) => {
        const match = String(label).match(/^(\d+)'-(.+)"$/);
        if (!match) return 0;
        const [whole, fraction] = match[2].split(' ');
        const parts = fraction ? fraction.split('/') : [];
        return Number(match[1]) + (Number(whole) + (parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : 0)) / 12;
    };
    const span = await cdp.evaluate(`(() => {
        document.querySelector('[data-calculator="lumber-span"]').click();
        const read = () => (document.querySelector('#calc-result p.text-3xl')?.textContent || '').trim();
        const base = read();
        const size = document.querySelector('[data-calc-field="size"]');
        size.value = '2x4';
        size.dispatchEvent(new Event('change', { bubbles: true }));
        const small = read();
        const spacing = document.querySelector('[data-calc-field="spacing"]');
        spacing.value = '24';
        spacing.dispatchEvent(new Event('change', { bubbles: true }));
        const wider = read();
        document.getElementById('calc-reset').click();
        return { base, small, wider, reset: read() };
    })()`);
    check('lumber span matches a plausible 2x10 floor span', spanFeet(span.base) > 10 && spanFeet(span.base) < 25, span.base);
    check('a 2x4 spans less than a 2x10', spanFeet(span.small) > 0 && spanFeet(span.small) < spanFeet(span.base), `${span.base} -> ${span.small}`);
    check('wider spacing shortens the span', spanFeet(span.wider) < spanFeet(span.small), `${span.small} -> ${span.wider}`);
    check('reset restores the defaults', span.reset === span.base, `${span.reset} vs ${span.base}`);

    const csv = await cdp.evaluate(`window.framingSuite.csv()`);
    check('schedule CSV has a header and walls', csv.schedule.startsWith('"storey"') && csv.schedule.split('\n').length === 11, `${csv.schedule.split('\n').length} lines`);
    check('cut list CSV has members', csv.cut.includes('"length_in"') && csv.cut.split('\n').length > 4, `${csv.cut.split('\n').length} lines`);
    check('takeoff CSV totals to the design', csv.takeoff.includes('"Total"') && csv.takeoff.includes('"Material"'));

    const spacing = await cdp.evaluate(`(() => {
        const before = window.framingSuite.design().metrics.studs;
        window.framingSuite.setStudSpacing(24);
        const after = window.framingSuite.design().metrics.studs;
        window.framingSuite.setStudSpacing(16);
        return { before, after };
    })()`);
    check('24 in spacing uses fewer studs than 16 in', spacing.after < spacing.before, `${spacing.before} -> ${spacing.after}`);

    const added = await cdp.evaluate(`(() => {
        document.getElementById('add-storey').click();
        const afterAdd = window.framingSuite.design().storeys.length;
        document.getElementById('remove-storey').click();
        return { afterAdd, afterRemove: window.framingSuite.design().storeys.length };
    })()`);
    check('add and remove a storey', added.afterAdd === 3 && added.afterRemove === 2, `${added.afterAdd}/${added.afterRemove}`);

    const rebuilt = await cdp.evaluate(`(() => {
        window.framingSuite.setStorey(0);
        const width = document.getElementById('fp-width');
        const depth = document.getElementById('fp-depth');
        width.value = '24'; depth.value = '16';
        document.getElementById('rebuild-rect').click();
        const design = window.framingSuite.design();
        const walls = design.storeys[0].walls;
        return {
            walls: walls.length,
            lengths: walls.map(wall => Math.round(wall.lengthM / 0.3048)),
            errors: design.errors
        };
    })()`);
    check('rectangle builder makes four exterior walls and a partition', rebuilt.walls === 5, `${rebuilt.walls} walls`);
    check('rectangle builder uses the entered footprint', rebuilt.lengths.filter((length) => length === 24).length >= 2 && rebuilt.lengths.filter((length) => length === 16).length >= 2, rebuilt.lengths.join(','));
    check('the rebuilt plan still frames without errors', rebuilt.errors === 0, `errors=${rebuilt.errors}`);

    const opening = await cdp.evaluate(`(() => {
        window.framingSuite.selectWall(0);
        const before = window.framingSuite.design().walls[0].openings.length;
        document.getElementById('add-window').click();
        const after = window.framingSuite.design().walls[0].openings.length;
        return { before, after, errors: window.framingSuite.design().errors };
    })()`);
    check('adds a window to the selected wall', opening.after === opening.before + 1, `${opening.before} -> ${opening.after}`);
    check('an extra window keeps the design valid', opening.errors === 0, `errors=${opening.errors}`);

    await sleep(500);
    const persisted = await cdp.evaluate(`(() => {
        const saved = JSON.parse(localStorage.getItem('framing-suite-draft') || 'null');
        return Boolean(saved && saved.storeys && saved.storeys.length);
    })()`);
    check('design persists to local storage', persisted === true);

    console.log('Editor hand-off');
    const suiteMaterial = await cdp.evaluate(`window.framingSuite.design().bom.material`);
    await cdp.evaluate(`document.getElementById('send-editor').click()`);
    await waitFor(cdp, 'Boolean(window.framingKit)', 30000);
    await sleep(1200);

    const editor = await cdp.evaluate(`(() => {
        const kit = window.framingKit;
        const design = kit.design();
        return {
            path: location.pathname,
            enabled: kit.enabled(),
            draft: Boolean(kit.draft()),
            storeys: design ? design.storeys.length : 0,
            walls: design ? design.walls.length : 0,
            meshes: kit.scene().meshes,
            wallRoot: kit.scene().wallRoot,
            bounds: kit.scene().bounds,
            studLength: design?.config?.studLengthIn || 0,
            studs: design?.metrics?.studs || 0,
            rows: kit.summary().rows.length,
            panel: document.getElementById('framing-summary')?.textContent || '',
            planWalls: (window.studioKit?.storeys?.() || []).reduce((sum, storey) => sum + (storey.walls || 0), 0)
        };
    })()`);
    check('send to editor opens the editor', editor.path.endsWith('Editor.html'), editor.path);
    check('the framing draft arrives', editor.draft === true);
    check('framing view turns itself on', editor.enabled === true);
    check('the plan was imported when the editor was empty', editor.storeys === 2 && editor.walls === 10, `${editor.storeys} storeys / ${editor.walls} walls`);
    check('the editor builds 3D framing members', editor.meshes > 100, `${editor.meshes} meshes`);
    check('the editor keeps the 92.5 in precut stud', Math.abs(editor.studLength - 92.5) < 0.05 && editor.studs > 100, `${editor.studLength} in / ${editor.studs} studs`);
    check('the framing stack reaches the second storey', editor.bounds && Number.isFinite(editor.bounds.maxY) && editor.bounds.maxY > 4.8, JSON.stringify(editor.bounds));
    check('the 3D frame matches the plan footprint', editor.bounds
        && Math.abs((editor.bounds.maxX - editor.bounds.minX) - 32 * 0.3048) < 0.15
        && Math.abs((editor.bounds.maxZ - editor.bounds.minZ) - 24 * 0.3048) < 0.15, JSON.stringify(editor.bounds));
    check('finished walls are hidden while framing shows', editor.wallRoot === false, `wallRoot=${editor.wallRoot}`);
    check('the framing panel reports the design', editor.rows >= 8 && editor.panel.includes('storey'), `${editor.rows} rows · ${editor.panel}`);

    const toggled = await cdp.evaluate(`(() => {
        window.framingKit.toggle(false);
        const off = { meshes: window.framingKit.scene().meshes, wallRoot: window.framingKit.scene().wallRoot };
        window.framingKit.toggle(true);
        const on = { meshes: window.framingKit.scene().meshes, wallRoot: window.framingKit.scene().wallRoot };
        return { off, on };
    })()`);
    check('turning framing off restores the finished walls', toggled.off.meshes === 0 && toggled.off.wallRoot === true, JSON.stringify(toggled.off));
    check('turning framing back on rebuilds the studs', toggled.on.meshes > 100 && toggled.on.wallRoot === false, JSON.stringify(toggled.on));

    await cdp.send('Page.reload');
    await waitFor(cdp, 'Boolean(window.framingKit)', 30000);
    await sleep(1200);
    const reloaded = await cdp.evaluate(`({
        enabled: window.framingKit.enabled(),
        meshes: window.framingKit.scene().meshes,
        storeys: window.framingKit.design()?.storeys.length || 0
    })`);
    check('framing survives a reload', reloaded.enabled === true && reloaded.meshes > 100 && reloaded.storeys === 2, JSON.stringify(reloaded));

    console.log('Bid harvest');
    await cdp.send('Page.navigate', { url: `${BASE}/pages/bid-builder.html` });
    await waitFor(cdp, 'Boolean(window.bidSuite)', 30000);
    await sleep(800);
    const bid = await cdp.evaluate(`(() => {
        const source = window.bidSuite.sources().find((entry) => entry.suite === 'framing');
        return {
            found: Boolean(source && source.found),
            subtotal: source ? source.subtotal : 0,
            lines: source ? source.lines.length : 0,
            base: window.bidSuite.bid().costs.base
        };
    })()`);
    check('the bid harvests the framing draft', bid.found === true && bid.lines > 5, `${bid.lines} lines`);
    check('the harvested framing subtotal matches the suite material', Math.abs(bid.subtotal - suiteMaterial) < 0.05, `${bid.subtotal} vs ${suiteMaterial}`);

    const pageErrors = cdp.errors();
    check('no runtime errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} finally {
    chrome.kill();
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
    failures.forEach((failure) => console.log(` - ${failure}`));
    process.exitCode = 1;
}
