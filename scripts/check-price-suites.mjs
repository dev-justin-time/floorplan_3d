import {
    applyPriceBookToDesign,
    emptyPriceBook,
    isMaterialRow,
    priceKey
} from '../features/pricing/book.js';
import { computeRoofDesign } from '../features/roof/design.js';
import { computeWallDesign } from '../features/wall/design.js';
import { computeFramingDesign } from '../features/framing/engine.js';
import { computeDeckDesign } from '../features/deck/engine.js';
import { computeElectricalDesign } from '../features/electrical/engine.js';
import { createPlan, autoLights, autoCircuits } from '../features/lighting/plan.js';
import { designLighting } from '../features/lighting/engine.js';
import { designPlumbing } from '../features/plumbing/engine.js';
import { designLandscape } from '../features/landscape/engine.js';

function rowsOf(design) {
    const rows = [];
    const seen = new Set();
    const walk = (value, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach((entry) => walk(entry, depth + 1));
            return;
        }
        const pricedRow = typeof value.unitCost === 'number'
            || (typeof value.cost === 'number' && typeof value.unit === 'string' && (value.item || value.description));
        if (pricedRow && (typeof value.cost === 'number' || typeof value.total === 'number')) rows.push(value);
        Object.values(value).forEach((entry) => walk(entry, depth + 1));
    };
    walk(design);
    return rows;
}

const lightingPlan = createPlan({ roomType: 'living' });
autoLights(lightingPlan);
autoCircuits(lightingPlan);

const designs = {
    roof: computeRoofDesign(),
    wall: computeWallDesign(),
    framing: computeFramingDesign(),
    deck: computeDeckDesign(),
    electrical: computeElectricalDesign(),
    lighting: designLighting(lightingPlan),
    plumbing: designPlumbing({}),
    landscape: designLandscape({})
};

for (const [suite, design] of Object.entries(designs)) {
    const rows = rowsOf(design);
    const materials = rows.filter(isMaterialRow);
    if (!materials.length) throw new Error(`${suite}: no material rows found`);
    const book = emptyPriceBook();
    for (const row of materials) {
        const item = row.item || row.description || row.label;
        book.entries[priceKey(suite, item, row.unit || 'ea')] = {
            suite,
            item,
            unit: row.unit || 'ea',
            cost: 0.01,
            supplier: 'Check Lumber',
            updatedAt: '2026-10-26'
        };
    }
    const priced = applyPriceBookToDesign(suite, design, book);
    const pricedRows = rowsOf(priced).filter(isMaterialRow);
    const leftover = pricedRows.filter((row) => Number(row.unitCost) !== 0.01);
    if (leftover.length) {
        throw new Error(`${suite}: ${leftover.length} quoted rows kept their old cost (${leftover[0].item || leftover[0].description})`);
    }
    if (priced.bom && 'material' in priced.bom && !(Number(priced.bom.material) > 0)) {
        throw new Error(`${suite}: bom.material did not follow the quotes`);
    }
    if (priced.costs && 'material' in priced.costs && !(Number(priced.costs.material) > 0)) {
        throw new Error(`${suite}: costs.material did not follow the quotes`);
    }
    console.log(`${suite}: ${pricedRows.length} quoted material rows repriced at the quoted $0.01`);
}
console.log('All suites repriced.');
