/**
 * Ports parity gate: the Rust, Python and Lua ports must agree byte for byte.
 *
 * `ports/` reimplements the suite calculations three times behind one JSON
 * contract, so the only thing that makes them trustworthy is that they produce
 * identical canonical JSON. `ports/run-parity.mjs` is that comparison; this
 * script runs it over every fixture in `ports/spec/` and folds the result into
 * the `npm test` summary.
 *
 * The gate needs two toolchains. Where one is missing the check reports SKIP
 * rather than failing, the same way the browser checks step aside on a machine
 * without Chrome: `npm test` still gates everything it can run. A missing
 * *interpreter* (no Lua and no fengari) is different — the gate itself decides
 * that, compares the ports it can reach and says so on stdout.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(ROOT, 'ports', 'run-parity.mjs');
const SPEC = path.join(ROOT, 'ports', 'spec');
const shell = process.platform === 'win32';

/** Whether a command runs here at all (`cargo`/`python` may be shims on Windows). */
function available(command) {
    // A shell finds the Windows shims, but args handed to a shell are deprecated:
    // give the whole command line to the shell and no args array.
    const probe = shell
        ? spawnSync(`${command} --version`, { encoding: 'utf8', shell: true })
        : spawnSync(command, ['--version'], { encoding: 'utf8' });
    return !probe.error && probe.status === 0;
}

const plans = existsSync(SPEC)
    ? readdirSync(SPEC).filter((name) => name.endsWith('.json')).sort().map((name) => path.join('ports', 'spec', name))
    : [];

const missing = [];
if (!existsSync(GATE)) missing.push('ports/run-parity.mjs');
if (!plans.length) missing.push('ports/spec/*.json');
if (!missing.length && !available('cargo')) missing.push('cargo');
if (!missing.length && !available('python')) missing.push('python');

if (missing.length) {
    console.log(`SKIP ports parity: missing ${missing.join(', ')}`);
    console.log('     the gate needs the ports, their fixtures, cargo and python');
    process.exitCode = 0;
} else {
    const gate = spawnSync(process.execPath, [GATE, ...plans], { cwd: ROOT, encoding: 'utf8' });
    const output = `${gate.stdout || ''}${gate.stderr || ''}`;

    // One `ok: … agree (N bytes …)` line per fixture; the plan name is the line above it.
    const agreed = new Map();
    let plan = '';
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.endsWith('.json')) plan = trimmed;
        else if (trimmed.startsWith('ok: ') && plan) agreed.set(plan, trimmed);
        else if (trimmed.includes(': FAILED')) console.log(`FAIL ${plan || 'ports'}: ${trimmed.replace(/: FAILED$/, '')} could not run`);
        else if (trimmed.startsWith('lua: ')) console.log(`     ${trimmed}`);
        else if (/differs at byte/.test(trimmed)) console.log(`FAIL ${plan}: ${trimmed}`);
    }

    const failed = [];
    for (const file of plans) {
        const key = path.basename(file);
        const match = [...agreed.entries()].find(([name]) => name.includes(key));
        if (match) console.log(`ok   ${key} — ${match[1].replace(/^ok: /, '')}`);
        else failed.push(key);
    }

    if (gate.error) console.log(`FAIL ports parity: ${gate.error.message}`);
    if (!agreed.size && !failed.length) {
        console.log(gate.status === 0 ? 'FAIL ports parity: the gate printed no result' : `FAIL ports parity: exit ${gate.status}`);
        if (gate.status !== 0) console.log(output.trim().split('\n').slice(-8).map((line) => `     ${line}`).join('\n'));
    }
    for (const file of failed) console.log(`FAIL ${file}: ports disagree or could not run`);

    const passed = plans.length - failed.length;
    console.log(`\n${passed} passed, ${failed.length} failed`);
    if (failed.length || gate.status !== 0) process.exitCode = 1;
}
