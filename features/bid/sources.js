import { computeDeckDesign } from '../deck/engine.js';
import { computeElectricalDesign } from '../electrical/engine.js';
import { designLandscape } from '../landscape/engine.js';
import { designLighting } from '../lighting/engine.js';
import { designPlumbing } from '../plumbing/engine.js';
import { computeRoofDesign } from '../roof/design.js';
import { computeWallDesign } from '../wall/design.js';

/**
 * Cross-suite harvest for the bid builder.
 *
 * Every designer suite stores its latest design in localStorage. Rather than
 * copying a price into a second place, the bid builder re-runs each suite's own
 * engine on that stored draft and reads the bill of materials it just produced,
 * so the bid always matches the drawing, the schedule and the takeoff.
 *
 * Each adapter is defensive: a missing or stale draft yields `found: false`
 * with a reason instead of breaking the bid.
 */

export const SUITES = [
    { key: 'deck', label: 'Deck and framing', draftKeys: ['deck-editor-draft', 'deck-suite-draft'] },
    { key: 'electrical', label: 'Electrical', draftKeys: ['electrical-editor-draft', 'electrical-suite-draft'] },
    { key: 'landscape', label: 'Landscape and water features', draftKeys: ['landscape-suite-plan'] },
    { key: 'lighting', label: 'Lighting', draftKeys: ['lighting-suite-plan'] },
    { key: 'plumbing', label: 'Plumbing', draftKeys: ['plumbing-suite-plan'] },
    { key: 'roof', label: 'Roof', draftKeys: ['roof-suite-draft'] },
    { key: 'wall', label: 'Wall finishes', draftKeys: ['wall-suite-draft'] },
    { key: 'stair', label: 'Stairs', draftKeys: ['stair-designer-draft'] }
];

const round = (value, digits = 2) => {
    const factor = 10 ** digits;
    return Math.round((Number(value) || 0) * factor) / factor;
};

const readDraft = (storage, keys) => {
    for (const key of keys) {
        try {
            const raw = storage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return { key, value: parsed };
        } catch {
            // A corrupt draft is skipped; the next key may still be good.
        }
    }
    return null;
};

/** Normalise the many BOM row shapes the suites emit into one line contract. */
export function normalizeLine(row = {}, suite = 'other', group = 'Materials') {
    const description = row.description || row.item || row.label || row.name || 'Line item';
    const qty = Number(row.qty ?? row.quantity ?? row.count ?? 1) || 0;
    const unit = row.unit || row.packLabel || row.uom || 'ea';
    const total = Number(row.total ?? row.cost ?? row.amount ?? 0) || 0;
    const unitCost = Number(row.unitCost ?? (qty ? total / qty : total)) || 0;
    return {
        suite,
        group: row.group || group,
        code: String(row.code || row.id || description).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        description,
        qty: round(qty, 2),
        unit,
        unitCost: round(unitCost, 2),
        total: round(total || qty * unitCost, 2),
        note: row.note || row.spec || ''
    };
}

const withLines = (key, label, lineGroups) => {
    const lines = [];
    lineGroups.forEach(({ rows = [], group }) => {
        rows.forEach((row) => lines.push(normalizeLine(row, key, group)));
    });
    const subtotal = round(lines.reduce((total, line) => total + line.total, 0), 2);
    return { suite: key, label, found: true, lines, subtotal, note: `${lines.length} lines` };
};

const missing = (key, label, note) => ({ suite: key, label, found: false, lines: [], subtotal: 0, note });

const ADAPTERS = {
    deck: (draft) => {
        const config = draft.config || draft;
        const design = computeDeckDesign(config);
        return withLines('deck', 'Deck and framing', [{ rows: design.bom.rows, group: 'Framing' }]);
    },
    electrical: (draft) => {
        const config = draft.config || draft;
        const design = computeElectricalDesign(config);
        return withLines('electrical', 'Electrical', [{ rows: design.bom.rows, group: 'Electrical' }]);
    },
    landscape: (draft) => {
        const plan = draft.feature ? draft : { feature: draft, site: {} };
        const design = designLandscape(plan.feature, plan.site || {});
        return withLines('landscape', 'Landscape and water features', [{ rows: design.bom, group: 'Landscape' }]);
    },
    lighting: (draft) => {
        const design = designLighting(draft.plan || draft);
        return withLines('lighting', 'Lighting', [{ rows: design.bom.rows, group: 'Lighting' }]);
    },
    plumbing: (draft) => {
        const design = designPlumbing(draft);
        return withLines('plumbing', 'Plumbing', [
            { rows: design.takeoff?.rough?.rows || [], group: 'Rough-in' },
            { rows: design.takeoff?.finish?.rows || [], group: 'Fixtures' }
        ]);
    },
    roof: (draft) => {
        const design = computeRoofDesign(draft);
        return withLines('roof', 'Roof', [{ rows: design.costs?.rows || [], group: 'Roofing' }]);
    },
    wall: (draft) => {
        const design = computeWallDesign(draft);
        return withLines('wall', 'Wall finishes', [{ rows: design.rows || [], group: 'Finishes' }]);
    },
    stair: () => missing('stair', 'Stairs', 'The stair designer exports quantities but no priced takeoff.')
};

/** Read every suite draft and rebuild its priced bill of materials. */
export function collectBidSources(storage = globalThis.localStorage) {
    if (!storage) return SUITES.map((suite) => missing(suite.key, suite.label, 'Storage unavailable in this browser.'));
    return SUITES.map((suite) => {
        const draft = readDraft(storage, suite.draftKeys);
        if (!draft) return missing(suite.key, suite.label, 'No saved design yet.');
        try {
            const result = ADAPTERS[suite.key](draft.value);
            return { ...result, draftKey: draft.key };
        } catch (error) {
            return missing(suite.key, suite.label, `Draft found but could not be rebuilt: ${error.message}`);
        }
    });
}

/** Merge harvested suites and manual lines into one priced bill. */
export function mergeSources(sources = [], manual = [], alternates = []) {
    const groups = [];
    sources.filter((source) => source.found && source.lines.length).forEach((source) => {
        groups.push({
            key: source.suite,
            label: source.label,
            kind: 'suite',
            lines: source.lines.map((line) => ({ ...line, suite: source.suite })),
            subtotal: source.subtotal
        });
    });
    if (manual.length) {
        const lines = manual.map((row) => normalizeLine(row, 'manual', row.group || 'Manual'));
        groups.push({
            key: 'manual',
            label: 'Manual and allowances',
            kind: 'manual',
            lines,
            subtotal: round(lines.reduce((total, line) => total + line.total, 0), 2)
        });
    }
    const alternateLines = alternates.map((row) => normalizeLine(row, 'alternate', 'Alternates'));
    return { groups, alternateLines, base: round(groups.reduce((total, group) => total + group.subtotal, 0), 2) };
}

export function emptySourceStatuses() {
    return SUITES.map((suite) => missing(suite.key, suite.label, 'Not loaded.'));
}
