import { readFileSync } from 'node:fs';
import {
    FIXTURE_TYPES,
    FIXTURE_COUNT,
    HEATER_TYPES,
    HEATER_COUNT,
    WATER_PIPE_SIZES,
    DWV_SIZES,
    GAS_SIZES,
    WATER_MATERIALS,
    DWV_MATERIALS,
    GAS_MATERIALS,
    FINISH_GRADES,
    FAUCET_FINISHES,
    PLAN_TEMPLATES,
    fixtureById,
    heaterById,
    templateById,
    finishGradeById,
    faucetFinishById
} from '../features/plumbing/catalog.js';
import {
    createPlan,
    normalizePlan,
    applyTemplate,
    autoLayout,
    addFixture,
    removeFixture,
    moveFixture,
    moveHeater,
    setHookup,
    fixtureAt,
    heaterAt,
    hookupAt,
    positionFor,
    heaterPosition,
    hookupPoint,
    zonesFor,
    rotationForWall,
    nearestWall,
    drainFixtures,
    gasFixtures,
    waterFixtures,
    planSummary,
    PLAN_TEMPLATE_LIST
} from '../features/plumbing/plan.js';
import {
    designPlumbing,
    orthogonalRoute,
    buildTree,
    pathTo,
    demandForWsfu,
    velocityFps,
    frictionPsi,
    waterSizeForWsfu,
    dwvSizeFor,
    gasCapacity,
    gasSizeForLoad,
    gasCfh,
    scheduleCsv,
    takeoffCsv,
    designSummaryText,
    GLOSSARY,
    glossaryByCategory
} from '../features/plumbing/engine.js';
import {
    RULES,
    RULE_CATEGORIES,
    RULE_LEVEL_LABEL,
    CODE_SCOPE,
    ruleStatus,
    rulesByCategory,
    searchRules,
    rulesForCheck
} from '../features/plumbing/rules.js';

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
const ids = (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length;
const designFor = (template = 'house') => designPlumbing(createPlan({ template }));

console.log('\nCatalogue');
check('there are at least sixteen fixtures', FIXTURE_TYPES.length >= 16 && FIXTURE_COUNT === FIXTURE_TYPES.length, `${FIXTURE_COUNT}`);
check('fixture ids are unique', ids(FIXTURE_TYPES));
check('every fixture has dimensions, cost and labour', FIXTURE_TYPES.every((entry) => entry.width > 0 && entry.depth > 0 && entry.roughCost > 0 && entry.labourRough > 0));
check('every water fixture has supply and drain data', FIXTURE_TYPES.filter((entry) => entry.requiresWater).every((entry) => entry.supplySize && entry.wsfuCold + entry.wsfuHot > 0));
check('every drain fixture has DFU and a drain size', FIXTURE_TYPES.filter((entry) => entry.requiresDrain).every((entry) => entry.dfu > 0 && entry.drainSize));
check('every gas appliance has input and a connection size', FIXTURE_TYPES.filter((entry) => entry.gasBtu > 0).every((entry) => entry.gasBtu > 0 && entry.gasConnection));
check('water heaters are unique and have a fuel and cost', HEATER_COUNT === HEATER_TYPES.length && HEATER_TYPES.every((entry) => entry.fuel && entry.cost > 0));
check('pipe sizes are ordered and unique', ids(WATER_PIPE_SIZES) && ids(DWV_SIZES) && ids(GAS_SIZES));
check('every water size has a PEX and copper internal diameter', WATER_PIPE_SIZES.every((entry) => entry.pexId > 0 && entry.copperId > 0));
check('every DWV size has branch, stack and main capacity', DWV_SIZES.every((entry) => entry.branchDfu > 0 && entry.stackDfu > 0 && entry.mainDfu > 0));
check('every gas size has a 10 ft capacity', GAS_SIZES.every((entry) => entry.capacity10 > 0));
check('materials have cost and fitting factors', [...WATER_MATERIALS, ...DWV_MATERIALS, ...GAS_MATERIALS].every((entry) => entry.factor > 0 && entry.fittingFactor > 0));
check('finish grades and faucet finishes are priced', FINISH_GRADES.length === 3 && FAUCET_FINISHES.length >= 4 && FAUCET_FINISHES.every((entry) => entry.cost >= 0));
check('unknown ids fall back safely', fixtureById('nope').id === FIXTURE_TYPES[0].id && heaterById('nope').id === HEATER_TYPES[1].id && templateById('nope').id === PLAN_TEMPLATES[0].id);
check('four plan templates are defined', PLAN_TEMPLATES.length === 4 && PLAN_TEMPLATE_LIST.length === 4);

console.log('\nPlan model');
const house = createPlan({ template: 'house' });
check('the whole-house template has eleven fixtures', house.fixtures.length === 11, `${house.fixtures.length}`);
check('the template includes a gas water heater', house.waterHeater?.typeId === 'tank-50-gas');
check('fixture ids are stable and unique', ids(house.fixtures) && house.fixtures.every((entry) => entry.id));
check('every fixture starts inside the plan', house.fixtures.every((entry) => {
    const type = fixtureById(entry.typeId);
    const centre = positionFor(house, entry, type);
    return centre.x >= 0 && centre.x <= house.width && centre.y >= 0 && centre.y <= house.depth;
}));
check('water is on the west wall and sewer on the east', house.water.side === 'west' && house.sewer.side === 'east');
check('the water hookup lies on its wall', near(hookupPoint(house, 'water').x, 0));
check('the sewer hookup lies on its wall', near(hookupPoint(house, 'sewer').x, house.width));
check('the gas hookup lies on the north wall', near(hookupPoint(house, 'gas').y, 0));
check('nearest wall names the side', nearestWall(house, 0.1, 3).wall === 'west' && nearestWall(house, house.width - 0.1, 3).wall === 'east');
check('wall rotations keep the fixture back on the wall', rotationForWall('north') === 0 && near(rotationForWall('south'), Math.PI) && rotationForWall('west') < 0);
check('zones fit inside the room', zonesFor(house.width, house.depth).every((zone) => zone.x >= 0 && zone.y >= 0 && zone.x + zone.width <= house.width + 0.01 && zone.y + zone.height <= house.depth + 0.01));
check('fixture hit testing finds the toilet', fixtureAt(house, positionFor(house, house.fixtures[0]).x, positionFor(house, house.fixtures[0]).y)?.id === house.fixtures[0].id);
check('heater hit testing finds the water heater', heaterAt(house, heaterPosition(house, house.waterHeater).x, heaterPosition(house, house.waterHeater).y)?.id === house.waterHeater.id);
check('hookup hit testing finds the water entry', hookupAt(house, hookupPoint(house, 'water').x, hookupPoint(house, 'water').y) === 'water');
check('a plan summary counts every kind', planSummary(house).fixtures === 11 && planSummary(house).drains === 7 && planSummary(house).gas === 4);

const moved = createPlan({ template: 'house' });
const toilet = moved.fixtures.find((entry) => entry.typeId === 'toilet');
moveFixture(moved, toilet.id, 0.05, moved.depth - 0.05);
check('a dragged fixture snaps to a wall', toilet.wall === 'south' || toilet.wall === 'west');
const added = addFixture(moved, 'bidet', moved.width - 0.1, 2.0);
check('adding a fixture gives it an id and a wall', added.id && ['east', 'north', 'south'].includes(added.wall));
check('remove takes the fixture out', removeFixture(moved, added.id)?.id === added.id && !moved.fixtures.some((entry) => entry.id === added.id));
const hook = setHookup(moved, 'gas', 'east', 2.2);
check('set hookup moves the gas entry', hook.side === 'east' && near(hook.along, 2.2));
check('set hookup clamps past the wall', setHookup(moved, 'gas', 'east', 99).along <= moved.depth);
const normal = normalizePlan({ width: 900, depth: -2, fixtures: [] });
check('normalize clamps a broken size', normal.width <= 40 && normal.depth >= 3);
check('normalize keeps an intentionally empty fixture set', normal.fixtures.length === 0);

const bath = applyTemplate(house, 'bath');
check('apply template swaps the fixture set', bath.template === 'bath' && bath.fixtures.length === 3);
check('apply template keeps the plan id', bath.id === house.id);

console.log('\nWater model');
const water = designFor('house').water;
check('the whole house demand is positive', water.demandGpm > 0 && water.totalWsfu > 0, `${water.demandGpm} gpm / ${water.totalWsfu} WSFU`);
check('the service size is one of the catalogue sizes', WATER_PIPE_SIZES.some((entry) => entry.id === water.serviceSize));
check('the service velocity is below 8 ft/s', water.serviceVelocity <= 8, `${water.serviceVelocity}`);
check('the residual pressure is at least 8 psi', water.residual >= 8, `${water.residual}`);
check('every water fixture has a pressure reading', water.readings.length >= water.coldFixtures.length);
check('cold and hot trees are built', water.coldTree && water.hotTree);
check('water routes have positive lengths', water.routes.length > 0 && water.routes.every((route) => route.length >= 0));
check('the hot tree is smaller than the cold tree', water.hotLength < water.coldLength);
check('a 20 WSFU service is 1 in', waterSizeForWsfu(20, { service: true }) === '1');
check('demand rises with fixture units', demandForWsfu(30) > demandForWsfu(10));
check('velocity rises with flow', velocityFps(10, 0.785) > velocityFps(5, 0.785));
check('friction rises with length', frictionPsi(10, 0.785, 20) > frictionPsi(10, 0.785, 10));
check('a longer run has more friction', frictionPsi(10, 0.785, 30) > frictionPsi(10, 0.785, 15));

console.log('\nDrainage model');
const drain = designFor('house').drain;
check('the drain counts every fixture unit', drain.totalDfu === 14, `${drain.totalDfu}`);
check('the building drain is 3 in for 14 DFU', drain.mainSize === '3');
check('the default slope is 2%', near(drain.slope, 0.02));
check('the required invert is below the floor', drain.requiredInvert < 0, `${drain.requiredInvert}`);
check('the default invert gives gravity fall', designFor('house').plan.sewer.invert <= drain.requiredInvert);
check('each drain group gets a stack', drain.stacks.length === 4, `${drain.stacks.length}`);
check('stacks carry their group DFU', drain.stacks.every((stack) => stack.dfu > 0 && stack.branchSize && stack.size && stack.ventSize));
check('every trap arm is measured', drain.trapArms.length === 7);
check('trap arms start within limits', drain.trapArms.every((arm) => arm.ok));
check('flow routes are present', drain.routes.length > 8 && drain.routes.some((route) => route.id === 'building_drain'));
check('a 25 DFU building drain is 3 in', dwvSizeFor(25, 'main') === '3');
check('a 4 in building drain carries 160 DFU', dwvSizeFor(160, 'main') === '4');

console.log('\nGas model');
const gas = designFor('house').gas;
check('gas is in use for the whole-house plan', gas.usesGas && gas.applianceCount === 4, `${gas.applianceCount}`);
check('gas BTU is the sum of the appliances', gas.totalBtu === 65000 + 22000 + 100000 + 50000, `${gas.totalBtu}`);
check('gas CFH uses the natural-gas heating value', near(gas.totalCfh, gas.totalBtu / 1030, 0.02), `${gas.totalCfh}`);
check('the gas main is sized for the load', gas.capacity >= gas.totalCfh, `${gas.mainSize} / ${gas.capacity} CFH`);
check('the gas meter carries the load', gas.totalCfh <= gas.meterCapacity);
check('the gas tree has one edge per appliance', gas.edges.length === gas.applianceCount);
check('gas capacities fall with length', gasCapacity('3/4', 30) < gasCapacity('3/4', 10));
check('a small load uses a small pipe', gasSizeForLoad(50, 10) === '1/2');
check('propane converts to fewer cubic feet', gasCfh(103000, 'propane') < gasCfh(103000, 'natural'));

console.log('\nDesign, checks and takeoff');
const houseDesign = designFor('house');
check('a normal whole-house plan has no errors', houseDesign.errors.length === 0, houseDesign.errors.map((entry) => entry.id).join(',') || 'none');
check('a normal whole-house plan has no warnings', houseDesign.warnings.length === 0, houseDesign.warnings.map((entry) => entry.id).join(',') || 'none');
check('every template is error-free', PLAN_TEMPLATES.every((template) => designPlumbing(createPlan({ template: template.id })).errors.length === 0));
check('checks include pass states for rules', houseDesign.ok.length >= 25, `${houseDesign.ok.length}`);
check('the schedule has one row per fixture', houseDesign.schedule.length === houseDesign.fixtures.length);
check('schedule tags are unique', new Set(houseDesign.schedule.map((entry) => entry.tag)).size === houseDesign.schedule.length);
check('the schedule reports WSFU and DFU', houseDesign.schedule.every((entry) => entry.coldWsfu >= 0 && entry.dfu >= 0));
check('the schedule reports a pressure for water fixtures', houseDesign.schedule.filter((entry) => entry.coldWsfu + entry.hotWsfu > 0).every((entry) => entry.pressure !== null));
check('the takeoff has rough and finish rows', houseDesign.takeoff.rough.rows.length > 15 && houseDesign.takeoff.finish.rows.length > 10);
check('rough and finish totals are separate and positive', houseDesign.takeoff.rough.total > 0 && houseDesign.takeoff.finish.total > 0 && houseDesign.takeoff.total === houseDesign.takeoff.rough.total + houseDesign.takeoff.finish.total);
check('materials plus labour equals each part', near(houseDesign.takeoff.rough.materials + houseDesign.takeoff.rough.labour, houseDesign.takeoff.rough.total, 0.05) && near(houseDesign.takeoff.finish.materials + houseDesign.takeoff.finish.labour, houseDesign.takeoff.finish.total, 0.05));
check('the rough takeoff includes hookups, water, DWV, gas and equipment', ['Hookups', 'Water piping', 'DWV piping', 'Fuel gas', 'Equipment', 'Labour'].every((group) => houseDesign.takeoff.rough.groups.some((entry) => entry.group === group)));
check('the finish takeoff includes fixtures, trim and labour', ['Fixtures', 'Faucets & trim', 'Labour'].every((group) => houseDesign.takeoff.finish.groups.some((entry) => entry.group === group)));
check('the summary text names the split', designSummaryText(houseDesign).includes('rough') && designSummaryText(houseDesign).includes('finish'));
check('the schedule CSV has a header and every fixture', scheduleCsv(houseDesign).split('\n').length === houseDesign.fixtures.length + 1);
check('the rough CSV has a total row', takeoffCsv(houseDesign, 'rough').includes('TOTAL'));
check('the finish CSV has a total row', takeoffCsv(houseDesign, 'finish').includes('TOTAL'));

console.log('\nChecks that should fail');
const badSewer = createPlan({ template: 'house' });
badSewer.sewer.invert = 0;
check('a shallow sewer invert is an error', designPlumbing(badSewer).errors.some((entry) => entry.id === 'sewer-invert'));

const badSlope = createPlan({ template: 'house' });
badSlope.sewer.slope = 0.005;
check('a slope below minimum is an error', designPlumbing(badSlope).errors.some((entry) => entry.id === 'sewer-slope'));

const smallSewer = createPlan({ template: 'house' });
smallSewer.sewer.size = '1-1/2';
check('a sewer smaller than the drain is an error', designPlumbing(smallSewer).errors.some((entry) => entry.id === 'sewer-size'));

const smallGas = createPlan({ template: 'house' });
smallGas.gas.meterCapacity = 100;
check('an undersized gas meter is an error', designPlumbing(smallGas).errors.some((entry) => entry.id === 'gas-meter'));

const noSediment = createPlan({ template: 'house' });
noSediment.gas.sedimentTraps = false;
check('missing sediment traps are an error', designPlumbing(noSediment).errors.some((entry) => entry.id === 'gas-sediment-trap'));

const noHeater = createPlan({ template: 'house' });
noHeater.waterHeater = null;
check('a house without a water heater is an error', designPlumbing(noHeater).errors.some((entry) => entry.id === 'water-heater-missing'));

const highPressure = createPlan({ template: 'house' });
highPressure.water.pressure = 100;
check('high static pressure warns for a PRV', designPlumbing(highPressure).warnings.some((entry) => entry.id === 'water-pressure-high'));

const lowPressure = createPlan({ template: 'house' });
lowPressure.water.pressure = 20;
lowPressure.water.mainLength = 100;
check('low residual pressure is an error', designPlumbing(lowPressure).errors.some((entry) => entry.id === 'water-pressure-low'));

const badHeater = createPlan({ template: 'house' });
badHeater.waterHeater.pan = false;
badHeater.waterHeater.temperature = 150;
check('a missing tank pan warns', designPlumbing(badHeater).warnings.some((entry) => entry.id === 'water-heater-pan'));
check('stored water above 120 F warns', designPlumbing(badHeater).warnings.some((entry) => entry.id === 'water-heater-temp'));

const noAirGap = createPlan({ template: 'house' });
noAirGap.finish.airGap = false;
check('a dishwasher without an air gap warns', designPlumbing(noAirGap).warnings.some((entry) => entry.id === 'dishwasher-airgap'));

const badBib = createPlan({ template: 'house' });
badBib.fixtures.find((entry) => entry.typeId === 'hose-bib').vacuumBreaker = false;
check('a hose bib without a vacuum breaker warns', designPlumbing(badBib).warnings.some((entry) => entry.id === 'backflow'));

const overlap = createPlan({ template: 'house' });
const toiletCopy = JSON.parse(JSON.stringify(overlap.fixtures.find((entry) => entry.typeId === 'toilet')));
toiletCopy.id = 'toilet_copy';
overlap.fixtures.push(toiletCopy);
check('two fixtures in the same place are an error', designPlumbing(overlap).errors.some((entry) => entry.id === 'fixture-overlap'));

const longTrap = createPlan({ template: 'house' });
longTrap.fixtures.find((entry) => entry.typeId === 'kitchen-sink').along = 1.0;
check('a long trap arm is an error', designPlumbing(longTrap).errors.some((entry) => entry.id === 'trap-arm'));

const badClearance = createPlan({ template: 'house' });
badClearance.fixtures.find((entry) => entry.typeId === 'toilet').along = 0.1;
check('a toilet against a side wall warns', designPlumbing(badClearance).warnings.some((entry) => entry.id === 'fixture-clearance'));

console.log('\nRules and documentation');
const ruleCheckIds = new Set(houseDesign.checks.map((entry) => entry.id));
check('rules have at least twenty-four entries', RULES.length >= 24, `${RULES.length}`);
check('rule ids are unique', new Set(RULES.map((entry) => entry.id)).size === RULES.length);
check('every category has at least one rule', RULE_CATEGORIES.every((category) => RULES.some((rule) => rule.category === category.id)));
check('every rule has a code citation and requirements', RULES.every((rule) => rule.code.length > 5 && rule.requirements.length > 0 && rule.detail.length > 20));
check('every rule check id is emitted by the engine', RULES.every((rule) => (rule.checkIds || []).every((id) => ruleCheckIds.has(id))), [...new Set(RULES.flatMap((rule) => rule.checkIds || []).filter((id) => !ruleCheckIds.has(id)))].join(',') || 'none');
check('the rules group without losing one', rulesByCategory().reduce((sum, group) => sum + group.rules.length, 0) === RULES.length);
check('search finds the backflow rule', searchRules('backflow').some((rule) => rule.id === 'backflow'));
check('search is case-insensitive', searchRules('GAS PIPE').length > 0);
check('an empty search returns every rule', searchRules('').length === RULES.length);
check('a passing check marks a rule pass', ruleStatus(RULES.find((rule) => rule.id === 'trap-arm'), [{ id: 'trap-arm', severity: 'ok' }]).state === 'ok');
check('a failed check marks a rule error', ruleStatus(RULES.find((rule) => rule.id === 'trap-arm'), [{ id: 'trap-arm', severity: 'error' }]).state === 'error');
check('a rule without a check is information', ruleStatus(RULES.find((rule) => rule.checkIds.length === 0)).state === 'info');
check('rules can be found from a check id', rulesForCheck('gas-meter').some((rule) => rule.id === 'gas-sizing'));
check('the code scope names IPC, IRC and IFGC', CODE_SCOPE.title.includes('IPC') && CODE_SCOPE.title.includes('IRC') && CODE_SCOPE.title.includes('IFGC'));
check('the glossary has at least twenty terms', GLOSSARY.length >= 20, `${GLOSSARY.length}`);
check('glossary terms are unique', new Set(GLOSSARY.map((entry) => entry.term)).size === GLOSSARY.length);
check('glossary groups cover every term', glossaryByCategory().reduce((sum, group) => sum + group.entries.length, 0) === GLOSSARY.length);

const doc = readFileSync(new URL('../docs/PLUMBING.MD', import.meta.url), 'utf8');
check('the rules document exists and cites the IPC water section', doc.includes('IPC 2021 §604.3') && doc.includes('Appendix E'));
check('the document covers slope, trap arms, gas and water heaters', doc.includes('704.1') && doc.includes('1002.2') && doc.includes('IFGC 2021 §402.4') && doc.includes('504.4'));
check('the document explains the two-part scope', doc.includes('Part 1') && doc.includes('Part 2'));
check('the document explains the hookup research steps', doc.includes('Research steps') && doc.includes('invert'));
check('the document carries the design-aid disclaimer', doc.includes('not a permit drawing'));
check('the document has an inspection checklist', doc.includes('Inspection checklist') && doc.includes('Pressure-test'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
