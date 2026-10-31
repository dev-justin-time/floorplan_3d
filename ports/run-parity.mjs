#!/usr/bin/env node
/**
 * Cross-language parity gate for ports/.
 *
 * Runs the Rust, Python and Lua implementations on the same plan and compares
 * their canonical JSON byte for byte. The three ports are only useful if they
 * agree, so this is the check that makes them trustworthy: exit non-zero on any
 * mismatch, and print the first differing region.
 *
 * Usage: node ports/run-parity.mjs [plan.json ...]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLANS = process.argv.slice(2);
const plans = PLANS.length ? PLANS : [path.join(HERE, 'spec', 'plan.example.json')];

const isWindows = process.platform === 'win32';
const rustBinary = path.join(HERE, 'rust', 'target', 'debug', isWindows ? 'floorplan_core.exe' : 'floorplan_core');
// `npm.cmd` launched without a shell keeps the JSON argument intact.
const npmCommand = isWindows ? 'npm.cmd' : 'npm';

/** Run a command and return { ok, out, err }. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return {
    ok: result.status === 0,
    out: (result.stdout || '').trimEnd(),
    err: (result.stderr || '').trim()
  };
}

function buildRust() {
  const build = run('cargo', ['build', '--quiet', '--manifest-path', path.join(HERE, 'rust', 'Cargo.toml')]);
  if (!build.ok) {
    console.error('rust build failed:\n' + build.err);
    process.exit(1);
  }
}

const LUA_SCRIPT = path.join(HERE, 'lua', 'floorplan_core.lua');
const PROBE_PLAN = Buffer.from('{"project":"probe","walls":[],"rooms":[]}', 'utf8').toString('base64');

/**
 * Find a Lua interpreter and how to hand it a plan.
 *
 * The probe runs the real port with a tiny plan instead of `-v`: fengari takes a
 * script, and reaching it through npm means a shell whose quoting would eat Lua
 * parentheses. Plans travel as base64 so no shell can mangle the JSON.
 */
function luaRunner() {
  const works = (command, prefix, shell) => {
    const probe = run(command, [...prefix, LUA_SCRIPT, '--b64', PROBE_PLAN], { shell });
    return probe.ok && probe.out.startsWith('{"project":"probe"');
  };

  for (const candidate of ['lua', 'lua5.4', 'lua5.3', 'luajit']) {
    if (works(candidate, [], false)) {
      return { label: candidate, command: candidate, prefix: [], shell: false };
    }
  }

  const fengari = ['exec', '--yes', '--package=fengari-node-cli', '--', 'fengari'];
  if (works(npmCommand, fengari, isWindows)) {
    return { label: 'fengari (Lua 5.3)', command: npmCommand, prefix: fengari, shell: isWindows };
  }
  return null;
}

function firstDifference(a, b) {
  const limit = Math.min(a.length, b.length);
  let at = 0;
  while (at < limit && a[at] === b[at]) at += 1;
  return at;
}

function report(label, expected, actual) {
  const at = firstDifference(expected, actual);
  const from = Math.max(0, at - 80);
  console.log(`\n  ${label} differs at byte ${at}`);
  console.log(`    expected: …${expected.slice(from, at + 80)}…`);
  console.log(`    actual:   …${actual.slice(from, at + 80)}…`);
}

let failures = 0;

buildRust();
const lua = luaRunner();
if (!lua) {
  console.log('lua: no interpreter found (install lua, or run npm exec --package=fengari-node-cli -- fengari)');
}

for (const plan of plans) {
  const relative = path.relative(process.cwd(), plan) || plan;
  console.log(`\n${relative}`);

  const rust = run(rustBinary, [plan]);
  const python = run('python', [path.join(HERE, 'python', 'floorplan_core.py'), plan]);
  const planBase64 = Buffer.from(readFileSync(plan, 'utf8'), 'utf8').toString('base64');
  const luaRun = lua
    ? run(lua.command, [...lua.prefix, LUA_SCRIPT, '--b64', planBase64], { shell: lua.shell })
    : null;

  const runners = [
    { label: 'rust', result: rust },
    { label: 'python', result: python }
  ];
  if (luaRun) runners.push({ label: `lua (${lua.label})`, result: luaRun });

  let failed = false;
  for (const runner of runners) {
    if (!runner.result.ok) {
      console.log(`  ${runner.label}: FAILED\n${runner.result.err}`);
      failed = true;
    }
  }

  if (!failed) {
    const reference = runners[0];
    for (const runner of runners.slice(1)) {
      if (runner.result.out !== reference.result.out) {
        report(`${runner.label} vs ${reference.label}`, reference.result.out, runner.result.out);
        failed = true;
      }
    }
  }

  if (failed) {
    failures += 1;
  } else {
    const bytes = runners[0].result.out.length;
    console.log(`  ok: ${runners.map((r) => r.label).join(', ')} agree (${bytes} bytes of canonical JSON)`);
  }
}

if (!existsSync(rustBinary)) {
  console.log('note: rust binary missing after build');
}

console.log(failures === 0 ? '\nparity: PASS' : `\nparity: FAIL (${failures} plan${failures === 1 ? '' : 's'})`);
process.exit(failures === 0 ? 0 : 1);
