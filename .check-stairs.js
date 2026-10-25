import * as THREE from 'three';
import { computeStairDesign, stairDesignForItem, stairLocalToPlanPoint } from './features/stairs/design.js';
import { OUTDOOR_SYSTEMS, computeOutdoorStair, outdoorBomCsv } from './features/stairs/outdoor.js';
import { buildStairAssembly, assemblySummary, findStairClashes, stairSectionProfile } from './features/stairs/assembly.js';
import { PART_LIBRARY, partsByCategory, buildPartWireframe, partSize } from './features/stairs/parts.js';
import { buildStairGeometry } from './features/stairs/geometry.js';
import { createStairHeightField } from './features/stairs/walk.js';
import { computeWaterFeature, waterDesignForItem, waterSummary, planOutline, surfaceArea } from './features/landscape/design.js';
import { buildWaterFeature } from './features/landscape/geometry.js';

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
    check('2R + T lands on 25 in', Math.abs(straight.comfort.valueIn - 25) < 0.01, `${straight.comfort.valueIn.toFixed(2)} in`);
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

    const design = stairDesignForItem(item, 2.7);
    check('item design reads the stair config', near(design.width, 0.9144), `${design.width} m`);
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
