import * as THREE from 'three';
import { computeStairDesign, stairDesignForItem, stairLocalToPlanPoint } from '../features/stairs/design.js';
import { OUTDOOR_SYSTEMS, computeOutdoorStair, outdoorBomCsv } from '../features/stairs/outdoor.js';
import { buildStairAssembly, assemblySummary, findStairClashes, stairSectionProfile } from '../features/stairs/assembly.js';
import { PART_LIBRARY, partsByCategory, buildPartWireframe, partSize } from '../features/stairs/parts.js';
import { buildStairGeometry, stairPlanBounds, stairPlanOutline, stairPlanContains, sizeStairItem } from '../features/stairs/geometry.js';
import { fixtureAt } from '../scene/scene-drag.js';
import { PIXELS_PER_METER } from '../core/world-space.js';
import { STAIR_MODELS, computeStairModel, stairModelConfig, stairModelSummary, modelTakeoffCsv, applyModelToConfig, modelsByCategory } from '../features/stairs/models.js';
import { computeStraightDesigner, toStairConfig, designerTakeoffCsv, designerSummary, buildDesignerStair } from '../features/stairs/designer.js';
import { loadStairPresets, saveStairPreset, removeStairPreset, getStairPreset, clearStairPresets, presetNameFor, presetSummary, STAIR_PRESET_KEY, STAIR_PRESET_LIMIT } from '../features/stairs/presets.js';
import { createStairHeightField } from '../features/stairs/walk.js';
import { computeWaterFeature, waterDesignForItem, waterSummary, planOutline, surfaceArea } from '../features/landscape/design.js';
import { buildWaterFeature } from '../features/landscape/geometry.js';

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

const IN = 0.0254;
const FT = 12 * IN;
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

console.log('\nStair design');
{
    const straight = computeStairDesign({ type: 'straight', storeyHeight: 2.7, width: 1.0, availableRun: 4.2 });
    check('straight risers within IRC 7.75 in', straight.riserHeight <= 7.75 * IN, `${(straight.riserHeight / IN).toFixed(2)} in`);
    check('straight tread at 10 in', near(straight.treadDepth, 10 * IN, 1e-6), `${(straight.treadDepth / IN).toFixed(2)} in`);
    check('straight run matches treads', near(straight.runUsed, straight.treads * straight.treadDepth, 1e-6), `${straight.runUsed.toFixed(2)} m`);
    check('2R + T is in the 24–25.5 in band', straight.comfort.valueIn >= 24 && straight.comfort.valueIn <= 25.5, `${straight.comfort.valueIn.toFixed(2)} in`);
    check('straight is compliant', straight.compliant);

    const right = computeStairDesign({ type: 'curve-right', storeyHeight: 2.7, width: 1.0 });
    const left = computeStairDesign({ type: 'curve-left', storeyHeight: 2.7, width: 1.0 });
    check('curve right walkline tread ≥ 10 in', right.treadDepth >= 10 * IN, `${(right.treadDepth / IN).toFixed(2)} in`);
    check('curve right mirrors left', near(Math.abs(right.sweep), Math.abs(left.sweep)) && right.direction === -left.direction);
    check('curve default compliant', right.compliant && left.compliant);

    const spiral = computeStairDesign({ type: 'spiral', storeyHeight: 2.7, availableWidth: 1.9 });
    check('spiral tread at walkline ≥ 7.5 in', spiral.treadDepth >= 7.5 * IN, `${(spiral.treadDepth / IN).toFixed(2)} in`);
    check('spiral clear width ≥ 26 in', spiral.clearWidth >= 26 * IN, `${(spiral.clearWidth / IN).toFixed(1)} in`);
    check('spiral riser ≤ 9.5 in', spiral.riserHeight <= 9.5 * IN);
    check('spiral foot is a square', spiral.footprint.width === spiral.footprint.depth);

    const pole = computeStairDesign({ type: 'fire-pole', storeyHeight: 2.7 });
    check('fire pole is not egress', pole.errors.some((issue) => issue.code === 'pole-not-egress'));
    check('fire pole has a guard and mat', pole.pole.guard && pole.pole.landingMat);
}

console.log('\nOutdoor systems');
for (const system of OUTDOOR_SYSTEMS) {
    const design = computeOutdoorStair({ system: system.key, storeyHeight: 2.7 });
    check(`${system.key}: sized and checked`, design.risers > 3 && design.riserHeight > 0);
    check(`${system.key}: guard height`, near(design.guard.height, system.guardHeight), `${(design.guard.height / IN).toFixed(0)} in`);
    check(`${system.key}: takeoff has parts`, design.bom.rows.length > 4 && design.bom.totals.parts > 20, `${design.bom.totals.parts} parts`);
    check(`${system.key}: no errors`, design.errors.length === 0, design.errors.map((issue) => issue.code).join(', '));
    check(`${system.key}: footprint matches width`, design.footprint.width >= design.width - 1e-6);
}

{
    const deck = computeOutdoorStair({ system: 'deck', storeyHeight: 2.7 });
    const csv = outdoorBomCsv(deck);
    check('deck takeoff CSV rows', csv.split('\n').length === deck.bom.rows.length + 1, `${deck.bom.rows.length} parts`);
    const shortGuard = computeOutdoorStair({ system: 'deck', storeyHeight: 2.7, guardHeight: 24 * IN });
    check('short guard is rejected', shortGuard.errors.some((issue) => issue.code === 'guard-height'));
    const openGap = computeOutdoorStair({ system: 'deck', storeyHeight: 2.7, openRisers: true, openRiserGap: 6 * IN });
    check('open riser gap is rejected', openGap.errors.some((issue) => issue.code === 'open-riser'));
    const egress = computeOutdoorStair({ system: 'egress', storeyHeight: 2.7, handrailSides: 1 });
    check('egress needs two handrails', egress.errors.some((issue) => issue.code === 'handrail-sides'));
    const spiralEgress = computeOutdoorStair({ system: 'egress', storeyHeight: 2.7, type: 'spiral' });
    check('spiral is rejected as egress', spiralEgress.errors.some((issue) => issue.code === 'spiral-egress'));
    const shallowFooting = computeOutdoorStair({ system: 'deck', storeyHeight: 2.7, footingDepth: 12 * IN });
    check('shallow footing is rejected', shallowFooting.errors.some((issue) => issue.code === 'footing-depth'));
}

console.log('\nBIM assembly');
{
    const assembly = buildStairAssembly({ system: 'deck', storeyHeight: 2.7 });
    check('run sub-type carries risers and treads', assembly.subTypes.run.risers === assembly.design.risers);
    check('automatic top landing', assembly.subTypes.landing.top.enabled);
    check('automatic bottom landing', assembly.subTypes.landing.bottom.enabled);
    check('levels: base 0, top = rise', near(assembly.subTypes.levels.base.finish, 0) && near(assembly.subTypes.levels.top.finish, 2.7));
    check('support is a wood carriage', assembly.subTypes.support.key === 'carriage');
    check('assembly summary lines', assemblySummary(assembly).length >= 4);

    const disabled = buildStairAssembly({ system: 'deck', storeyHeight: 2.7, landings: { top: { enabled: false } } });
    check('top landing can be disabled', disabled.subTypes.landing.top.enabled === false);

    const offsets = buildStairAssembly({ system: 'deck', storeyHeight: 2.7, baseElevation: 3, baseOffset: 0.15, topOffset: -0.05 });
    check('base elevation and offsets applied', near(offsets.subTypes.levels.base.finish, 3.15) && near(offsets.subTypes.levels.top.finish, 5.65));

    const intermediate = buildStairAssembly({
        system: 'egress',
        storeyHeight: 3.6,
        landings: { intermediate: [{ riser: 8, depth: 1.2 }] }
    });
    check('manual intermediate landing is kept', intermediate.subTypes.landing.intermediate.length === 1);

    const section = stairSectionProfile(assembly);
    check('section profile has a sawtooth nosing line', section.straight && section.treads.length >= assembly.design.treads * 2);

    const clash = findStairClashes(assembly, {
        item: { x: 300, y: 300 },
        walls: [{ id: 'wall-1', start: { x: 300 - 120, y: 300 }, end: { x: 300 + 120, y: 300 } }]
    });
    check('wall clash is reported', clash.some((entry) => entry.type === 'wall'), `${clash.length} clashes`);
}

console.log('\nParts library');
{
    const parts = PART_LIBRARY;
    check('parts catalogued', parts.length >= 28, `${parts.length} parts`);
    check('categories grouped', partsByCategory().length >= 6);
    check('2x10 dressed size', Math.abs(partSize('tread-2x10', { width: 1 }).height - 1.5 * IN) < 1e-9);
    check('stringer length follows the run', partSize('stringer-2x12', { run: 10 * FT, rise: 1.5 }).length > 10 * FT);

    const wire = buildPartWireframe(THREE, 'stringer-2x12', { run: 10 * FT, rise: 1.19 });
    let lines = 0;
    wire.traverse((child) => { if (child.isLineSegments) lines += 1; });
    check('stringer wireframe has edges', lines > 0, `${lines} line sets`);

    const post = buildPartWireframe(THREE, 'post-4x4', { height: 42 * IN });
    const box = new THREE.Box3().setFromObject(post);
    const size = new THREE.Vector3();
    box.getSize(size);
    check('4x4 post is 3.5 in square and 42 in tall',
        Math.abs(size.x - 3.5 * IN) < 1e-6 && Math.abs(size.z - 3.5 * IN) < 1e-6 && Math.abs(size.y - 42 * IN) < 1e-6,
        `${(size.x / IN).toFixed(2)} × ${(size.z / IN).toFixed(2)} × ${(size.y / IN).toFixed(2)} in`);

    const every = parts.map((part) => buildPartWireframe(THREE, part.key));
    check('every part builds a wireframe', every.every(Boolean), `${every.filter(Boolean).length}/${parts.length}`);
}

console.log('\n3D stair geometry');
{
    const item = {
        type: 'stair_deck',
        x: 400,
        y: 300,
        rotation: 0,
        metadata: { width: 0.9144, depth: 4.4, height: 2.7 },
        stair: { system: 'deck', type: 'straight', code: 'IRC2021', width: 0.9144, availableRun: 4.4, availableWidth: 1.2 }
    };
    const group = buildStairGeometry(item, { storeyHeight: 2.7 });
    const names = [];
    let meshes = 0;
    group.traverse((child) => {
        if (child.isMesh) meshes += 1;
        if (child.name) names.push(child.name);
    });
    check('deck stair geometry has meshes', meshes > 20, `${meshes} meshes`);
    check('automatic top landing is built', names.includes('top-landing'));
    check('automatic bottom landing is built', names.includes('bottom-landing'));
    check('pier footings are built', names.filter((name) => name === 'pier-footing').length === 4);

    const bounds = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    check('stair top is one storey plus the rail', Math.abs(bounds.max.y - (2.7 + 0.9144)) < 0.2, `${bounds.max.y.toFixed(2)} m top`);
    check('steps climb risers, not the whole storey', bounds.max.y < 4, `${bounds.max.y.toFixed(2)} m`);
    check('footings sit below grade', bounds.min.y < -0.9, `${bounds.min.y.toFixed(2)} m`);

    const design = stairDesignForItem(item, 2.7);
    check('item design reads the stair config', near(design.width, 0.9144), `${design.width} m`);

    // The plan footprint the selection box and symbol use has to cover the run
    // plus the automatic landings the 3D build draws.
    const planBounds = stairPlanBounds(item, { storeyHeight: 2.7 });
    check('plan footprint includes both landings', planBounds.landings.length === 2, planBounds.landings.map((landing) => landing.end).join(' + '));
    check('plan footprint is deeper than the run', planBounds.depth > design.runUsed + 1.6, `${planBounds.depth.toFixed(2)} m vs ${design.runUsed.toFixed(2)} m run`);
    const topLanding = planBounds.landings.find((landing) => landing.end === 'top');
    check('top landing abuts the top nosing', Math.abs(topLanding.minZ - design.runUsed / 2) < 1e-6);
    check('plan footprint matches the 3D depth', Math.abs((bounds.max.z - bounds.min.z) - planBounds.depth) < 0.02,
        `${(bounds.max.z - bounds.min.z).toFixed(2)} m in 3D vs ${planBounds.depth.toFixed(2)} m in plan`);
    const outline = stairPlanOutline(item, 2.7);
    check('plan outline uses the landing footprint', near(outline.depth, planBounds.depth));

    const monoPlan = stairPlanBounds({
        type: 'stair', x: 0, y: 0, rotation: 0,
        metadata: { width: 1.07, depth: 3.4, height: 2.7 },
        stair: stairModelConfig('mono-straight', { storeyHeight: 2.7 })
    }, { storeyHeight: 2.7 });
    check('models drawn without landings keep the run footprint', monoPlan.landings.length === 0 && near(monoPlan.depth, computeStairModel('mono-straight', { storeyHeight: 2.7 }).footprint.depth, 1e-9),
        `${monoPlan.depth.toFixed(2)} m`);
}

console.log('\nPlan picking');
{
    // A stair straight from the palette has no `size`; picking has to use the
    // footprint the plan and the 3D draw, landings included.
    const item = {
        type: 'stair_deck',
        x: 300,
        y: 300,
        rotation: 0,
        metadata: { width: 0.9144, depth: 4.4, height: 2.7 },
        stair: { system: 'deck', type: 'straight', code: 'IRC2021', width: 0.9144, availableRun: 4.4, availableWidth: 1.2 }
    };
    const bounds = stairPlanBounds(item, { storeyHeight: 2.7 });
    const bottom = bounds.landings.find((landing) => landing.end === 'bottom');
    const top = bounds.landings.find((landing) => landing.end === 'top');
    const centreOf = (rect) => ({ x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 });

    check('picking reaches the bottom landing',
        fixtureAt([item], stairLocalToPlanPoint(item, centreOf(bottom)), { storeyHeight: 2.7 }) === item);
    check('picking reaches the top landing',
        fixtureAt([item], stairLocalToPlanPoint(item, centreOf(top)), { storeyHeight: 2.7 }) === item);
    check('picking stops past the footprint',
        fixtureAt([item], stairLocalToPlanPoint(item, { x: 0, z: bounds.maxZ + 0.3 }), { storeyHeight: 2.7, slack: 0 }) === null);

    const turned = { ...item, rotation: Math.PI / 2 };
    check('picking follows the stair rotation',
        fixtureAt([turned], stairLocalToPlanPoint(turned, centreOf(bottom)), { storeyHeight: 2.7 }) === turned);

    const bare = {
        ...item,
        stair: { ...item.stair, landings: { top: { enabled: false }, bottom: { enabled: false } } }
    };
    const bareBounds = stairPlanBounds(bare, { storeyHeight: 2.7 });
    check('no landings means the run footprint only', bareBounds.landings.length === 0);
    check('picking a disabled landing misses',
        fixtureAt([bare], stairLocalToPlanPoint(bare, centreOf(bottom)), { storeyHeight: 2.7 }) === null);

    const paletteItem = { ...item, size: null };
    const sized = sizeStairItem(paletteItem, 2.7);
    check('sizing stores the landing footprint',
        near(paletteItem.size.depth, sized.depth) && paletteItem.size.depth > stairDesignForItem(item, 2.7).runUsed + 1.6,
        `${paletteItem.size.width.toFixed(2)} × ${paletteItem.size.depth.toFixed(2)} m`);
    check('sizing keeps the storey height', near(paletteItem.size.height, 2.7));
    check('sizing matches the picking footprint',
        near(paletteItem.size.width, bounds.width) && near(paletteItem.size.depth, bounds.depth));
    check('a sized stair is still picked by its landings',
        fixtureAt([paletteItem], stairLocalToPlanPoint(paletteItem, centreOf(top)), { storeyHeight: 2.7 }) === paletteItem);

    // Rectangular non-stair items keep their metadata footprint.
    const door = { type: 'door', x: 300, y: 300, rotation: 0, metadata: { width: 1, depth: 0.15 } };
    check('non-stair picking is unchanged',
        fixtureAt([door], { x: 300 + 10, y: 300 }) === door
        && fixtureAt([door], { x: 300 + 0.9 * PIXELS_PER_METER, y: 300 }) === null);
}

console.log('\nModel catalogue');
{
    check('model families catalogued', STAIR_MODELS.length === 12, `${STAIR_MODELS.length} models`);
    check('models grouped into categories', modelsByCategory().length === 5, modelsByCategory().map((group) => group.category).join(', '));

    let compliant = 0;
    let built = 0;
    for (const model of STAIR_MODELS) {
        const design = computeStairModel(model.key, { storeyHeight: 2.7 });
        if (design.compliant) compliant += 1;
        const config = stairModelConfig(model.key, { storeyHeight: 2.7 });
        const item = {
            type: 'stair',
            x: 300,
            y: 300,
            rotation: 0,
            metadata: { width: design.width, depth: design.footprint.depth, height: 2.7 },
            stair: config
        };
        const group = buildStairGeometry(item, { storeyHeight: 2.7 });
        const names = [];
        group.traverse((child) => { if (child.name) names.push(child.name); });
        if (names.length > 0 && group.userData.model === model.key) built += 1;
        check(`${model.key}: model geometry`, group.userData.geometryKey === model.geometry, `${group.userData.geometryKey}, ${names.length} named parts`);
    }
    check('every model is code compliant at 2.7 m', compliant === STAIR_MODELS.length, `${compliant}/${STAIR_MODELS.length}`);
    check('every model builds geometry', built === STAIR_MODELS.length, `${built}/${STAIR_MODELS.length}`);

    const mono = buildStairGeometry({
        type: 'stair', x: 0, y: 0, rotation: 0,
        metadata: { width: 1.07, depth: 3, height: 2.7 },
        stair: stairModelConfig('mono-straight')
    }, { storeyHeight: 2.7 });
    const monoNames = [];
    mono.traverse((child) => { if (child.name) monoNames.push(child.name); });
    check('mono stringer has one centre plate', monoNames.filter((name) => name === 'mono-stringer').length === 1);

    const alt = buildStairGeometry({
        type: 'stair', x: 0, y: 0, rotation: 0,
        metadata: { width: 0.61, depth: 2.4, height: 2.7 },
        stair: stairModelConfig('alt-tread')
    }, { storeyHeight: 2.7 });
    const altTreads = [];
    alt.traverse((child) => { if (child.name?.startsWith('alt-tread-')) altTreads.push(child); });
    const halfWidth = altTreads.every((tread) => Math.abs(tread.geometry.parameters.width - (alt.userData.design.width / 2 - 0.03)) < 1e-6);
    check('alternating treads are half width', altTreads.length > 6 && halfWidth, `${altTreads.length} half treads`);
    const alternateSides = altTreads.map((tread) => Math.sign(tread.position.x));
    check('alternating treads swap sides', alternateSides.some((side, i) => i > 0 && side !== alternateSides[i - 1]));

    const ladder = buildStairGeometry({
        type: 'stair', x: 0, y: 0, rotation: 0,
        metadata: { width: 0.61, depth: 2, height: 2.7 },
        stair: stairModelConfig('ships-ladder')
    }, { storeyHeight: 2.7 });
    const ladderNames = [];
    ladder.traverse((child) => { if (child.name) ladderNames.push(child.name); });
    check('ships ladder treads built', ladderNames.filter((name) => name.startsWith('ladder-tread-')).length > 6);
    check('ships ladder is steep', ladder.userData.design.model.slopeDegrees > 55, `${ladder.userData.design.model.slopeDegrees}°`);

    const crossover = buildStairGeometry({
        type: 'stair', x: 0, y: 0, rotation: 0,
        metadata: { width: 0.91, depth: 5, height: 2.7 },
        stair: stairModelConfig('crossover')
    }, { storeyHeight: 2.7 });
    const crossoverNames = [];
    crossover.traverse((child) => { if (child.name) crossoverNames.push(child.name); });
    check('crossover has a mid platform', crossoverNames.includes('crossover-platform'));

    const folding = buildStairGeometry({
        type: 'stair', x: 0, y: 0, rotation: 0,
        metadata: { width: 0.61, depth: 2, height: 2.7 },
        stair: stairModelConfig('disappearing')
    }, { storeyHeight: 2.7 });
    const foldingNames = [];
    folding.traverse((child) => { if (child.name) foldingNames.push(child.name); });
    check('disappearing stair is drawn folded', foldingNames.includes('disappearing-panel') && foldingNames.some((name) => name.startsWith('folded-tread-')));
    check('disappearing stair is not walkable', folding.userData.walkable === false);

    const narrow = computeStairModel('pan-stair', { storeyHeight: 2.7, width: 0.9 });
    check('narrow pan stair is rejected', narrow.errors.some((issue) => issue.code === 'model-width'), narrow.errors.map((issue) => issue.code).join(', '));
    const egress = computeStairModel('disappearing', { storeyHeight: 2.7 });
    check('disappearing stair is not egress', egress.warnings.some((issue) => issue.code === 'model-not-egress'));

    check('model summary lines', stairModelSummary(computeStairModel('pan-stair')).length >= 4);
    check('model takeoff rows', modelTakeoffCsv(computeStairModel('mono-straight')).split('\n').length === 5);

    const merged = applyModelToConfig({ system: 'deck', width: 0.9 }, 'alt-tread', { storeyHeight: 2.7 });
    check('model preset overrides width and code', near(merged.width, 24 * IN, 1e-9) && merged.code === 'IBC_ALT' && merged.model === 'alt-tread');

    const monoItem = {
        type: 'stair', id: 'mono-1', x: 300, y: 300, rotation: 0, visible: true,
        metadata: { width: 1.07, depth: 3.4, height: 2.7 },
        stair: stairModelConfig('mono-straight', { storeyHeight: 2.7 })
    };
    const monoDesign = stairDesignForItem(monoItem, 2.7);
    const field = createStairHeightField({
        stories: [{ id: 's0', height: 2.7, visible: true, walls: [], fixtures: [monoItem] }],
        currentStoryIndex: 0,
        walls: [],
        fixtures: [monoItem]
    });
    const top = field.heightAt(stairLocalToPlanPoint(monoItem, monoDesign.exit));
    check('mono stringer is walkable to the upper storey', Math.abs(top - 2.7) < 0.05, `${top.toFixed(2)} m`);
}

console.log('\nStraight stair designer');
{
    const designer = computeStraightDesigner();
    check('designer default is compliant', designer.compliant, designer.checks.filter((c) => c.severity === 'error').map((c) => c.id).join(', '));
    check('auto steps follow the published method', designer.steps === 14 && designer.risers === 15, `${designer.steps} steps / ${designer.risers} risers`);
    check('step height divides the height by the risers', Math.abs(designer.stepHeight - 180) < 1e-9, `${designer.stepHeight.toFixed(2)} mm`);
    check('going from Blondel', Math.abs(designer.going - (630 - 2 * 180)) < 1e-9, `${designer.going.toFixed(1)} mm`);
    check('designer Blondel in band', Math.abs(designer.blondel - 630) < 1e-9, `${designer.blondel.toFixed(1)} mm`);
    check('angle from step height over going', Math.abs(designer.angle - (Math.atan2(designer.stepHeight, designer.going) * 180) / Math.PI) < 1e-9, `${designer.angle.toFixed(2)}°`);
    check('total run is steps × going + landing step', Math.abs(designer.totalRun - (designer.steps * designer.going + designer.landingStep.size)) < 1e-9, `${designer.totalRun.toFixed(0)} mm`);

    const expectedHeadroom = Math.tan((designer.angle * Math.PI) / 180) * (designer.opening.length - designer.landingStep.size) - designer.opening.floorThickness;
    check('headroom from tan × opening', Math.abs(designer.headroom - expectedHeadroom) < 1e-6, `${designer.headroom.toFixed(0)} mm`);

    const locked = computeStraightDesigner({ steps: 12 });
    check('locked step count honoured', locked.steps === 12 && locked.risers === 13 && Math.abs(locked.stepHeight - 2700 / 13) < 1e-9, `${locked.stepHeight.toFixed(1)} mm riser`);
    check('locked 208 mm riser rejected', locked.checks.some((c) => c.id === 'riser' && c.severity === 'error'));

    const shortOpening = computeStraightDesigner({ openingLength: 1500 });
    check('short opening fails headroom', shortOpening.headroom < 1900 && shortOpening.checks.some((c) => c.id === 'headroom' && c.severity === 'error'), `${shortOpening.headroom.toFixed(0)} mm`);

    const byLength = computeStraightDesigner({ solve: 'length', length: 4200 });
    check('solving by length pins the run', Math.abs(byLength.totalRun - 4200) < 1e-6, `${byLength.totalRun.toFixed(0)} mm`);
    check('solving by length derives the going', Math.abs(byLength.going - (4200 - byLength.landingStep.size) / byLength.steps) < 1e-9, `${byLength.going.toFixed(1)} mm`);

    const tight = computeStraightDesigner({ solve: 'length', length: 2400, height: 3600 });
    check('tight run is not compliant', !tight.compliant, tight.checks.filter((c) => c.severity === 'error').map((c) => c.id).join(', '));

    const noLanding = computeStraightDesigner({ landingStep: 0 });
    check('landing step adds a tread', designer.elevation.treads.length === noLanding.elevation.treads.length + 1,
        `${designer.elevation.treads.length} vs ${noLanding.elevation.treads.length}`);
    check('elevation has a tread per step plus the landing', designer.elevation.treads.length === designer.steps + 1 && designer.elevation.risers.length === designer.risers);

    check('designer summary lines', designerSummary(designer).length === 4);
    check('designer takeoff rows', designerTakeoffCsv(designer).split('\n').length === 7);

    const config = toStairConfig(designer);
    const item = {
        type: 'stair', x: 0, y: 0, rotation: 0,
        metadata: { width: config.width, depth: config.availableRun, height: config.storeyHeight },
        stair: config
    };
    const engine = stairDesignForItem(item, config.storeyHeight);
    check('designer pins the engine riser count and going', engine.risers === designer.risers && Math.abs(engine.treadDepth - designer.metres.going) < 1e-9,
        `${engine.risers} × ${(engine.treadDepth / IN).toFixed(2)} in`);
    check('placed designer stair passes the code engine', engine.errors.length === 0, engine.errors.map((issue) => issue.code).join(', '));

    const group = buildDesignerStair(designer);
    const names = [];
    let meshes = 0;
    group.traverse((child) => { if (child.isMesh) meshes += 1; if (child.name) names.push(child.name); });
    check('designer 3D builds the flight', meshes > 30, `${meshes} meshes`);
    check('designer 3D has the landing step and upper floor', names.includes('designer-landing-step') && names.includes('designer-upper-floor'));
    check('designer 3D has one tread per step', names.filter((name) => name.startsWith('designer-tread-')).length === designer.steps,
        `${names.filter((name) => name.startsWith('designer-tread-')).length} treads`);
}

console.log('\nSaved stair presets');
{
    const memory = new Map();
    const storage = {
        getItem: (key) => (memory.has(key) ? memory.get(key) : null),
        setItem: (key, value) => memory.set(key, String(value)),
        removeItem: (key) => memory.delete(key)
    };

    check('presets start empty', loadStairPresets(storage).length === 0);
    check('preset names follow the model', presetNameFor({ model: 'mono-straight' }) === 'Mono stringer, straight run', presetNameFor({ model: 'mono-straight' }));
    check('preset names follow the system', presetNameFor({ system: 'deck' }) === 'Deck stair', presetNameFor({ system: 'deck' }));

    const saved = saveStairPreset({
        name: 'Alt tread 900',
        stair: { model: 'alt-tread', type: 'straight', code: 'IBC_ALT', width: 0.9, risers: 14, treadDepth: 0.21, junk: 'drop me' },
        itemType: 'stair'
    }, storage);
    check('preset saved', Boolean(saved?.id) && saved.name === 'Alt tread 900');
    check('preset drops unknown fields', saved.stair.junk === undefined, Object.keys(saved.stair).join(','));
    check('preset stored once', loadStairPresets(storage).length === 1);
    check('preset can be looked up by id', getStairPreset(saved.id, storage)?.stair.model === 'alt-tread');

    const renamed = saveStairPreset({ name: 'Alt tread renamed', stair: saved.stair }, storage);
    check('re-saving the same stair renames it', renamed.id === saved.id && loadStairPresets(storage).length === 1);
    check('renamed preset wins', loadStairPresets(storage)[0].name === 'Alt tread renamed');

    check('preset summary lists risers and width', presetSummary(renamed).includes('14 risers') && presetSummary(renamed).includes('900 mm'), presetSummary(renamed));

    check('preset removed', removeStairPreset(saved.id, storage) === true && getStairPreset(saved.id, storage) === null);
    check('removing an unknown preset is a no-op', removeStairPreset('missing', storage) === false);

    for (let i = 0; i < 30; i++) {
        saveStairPreset({ name: `Preset ${i}`, stair: { type: 'straight', width: 0.6 + i * 0.01 } }, storage);
    }
    check('preset list is capped', loadStairPresets(storage).length === STAIR_PRESET_LIMIT, `${loadStairPresets(storage).length} saved`);
    check('newest preset first', loadStairPresets(storage)[0].name === 'Preset 29', loadStairPresets(storage)[0].name);

    memory.set(STAIR_PRESET_KEY, '{not json');
    check('malformed storage is ignored', loadStairPresets(storage).length === 0);
    check('clearing presets empties the store', clearStairPresets(storage) === true && loadStairPresets(storage).length === 0);
    check('empty config is rejected', saveStairPreset({ name: 'none', stair: null }, storage) === null);

    // A saved model config sizes through the engine unchanged.
    const modelPreset = saveStairPreset({
        name: 'Mono preset',
        stair: stairModelConfig('mono-straight', { storeyHeight: 2.7 }),
        itemType: 'stair'
    }, storage);
    const presetItem = { type: 'stair', x: 0, y: 0, rotation: 0, metadata: { width: 1, depth: 1, height: 2.7 }, stair: modelPreset.stair };
    const presetDesign = stairDesignForItem(presetItem, 2.7);
    check('preset config sizes through the engine', presetDesign.risers > 3 && presetDesign.compliant, `${presetDesign.risers} risers`);
    check('preset keeps the model family', presetItem.stair.model === 'mono-straight');
}

console.log('\nWalkable stairs');
{
    const stair = {
        type: 'stair',
        id: 'stair-1',
        x: 300,
        y: 300,
        rotation: 0,
        visible: true,
        metadata: { width: 1, depth: 3.3, height: 2.7 },
        stair: { type: 'straight', code: 'IRC2021', width: 1, availableRun: 4.2 }
    };
    const design = stairDesignForItem(stair, 2.7);
    const state = {
        stories: [
            { id: 's0', height: 2.7, visible: true, walls: [], fixtures: [stair] },
            { id: 's1', height: 2.7, visible: true, walls: [], fixtures: [] }
        ],
        currentStoryIndex: 0,
        walls: [],
        fixtures: [stair]
    };
    const field = createStairHeightField(state);
    const entry = stairLocalToPlanPoint(stair, design.entry);
    const exit = stairLocalToPlanPoint(stair, design.exit);
    const mid = stairLocalToPlanPoint(stair, design.path.pointAt(0.5));
    const entryH = field.heightAt(entry);
    const midH = field.heightAt(mid);
    const exitH = field.heightAt(exit);
    check('entry is at floor level', Math.abs(entryH) < 0.02, `${entryH.toFixed(3)} m`);
    check('mid run is half way up', Math.abs(midH - 1.35) < 0.25, `${midH.toFixed(2)} m`);
    check('exit reaches the next storey', Math.abs(exitH - 2.7) < 0.05, `${exitH.toFixed(2)} m`);
    const sample = field.sample(exit);
    check('exit reports the upper storey', sample.storeyIndex === 1, `storey ${sample.storeyIndex}`);
    check('stairs collected across storeys', field.stairs.length === 1);

    const floorState = {
        ...state,
        rooms: [{ vertices: [{ x: 250, z: 250 }, { x: 350, z: 250 }, { x: 350, z: 350 }, { x: 250, z: 350 }] }]
    };
    const floorField = createStairHeightField(floorState);
    check('room floor is at ground elevation', Math.abs(floorField.heightAt({ x: 260, y: 340 })) < 0.001);
}

console.log('\nLandscape water features');
{
    const pool = computeWaterFeature({ type: 'pool', shape: 'rectangle', width: 4, length: 9, shallow: 1.1, deep: 1.9 });
    check('pool area 36 m²', near(pool.area, 36));
    check('pool volume from mean depth', near(pool.volumeM3, 54, 0.001), `${pool.volumeM3.toFixed(1)} m³`);
    check('pool gallons', near(pool.gallons, 54 * 264.172, 0.01), `${Math.round(pool.gallons)} gal`);
    check('6 h turnover flow', near(pool.flowGpm, pool.gallons / 360, 0.01), `${pool.flowGpm.toFixed(1)} gpm`);
    check('pool sized with deck', near(pool.footprint.width, 4 + 2 * 1.22), `${pool.footprint.width.toFixed(2)} m`);
    check('pool compliant', pool.compliant, pool.errors.map((issue) => issue.code).join(', '));

    const shallow = computeWaterFeature({ type: 'pool', width: 3, length: 6, shallow: 0.6, deep: 1.2 });
    check('shallow pool is rejected', shallow.errors.some((issue) => issue.code === 'depth'));

    const barrier = computeWaterFeature({ type: 'pool', barrier: true, barrierHeight: 40 * IN });
    check('low barrier is rejected', barrier.errors.some((issue) => issue.code === 'barrier'));

    const gate = computeWaterFeature({ type: 'pool', gateSelfClosing: false });
    check('non-self-closing gate rejected', gate.errors.some((issue) => issue.code === 'gate'));

    const spa = computeWaterFeature({ type: 'spa', waterTempF: 106 });
    check('spa over 104 F rejected', spa.errors.some((issue) => issue.code === 'spa-temp'));

    const pond = computeWaterFeature({ type: 'pond', deep: 0.4 });
    check('shallow pond is warned', pond.warnings.some((issue) => issue.code === 'pond-depth'));

    const waterfall = computeWaterFeature({ type: 'waterfall', weirLength: 2.4 });
    check('weir flow computed', waterfall.weirFlowGpm > 5, `${waterfall.weirFlowGpm.toFixed(1)} gpm`);

    const kidneyArea = surfaceArea('kidney', 4, 8);
    check('kidney area is 82% of its box', near(kidneyArea, 4 * 8 * 0.82), `${kidneyArea.toFixed(2)} m²`);
    check('circular outline closed', planOutline('circular', 3, 3).length === 48);

    const outline = planOutline('rectangle', 4, 9);
    check('rectangle outline has 4 corners', outline.length === 4);

    const item = {
        type: 'pool', x: 100, y: 100, rotation: 0,
        metadata: { width: 4, depth: 9, height: 0.1 },
        landscape: { type: 'pool', shape: 'rectangle', width: 4, length: 9, shallow: 1.1, deep: 1.9, deck: 1.22 }
    };
    const design = waterDesignForItem(item);
    check('item design reads the landscape config', near(design.volumeM3, 54, 0.01));

    const group = buildWaterFeature(item);
    const water = [];
    let meshes = 0;
    group.traverse((child) => {
        if (child.isMesh) meshes += 1;
        if (child.userData.isWater) water.push(child);
    });
    check('pool geometry built', meshes > 10, `${meshes} meshes`);
    check('water surface present', water.length === 1);
    check('pool summary lines', waterSummary(design).length >= 4);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
