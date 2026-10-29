/**
 * Checks for the editor-draft contract (`core/drafts.js`) and its call sites.
 *
 * The nine `*-editor-draft` keys are a hand-off between two pages, so the risky
 * part is not the maths but the branch a user can hit with a stale or corrupt
 * payload. The helper takes an injectable storage, so every branch — versioned,
 * legacy, malformed, future-version, storage that throws — runs here in Node;
 * the static half makes sure no page went back to raw `localStorage` reads for
 * these keys.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DRAFT_VERSION,
    EDITOR_DRAFT_KEYS,
    clearDraft,
    readDraft,
    writeDraft
} from '../core/drafts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
const failures = [];
const check = (name, condition, detail = '') => {
    if (condition) {
        pass += 1;
        console.log(`  ok  ${name}`);
    } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
};

/** A Map backed by the three localStorage methods, optionally throwing. */
function memoryStorage(initial = {}, { throwOnWrite = false, throwOnRead = false } = {}) {
    const map = new Map(Object.entries(initial));
    return {
        map,
        getItem(key) {
            if (throwOnRead) throw new Error('blocked');
            return map.has(key) ? map.get(key) : null;
        },
        setItem(key, value) {
            if (throwOnWrite) throw new Error('QuotaExceededError');
            map.set(key, String(value));
        },
        removeItem(key) {
            map.delete(key);
        }
    };
}

console.log('\nThe draft payload');

const storage = memoryStorage();
check('a draft saves', writeDraft('wall-editor-draft', { covering: 'paint-eggshell' }, { storage }) === true);
const stored = JSON.parse(storage.getItem('wall-editor-draft'));
check('the payload is versioned', stored.version === DRAFT_VERSION && DRAFT_VERSION === 1, String(stored.version));
check('the payload records when it was saved', typeof stored.savedAt === 'string' && !Number.isNaN(Date.parse(stored.savedAt)));
check('the payload wraps the data', JSON.stringify(stored.data) === '{"covering":"paint-eggshell"}', JSON.stringify(stored.data));

const read = readDraft('wall-editor-draft', { storage });
check('a draft reads back as its data', JSON.stringify(read.data) === '{"covering":"paint-eggshell"}');
check('the read reports the version and not legacy', read.version === 1 && read.legacy === false && read.issue === null);
check('a draft is consumed once', storage.getItem('wall-editor-draft') === null);

const kept = memoryStorage();
writeDraft('deck-editor-draft', { config: { joist: '2x8' } }, { storage: kept });
const keptRead = readDraft('deck-editor-draft', { storage: kept, consume: false });
check('consume:false leaves the key for the bid builder', keptRead.data.config.joist === '2x8' && kept.getItem('deck-editor-draft') !== null);

console.log('\nOld and broken payloads');

const legacy = memoryStorage({ 'roof-editor-draft': JSON.stringify({ style: 'gable', covering: 'asphalt' }) });
const legacyRead = readDraft('roof-editor-draft', { storage: legacy });
check('an unwrapped payload still imports', legacyRead.data.style === 'gable' && legacyRead.version === 0 && legacyRead.legacy === true);
check('a legacy payload has no issue', legacyRead.issue === null);

const broken = memoryStorage({ 'kitchen-editor-draft': '{"modules": [' });
const brokenRead = readDraft('kitchen-editor-draft', { storage: broken });
check('malformed JSON is dropped, not applied', brokenRead.data === null && brokenRead.issue === 'unparsable');
check('the malformed key is removed', broken.getItem('kitchen-editor-draft') === null);

const future = memoryStorage({ 'lighting-editor-draft': JSON.stringify({ version: DRAFT_VERSION + 1, data: { plan: {} } }) });
const futureRead = readDraft('lighting-editor-draft', { storage: future });
check('a newer build payload is refused', futureRead.data === null && futureRead.issue === 'version' && futureRead.version === DRAFT_VERSION + 1);
check('the refused key is removed', future.getItem('lighting-editor-draft') === null);

check('a missing draft reads as null', readDraft('nothing-here', { storage: memoryStorage() }) === null);
check('an unparsable draft is reported without a banner', (() => {
    const calls = [];
    const previous = globalThis.window;
    globalThis.window = { reportClientError: (message, extra) => calls.push({ message, extra }) };
    try {
        readDraft('electrical-editor-draft', { storage: memoryStorage({ 'electrical-editor-draft': 'nope' }) });
    } finally {
        globalThis.window = previous;
    }
    return calls.length === 1
        && /electrical-editor-draft/.test(calls[0].message)
        && calls[0].extra.kind === 'draft'
        && calls[0].extra.fatal === false;
})());

console.log('\nStorage failures');

check('a write that throws reports false', writeDraft('x-editor-draft', {}, { storage: memoryStorage({}, { throwOnWrite: true }) }) === false);
check('a read that throws reports null', readDraft('x-editor-draft', { storage: memoryStorage({ 'x-editor-draft': '{}' }, { throwOnRead: true }) }) === null);
check('a clear removes the key', (() => {
    const store = memoryStorage({ 'wall-editor-draft': '{}' });
    return clearDraft('wall-editor-draft', { storage: store }) === true && store.getItem('wall-editor-draft') === null;
})());
check('a clear never throws', clearDraft('wall-editor-draft', { storage: { removeItem() { throw new Error('blocked'); } } }) === false);

console.log('\nThe nine hand-off keys');

check('the register lists nine keys', EDITOR_DRAFT_KEYS.length === 9 && new Set(EDITOR_DRAFT_KEYS).size === 9, String(EDITOR_DRAFT_KEYS.length));
check('every key is an editor draft', EDITOR_DRAFT_KEYS.every((key) => key.endsWith('-editor-draft')));

const editor = await readFile(path.join(ROOT, 'editor/editor.js'), 'utf8');
const framingScene = await readFile(path.join(ROOT, 'features/framing/scene.js'), 'utf8');
const readers = [
    ...EDITOR_DRAFT_KEYS.filter((key) => key !== 'framing-editor-draft')
        .map((key) => ({ key, text: editor, pattern: `readDraft('${key}'` })),
    { key: 'framing-editor-draft', text: framingScene, pattern: 'readDraft(FRAMING_DRAFT_KEY' }
];
for (const reader of readers) {
    check(`the ${reader.key} reader uses the helper`, reader.text.includes(reader.pattern), reader.pattern);
}
check('the editor no longer parses draft JSON by hand', !/JSON\.parse\(localStorage\.getItem\('(?:[a-z]+)-editor-draft'\)/.test(editor));
check('the two shared keys are read without consuming', editor.includes("readDraft('electrical-editor-draft', { consume: false })")
    && editor.includes("readDraft('deck-editor-draft', { consume: false })"));

// The bid builder reads the same keys as the studio, so it must unwrap the
// versioned payload too — reading the envelope as the draft silently emptied
// every harvested suite (caught by check-framing and check-new-suites).
const bidSources = await readFile(path.join(ROOT, 'features/bid/sources.js'), 'utf8');
check('the bid harvest unwraps through the helper',
    bidSources.includes('readStoredDraft(key, { storage, consume: false })')
        && !/JSON\.parse\(/.test(bidSources),
    'raw JSON.parse still present');

const writers = [
    'features/deck/page.js',
    'features/electrical/page.js',
    'features/framing/page.js',
    'features/kitchen/page.js',
    'features/landscape/page.js',
    'features/lighting/page.js',
    'pages/index.html',
    'pages/roof-designer.html',
    'pages/wall-designer.html'
];
for (const file of writers) {
    const text = await readFile(path.join(ROOT, file), 'utf8');
    const writes = /writeDraft\(/.test(text);
    const raw = /localStorage\.setItem\([^)]*editor-draft/.test(text) || /setItem\(EDITOR_KEY/.test(text);
    check(`${file} writes through the helper`, writes && !raw, `writeDraft=${writes} raw=${raw}`);
}

const wallCheck = await readFile(path.join(ROOT, 'scripts/check-wall.js'), 'utf8');
check('the wall suite expects the versioned read', wallCheck.includes("readDraft('wall-editor-draft')"));

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
