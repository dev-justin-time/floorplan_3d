import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Wall } from '../core/items.js';
import { PIXELS_PER_METER } from '../core/world-space.js';
import {
    ROOF_STYLES,
    ROOF_STYLE_COUNT,
    roofStyle,
    roofGeometry,
    trussMembers,
    eaveSegments,
    ridgeSegments,
    hipSegments
} from '../features/roof/styles.js';
import {
    COVERINGS,
    GUTTER_SYSTEMS,
    coveringById,
    gutterById,
    SQUARE_M2
} from '../features/roof/materials.js';
import {
    computeRoofDesign,
    roofTakeoffCsv,
    takeoffRows,
    roofSummary,
    ROOF_DEFAULTS
} from '../features/roof/design.js';
import {
    ROOF_GLOSSARY,
    GLOSSARY_CATEGORIES,
    glossaryByCategory,
    glossaryTerm,
    searchGlossary,
    ROOF_FORMULAS
} from '../features/roof/glossary.js';
import { buildTrussRoof } from '../features/studio/roof.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
    if (ok) {
        pass += 1;
        console.log(`  ok  ${name}${detail ? ' — ' + detail : ''}`);
    } else {
        fail += 1;
        console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
    }
};
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
const countNamed = (root, name) => {
    let count = 0;
    root.traverse((child) => { if (child.name === name) count += 1; });
    return count;
};

console.log('\nStyles');
check('ten truss styles are defined', ROOF_STYLE_COUNT === 10 && ROOF_STYLES.length === 10, `${ROOF_STYLE_COUNT} styles`);
check('style keys are unique', new Set(ROOF_STYLES.map((style) => style.key)).size === 10);
check('every style has a summary and a use', ROOF_STYLES.every((style) => style.summary.length > 20 && style.bestFor.length > 10));
check('unknown styles fall back to the gable', roofStyle('nope').key === ROOF_STYLES[0].key);

const geometryResults = ROOF_STYLES.map((style) => ({
    style,
    geometry: roofGeometry({ style: style.key, span: 10, length: 14, pitch: 6, overhang: 0.5 })
}));
check('every style produces planes', geometryResults.every(({ geometry }) => geometry.planes.length >= 1));
check('every style covers positive area', geometryResults.every(({ geometry }) => geometry.roofArea > 20));
check('every style measures its eaves', geometryResults.every(({ geometry }) => geometry.eaveLength > 2));
check('every style has truss members', geometryResults.every(({ style, geometry }) => trussMembers(style.key, geometry).length >= 3));

const gable = roofGeometry({ style: 'gable-king', span: 10, length: 14, pitch: 6, overhang: 0.5 });
check('gable rise follows the pitch', near(gable.rise, 2.5, 1e-6), `${gable.rise} m`);
check('pitch 6 is 26.57°', near(gable.angle, 26.565051177, 1e-6), `${gable.angle.toFixed(3)}°`);
check('gable has two planes', gable.planes.length === 2);
check('gable ridge includes the overhang', near(gable.ridgeLength, 15, 1e-6), `${gable.ridgeLength} m`);
check('gable eave is two long runs', near(gable.eaveLength, 30, 1e-6), `${gable.eaveLength} m`);
check('gable rake runs four slopes', near(gable.rakeLength, 4 * Math.hypot(5.5, 2.75), 1e-6), `${gable.rakeLength.toFixed(2)} m`);

const hip = roofGeometry({ style: 'hip', span: 10, length: 14, pitch: 6, overhang: 0.5 });
check('hip has four planes', hip.planes.length === 4);
check('hip has four eave runs', eaveSegments(hip).length === 4);
check('hip caps follow the slope', near(hip.hipLength, 4 * Math.hypot(Math.hypot(5.5, 5.5), 2.75), 1e-6), `${hip.hipLength.toFixed(2)} m`);
check('hip ridge is shorter than the plan', hip.ridgeLength < 14);
check('hip has no rake', hip.rakeLength === 0);
check('hip segments are four', hipSegments(hip).length === 4);

const shed = roofGeometry({ style: 'shed', span: 10, length: 14, pitch: 4, overhang: 0.5 });
check('shed has one plane', shed.planes.length === 1);
check('shed has one eave run', eaveSegments(shed).length === 1);
check('shed has no ridge', ridgeSegments(shed).length === 0);

const cross = roofGeometry({ style: 'cross-gable', span: 10, length: 14, pitch: 6, overhang: 0.5 });
check('cross gable has four planes', cross.planes.length === 4);
check('cross gable has two valleys counted', cross.valleyLength > 0, `${cross.valleyLength.toFixed(2)} m`);

check('gambrel has four planes', roofGeometry({ style: 'gambrel', span: 10, length: 14, pitch: 8 }).planes.length === 4);
check('saltbox ridge is off centre', Math.abs(roofGeometry({ style: 'saltbox', span: 10, length: 14, pitch: 6 }).ridgeX) > 0.2);

console.log('\nDesign engine');
const design = computeRoofDesign({ ...ROOF_DEFAULTS });
check('default design computes', design.areas.roof > 0 && design.costs.total > 0);
check('default style is the gable king post', design.style.key === 'gable-king');
check('roof area exceeds the footprint', design.areas.roof > design.areas.plan, `${design.areas.roof} > ${design.areas.plan}`);
check('squares convert from m²', near(design.areas.squares, design.areas.roof / SQUARE_M2, 0.01), `${design.areas.squares} squares`);
check('waste is applied to squares', design.areas.squaresWithWaste > design.areas.squares);
check('deck sheets cover the area plus waste', design.layers.sheets === Math.ceil(design.areas.roof * 1.1 / 2.9768), `${design.layers.sheets} sheets`);
check('underlayment covers the roof', design.layers.underlayRolls >= 2, `${design.layers.underlayRolls} rolls`);
check('shingle bundles are three per square', design.layers.coveringUnits === Math.ceil(design.areas.squaresWithWaste * 3), `${design.layers.coveringUnits} bundles`);
check('ridge cap is measured', design.layers.ridgeCapLf > 0, `${design.layers.ridgeCapLf} m`);
check('trusses at 24 in o.c.', design.trussCount === Math.ceil(design.geometry.length / 0.61) + 1, `${design.trussCount} trusses`);
check('every truss has a cost', design.costs.rows.some((row) => row.item === 'Roof trusses'));
check('gutter run follows the eaves', near(design.gutterPackage.gutterLf, design.geometry.eaveLength, 0.1), `${design.gutterPackage.gutterLf} m`);
check('auto downspouts at least two', design.gutterPackage.downspouts >= 2);
check('hangers at 600 mm', design.gutterPackage.hangers === Math.ceil(design.geometry.eaveLength / 0.6));
check('ice shield is measured on the eave', design.areas.iceShield > 10, `${design.areas.iceShield} m²`);
check('vent area is 1:300 of the roof', near(design.areas.requiredVents, design.areas.roof / 300, 0.01));
check('drip edge covers eave and rake', near(design.layers.dripEdgeM, design.geometry.eaveLength + design.geometry.rakeLength, 0.1));
check('costs add up', near(design.costs.material + design.costs.labour, design.costs.total, 0.02));
check('per-square cost is derived', near(design.costs.perSquare, design.costs.total / (design.geometry.roofArea / SQUARE_M2), 0.02));
check('summary is a short list', roofSummary(design).length === 7);
check('every check has a known severity', design.checks.every((entry) => ['ok', 'info', 'warn', 'error'].includes(entry.severity)));
check('every check has a label', design.checks.every((entry) => entry.label.length > 3));

console.log('\nCoverings and layers');
const tile = computeRoofDesign({ style: 'gable-king', covering: 'clay-tile', pitch: 8, spacing: 0.61 });
check('tile is counted in pieces', tile.layers.coveringUnit === 'tile' && tile.layers.coveringUnits > 500, `${tile.layers.coveringUnits} tiles`);
check('tile at 24 in spacing fails the deck check', tile.checks.some((entry) => entry.id === 'truss-spacing' && entry.severity === 'error'));
check('tile reports its dead load', tile.checks.some((entry) => entry.id === 'dead-load'));
const tile16 = computeRoofDesign({ style: 'gable-king', covering: 'clay-tile', pitch: 8, spacing: 0.4 });
check('tile passes at 16 in spacing', !tile16.checks.some((entry) => entry.id === 'truss-spacing' && entry.severity === 'error'));

const metal = computeRoofDesign({ covering: 'metal-standing-seam', pitch: 3 });
check('metal is counted in squares', metal.layers.coveringUnit === 'square' && metal.layers.coveringUnits === Math.ceil(metal.areas.squaresWithWaste));
check('metal gets a ridge cap', metal.costs.rows.some((row) => row.item === 'Ridge and hip cap'));
check('metal gets closures and fasteners', metal.costs.rows.some((row) => row.item === 'Closures and fasteners'));
check('metal has no starter strip', metal.layers.starterUnits === 0);

const flat = computeRoofDesign({ covering: 'bur', pitch: 0.5 });
check('BUR is counted per ply-square', flat.layers.coveringUnit === 'ply-square');
check('low slope is flagged', flat.checks.some((entry) => entry.id === 'low-slope'));
const ponding = computeRoofDesign({ covering: 'tpo', pitch: 0.2 });
check('a pitch under 0.25:12 is ponding', ponding.checks.some((entry) => entry.id === 'ponding' && entry.severity === 'error'));

const steepShingle = computeRoofDesign({ covering: 'asphalt-arch', pitch: 21 });
check('pitch above the covering maximum warns', steepShingle.checks.some((entry) => entry.id === 'pitch-max' && entry.severity === 'warn'));
const lowShingle = computeRoofDesign({ covering: 'asphalt-arch', pitch: 1 });
check('shingle below 2:12 is an error', lowShingle.checks.some((entry) => entry.id === 'pitch-covering' && entry.severity === 'error'));

const tub = computeRoofDesign({ gutter: 'half-round-5' });
check('half-round has tighter hangers', tub.gutterPackage.hangers > design.gutterPackage.hangers);

const cold = computeRoofDesign({ climate: 'cold', iceShield: false });
check('cold climate without ice shield is an error', cold.checks.some((entry) => entry.id === 'ice-dam' && entry.severity === 'error'));
const coldShield = computeRoofDesign({ climate: 'cold', iceShield: true });
check('cold climate with a shield is fine', !coldShield.checks.some((entry) => entry.id === 'ice-dam' && entry.severity === 'error'));

const noVents = computeRoofDesign({ ridgeVent: false, soffitVent: false });
check('no vents warns', noVents.checks.some((entry) => entry.id === 'ventilation' && entry.severity === 'warn'));
const oneVent = computeRoofDesign({ ridgeVent: true, soffitVent: false });
check('one-sided ventilation warns', oneVent.checks.some((entry) => entry.id === 'ventilation' && entry.severity === 'warn'));

const fewDownspouts = computeRoofDesign({ downspouts: 1, gutter: 'box-4' });
check('undersized downspouts warn', fewDownspouts.checks.some((entry) => entry.id === 'gutter-capacity' && entry.severity === 'warn'));
const noGutters = computeRoofDesign({ gutters: false });
check('gutters can be switched off', noGutters.gutterPackage.gutterLf === 0 && noGutters.gutterPackage.downspouts === 0);
check('no gutters leaves a note', noGutters.checks.some((entry) => entry.id === 'gutter'));

check('chimney adds step and apron flashing', computeRoofDesign({ chimney: true }).layers.stepM === 4);
check('pipe boots are counted', computeRoofDesign({ pipeVents: 3 }).layers.pipeBoots === 3);
check('kickouts appear on cross gables', computeRoofDesign({ style: 'cross-gable' }).layers.kickouts === 2);
check('tear-off adds labour', computeRoofDesign({ tearOff: true }).costs.labour > design.costs.labour);
check('low waste warns', computeRoofDesign({ waste: 0.02 }).checks.some((entry) => entry.id === 'waste'));
check('deep overhang warns', computeRoofDesign({ overhang: 1.2 }).checks.some((entry) => entry.id === 'overhang'));

const withWaste = computeRoofDesign({ waste: 0.25 });
check('more waste means more shingles', withWaste.layers.coveringUnits > design.layers.coveringUnits);
check('waste is clamped', computeRoofDesign({ waste: 5 }).waste <= 0.4);
check('unknown covering falls back', computeRoofDesign({ covering: 'nope' }).covering.id === coveringById('nope').id);
check('unknown gutter falls back', computeRoofDesign({ gutter: 'nope' }).gutter.id === gutterById('nope').id);

console.log('\nTakeoff and CSV');
const rows = takeoffRows(design);
check('takeoff rows exist', rows.length > 15, `${rows.length} rows`);
check('every row has a positive quantity', rows.every((row) => row.qty > 0));
check('every row has a cost', rows.every((row) => row.cost >= 0));
check('rows are grouped', new Set(rows.map((row) => row.group)).size >= 5);
const csv = roofTakeoffCsv(design);
const csvLines = csv.split('\n');
check('CSV has a header', csvLines[0].startsWith('"group","item"'));
check('CSV lists every row', csvLines.length === rows.length + 7, `${csvLines.length} lines`);
check('CSV carries a summary total', csv.includes('"Summary","Total"'));
check('CSV labels the style', csv.includes(design.style.name.replace(/"/g, '""')));
check('CSV quotes commas', computeRoofDesign({ covering: 'asphalt-arch' }) && roofTakeoffCsv(computeRoofDesign()).includes('"'));

console.log('\nGlossary');
check('glossary covers every category', glossaryByCategory().length === GLOSSARY_CATEGORIES.length);
check('every entry is in a category', ROOF_GLOSSARY.every((entry) => GLOSSARY_CATEGORIES.includes(entry.category)));
check('every entry defines its term', ROOF_GLOSSARY.every((entry) => entry.term && entry.definition.length > 20));

const terms = [
    ['Deck', 'Sheathing'], ['Rafter', null], ['Truss', null], ['Ridge', null], ['Eave', null],
    ['Gable', null], ['Hip', null], ['Rake', null], ['Soffit', null], ['Fascia', null],
    ['Overhang', null], ['Parapet', null], ['Valley', null],
    ['Flashing', null], ['Drip edge', null], ['Step flashing', null], ['Counter flashing', null],
    ['Apron flashing', null], ['Underlayment', null], ['Ice and water shield', null], ['Cricket', null],
    ['Gutter apron', null], ['Kickout flashing', null],
    ['Square', null], ['Asphalt shingle', null], ['Architectural shingle', 'Dimensional shingle'],
    ['3-tab shingle', null], ['Granules', null], ['Metal roofing', null], ['Modified bitumen', null],
    ['Built-up roof', null], ['Single-ply membrane', null], ['Roll roofing', null],
    ['Synthetic underlayment', null], ['Felt', 'Tar paper'],
    ['Pitch', 'Slope'], ['Tear-off', null], ['Overlay', null], ['Starter strip', null],
    ['Ridge cap', null], ['Vent boot', null], ['Racking', null], ['Blistering', null], ['Ponding', null],
    ['Hail damage', null], ['Ice dam', null], ['Attic ventilation', null],
    ['ACV', null], ['RCV', null], ['AOB', null], ['Roofing inspection', null], ['Warranty', null],
    ['Dormer', null], ['Shed roof', null], ['Low-slope roof', null], ['Dead valley', null],
    ['Exposed-nail method', null], ['Ply', null], ['BTU', null], ['R-value', null],
    ['Vapor barrier', null], ['Batten', null]
];
const missing = terms.filter(([term]) => !glossaryTerm(term)).map(([term]) => term);
check('every requested term is in the glossary', missing.length === 0, missing.join(', '));
const aliasMissing = terms.filter(([term, aka]) => aka && glossaryTerm(aka)?.term !== term).map(([term, aka]) => `${term} (${aka})`);
check('aliases resolve to the right entry', aliasMissing.length === 0, aliasMissing.join(', '));
check('search matches a definition', searchGlossary('ice ridge').some((entry) => entry.term === 'Ice dam'));
check('search matches an alias', searchGlossary('tar paper').some((entry) => entry.term === 'Felt'));
check('empty search returns everything', searchGlossary('').length === ROOF_GLOSSARY.length);
check('glossary is substantial', ROOF_GLOSSARY.length >= 60, `${ROOF_GLOSSARY.length} terms`);
check('formulas list their quantity', ROOF_FORMULAS.length >= 8 && ROOF_FORMULAS.every((entry) => entry.label && entry.formula && entry.note));

console.log('\nEditor roof builder');
const view = { width: 900, height: 700 };
const walls = [
    new Wall(150, 150, 750, 150),
    new Wall(750, 150, 750, 550),
    new Wall(750, 550, 150, 550),
    new Wall(150, 550, 150, 150)
];
const hipRoof = buildTrussRoof(THREE, {
    walls, view, style: 'hip', pitch: 7, covering: 'clay-tile',
    gutter: 'half-round-5', gutters: true, ridgeVent: true
});
check('hip roof builds four planes', countNamed(hipRoof, 'roof-plane') === 4, `${countNamed(hipRoof, 'roof-plane')} planes`);
check('hip roof builds four deck layers', countNamed(hipRoof, 'roof-deck') === 4);
check('hip roof builds four gutter runs', countNamed(hipRoof, 'roof-gutter') === 4);
check('hip roof builds four fascia boards', countNamed(hipRoof, 'roof-fascia') === 4);
check('hip roof places downspouts', countNamed(hipRoof, 'roof-downspout') >= 4);
check('hip roof has a ridge cap', countNamed(hipRoof, 'roof-ridge-cap') === 1);
check('hip roof has hip caps', countNamed(hipRoof, 'roof-hip-cap') === 4);
check('hip roof has a ridge vent', countNamed(hipRoof, 'roof-ridge-vent') === 1);
check('hip roof reports its style', hipRoof.userData.style === 'hip' && hipRoof.userData.coveringFamily === 'tile');
check('hip roof area is priced from its own geometry', near(hipRoof.userData.squares, hipRoof.userData.roofArea / SQUARE_M2, 0.01));
check('hip trusses at 24 in o.c.', hipRoof.userData.trusses === Math.ceil((750 - 150) / PIXELS_PER_METER / 0.61) + 1, `${hipRoof.userData.trusses} trusses`);

const shedRoof = buildTrussRoof(THREE, { walls, view, style: 'shed', pitch: 4, covering: 'metal-standing-seam' });
check('shed roof builds one plane', countNamed(shedRoof, 'roof-plane') === 1);
check('shed roof builds one gutter', countNamed(shedRoof, 'roof-gutter') === 1);
check('shed roof has no ridge cap', countNamed(shedRoof, 'roof-ridge-cap') === 0);
check('shed roof still has trusses', countNamed(shedRoof, 'roof-truss') >= 2);

const noGutterRoof = buildTrussRoof(THREE, { walls, view, gutters: false });
check('gutters can be left off the model', countNamed(noGutterRoof, 'roof-gutter') === 0);
check('fascia still closes the eave', countNamed(noGutterRoof, 'roof-fascia') === 2);

const autoRoof = buildTrussRoof(THREE, { walls, view });
check('the default roof keeps two planes', countNamed(autoRoof, 'roof-plane') === 2);
check('the default roof has king posts', countNamed(autoRoof, 'truss-king-post') === autoRoof.userData.trusses);
check('the default roof has four webs per truss', countNamed(autoRoof, 'truss-web') === autoRoof.userData.trusses * 4);

console.log('\nRules document');
const rules = readFileSync(new URL('../docs/ROOF.MD', import.meta.url), 'utf8').toLowerCase();
const missingRules = ROOF_GLOSSARY
    .filter((entry) => !rules.includes(entry.term.toLowerCase()))
    .map((entry) => entry.term);
check('ROOF.MD exists and is substantial', rules.length > 10000, `${rules.split(/\s+/).length} words`);
check('ROOF.MD covers every glossary term', missingRules.length === 0, missingRules.join(', '));
check('ROOF.MD cites the roof chapters', rules.includes('irc r905') && rules.includes('irc r806') && rules.includes('irc r903'));
check('ROOF.MD covers the covering slope rules', rules.includes('r905.10.2') && rules.includes('r905.3.2'));
check('ROOF.MD covers insurance and warranty', rules.includes('actual cash value') && rules.includes('replacement cost value') && rules.includes('assignment of benefits'));
check('ROOF.MD covers safety', rules.includes('1926.501') && rules.includes('fall protection'));
const unmappedChecks = design.checks.filter((entry) => !rules.includes(entry.id));
check('ROOF.MD maps every suite check', unmappedChecks.length === 0, unmappedChecks.map((entry) => entry.id).join(', '));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
