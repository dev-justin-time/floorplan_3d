import { readFileSync } from 'node:fs';
import {
    WALL_COVERINGS,
    COVERING_COUNT,
    PAINT_SHEENS,
    PAINT_COLOURS,
    HARMONIES,
    SUBSTRATES,
    coveringById,
    coveringOptions,
    coveringsByFamily,
    sheenById,
    colourById,
    substrateById,
    finishPatchFor,
    buildColourScheme,
    lrvOf,
    shiftHue,
    shiftLightness,
    nearestColour
} from './features/wall/materials.js';
import {
    computeWallDesign,
    wallTakeoffCsv,
    takeoffRows,
    wallSummary,
    wallAreaFromPlan,
    WALL_DEFAULTS
} from './features/wall/design.js';
import {
    WALL_GLOSSARY,
    WALL_GLOSSARY_CATEGORIES,
    WALL_FORMULAS,
    wallGlossaryByCategory,
    wallGlossaryTerm,
    searchWallGlossary
} from './features/wall/glossary.js';
import { wallParts } from './features/wall/preview.js';

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

console.log('\nCovering catalogue');
check('at least thirty coverings are defined', COVERING_COUNT >= 30 && WALL_COVERINGS.length === COVERING_COUNT, `${COVERING_COUNT} coverings`);
check('covering ids are unique', new Set(WALL_COVERINGS.map((entry) => entry.id)).size === WALL_COVERINGS.length);
check('every covering has a label and a note', WALL_COVERINGS.every((entry) => entry.label.length > 4 && entry.note.length > 20));
check('every covering names its substrates', WALL_COVERINGS.every((entry) => Array.isArray(entry.substrates) && entry.substrates.length > 0));
check('every covering has components', WALL_COVERINGS.every((entry) => entry.components.length > 0));
check('every component has a coverage and a cost', WALL_COVERINGS.every((entry) => entry.components.every((component) => component.coveragePerPack > 0 && component.costPerPack >= 0)));
check('every covering prices labour and life', WALL_COVERINGS.every((entry) => entry.labourPerM2 > 0 && entry.lifeYears > 0 && entry.maintenanceYears > 0));
check('every covering declares a fire class', WALL_COVERINGS.every((entry) => ['A', 'B', 'C'].includes(entry.fireClass)));
check('every covering declares an exposure', WALL_COVERINGS.every((entry) => ['interior', 'exterior', 'both'].includes(entry.exposure)));
check('interior coverings are listed', coveringOptions({ exposure: 'interior' }).length >= 20, `${coveringOptions({ exposure: 'interior' }).length}`);
check('exterior coverings are listed', coveringOptions({ exposure: 'exterior' }).length >= 10, `${coveringOptions({ exposure: 'exterior' }).length}`);
check('families group without losing an entry', coveringsByFamily({ exposure: 'interior' }).reduce((sum, group) => sum + group.entries.length, 0) === coveringOptions({ exposure: 'interior' }).length);
check('unknown coverings fall back to the first', coveringById('nope').id === WALL_COVERINGS[0].id);
check('paint coverings carry a sheen and a colour', WALL_COVERINGS.filter((entry) => entry.family === 'paint').every((entry) => sheenById(entry.sheen).id === entry.sheen && colourById(entry.defaultColour)));
check('exterior paint is not approved over interior gypsum', !coveringById('paint-exterior-acrylic').substrates.includes('gypsum-new'));
check('tile includes a wet backer', coveringById('tile-ceramic').substrates.includes('gypsum-wet') && coveringById('tile-ceramic').substrates.includes('fiber-cement'));
check('stucco requires a WRB', coveringById('stucco-3coat').requiresWrb === true);
check('vinyl siding holds a 6 in grade clearance', coveringById('vinyl-siding').minGradeClearanceMm === 152);

console.log('\nPaint palette');
check('at least twenty colours are defined', PAINT_COLOURS.length >= 20, `${PAINT_COLOURS.length} colours`);
check('colour ids are unique', new Set(PAINT_COLOURS.map((entry) => entry.id)).size === PAINT_COLOURS.length);
check('every colour has a valid hex', PAINT_COLOURS.every((entry) => /^#[0-9A-F]{6}$/i.test(entry.hex)));
check('LRV runs from dark to light', lrvOf('#1E1E1E') < 10 && lrvOf('#FFFFFF') > 95, `${lrvOf('#1E1E1E')} / ${lrvOf('#FFFFFF')}`);
check('black is the darkest palette colour', PAINT_COLOURS.every((entry) => lrvOf(entry.hex) >= lrvOf('#1E1E1E')));
check('chalk white is the lightest palette colour', PAINT_COLOURS.every((entry) => lrvOf(entry.hex) <= lrvOf('#F7F5EF')));
check('sheens declare a working wet-area flag', PAINT_SHEENS.every((entry) => typeof entry.wetArea === 'boolean' && entry.bestFor.length > 5));
check('satin is a wet-area sheen and matte is not', sheenById('satin').wetArea && !sheenById('matte').wetArea);
check('four harmonies are defined', HARMONIES.length === 4 && HARMONIES.every((entry) => entry.note.length > 10));
const scheme = buildColourScheme('sage', 'complementary');
check('a scheme has wall, trim, accent and ceiling', Boolean(scheme.wall && scheme.trim && scheme.accent && scheme.ceiling));
check('trim reads against the wall', scheme.contrast.trim >= 25, `${scheme.contrast.trim.toFixed(1)} LRV`);
check('complementary accent leaves the wall hue', Math.abs(((scheme.accent.lrv - scheme.wall.lrv))) >= 0, scheme.accent.hex);
check('monochrome uses the base hue', buildColourScheme('sage', 'monochrome').accent.hex === '#A9B6A2' || buildColourScheme('sage', 'monochrome').accent.id === 'accent-monochrome');
check('hue shifting wraps through 360°', shiftHue('#FF0000', 180) !== '#FF0000', shiftHue('#FF0000', 180));
check('lightness shifting keeps a valid hex', /^#[0-9A-F]{6}$/i.test(shiftLightness('#A9B6A2', -0.2)));
check('nearest colour resolves a hex', nearestColour('#F7F5EF').id === 'chalk-white');
check('every substrate is grouped', SUBSTRATES.every((entry) => entry.group && entry.label));
check('substrate lookup falls back safely', substrateById('nope').id === SUBSTRATES[0].id);

console.log('\nDesign engine');
const design = computeWallDesign({});
check('default design computes', design.areas.net > 0 && design.costs.total > 0);
check('default covering is interior eggshell', design.covering.id === 'paint-eggshell');
check('gross wall area is length × height', near(design.areas.gross, 12 * 2.7, 1e-6), `${design.areas.gross} m²`);
check('openings are deducted', near(design.areas.net, design.areas.gross - design.areas.openings, 1e-6), `${design.areas.net} m²`);
check('waste follows the product', near(design.areas.waste, design.covering.waste, 1e-6));
check('net with waste is larger than net', design.areas.netWithWaste > design.areas.net);
check('paint litres follow area, coats and coverage', near(design.paint.litres, (design.areas.net * 1.05 * 2) / 11, 0.15), `${design.paint.litres} L`);
check('finish cans are rounded up', design.paint.cans === Math.ceil((design.areas.net * 1.05 * 2) / (11 * 3.78541)), `${design.paint.cans} cans`);
check('primer litres are measured', design.paint.primerLitres > 0, `${design.paint.primerLitres} L`);
check('primer is included by default', design.config.primer === true);
check('every row has a positive quantity and a cost', design.rows.every((row) => row.qty > 0 && row.cost >= 0));
check('material is the sum of the rows', near(design.costs.material, design.rows.reduce((sum, row) => sum + row.cost, 0), 0.02));
check('labour includes preparation', near(design.costs.labour, design.costs.install + design.costs.prep, 0.02));
check('total is material plus labour', near(design.costs.total, design.costs.material + design.costs.labour, 0.02));
check('cost per m² is derived', near(design.costs.perM2, design.costs.total / design.areas.net, 0.02));
check('preparation has hours and a cost', design.prep.length >= 2 && design.prep.every((task) => task.hours >= 0 && task.cost >= 0));
check('summary is a short list', wallSummary(design).length === 7);
check('summary names the covering and area', design.summary[1].includes(design.covering.label) && design.summary[0].includes('m²'));
check('every check has a known severity', design.checks.every((entry) => ['ok', 'info', 'warn', 'error'].includes(entry.severity)));
check('every check has an id and a label', design.checks.every((entry) => entry.id && entry.label.length > 3));
const fallbackExterior = computeWallDesign({ exposure: 'exterior' });
check('exterior exposure swaps to an exterior covering', fallbackExterior.covering.exposure !== 'interior', fallbackExterior.covering.id);
const fallbackInterior = computeWallDesign({ exposure: 'interior', covering: 'vinyl-siding' });
check('interior exposure swaps to an interior covering', fallbackInterior.covering.exposure !== 'exterior', fallbackInterior.covering.id);
check('areas can be supplied directly', near(computeWallDesign({ area: 50 }).areas.net, 50, 1e-6));
check('waste is clamped', computeWallDesign({ waste: 5 }).areas.waste <= 0.4);
check('coats are clamped', computeWallDesign({ coats: 12 }).areas.coats <= 5);
check('length and height are clamped', computeWallDesign({ length: 0, height: 0 }).areas.length > 0 && computeWallDesign({ height: 0 }).areas.height > 0);

console.log('\nCovering-specific takeoffs');
const tile = computeWallDesign({ covering: 'tile-ceramic', substrate: 'gypsum-wet', wetArea: true });
check('tile is counted in boxes', tile.rows.some((row) => row.item === 'Ceramic tile' && row.unit.startsWith('box')));
check('tile includes backer and thinset', tile.rows.some((row) => row.item === 'Backer board') && tile.rows.some((row) => row.item === 'Thinset'));
check('tile has no paint litres', tile.paint === null);
const stucco = computeWallDesign({ exposure: 'exterior', covering: 'stucco-3coat', substrate: 'wood-bare' });
check('stucco is counted in bags', stucco.rows.some((row) => row.item === 'Scratch coat' && row.unit.includes('bag')));
check('stucco includes lath and a WRB', stucco.rows.some((row) => row.item === 'Metal lath') && stucco.rows.some((row) => row.item === 'Water-resistive barrier'));
check('stucco includes a weep screed', stucco.rows.some((row) => row.item === 'Weep screed'));
const siding = computeWallDesign({ exposure: 'exterior', covering: 'fiber-cement-siding', substrate: 'wood-bare' });
check('siding is counted in squares', siding.rows.some((row) => row.unit.startsWith('square')));
check('siding includes corner trim', siding.rows.some((row) => row.item === 'Corner trim'));
const wallpaper = computeWallDesign({ covering: 'wallpaper-paper', substrate: 'gypsum-painted' });
check('wallpaper is counted in rolls', wallpaper.rows.some((row) => row.unit.includes('roll') && row.item === 'Wallpaper'));
check('packs are rounded up', wallpaper.rows.every((row) => Number.isInteger(row.qty)));
check('finishPatchFor maps a paint colour', finishPatchFor('paint-satin', 'sage').color === '#A9B6A2');
check('finishPatchFor maps a system colour', finishPatchFor('stucco-3coat').color === '#E6DFD2');
check('finishPatchFor falls back to null texture', finishPatchFor('vinyl-siding').texture === null);

console.log('\nChecks');
const ids = (result) => result.checks.map((entry) => entry.id);
const severity = (result, id) => result.checks.find((entry) => entry.id === id)?.severity;
check('a compatible substrate passes', severity(design, 'substrate') === 'ok');
const wrongSubstrate = computeWallDesign({ covering: 'vinyl-siding', exposure: 'exterior', substrate: 'gypsum-new' });
check('an incompatible substrate is an error', severity(wrongSubstrate, 'substrate') === 'error');
check('too few coats warns', severity(computeWallDesign({ coats: 1 }), 'coats') === 'warn');
check('a required primer left off is an error', severity(computeWallDesign({ covering: 'plaster-skim', substrate: 'gypsum-new', primer: false }), 'primer') === 'error');
check('a recommended primer left off warns', severity(computeWallDesign({ primer: false }), 'primer') === 'warn');
const wetMatte = computeWallDesign({ covering: 'paint-matte', wetArea: true });
check('matte paint in a wet area is an error', severity(wetMatte, 'sheen-wet') === 'error');
check('paper wallpaper in a wet area is an error', severity(computeWallDesign({ covering: 'wallpaper-paper', substrate: 'gypsum-painted', wetArea: true }), 'wet-area') === 'error');
check('vinyl wallpaper passes a wet area', severity(computeWallDesign({ covering: 'wallpaper-vinyl', substrate: 'gypsum-painted', wetArea: true }), 'wet-area') !== 'error');
const vapour = computeWallDesign({ covering: 'wallpaper-vinyl', substrate: 'gypsum-painted', climateZone: 6 });
check('a Class I finish in a cold zone warns', severity(vapour, 'vapour') === 'warn');
check('a Class III finish in a cold zone is informational', ['info', 'ok'].includes(severity(computeWallDesign({ climateZone: 6 }), 'vapour')));
check('Class B paper in a 1-hour wall warns', severity(computeWallDesign({ covering: 'wallpaper-paper', substrate: 'gypsum-painted', fireRating: '1-hour' }), 'fire') === 'warn');
check('Class A paint passes a 1-hour wall', severity(computeWallDesign({ fireRating: '1-hour' }), 'fire') === 'ok');
check('high VOC warns', severity(computeWallDesign({ covering: 'paint-gloss' }), 'voc') === 'warn');
check('a new concrete pour younger than 28 days warns', severity(computeWallDesign({ covering: 'paint-masonry-exterior', exposure: 'exterior', substrate: 'concrete-new', condition: 'new', ageDays: 7 }), 'cure') === 'warn');
check('damp wood is an error', severity(computeWallDesign({ covering: 'wood-cladding', exposure: 'exterior', substrate: 'wood-bare', moisturePercent: 24 }), 'moisture') === 'error');
check('cold application is an error', severity(computeWallDesign({ temperatureC: 2 }), 'temperature') === 'error');
check('hot application warns', severity(computeWallDesign({ temperatureC: 39 }), 'temperature') === 'warn');
check('pre-1978 paint disturbance warns', severity(computeWallDesign({ buildingYear: 1960, condition: 'repaint' }), 'lead') === 'warn');
check('pre-1980 plaster is informational', severity(computeWallDesign({ buildingYear: 1975, condition: 'repaint', substrate: 'plaster-painted' }), 'asbestos') === 'info');
check('tile over drywall in a wet area is an error', severity(computeWallDesign({ covering: 'tile-ceramic', substrate: 'gypsum-new', wetArea: true }), 'tile-backer') === 'error');
check('tile on a flexible wall warns', severity(computeWallDesign({ covering: 'tile-ceramic', substrate: 'fiber-cement', deflection: 240 }), 'tile-deflection') === 'warn');
check('papering over paper warns', severity(computeWallDesign({ covering: 'wallpaper-paper', substrate: 'gypsum-painted', condition: 'wallpaper' }), 'wallpaper-strip') === 'warn');
check('siding without acclimation is informational', severity(computeWallDesign({ covering: 'fiber-cement-siding', exposure: 'exterior', substrate: 'wood-bare', acclimated: false }), 'acclimation') === 'info');
check('missing WRB is an error', severity(computeWallDesign({ exposure: 'exterior', covering: 'stucco-3coat', substrate: 'wood-bare', wrb: false }), 'wrb') === 'error');
check('missing drainage warns', severity(computeWallDesign({ exposure: 'exterior', covering: 'stucco-3coat', substrate: 'wood-bare', rainScreen: false }), 'drainage') === 'warn');
check('grade clearance below 6 in is an error', severity(computeWallDesign({ exposure: 'exterior', covering: 'vinyl-siding', substrate: 'wood-bare', gradeClearanceMm: 75 }), 'grade') === 'error');
check('missing flashing warns', severity(computeWallDesign({ exposure: 'exterior', covering: 'stucco-3coat', substrate: 'wood-bare', flashing: false }), 'flashing') === 'warn');
check('vinyl in high wind warns', severity(computeWallDesign({ exposure: 'exterior', covering: 'vinyl-siding', substrate: 'wood-bare', windMph: 130 }), 'wind') === 'warn');
check('rain during the window warns', severity(computeWallDesign({ exposure: 'exterior', covering: 'stucco-3coat', substrate: 'wood-bare', rainExpected: true }), 'rain') === 'warn');
check('a dark exterior colour is informational', severity(computeWallDesign({ exposure: 'exterior', covering: 'paint-exterior-acrylic', substrate: 'wood-primed', colour: 'black' }), 'dark-colour') === 'info');
check('a low trim contrast is informational', severity(computeWallDesign({ colour: 'chalk-white' }), 'trim-contrast') === 'info');
check('a strong trim contrast is ok', severity(computeWallDesign({ colour: 'sage' }), 'trim-contrast') === 'ok');
check('every check is unique by id', new Set(ids(design)).size === ids(design).length);
check('the design reports no errors by default', design.checks.filter((entry) => entry.severity === 'error').length === 0);

console.log('\nPlan area and CSV');
const area = wallAreaFromPlan([
    { start: { x: 0, y: 0 }, end: { x: 300, y: 0 } },
    { start: { x: 300, y: 0 }, end: { x: 300, y: 300 } }
], { wallHeight: 2.7, openings: [{ width: 1, height: 1 }] });
check('wall runs are measured in metres', near(area.length, 20, 1e-6), `${area.length} m`);
check('gross area uses the storey height', near(area.gross, 54, 1e-6), `${area.gross} m²`);
check('openings are deducted from the plan area', near(area.net, 53, 1e-6), `${area.net} m²`);
check('a per-wall height overrides the storey', near(wallAreaFromPlan([{ start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, height: 3 }], { wallHeight: 2.7 }).gross, 30, 1e-6));
check('an empty plan is zero', wallAreaFromPlan([]).net === 0);
const rows = takeoffRows(design);
check('takeoff rows are the cost rows', rows.length === design.rows.length);
check('rows are grouped', new Set(rows.map((row) => row.group)).size >= 3);
const csv = wallTakeoffCsv(design);
const lines = csv.split('\n');
check('CSV has a header', lines[0] === '"group","item","qty","unit","cost"');
check('CSV lists every row', lines.length === rows.length + 8, `${lines.length} lines`);
check('CSV carries a total', csv.includes('"Summary","Total"'));
check('CSV labels the covering', csv.includes(design.covering.label.replace(/"/g, '""')));
check('CSV quotes commas', wallTakeoffCsv(computeWallDesign({ covering: 'tile-ceramic' })).includes('"box (1.2 m²)"'));

console.log('\nPreview geometry');
const parts = wallParts(design);
check('a painted wall has a baseboard and crown', parts.baseboard > 0 && parts.crown > 0);
check('a tiled wall omits the timber trim', wallParts(tile).baseboard === 0 && wallParts(tile).crown === 0);
check('the window sits between floor and ceiling', parts.window.sill > 0 && parts.window.sill + parts.window.height < design.config.height);
check('the window width is capped', parts.window.width <= 1.2);

console.log('\nGlossary and formulas');
check('every glossary category exists', wallGlossaryByCategory().length === WALL_GLOSSARY_CATEGORIES.length);
check('every category has terms', wallGlossaryByCategory().every((group) => group.terms.length >= 3));
check('glossary is substantial', WALL_GLOSSARY.length >= 60, `${WALL_GLOSSARY.length} terms`);
check('every term defines itself', WALL_GLOSSARY.every((entry) => entry.term && entry.definition.length > 20));
const wanted = ['Paint', 'Primer', 'Sheen', 'LRV', 'VOC', 'Coverage rate', 'Orange peel', 'Skim coat', 'Venetian plaster', 'Stucco', 'EIFS', 'Wallpaper', 'Wainscot', 'Beadboard', 'Shiplap', 'Board and batten', 'Ceramic tile', 'Porcelain', 'Backer board', 'Brick veneer', 'Stone veneer', 'Water-resistive barrier', 'Rainscreen', 'Flashing', 'Grade clearance', 'Vinyl siding', 'Vapour retarder', 'Fire rating', 'Lead-safe', 'Asbestos', 'Fall protection'];
const missing = wanted.filter((term) => !wallGlossaryTerm(term));
check('every requested term is present', missing.length === 0, missing.join(', '));
check('aliases resolve', wallGlossaryTerm('house wrap')?.term === 'Water-resistive barrier' && wallGlossaryTerm('vapor barrier')?.term === 'Vapour retarder');
check('search matches a definition', searchWallGlossary('cracks').length > 0 && searchWallGlossary('cracks').some((entry) => entry.term === 'Elastomeric'));
check('empty search returns everything', searchWallGlossary('').length === WALL_GLOSSARY.length);
check('formulas are listed', WALL_FORMULAS.length >= 10 && WALL_FORMULAS.every((entry) => entry.label && entry.formula && entry.note));

console.log('\nPage wiring');
const page = readFileSync(new URL('./wall-designer.html', import.meta.url), 'utf8');
const editor = readFileSync(new URL('./Editor.html', import.meta.url), 'utf8');
const editorJs = readFileSync(new URL('./editor.js', import.meta.url), 'utf8');
check('the designer page exists', page.length > 12000, `${page.length} bytes`);
check('the page imports the wall kit', page.includes("from './features/wall/design.js'") && page.includes("from './features/wall/materials.js'"));
check('the page draws the elevation and 3D', page.includes('drawWallElevation') && page.includes('createWallViewer'));
check('the page exposes a test handle', page.includes('window.wallSuite'));
check('the page has interior and exterior modes', page.includes('id="exposure-interior"') && page.includes('id="exposure-exterior"'));
check('the page offers colours and harmonies', page.includes('id="colour-grid"') && page.includes('id="harmony"'));
check('the page lists every check', page.includes('id="checks"'));
check('the editor has a covering select', editor.includes('id="wall-covering-select"'));
check('the editor imports the wall kit', editorJs.includes("from './features/wall/index.js'"));
check('the editor applies and prices coverings', editorJs.includes('function applyWallCovering') && editorJs.includes('function wallCoveringDesign'));
check('the editor consumes the designer draft', editorJs.includes("localStorage.getItem('wall-editor-draft')"));
check('the editor exposes the wall handle', editorJs.includes('window.wallKit'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
