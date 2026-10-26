/**
 * Every page check: local links, console errors and failed assets.
 *
 * Serves the project, walks each HTML file, verifies every relative href/src
 * and CSS url() resolves to a file on disk, then loads the page in headless
 * Chrome and reports uncaught exceptions, console errors, local 4xx/5xx
 * responses and failed local requests. Pages are visited in one profile so the
 * cross-page drafts (designer -> editor) behave like a real session.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8768;
const DEBUG_PORT = 9336;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ORIGIN = `http://127.0.0.1:${PORT}`;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8'
};

function startServer() {
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, ORIGIN);
        let pathname = decodeURIComponent(url.pathname);
        if (pathname.endsWith('/')) pathname += 'index.html';
        let file = path.join(ROOT, pathname);
        try {
            if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        }
    });
    return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function htmlFiles(dir = ROOT, found = []) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', '.agents'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await htmlFiles(full, found);
        else if (entry.name.endsWith('.html')) found.push(full);
    }
    return found;
}

const SKIP_LINK = /^(?:[a-z]+:|\/\/|#|$)/i;
const isLocalRef = (ref) => Boolean(ref) && !SKIP_LINK.test(ref);

/** Local href/src/action and CSS url() targets, resolved against the page. */
function localReferences(html, pageFile) {
    // Inline scripts build URLs at runtime (blob:, template literals); their
    // strings are not links, so only real markup is scanned.
    const markup = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    const references = new Map();
    const add = (raw) => {
        if (!isLocalRef(raw)) return;
        const clean = raw.trim().split('#')[0].split('?')[0];
        if (!clean) return;
        const target = path.resolve(path.dirname(pageFile), decodeURIComponent(clean));
        references.set(raw.trim(), target);
    };
    for (const match of markup.matchAll(/\b(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) add(match[1]);
    for (const match of markup.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(match[1]);
    return references;
}

class CDP {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
        this.events = [];
        this.ready = new Promise((resolve) => {
            this.ws.onopen = resolve;
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
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) return null;
        return result.result.value;
    }
    clear() {
        this.events = [];
    }
}

async function waitForChrome() {
    for (let i = 0; i < 100; i += 1) {
        try {
            if ((await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok) return;
        } catch {
            // still starting
        }
        await sleep(200);
    }
    throw new Error('Chrome debug endpoint never came up');
}

const isFavicon = (url = '') => url.includes('favicon');

function pageReport(events) {
    const exceptions = events
        .filter((event) => event.method === 'Runtime.exceptionThrown')
        .map((event) => event.params.exceptionDetails?.exception?.description
            || event.params.exceptionDetails?.text
            || 'unknown exception')
        .filter(Boolean);
    const consoleErrors = events
        .filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
        .map((event) => event.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' ').trim())
        .filter(Boolean);
    const badResponses = events
        .filter((event) => event.method === 'Network.responseReceived'
            && event.params.response.url.startsWith(ORIGIN)
            && event.params.response.status >= 400)
        .map((event) => `${event.params.response.status} ${event.params.response.url.replace(ORIGIN, '')}`);
    const requestUrls = new Map();
    events
        .filter((event) => event.method === 'Network.requestWillBeSent')
        .forEach((event) => requestUrls.set(event.params.requestId, event.params.request.url));
    const failedRequests = events
        .filter((event) => event.method === 'Network.loadingFailed'
            && !event.params.errorText?.includes('ERR_ABORTED'))
        .map((event) => `${event.params.errorText || 'request failed'} ${requestUrls.get(event.params.requestId) || ''}`.trim())
        .filter((entry) => entry.includes(ORIGIN) && !isFavicon(entry));
    return {
        exceptions,
        consoleErrors,
        badResponses: badResponses.filter((entry) => !isFavicon(entry)),
        failedRequests
    };
}

async function main() {
    const server = await startServer();
    const pages = (await htmlFiles()).sort();
    const profile = await mkdtemp(path.join(tmpdir(), 'page-check-'));
    const chrome = spawn(CHROME, [
        '--headless=new',
        '--disable-gpu',
        '--enable-unsafe-swiftshader',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${profile}`,
        'about:blank'
    ], { stdio: 'ignore' });

    let failures = 0;
    try {
        await waitForChrome();

        // --- Static links ---------------------------------------------------
        console.log(`Checking ${pages.length} pages\n`);
        const broken = new Map();
        for (const page of pages) {
            const html = await readFile(page, 'utf8');
            const refs = localReferences(html, page);
            const missing = [];
            for (const [raw, target] of refs) {
                try {
                    const info = await stat(target);
                    if (!info.isFile()) missing.push(`${raw} (not a file)`);
                } catch {
                    missing.push(raw);
                }
            }
            if (missing.length) {
                broken.set(path.relative(ROOT, page), missing);
                failures += 1;
            }
        }
        if (!broken.size) {
            console.log('ok   every local href/src/url() resolves to a file');
        } else {
            for (const [page, missing] of broken) {
                console.log(`FAIL ${page}: ${missing.length} broken link(s)`);
                missing.forEach((entry) => console.log(`       ${entry}`));
            }
        }

        // --- Runtime --------------------------------------------------------
        const target = await (await fetch(
            `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent('about:blank')}`,
            { method: 'PUT' }
        )).json();
        const cdp = new CDP(target.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        await cdp.send('Log.enable');
        await cdp.send('Network.enable');
        await cdp.send('Page.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
        });

        const results = [];
        for (const page of pages) {
            const route = '/' + path.relative(ROOT, page).split(path.sep).join('/');
            cdp.clear();
            await cdp.send('Page.navigate', { url: ORIGIN + route });
            for (let i = 0; i < 80; i += 1) {
                if (await cdp.evaluate("document.readyState === 'complete'")) break;
                await sleep(150);
            }
            // Let deferred module work, WebGL boot and draft hand-offs settle.
            await sleep(3500);
            const report = pageReport(cdp.events);
            const chrome = await cdp.evaluate(`(() => ({
                nav: Boolean(document.getElementById('site-nav-menu')),
                links: document.querySelectorAll('#site-nav-menu a').length,
                footer: Boolean(document.getElementById('site-footer'))
            }))()`);
            const count = report.exceptions.length + report.consoleErrors.length
                + report.badResponses.length + report.failedRequests.length;
            const chromeMissing = !chrome || !chrome.nav || !chrome.footer || chrome.links < 20;
            results.push({ route, report, count, chrome });
            if (count || chromeMissing) failures += 1;
            console.log(`${count || chromeMissing ? 'FAIL' : 'ok  '} ${route}${count || chromeMissing ? ` — ${count} problem(s)` : ''}`);
            if (chromeMissing) {
                console.log(`       chrome:    nav=${chrome?.nav} links=${chrome?.links} footer=${chrome?.footer}`);
            }
            for (const entry of report.exceptions.slice(0, 3)) console.log(`       exception: ${entry.split('\n')[0]}`);
            for (const entry of report.consoleErrors.slice(0, 3)) console.log(`       console:   ${entry}`);
            for (const entry of report.badResponses.slice(0, 5)) console.log(`       http:      ${entry}`);
            for (const entry of report.failedRequests.slice(0, 3)) console.log(`       request:   ${entry}`);
        }

        const clean = results.filter((entry) => entry.count === 0).length;
        console.log(`\n${clean}/${results.length} pages clean, ${failures} failure(s) total`);
        process.exitCode = failures ? 1 : 0;
        cdp.ws.close();
    } finally {
        chrome.kill();
        server.close();
        await sleep(300);
        await rm(profile, { recursive: true, force: true }).catch(() => {});
    }
}

main().catch((error) => {
    console.error('Page check crashed:', error);
    process.exitCode = 1;
});
