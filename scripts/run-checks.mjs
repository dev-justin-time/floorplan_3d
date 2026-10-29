/**
 * Runs every check in scripts/ and fails the process if any of them fails.
 *
 * This is the release gate: `npm test`. The node harnesses are plain scripts
 * that exit non-zero on a failed assertion; the browser harnesses need Chrome
 * and, for the two page sweeps, a server. The runner starts that server itself
 * and points BASE_URL at it, so the suite behaves the same locally and in CI.
 *
 * Chrome-dependent checks are reported as skipped (not failed) when no browser
 * is installed, so `npm test` still gates the logic on a bare machine. Set
 * CHROME_PATH to override browser detection.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8790;

const CHECKS = [
    'check-kitchen.js',
    'check-kitchen-page.mjs',
    'check-scene-upload.mjs',
    'check-editor-wiring.mjs',
    'check-studio.js',
    'check-framing.mjs',
    'check-new-suites.mjs',
    'check-plumbing.js',
    'check-roof.js',
    'check-wall.js',
    'check-stairs.js',
    'check-ocr.js',
    'check-lighting.js',
    'check-imports.mjs',
    'check-toolbox.mjs',
    'check-price-suites.mjs',
    'check-pages.mjs',
    'browser-check.mjs',
    'browser-pages.mjs'
];

// browser-pages defaults to a list that includes the deleted app-demo page.
const ARGS = {
    'browser-pages.mjs': ['pages/app.html', 'pages/demo.html', 'pages/stair-gallery.html', 'pages/stair-glossary.html']
};

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.glb': 'model/gltf-binary',
    '.woff2': 'font/woff2',
    '.csv': 'text/csv; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.ipynb': 'application/json'
};

function findChrome() {
    if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    const candidates = [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ];
    return candidates.find((file) => existsSync(file)) || null;
}

function serve(root) {
    const server = createServer(async (request, response) => {
        try {
            const url = decodeURIComponent(request.url.split('?')[0]);
            let file = path.join(root, url);
            if (!path.resolve(file).startsWith(root)) {
                response.writeHead(403).end();
                return;
            }
            const info = await stat(file).catch(() => null);
            if (!info) {
                response.writeHead(404).end('not found');
                return;
            }
            if (info.isDirectory()) file = path.join(file, 'index.html');
            if (!existsSync(file)) {
                response.writeHead(404).end('not found');
                return;
            }
            response.writeHead(200, {
                'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            createReadStream(file).pipe(response);
        } catch {
            response.writeHead(500).end('error');
        }
    });
    return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

function run(file, env) {
    return new Promise((resolve) => {
        const started = Date.now();
        const child = spawn(process.execPath, [path.join('scripts', file), ...(ARGS[file] || [])], {
            cwd: ROOT,
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.on('close', (code) => {
            const failures = [...output.matchAll(/FAIL\s+([^\n]+)/g)].map((match) => match[1].trim());
            const summary = /(\d+)\s+passed,\s+(\d+)\s+failed/.exec(output)
                || /(\d+)\s+pass\s*\/\s*(\d+)\s+fail/.exec(output);
            resolve({
                file,
                code,
                seconds: ((Date.now() - started) / 1000).toFixed(0),
                passed: summary ? Number(summary[1]) : null,
                failed: summary ? Number(summary[2]) : failures.length,
                failures,
                output
            });
        });
    });
}

const chrome = findChrome();
if (chrome) console.log(`chrome: ${chrome}`);
else console.log('chrome: not found — browser checks will be skipped');

const server = await serve(ROOT);
const base = `http://127.0.0.1:${PORT}`;
const results = [];

for (const file of CHECKS) {
    const source = await readFile(path.join(ROOT, 'scripts', file), 'utf8');
    const needsChrome = /chrome/i.test(source);
    if (needsChrome && !chrome) {
        console.log(`SKIP ${file} (no Chrome)`);
        results.push({ file, skipped: true });
        continue;
    }
    process.stdout.write(`RUN  ${file} ... `);
    const result = await run(file, { BASE_URL: base, CHROME_PATH: chrome || '' });
    results.push(result);
    const counts = result.passed == null ? '' : ` ${result.passed} passed`;
    console.log(`${result.code === 0 ? 'ok  ' : 'FAIL'}${counts} (${result.seconds}s)`);
    if (result.code !== 0) {
        for (const failure of result.failures.slice(0, 8)) console.log(`       ${failure}`);
        if (!result.failures.length) console.log(result.output.trim().split('\n').slice(-6).map((line) => `       ${line}`).join('\n'));
    }
}

server.close();

const failed = results.filter((entry) => !entry.skipped && entry.code !== 0);
const skipped = results.filter((entry) => entry.skipped);
const passed = results.filter((entry) => !entry.skipped && entry.code === 0);
const assertions = results.reduce((sum, entry) => sum + (entry.passed || 0), 0);

console.log(`\n${passed.length} checks passed, ${failed.length} failed, ${skipped.length} skipped; ${assertions} assertions passed`);
if (failed.length) {
    console.log(failed.map((entry) => `  - ${entry.file}`).join('\n'));
    process.exitCode = 1;
}
