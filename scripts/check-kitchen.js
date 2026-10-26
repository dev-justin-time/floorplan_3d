import { KITCHEN_DEFAULTS, KITCHEN_GAPS, KITCHEN_MODULES } from '../features/kitchen/catalog.js';
import { formatGap, gapRows, layoutKitchenRun, runSummary } from '../features/kitchen/engine.js';
import { KITCHEN_RULES, ruleStatus, rulesByCategory } from '../features/kitchen/rules.js';

let passed = 0;
const failures = [];
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
function check(name, condition, detail = '') {
    if (condition) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

console.log('Run layout');
const design = layoutKitchenRun(KITCHEN_DEFAULTS);
check('the default run lays out every module', design.modules.length === KITCHEN_DEFAULTS.modules.length, `${design.modules.length}`);
check('the run fills the measured wall',
    near(design.totals.used, design.length, 0.002),
    `${design.totals.used.toFixed(3)} / ${design.length} m`);
check('the gap widths plus the cabinets equal the wall',
    near(design.gaps.reduce((sum, gap) => sum + gap.width, 0) + design.totals.cabinetWidth, design.length, 0.002));
check('fillers close both ends', design.fillers.length === 2, JSON.stringify(design.fillers));
check('the default run has no errors',
    design.checks.every((entry) => entry.severity !== 'error'),
    design.checks.filter((entry) => entry.severity === 'error').map((entry) => entry.id).join(',') || 'none');
check('the default run scores full marks', design.score === 100, String(design.score));
check('the refrigerator keeps its air gap', design.gaps.some((gap) => gap.kind === 'clearance' && gap.width >= 0.025));
check('the sink keeps its landing counter',
    design.gaps.some((gap) => gap.id === 'between-1' || gap.id === 'between-2') && !design.checks.some((entry) => entry.id === 'landing-sink'));
check('module centres follow the gap positions',
    near(design.modules[1].start, design.modules[0].end + (design.gaps.find((gap) => gap.id === 'between-1')?.width || 0), 0.002));

console.log('\nGap failures');
const overflow = layoutKitchenRun({ ...KITCHEN_DEFAULTS, runLength: 2 });
check('a run longer than the wall is an error', overflow.checks.some((entry) => entry.id === 'run-overflow' && entry.severity === 'error'));
check('an overflowing run reports the shortfall', overflow.totals.overflow > 0, `${overflow.totals.overflow} m`);

const wide = layoutKitchenRun({ ...KITCHEN_DEFAULTS, runLength: 6.4 });
check('a wide wall gap warns about filler width', wide.checks.some((entry) => entry.id === 'wide-filler'));
check('the wide filler is still dimensioned', wide.gaps.some((gap) => gap.kind === 'wall' && gap.width > KITCHEN_GAPS.fillerMax));

const tight = layoutKitchenRun({ runLength: 1.69, aisle: 1.2, modules: ['fridge-36', 'base-30'] });
check('a refrigerator tight to the wall warns about end clearance',
    tight.checks.some((entry) => entry.id === 'end-clearance-left' || entry.id === 'end-clearance-right'),
    JSON.stringify(tight.checks.map((entry) => entry.id)));

const noLanding = layoutKitchenRun({ runLength: 2.6, aisle: 1.2, modules: ['range-30', 'fridge-36'] });
check('a range with no counter on either side is an error', noLanding.checks.some((entry) => entry.id === 'landing-range' && entry.severity === 'error'));

const oneSided = layoutKitchenRun({ runLength: 2.4, aisle: 1.2, modules: ['range-30', 'base-24', 'fridge-36'] });
check('a range with counter on one side only warns', oneSided.checks.some((entry) => entry.id === 'landing-range-one-side'));

const narrow = layoutKitchenRun({ ...KITCHEN_DEFAULTS, aisle: 0.9 });
check('an aisle under 42 in is an error', narrow.checks.some((entry) => entry.id === 'aisle' && entry.severity === 'error'));

const empty = layoutKitchenRun({ modules: [] });
check('an empty run is reported', empty.checks.some((entry) => entry.id === 'empty-run') && empty.modules.length === 0);

console.log('\nGap table and rules');
const rows = gapRows(design);
check('every layout gap is listed', rows.length === design.gaps.length && rows.length >= KITCHEN_DEFAULTS.modules.length - 1);
check('the table labels fillers in millimetres', rows.some((row) => row.kind === 'wall' && /mm$/.test(row.widthLabel)));
check('formatGap rounds to millimetres', formatGap(0.0127) === '13 mm', formatGap(0.0127));
check('the summary reports cabinets and gaps', runSummary(design).length === 4);

const groups = rulesByCategory();
check('rules group without losing one', groups.reduce((sum, group) => sum + group.rules.length, 0) === KITCHEN_RULES.length);
check('a clean run passes the aisle rule', ruleStatus(KITCHEN_RULES.find((rule) => rule.id === 'aisle'), design.checks).state === 'ok');
check('a narrow run fails the aisle rule', ruleStatus(KITCHEN_RULES.find((rule) => rule.id === 'aisle'), narrow.checks).state === 'error');

check('the catalogue has unique module ids', new Set(KITCHEN_MODULES.map((module) => module.id)).size === KITCHEN_MODULES.length);
check('every module has a positive width', KITCHEN_MODULES.every((module) => module.width > 0));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
    failures.forEach((failure) => console.log(` - ${failure}`));
    process.exitCode = 1;
}
