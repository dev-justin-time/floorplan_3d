import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8766';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9336;
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
                .map((event) => event.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')));
    }
}

async function waitForVersion() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
            if (response.ok) return response.json();
        } catch {
            // Chrome is still starting.
        }
        await sleep(250);
    }
    throw new Error('Chrome debug endpoint never came up');
}

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

async function main() {
    const profile = await mkdtemp(path.join(tmpdir(), 'buffit-suites-'));
    const chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
        '--no-default-browser-check', '--disable-extensions',
        `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: 'ignore' });

    try {
        await waitForVersion();
        const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/pages/deck-designer.html')}`, { method: 'PUT' })).json();
        const cdp = new CDP(target.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');

        const load = async (url, wait = 3600) => {
            await cdp.send('Page.navigate', { url });
            await sleep(wait);
        };
        const waitFor = async (expression, timeout = 6000) => {
            const started = Date.now();
            while (Date.now() - started < timeout) {
                if (await cdp.evaluate(expression)) return true;
                await sleep(200);
            }
            return false;
        };
        const painted = (selector = '#plan') => cdp.evaluate(`(() => {
            const canvas = document.querySelector('${selector}');
            if (!canvas || !canvas.width) return 0;
            const ctx = canvas.getContext('2d');
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let count = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
            return count;
        })()`);

        // ---------------------------------------------------------------- deck
        console.log('\nDeck suite');
        await load(BASE + '/pages/deck-designer.html');
        check('deck page boots', await waitFor('Boolean(window.deckSuite && window.deckSuite.design)'));
        const deckBoot = await cdp.evaluate(`(() => {
            const design = window.deckSuite.design();
            return {
                area: design.areas.deckM2,
                joists: design.joist.count,
                joistSpan: design.joist.spanM,
                capacity: design.joist.capacityM,
                beam: design.config.beamPlies + 'x' + design.config.beamSize,
                posts: design.post.count,
                footings: design.footing.count,
                guard: design.guard.lengthM,
                risers: design.stair.risers,
                rows: design.bom.rows.length,
                cutRows: design.cutRows.length,
                checks: design.checks.length,
                errors: design.errors,
                outline: window.deckSuite.plan().outline.length,
                painted: 0,
                metrics: document.getElementById('m-area').textContent,
                takeoffRows: document.querySelectorAll('#panel-takeoff table tbody tr').length,
                cutlistRows: document.querySelectorAll('#panel-cutlist table tbody tr').length,
                ruleCards: document.querySelectorAll('#rules-list .rule').length,
                csv: window.deckSuite.csv().includes('"group","item"'),
                cutCsv: window.deckSuite.cutCsv().split('\\n').length,
                scheduleCsv: window.deckSuite.scheduleCsv().split('\\n').length
            };
        })()`);
        check('deck plan has a closed outline', deckBoot.outline >= 4, `${deckBoot.outline} points`);
        check('deck area from the drawn outline', Math.abs(deckBoot.area - 25.2) < 0.3, `${deckBoot.area} m²`);
        check('joist schedule sized from the span check', deckBoot.joists >= 5 && deckBoot.capacity > deckBoot.joistSpan, `${deckBoot.joists} joists, ${deckBoot.joistSpan.toFixed(2)} of ${deckBoot.capacity.toFixed(2)} m`);
        check('beam, posts and footings agree', deckBoot.beam === '2x2x10' && deckBoot.posts >= 4 && deckBoot.footings === deckBoot.posts, `${deckBoot.beam}, ${deckBoot.posts} posts`);
        check('guard and stair included', deckBoot.guard > 10 && deckBoot.risers === 5, `${deckBoot.guard.toFixed(1)} m guard, ${deckBoot.risers} risers`);
        check('takeoff, cut list and checks rendered', deckBoot.rows > 15 && deckBoot.cutRows >= 3 && deckBoot.checks > 20, `${deckBoot.rows} BOM rows, ${deckBoot.cutRows} cut rows, ${deckBoot.checks} checks`);
        check('default deck passes its modelled checks', deckBoot.errors === 0);
        check('metric card shows the area', deckBoot.metrics.includes('m²'), deckBoot.metrics);
        check('takeoff and cut-list tables rendered', deckBoot.takeoffRows > 15 && deckBoot.cutlistRows >= 4, `${deckBoot.takeoffRows} / ${deckBoot.cutlistRows} rows`);
        check('rules tab lists the register', deckBoot.ruleCards >= 20, `${deckBoot.ruleCards} cards`);
        check('deck CSVs export', deckBoot.csv && deckBoot.cutCsv > 3 && deckBoot.scheduleCsv > 3);
        const deckPainted = await painted();
        check('deck plan canvas paints', deckPainted > 5000, `${deckPainted} px`);

        const undersized = await cdp.evaluate(`(() => {
            window.setDeckField('joistSize', '2x6');
            window.setDeckField('joistSpacingIn', 24);
            const design = window.deckSuite.design();
            return {
                errors: design.errors,
                ids: design.checks.filter((check) => check.severity === 'error').map((check) => check.id),
                span: design.joist.spanM,
                capacity: design.joist.capacityM
            };
        })()`);
        check('undersized joists raise span and spacing errors',
            undersized.errors >= 2 && undersized.ids.includes('joist-span') && undersized.ids.includes('joist-spacing'),
            undersized.ids.join(','));

        const guardOff = await cdp.evaluate(`(() => {
            window.setDeckField('guard', 'none');
            const design = window.deckSuite.design();
            return design.checks.find((check) => check.id === 'guard-required')?.severity;
        })()`);
        check('removing the guard fails the guard-required check', guardOff === 'error', String(guardOff));

        const deckDraft = await cdp.evaluate(`(() => {
            window.setDeckField('joistSize', '2x10');
            window.setDeckField('joistSpacingIn', 16);
            window.setDeckField('guard', 'wood');
            window.setDeckField('width', 7);
            return { total: window.deckSuite.design().bom.material, width: window.deckSuite.config().width };
        })()`);
        await cdp.evaluate(`document.getElementById('send-editor').click()`);
        await sleep(4500);
        check('deck hand-off opens the editor', await waitFor('Boolean(window.deckKit)', 9000) && (await cdp.evaluate('location.pathname')).includes('Editor.html'));
        const deckKit = await cdp.evaluate(`(() => {
            const design = window.deckKit.design();
            return {
                found: Boolean(design),
                width: design?.config.width,
                total: design?.bom.material,
                rows: window.deckKit.summary()?.rows?.length || 0,
                lines: window.deckKit.lines().length
            };
        })()`);
        check('editor rebuilds the deck draft', deckKit.found && deckKit.width === 7, `${deckKit.width} m`);
        check('editor agrees on the deck price', Math.abs(deckKit.total - deckDraft.total) < 0.02, `${deckKit.total} vs ${deckDraft.total}`);
        check('editor deck readout and lines', deckKit.rows >= 8 && deckKit.lines > 15, `${deckKit.rows} rows, ${deckKit.lines} lines`);

        // ---------------------------------------------------------- electrical
        console.log('\nElectrical suite');
        await load(BASE + '/pages/electrical-designer.html');
        check('electrical page boots', await waitFor('Boolean(window.electricalSuite && window.electricalSuite.design)'));
        const elecBoot = await cdp.evaluate(`(() => {
            const design = window.electricalSuite.design();
            return {
                service: design.serviceAmps,
                demand: design.demandVa,
                circuits: design.circuits.length,
                feeder: design.feeder.size,
                gec: design.gec,
                spaces: design.spaces,
                errors: design.errors,
                scheduleRows: document.querySelectorAll('#schedule-table table tbody tr').length,
                cards: document.querySelectorAll('#appliance-grid input').length,
                checks: design.checks.length,
                csv: window.electricalSuite.csv().includes('"group","item"'),
                scheduleCsv: window.electricalSuite.scheduleCsv().split('\\n').length,
                demandCsv: window.electricalSuite.demandCsv().split('\\n').length,
                gauge: document.getElementById('m-service').textContent
            };
        })()`);
        check('service sized from the demand load', elecBoot.service >= 100 && elecBoot.demand > 10000, `${elecBoot.service} A for ${elecBoot.demand} VA`);
        check('branch circuit list built', elecBoot.circuits >= 15 && elecBoot.scheduleRows === elecBoot.circuits, `${elecBoot.circuits} circuits`);
        check('service conductors and grounding sized', Boolean(elecBoot.feeder) && Boolean(elecBoot.gec), `${elecBoot.feeder} / ${elecBoot.gec}`);
        check('panel spaces tracked', elecBoot.spaces.spares >= 0 && elecBoot.spaces.used > 10, `${elecBoot.spaces.used} used`);
        check('electrical default passes', elecBoot.errors === 0);
        check('appliance inputs rendered', elecBoot.cards === 12, `${elecBoot.cards} loads`);
        check('electrical CSVs export', elecBoot.csv && elecBoot.scheduleCsv > 3 && elecBoot.demandCsv > 3);
        const elecPainted = await painted();
        check('panel elevation paints', elecPainted > 5000, `${elecPainted} px`);

        const evLoad = await cdp.evaluate(`(() => {
            const before = window.electricalSuite.design();
            window.setApplianceLoad('ev', 9600);
            const after = window.electricalSuite.design();
            return {
                beforeService: before.serviceAmps,
                afterService: after.serviceAmps,
                beforeDemand: before.demandVa,
                afterDemand: after.demandVa,
                ev: after.circuits.find((circuit) => circuit.id === 'ev')
            };
        })()`);
        check('EV charger raises the demand and the service',
            evLoad.afterDemand > evLoad.beforeDemand && evLoad.afterService >= evLoad.beforeService,
            `${evLoad.beforeService} A → ${evLoad.afterService} A`);
        check('EV circuit is 125% of the continuous current and GFCI', evLoad.ev?.breaker === 50 && evLoad.ev?.gfci === true, `${evLoad.ev?.breaker} A`);

        const gfciCheck = await cdp.evaluate(`(() => {
            window.setElectricalField('afci', false);
            const design = window.electricalSuite.design();
            return {
                severity: design.checks.find((check) => check.id === 'afci')?.severity,
                emptyService: (() => {
                    document.getElementById('clear-appliances').click();
                    return window.electricalSuite.design().demandVa;
                })(),
                cleared: window.electricalSuite.circuits().length
            };
        })()`);
        check('turning AFCI off warns', gfciCheck.severity === 'warning', String(gfciCheck.severity));
        check('clearing appliances drops the demand', gfciCheck.emptyService < elecBoot.demand, `${gfciCheck.emptyService} VA`);

        const elecDraft = await cdp.evaluate(`(() => {
            window.setApplianceLoad('ev', 9600);
            window.setElectricalField('afci', true);
            return {
                total: window.electricalSuite.design().bom.material,
                service: window.electricalSuite.design().serviceAmps,
                circuits: window.electricalSuite.design().circuits.length
            };
        })()`);
        await cdp.evaluate(`document.getElementById('send-editor').click()`);
        await sleep(4500);
        check('electrical hand-off opens the editor', await waitFor('Boolean(window.electricalKit)', 9000));
        const elecKit = await cdp.evaluate(`(() => {
            const design = window.electricalKit.design();
            return {
                found: Boolean(design),
                service: design?.serviceAmps,
                total: design?.bom.material,
                circuits: window.electricalKit.circuits().length,
                rows: window.electricalKit.summary()?.rows?.length || 0
            };
        })()`);
        check('editor rebuilds the electrical draft', elecKit.found && elecKit.service === elecDraft.service, `${elecKit.service} A`);
        check('editor agrees on the electrical price', Math.abs(elecKit.total - elecDraft.total) < 0.02, `${elecKit.total} vs ${elecDraft.total}`);
        check('editor electrical circuits and readout', elecKit.circuits === elecDraft.circuits && elecKit.rows >= 8, `${elecKit.circuits} circuits`);

        // ----------------------------------------------------------------- bid
        console.log('\nBid builder');
        await load(BASE + '/pages/bid-builder.html');
        check('bid page boots', await waitFor('Boolean(window.bidSuite && window.bidSuite.bid)'));

        const bidBoot = await cdp.evaluate(`(() => {
            const sources = window.bidSuite.sources();
            const bid = window.bidSuite.bid();
            return {
                found: sources.filter((source) => source.found && source.lines.length).map((source) => source.suite),
                missing: sources.filter((source) => !source.found).map((source) => source.suite),
                base: bid.costs.base,
                total: bid.costs.total,
                preTax: bid.costs.preTax,
                tax: bid.costs.tax,
                lines: bid.counts.lines,
                groups: bid.groups.map((group) => group.key),
                schedule: bid.schedule.length,
                proposal: window.bidSuite.proposal(),
                csv: window.bidSuite.csv().split('\\n').length,
                rows: document.querySelectorAll('#source-table table tbody tr').length
            };
        })()`);
        check('bid harvests the deck and electrical drafts', bidBoot.found.includes('deck') && bidBoot.found.includes('electrical'), bidBoot.found.join(','));
        check('bid reports the suites without a design', bidBoot.missing.length >= 4, `${bidBoot.missing.length} missing`);
        check('base matches the two suite takeoffs', Math.abs(bidBoot.base - (deckDraft.total + elecDraft.total)) < 0.05, `${bidBoot.base} vs ${(deckDraft.total + elecDraft.total).toFixed(2)}`);
        check('contract total follows the markup', Math.abs(bidBoot.preTax + bidBoot.tax - bidBoot.total) < 0.02, `${bidBoot.preTax} + ${bidBoot.tax} = ${bidBoot.total}`);
        check('progress billing has three stages', bidBoot.schedule === 3);
        check('proposal and CSV generated', bidBoot.proposal.includes('CONTRACT TOTAL') && bidBoot.csv > 20);
        check('summary lists the groups', bidBoot.rows >= 2 && bidBoot.groups.includes('deck') && bidBoot.groups.includes('electrical'));

        const markup = await cdp.evaluate(`(() => {
            const before = window.bidSuite.bid().costs.total;
            window.bidSuite.setMarkup('profit', 30);
            const after = window.bidSuite.bid().costs.total;
            window.bidSuite.setMarkup('profit', 15);
            return { before, after };
        })()`);
        check('raising profit raises the contract total', markup.after > markup.before, `${markup.before} → ${markup.after}`);

        const manual = await cdp.evaluate(`(() => {
            const base = window.bidSuite.bid().costs.base;
            const line = window.bidSuite.addManual({ description: 'Site protection', qty: 2, unit: 'ea', unitCost: 250 });
            const withLine = window.bidSuite.bid();
            const removed = window.bidSuite.removeManual(line.code);
            return { base, after: withLine.costs.base, removed, back: window.bidSuite.bid().costs.base };
        })()`);
        check('manual line adds to the base', Math.abs(manual.after - (manual.base + 500)) < 0.02, `${manual.base} → ${manual.after}`);
        check('manual line can be removed', manual.removed && Math.abs(manual.back - manual.base) < 0.02);

        const alternate = await cdp.evaluate(`(() => {
            const before = window.bidSuite.bid().costs.total;
            window.bidSuite.addAlternate({ description: 'Cable rail upgrade', qty: 12, unitCost: 180 });
            const bid = window.bidSuite.bid();
            return { before, after: bid.costs.total, alternateTotal: bid.alternateTotal, alternates: bid.alternates.length };
        })()`);
        check('alternates are priced but excluded from the total',
            alternate.alternates === 1 && alternate.alternateTotal === 2160 && Math.abs(alternate.after - alternate.before) < 0.02,
            `alternate ${alternate.alternateTotal}, total ${alternate.after}`);

        const persistence = await cdp.evaluate(`(() => {
            localStorage.setItem('bid-suite-state', JSON.stringify({ project: { name: 'Persisted bid' }, markup: {}, manual: [], alternates: [] }));
            return true;
        })()`);
        await load(BASE + '/pages/bid-builder.html', 3000);
        const reloaded = await cdp.evaluate(`(() => ({
            name: window.bidSuite.bid().config.project.name,
            found: window.bidSuite.sources().filter((source) => source.found).length,
            errors: 0
        }))()`);
        check('bid reloads its saved project state', persistence && reloaded.name === 'Persisted bid', reloaded.name);
        check('bid re-harvests the suites after reload', reloaded.found >= 2, `${reloaded.found} suites`);

        console.log('Persistence');
        await load(BASE + '/pages/deck-designer.html', 3000);
        const deckReload = await cdp.evaluate(`(() => ({
            width: window.deckSuite.config().width,
            guard: window.deckSuite.config().guard,
            area: window.deckSuite.design().areas.deckM2
        }))()`);
        check('deck design reloads from storage', deckReload.width === 7 && Math.abs(deckReload.area - 29.4) < 0.02, `${deckReload.width} m, ${deckReload.area} m²`);

        await load(BASE + '/pages/electrical-designer.html', 3000);
        const elecReload = await cdp.evaluate(`(() => ({
            ev: window.electricalSuite.config().appliances.ev,
            service: window.electricalSuite.design().serviceAmps
        }))()`);
        check('electrical design reloads from storage', elecReload.ev === 9600 && elecReload.service === elecDraft.service, `${elecReload.ev} VA, ${elecReload.service} A`);

        const runtimeErrors = cdp.errors();
        check('no uncaught runtime errors', runtimeErrors.length === 0, runtimeErrors.slice(0, 3).join(' | '));
    } finally {
        chrome.kill();
        await sleep(300);
        await rm(profile, { recursive: true, force: true }).catch(() => {});
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((error) => {
    console.error('New-suite check crashed:', error);
    process.exit(1);
});
