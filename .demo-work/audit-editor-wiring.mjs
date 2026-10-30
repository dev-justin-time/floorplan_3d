/* Static audit: every interactive element in pages/Editor.html vs real handlers.
 * Checks data-click/input/change args resolve, data-tool/data-item validity,
 * data-show/hide/disclosure targets exist, and direct getElementById bindings.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync('pages/Editor.html', 'utf8');
const editorJs = readFileSync('editor/editor.js', 'utf8');
const classicJs = readFileSync('assets/page-scripts/Editor.js', 'utf8');
let itemsJs = '';
try { itemsJs = readFileSync('core/metadata.js', 'utf8'); } catch {}

const fails = [];
const passes = [];
const ok = (name, detail = '') => { passes.push(name); console.log(`ok   ${name}${detail ? ' — ' + detail : ''}`); };
const bad = (name, detail = '') => { fails.push(name); console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); };

const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);

// Window handlers defined in the module + classic script globals.
const windowFns = new Set([
    ...all(/window\.([A-Za-z_$][\w$]*)\s*=/g, editorJs),
    ...all(/function\s+([A-Za-z_$][\w$]*)\s*\(/g, classicJs),
]);
// Dotted-action owners on window (planOcr, editorKit, …).
const dottedOwner = (name) => {
    const parts = name.split('.');
    if (parts.length < 2) return false;
    return new RegExp(`window\\.${parts[0]}\\s*=`).test(editorJs);
};
const resolves = (name) => windowFns.has(name) || windowFns.has(name.split('.')[0]) && dottedOwner(name) || windowFns.has(name);

// Direct element bindings inside editor.js.
const boundIds = new Set(all(/getElementById\('([^']+)'\)/g, editorJs));
const boundSelectors = all(/querySelectorAll\('([^']+)'\)/g, editorJs);

// ---- data-click ----
const clicks = [...new Set(all(/data-click="([^"]+)"/g, html))];
for (const name of clicks) {
    if (name === 'toggleCategory') {
        (windowFns.has('toggleCategory') ? ok : bad)('click toggleCategory', 'classic script + module fallback');
    } else if (resolves(name)) ok(`click ${name}`);
    else bad(`click ${name}`, 'NO HANDLER on window');
}

// ---- data-input / data-change (value passed; check function arity >= 1 where known) ----
for (const name of [...new Set(all(/data-input="([^"]+)"/g, html))]) {
    if (resolves(name)) ok(`input ${name}`);
    else bad(`input ${name}`, 'NO HANDLER on window');
}
for (const name of [...new Set(all(/data-change="([^"]+)"/g, html))]) {
    if (resolves(name)) ok(`change ${name}`);
    else bad(`change ${name}`, 'NO HANDLER on window');
}

// ---- data-tool (must be a real tool branch or item type) ----
const tools = [...new Set(all(/data-tool="([^"]+)"/g, html))];
const toolBranches = new Set(['wall', 'delete', 'select', 'cutout']);
const itemTypes = new Set([...all(/['"]([a-z][a-z0-9_]+)['"]\s*:/g, itemsJs)].filter((t) => t.length > 2));
void itemTypes;
for (const t of tools) {
    if (toolBranches.has(t)) ok(`tool ${t}`, 'real tool branch');
    else bad(`tool ${t}`, 'no branch in onPointerDown/setTool');
}

// ---- data-item (must exist in ItemFactory) ----
const dataItems = [...new Set(all(/data-item="([^"]+)"/g, html))];
const factoryTypes = new Set(all(/^\s{4}([a-z][a-z0-9_]*):\s*\{/gm, itemsJs));
for (const t of dataItems) {
    if (factoryTypes.has(t)) ok(`item ${t}`, 'ItemFactory case');
    else bad(`item ${t}`, 'NOT in ItemFactory switch');
}

// ---- data-show / data-hide / data-disclosure targets ----
for (const sel of [...new Set(all(/data-show="([^"]+)"/g, html))]) {
    (html.includes(`id="${sel.slice(1)}"`) ? ok : bad)(`show ${sel}`, html.includes(`id="${sel.slice(1)}"`) ? '' : 'target missing');
}
for (const sel of [...new Set(all(/data-hide="([^"]+)"/g, html))]) {
    (html.includes(`id="${sel.slice(1)}"`) ? ok : bad)(`hide ${sel}`, html.includes(`id="${sel.slice(1)}"`) ? '' : 'target missing');
}
for (const sel of [...new Set(all(/data-disclosure="([^"]+)"/g, html))]) {
    (html.includes(`id="${sel.slice(1)}"`) ? ok : bad)(`disclosure ${sel}`, html.includes(`id="${sel.slice(1)}"`) ? '' : 'target missing');
}

// ---- id-wired controls: every getElementById listener target should exist ----
const listenerIds = [...new Set(all(/getElementById\('([^']+)'\)\?\.addEventListener|getElementById\('([^']+)'\)\.addEventListener/g, editorJs))].flat().filter(Boolean);
const missingTargets = [...new Set([...all(/document\.getElementById\('([^']+)'\)/g, editorJs)])].filter((id) => !html.includes(`id="${id}"`) && !editorJs.includes(`createElement`) /* dynamic */);
if (missingTargets.length) {
    // Filter to ones actually listened to (not just read).
    const listened = missingTargets.filter((id) => new RegExp(`getElementById\\('${id}'\\)\\?\\.addEventListener|getElementById\\('${id}'\\)\\.addEventListener`).test(editorJs));
    if (listened.length) bad('listener targets missing from HTML', listened.slice(0, 10).join(', '));
    else ok('all listener targets exist in HTML');
} else ok('all listener targets exist in HTML');

// ---- reverse: prominent window handlers with no UI trigger ----
const uiText = html;
const unused = [...windowFns].filter((fn) => {
    if (/^(undo|redo|toggleView|setViewMode)/.test(fn)) return false;
    if (uiText.includes(`data-click="${fn}"`) || uiText.includes(`data-input="${fn}"`) || uiText.includes(`data-change="${fn}"`)) return false;
    if (new RegExp(`getElementById\\('${fn}'\\)`).test(editorJs)) return false;
    return true;
});
console.log(`\nnote: ${unused.length} window handlers without a direct HTML trigger (harness/API handles, mostly fine):`);
console.log(unused.slice(0, 40).join(', '));

console.log(`\n${passes.length} connected, ${fails.length} broken`);
process.exit(fails.length ? 1 : 0);
