import { readFileSync } from 'node:fs';
import {
    LUMINAIRES,
    SWITCHES,
    SOCKETS,
    ROOM_PRESETS,
    LUMINAIRE_COUNT,
    luminaireById,
    switchById,
    socketById,
    roomPresetById,
    circuitTypeById,
    defaultCircuitFor
} from '../features/lighting/catalog.js';
import {
    DEFAULT_REFLECTANCES,
    roomIndex,
    coefficientOfUtilization,
    lumenMethod,
    illuminanceAt,
    illuminanceGrid,
    spacingFor,
    luxColour
} from '../features/lighting/photometry.js';
import {
    createPlan,
    normalizePlan,
    addDevice,
    removeDevice,
    moveDevice,
    nearestWall,
    snapToWall,
    autoLights,
    autoSockets,
    autoSwitches,
    autoCircuits,
    circuitLoad,
    circuitDevices,
    bindSwitch,
    bindAllLights,
    controlsFor,
    toggleSwitch,
    setMaster,
    toggleLuminaire,
    assignCircuit,
    validateLayout,
    deviceAt,
    planSummary,
    devicesOf
} from '../features/lighting/plan.js';
import { designLighting, designCsv, designSummaryText, GLOSSARY, glossaryByCategory, CATALOG_COUNTS } from '../features/lighting/engine.js';
import { RULES, RULE_CATEGORIES, CODE_SCOPE, rulesByCategory, searchRules, ruleStatus } from '../features/lighting/rules.js';

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

function autoRoom(roomType, dimensions = {}) {
    const preset = roomPresetById(roomType);
    const plan = createPlan({ roomType, width: 4.6, depth: 4.0, ...dimensions });
    autoLights(plan, { typeId: preset.ambient });
    autoSockets(plan, { typeId: preset.socketType, minCount: preset.minSockets });
    autoSwitches(plan, { typeId: preset.switchType });
    autoCircuits(plan);
    return { plan, preset };
}

console.log('\nCatalogue');
check('luminaires are defined', LUMINAIRES.length >= 20 && LUMINAIRE_COUNT === LUMINAIRES.length, `${LUMINAIRE_COUNT}`);
check('luminaire ids are unique', ids(LUMINAIRES));
check('every luminaire has output, power and a beam', LUMINAIRES.every((entry) => entry.lumens > 0 && entry.watts > 0 && entry.beamAngle > 0));
check('every luminaire is high efficacy', LUMINAIRES.every((entry) => entry.efficacy >= 65), `${Math.min(...LUMINAIRES.map((entry) => entry.efficacy))} lm/W minimum`);
check('efficacy is derived from lumens and watts', LUMINAIRES.every((entry) => Math.abs(entry.efficacy - Math.round((entry.lumens / entry.watts) * 10) / 10) < 0.05));
check('every luminaire declares CRI and CCT', LUMINAIRES.every((entry) => entry.cri >= 80 && entry.cct >= 2200 && entry.cct <= 6500));
check('every luminaire has a spacing ratio and cost', LUMINAIRES.every((entry) => entry.spacingRatio > 0 && entry.cost > 0));
check('switch and socket ids are unique', ids(SWITCHES) && ids(SOCKETS));
check('switches declare ways, rating and neutral need', SWITCHES.every((entry) => entry.ways >= 1 && entry.ratingA > 0 && typeof entry.requiresNeutral === 'boolean'));
check('sockets declare rating, GFCI and WR flags', SOCKETS.every((entry) => entry.ratingA > 0 && typeof entry.gfci === 'boolean' && typeof entry.weatherResistant === 'boolean'));
check('every room preset names a light, socket and switch', ROOM_PRESETS.every((entry) => entry.ambient && entry.socketType && entry.switchType));
check('every room preset has a target and a socket minimum', ROOM_PRESETS.every((entry) => entry.targetLux > 0 && entry.minSockets >= 0));
check('catalogue counts agree', CATALOG_COUNTS.luminaires === LUMINAIRES.length && CATALOG_COUNTS.switches === SWITCHES.length && CATALOG_COUNTS.sockets === SOCKETS.length);
check('unknown ids fall back safely', luminaireById('nope').id === LUMINAIRES[1].id && switchById('nope').id === SWITCHES[0].id && socketById('nope').id === SOCKETS[0].id);
check('circuit colours are unique', new Set(['lighting', 'general', 'kitchen', 'bathroom', 'laundry', 'outdoor', 'garage', 'dedicated'].map((id) => circuitTypeById(id).colour)).size === 8);
check('kitchen sockets route to a kitchen circuit', defaultCircuitFor(socketById('gfci-20'), 'kitchen') === 'kitchen');
check('a dedicated appliance routes to a dedicated circuit', defaultCircuitFor(socketById('range-50'), 'kitchen') === 'dedicated');

console.log('\nPhotometry');
check('room index uses the room shape', near(roomIndex(5, 4, 2.4), 20 / (2.4 * 9), 1e-9));
check('CU rises with the room index', coefficientOfUtilization(roomIndex(3, 3, 2.4)) < coefficientOfUtilization(roomIndex(8, 8, 2.4)));
check('brighter finishes raise CU', coefficientOfUtilization(1.2, { ceiling: 0.9, wall: 0.7 }) > coefficientOfUtilization(1.2, { ceiling: 0.5, wall: 0.3 }));
check('lumen method returns maintained average lux', near(lumenMethod({ totalLumens: 10000, width: 5, depth: 4, mountingHeight: 2.4 }).averageLux, 10000 * coefficientOfUtilization(roomIndex(5, 4, 2.4)) * 0.8 / 20, 1e-6));
check('no lumens means no illuminance', lumenMethod({ totalLumens: 0, width: 5, depth: 4 }).averageLux === 0);
const pointLux = illuminanceAt({ x: 1, y: 1 }, [{ x: 1, y: 1, lumens: 800, mountHeight: 2.4 }], 0.75);
check('a point directly below a light is brightest', pointLux > illuminanceAt({ x: 2, y: 1 }, [{ x: 1, y: 1, lumens: 800, mountHeight: 2.4 }], 0.75));
check('a switched-off light contributes nothing', illuminanceAt({ x: 1, y: 1 }, [{ x: 1, y: 1, lumens: 800, mountHeight: 2.4, on: false }], 0.75) === 0);
const grid = illuminanceGrid({ width: 4, depth: 3, mountingHeight: 2.4, luminaires: [{ x: 2, y: 1.5, lumens: 1200, mountHeight: 2.4 }], steps: 8 });
check('the point grid covers the room', grid.values.length === 64 && grid.max > grid.min);
check('uniformity is a ratio at or below one', grid.uniformity > 0 && grid.uniformity <= 1, `${grid.uniformity.toFixed(2)}`);
check('spacing ratio scales with mounting height', spacingFor(luminaireById('recessed-6'), 2.4) > spacingFor(luminaireById('recessed-6'), 2.0));
check('the heatmap colour is an rgba string', luxColour(100, 200).startsWith('rgba('));
check('the heatmap clamps above the maximum', luxColour(500, 200) === luxColour(200, 200));
check('default reflectances are physical', DEFAULT_REFLECTANCES.ceiling > DEFAULT_REFLECTANCES.wall && DEFAULT_REFLECTANCES.wall > DEFAULT_REFLECTANCES.floor);

console.log('\nPlan model');
const blank = createPlan({ roomType: 'living', width: 5, depth: 4, height: 2.7, mountingHeight: 2.4 });
check('a plan starts empty with a valid entry and panel', blank.devices.length === 0 && blank.entry.y === 4 && blank.panel.x > 0);
check('the nearest wall is named', nearestWall(blank, 0.1, 2).wall === 'west' && nearestWall(blank, 4.9, 2).wall === 'east');
check('snapping puts a device on the wall', near(snapToWall(blank, 'socket', 0.02, 2).x, 0));
const westSocket = addDevice(blank, { kind: 'socket', typeId: 'duplex-15', x: 0, y: 2 });
check('a socket at x = 0 keeps the west wall', westSocket.x === 0 && westSocket.wall === 'west', `${westSocket.x}, ${westSocket.wall}`);
const northSwitch = addDevice(blank, { kind: 'switch', typeId: 'single-pole', x: 2.5, y: 0 });
check('a switch at y = 0 keeps the north wall', northSwitch.y === 0 && northSwitch.wall === 'north', `${northSwitch.y}, ${northSwitch.wall}`);
const light = addDevice(blank, { kind: 'luminaire', typeId: 'recessed-6', x: 2.5, y: 2 });
check('a luminaire sits at the mounting height', light.on === true && near(light.mountHeight, blank.mountingHeight));
check('a wall device can slide along the wall', moveDevice(blank, westSocket.id, 0, 3.2).wall === 'west' && near(westSocket.y, 3.2));
check('device hit testing finds the nearest', deviceAt(blank, { x: 2.5, y: 2 }, 0.3)?.id === light.id);
check('deleting a light clears switch bindings', bindSwitch(blank, northSwitch.id, light.id) && removeDevice(blank, light.id) && !northSwitch.controls.includes(light.id));

const normal = normalizePlan({ roomType: 'kitchen', width: 900, depth: -2, devices: [] });
check('normalize clamps a broken plan', normal.width <= 30 && normal.depth >= 2);
check('normalize keeps valid devices', normalizePlan({ devices: [{ id: 'x', kind: 'socket', typeId: 'duplex-15', x: 1, y: 1 }] }).devices.length === 1);

console.log('\nAuto layout');
const { plan: living, preset: livingPreset } = autoRoom('living');
check('auto layout adds lights, sockets and a switch', devicesOf(living, 'luminaire').length > 0 && devicesOf(living, 'socket').length >= livingPreset.minSockets && devicesOf(living, 'switch').length === 1);
check('every light is inside the room', devicesOf(living, 'luminaire').every((entry) => entry.x > 0 && entry.x < living.width && entry.y > 0 && entry.y < living.depth));
check('every socket is on a wall', devicesOf(living, 'socket').every((entry) => {
    const wall = nearestWall(living, entry.x, entry.y);
    return wall.distance < 0.01;
}));
check('auto sockets meet the preset minimum', devicesOf(living, 'socket').length >= livingPreset.minSockets);
check('one switch controls all lights', controlsFor(living, devicesOf(living, 'switch')[0].id).length === devicesOf(living, 'luminaire').length);
check('auto circuits make a lighting and a general circuit', living.circuits.some((entry) => entry.type === 'lighting') && living.circuits.some((entry) => entry.type === 'general'));
check('every device has a circuit', living.devices.every((entry) => entry.circuitId));
check('auto layout uses a dimmer where the preset asks', switchById(devicesOf(living, 'switch')[0].typeId).dimmable === livingPreset.dimmer);

const { plan: kitchen } = autoRoom('kitchen');
check('kitchen gets two small-appliance circuits', kitchen.circuits.filter((entry) => entry.type === 'kitchen').length === 2);
check('kitchen sockets are all GFCI', devicesOf(kitchen, 'socket').every((entry) => socketById(entry.typeId).gfci));
check('kitchen counter spacing is tighter than a living room', kitchen.socketSpacing < living.socketSpacing);

const { plan: stairs } = autoRoom('stairs');
check('a stairway gets two switches', devicesOf(stairs, 'switch').length === 2);
check('stair switches are three-way', devicesOf(stairs, 'switch').every((entry) => switchById(entry.typeId).ways === 2));

const { plan: dining } = autoRoom('dining');
check('dining centers one decorative fixture', devicesOf(dining, 'luminaire').length === 1);

console.log('\nSwitching and controls');
const switchDevice = devicesOf(living, 'switch')[0];
const lightsBefore = living.devices.filter((entry) => entry.kind === 'luminaire' && entry.on !== false).length;
toggleSwitch(living, switchDevice.id);
check('a switch flips every controlled light', living.devices.filter((entry) => entry.kind === 'luminaire' && entry.on !== false).length === 0 && lightsBefore > 0);
toggleSwitch(living, switchDevice.id);
check('a second flip restores the lights', living.devices.filter((entry) => entry.kind === 'luminaire' && entry.on !== false).length === lightsBefore);
setMaster(living, false);
check('master off clears the room', living.devices.filter((entry) => entry.kind === 'luminaire' && entry.on).length === 0);
setMaster(living, true);
check('master on restores the room', living.devices.filter((entry) => entry.kind === 'luminaire' && entry.on).length === lightsBefore);
const dimmable = living.devices.find((entry) => entry.kind === 'luminaire');
toggleLuminaire(living, dimmable.id);
check('one luminaire can be toggled alone', dimmable.on === false);
toggleLuminaire(living, dimmable.id);
const firstLight = living.devices.find((entry) => entry.kind === 'luminaire');
const secondLight = living.devices.filter((entry) => entry.kind === 'luminaire')[1];
bindSwitch(living, switchDevice.id, firstLight.id, false);
check('a switch can unbind one light', !switchDevice.controls.includes(firstLight.id));
bindSwitch(living, switchDevice.id, firstLight.id, true);
check('a switch can rebind a light', switchDevice.controls.includes(firstLight.id));
bindAllLights(living, switchDevice.id);
check('bind all restores every light', switchDevice.controls.length === devicesOf(living, 'luminaire').length);
check('a switch ignores a non-light binding', bindSwitch(living, switchDevice.id, 'nope') === null);

console.log('\nCircuits');
const lightingCircuit = living.circuits.find((entry) => entry.type === 'lighting');
const generalCircuit = living.circuits.find((entry) => entry.type === 'general');
check('the lighting circuit is 15 A', lightingCircuit.breakerA === 15 && lightingCircuit.wire === '14-2');
check('the general circuit is 20 A', generalCircuit.breakerA === 20 && generalCircuit.wire === '12-2');
check('general sockets count 180 VA each', circuitLoad(living, generalCircuit.id).va >= 180 * circuitDevices(living, generalCircuit.id).filter((entry) => entry.kind === 'socket').length);
check('the lighting load is under 15 A', circuitLoad(living, lightingCircuit.id).amps < 15);
check('a circuit reports its device count', circuitLoad(living, generalCircuit.id).devices === circuitDevices(living, generalCircuit.id).length);
const detached = living.devices.find((entry) => entry.kind === 'socket');
assignCircuit(living, detached.id, null);
check('a device can be unassigned', detached.circuitId === null);
assignCircuit(living, detached.id, generalCircuit.id);
check('a device can be reassigned', detached.circuitId === generalCircuit.id);
check('assigning an unknown circuit is refused', assignCircuit(living, detached.id, 'nope') === null && detached.circuitId === generalCircuit.id);

const overload = autoRoom('kitchen').plan;
const fifteen = overload.circuits.find((entry) => entry.breakerA === 15);
devicesOf(overload, 'socket').forEach((entry) => { entry.circuitId = fifteen.id; });
const overloadDesign = designLighting(overload);
check('an overloaded 15 A circuit is an error', overloadDesign.errors.some((entry) => entry.id === 'circuit-overload'));

const dedicated = autoRoom('laundry').plan;
addDevice(dedicated, { kind: 'socket', typeId: 'range-50', x: 0.5, y: dedicated.depth });
autoCircuits(dedicated);
const dedicatedDesign = designLighting(dedicated);
check('a dedicated 50 A appliance circuit is not a continuous-load warning', !dedicatedDesign.warnings.some((entry) => entry.id === 'circuit-80' && entry.label.includes('D1')), dedicatedDesign.warnings.map((entry) => entry.id).join(','));

console.log('\nValidation and design');
const firstLightForDim = living.devices.find((entry) => entry.kind === 'luminaire');
firstLightForDim.dim = 50;
const livingDesign = designLighting(living);
check('a normal living room has no design errors', livingDesign.errors.length === 0, livingDesign.errors.map((entry) => entry.id).join(',') || 'none');
check('auto layout meets the target average', livingDesign.metrics.averageLux >= livingPreset.targetLux * 0.9, `${livingDesign.metrics.averageLux} / ${livingPreset.targetLux}`);
check('design reports uniformity, min and max', livingDesign.metrics.uniformity > 0 && livingDesign.metrics.minLux > 0 && livingDesign.metrics.maxLux > 0);
check('design layers total every luminaire', Object.values(livingDesign.layers).reduce((sum, layer) => sum + layer.count, 0) === livingDesign.luminaires.length);
check('design reports connected and lit watts', livingDesign.metrics.connectedW > livingDesign.metrics.litW && livingDesign.metrics.litW > 0);
check('design reports efficacy and LPD', livingDesign.metrics.efficacy >= 65 && livingDesign.metrics.wattsPerM2 > 0);
check('design includes a schedule for every device', livingDesign.schedule.length === living.devices.length);
check('schedule tags are unique and prefixed', new Set(livingDesign.schedule.map((entry) => entry.tag)).size === livingDesign.schedule.length && livingDesign.schedule.every((entry) => /^[LSR]\d+$/.test(entry.tag)));
check('design produces a costed bill', livingDesign.bom.rows.length > 8 && livingDesign.cost.total > 0);
check('materials plus labour equals the total', near(livingDesign.cost.materials + livingDesign.cost.labour, livingDesign.cost.total, 0.05));
check('the takeoff includes cable, boxes and breakers', ['Cable', 'Boxes', 'Panel', 'Luminaires', 'Labour'].every((group) => livingDesign.bom.groups.some((entry) => entry.group === group)));
check('the CSV has a header and one row per device', designCsv(livingDesign).split('\n').length === living.devices.length + 1);
check('the CSV header names the schedule columns', designCsv(livingDesign).startsWith('Tag,Kind,Type,Room,Location,Mount (m),Circuit'));
check('the summary text names room, lux and cost', designSummaryText(livingDesign).includes('lx') && designSummaryText(livingDesign).includes('$'));
check('the plan summary counts each device kind', planSummary(living).luminaires === devicesOf(living, 'luminaire').length && planSummary(living).sockets === devicesOf(living, 'socket').length);

const noLights = createPlan({ roomType: 'bedroom', width: 4, depth: 3.5 });
const noLightsChecks = validateLayout(noLights);
check('no lighting outlet is an error', noLightsChecks.some((entry) => entry.id === 'lighting-outlet' && entry.severity === 'error'));
check('no switch is an error', noLightsChecks.some((entry) => entry.id === 'switch-missing' && entry.severity === 'error'));

const badSpacing = autoRoom('living').plan;
const southSockets = devicesOf(badSpacing, 'socket').filter((entry) => entry.wall === 'south');
if (southSockets.length > 1) removeDevice(badSpacing, southSockets[0].id);
check('a socket gap beyond the spacing warns', validateLayout(badSpacing).some((entry) => entry.id === 'socket-spacing' && entry.severity === 'warn'));

const simpleSwitch = autoRoom('living').plan;
simpleSwitch.devices.filter((entry) => entry.kind === 'switch').forEach((entry) => removeDevice(simpleSwitch, entry.id));
const manual = addDevice(simpleSwitch, { kind: 'switch', typeId: 'single-pole', x: simpleSwitch.width * 0.45, y: simpleSwitch.depth });
bindAllLights(simpleSwitch, manual.id);
autoCircuits(simpleSwitch);
check('a plain switch warns about the energy control rule', designLighting(simpleSwitch).warnings.some((entry) => entry.id === 'energy-controls'));

const bathroom = autoRoom('bathroom').plan;
check('a normal bathroom has no errors', designLighting(bathroom).errors.length === 0, designLighting(bathroom).errors.map((entry) => entry.id).join(',') || 'none');
const wetBath = autoRoom('bathroom').plan;
devicesOf(wetBath, 'luminaire').forEach((entry) => { entry.typeId = 'chandelier'; });
check('a non-damp bathroom light is an error', designLighting(wetBath).errors.some((entry) => entry.id === 'wet-luminaire'));

const fireRoom = autoRoom('office').plan;
fireRoom.fireRatedCeiling = true;
devicesOf(fireRoom, 'luminaire').forEach((entry) => { entry.typeId = 'recessed-gimbal'; });
check('a non-fire-rated recessed light warns in a rated ceiling', designLighting(fireRoom).warnings.some((entry) => entry.id === 'fire-rating'));

const mixed = autoRoom('living').plan;
devicesOf(mixed, 'luminaire').forEach((entry, index) => { if (index % 2) entry.cct = 4000; });
check('mixed colour temperatures warn', designLighting(mixed).warnings.some((entry) => entry.id === 'cct-mix'));

const outdoor = autoRoom('outdoor').plan;
check('an outdoor plan has no errors', designLighting(outdoor).errors.length === 0, designLighting(outdoor).errors.map((entry) => entry.id).join(',') || 'none');
check('outdoor sockets are GFCI and WR', devicesOf(outdoor, 'socket').every((entry) => socketById(entry.typeId).gfci && socketById(entry.typeId).weatherResistant));
check('outdoor luminaires are wet rated', designLighting(outdoor).luminaires.every((entry) => entry.type.wet));

const { plan: stairPlan } = autoRoom('stairs');
check('stair plan has no errors', designLighting(stairPlan).errors.length === 0, designLighting(stairPlan).errors.map((entry) => entry.id).join(',') || 'none');
const oneSwitchStair = autoRoom('stairs').plan;
removeDevice(oneSwitchStair, devicesOf(oneSwitchStair, 'switch')[1].id);
check('removing one stair switch is an error', validateLayout(oneSwitchStair).some((entry) => entry.id === 'stair-switch' && entry.severity === 'error'));

console.log('\nGlossary and rules');
check('the glossary has at least forty terms', GLOSSARY.length >= 40, `${GLOSSARY.length}`);
check('glossary terms are unique', new Set(GLOSSARY.map((entry) => entry.term)).size === GLOSSARY.length);
check('every glossary term has a short and a detail', GLOSSARY.every((entry) => entry.short.length > 10 && entry.detail.length > 20));
check('glossary groups cover every term', glossaryByCategory().reduce((sum, group) => sum + group.entries.length, 0) === GLOSSARY.length);
check('rules have at least twenty entries', RULES.length >= 20, `${RULES.length}`);
check('rule ids are unique', new Set(RULES.map((entry) => entry.id)).size === RULES.length);
check('every category has at least one rule', RULE_CATEGORIES.every((category) => RULES.some((rule) => rule.category === category.id)));
check('rules declare a level and a code citation', RULES.every((rule) => ['required', 'recommended', 'energy'].includes(rule.level) && rule.code.length > 4));
check('every rule has requirements and a detail', RULES.every((rule) => rule.requirements.length > 0 && rule.detail.length > 20));
check('search finds the GFCI rule', searchRules('GFCI').some((rule) => rule.id === 'gfci'));
check('search is case insensitive', searchRules('kitchen counter').length > 0);
check('an empty search returns every rule', searchRules('').length === RULES.length);
check('rules group without losing one', rulesByCategory().reduce((sum, group) => sum + group.rules.length, 0) === RULES.length);
check('a passing check marks a rule pass', ruleStatus(RULES[0], [{ id: RULES[0].checkIds[0], severity: 'ok' }]).state === 'ok');
check('a failed check marks a rule fix', ruleStatus(RULES[0], [{ id: RULES[0].checkIds[0], severity: 'error' }]).state === 'error');
check('an unmodelled rule is labelled info', ruleStatus(RULES.find((rule) => !rule.checkIds.length)).state === 'info');
check('code scope names the California electrical and energy codes', CODE_SCOPE.title.includes('California Electrical Code') && CODE_SCOPE.title.includes('Title 24, Part 6') && CODE_SCOPE.body.includes('Title 24, Part 3'));

const doc = readFileSync(new URL('../docs/LIGHTING.MD', import.meta.url), 'utf8');
check('the rules document exists and cites chapter 39', doc.includes('E3903.2') && doc.includes('Chapter 39'));
check('the document covers GFCI, AFCI and kitchen circuits', doc.includes('GFCI') && doc.includes('AFCI') && doc.includes('small-appliance'));
check('the document covers photometry and inspection', doc.includes('Lumen method') && doc.includes('Inspection checklist'));
check('the document carries the design-aid disclaimer', doc.includes('not a permit drawing'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
