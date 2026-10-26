import * as THREE from 'three';
import { Wall, ItemFactory } from './items.js';
import { INCH, PIXELS_PER_METER } from './world-space.js';
import {
    constructionOptions,
    storeyConstruction,
    WALL_HEIGHT_M,
    JOIST_DEPTH_M,
    STOREY_PITCH_M,
    WALL_HEIGHT_IN,
    JOIST_DEPTH_IN,
    TRUSS_SPACING_M
} from './features/studio/construction.js';
import {
    newStorey,
    addStorey,
    activateStorey,
    syncActiveStorey,
    storeyStack,
    engineStories
} from './features/studio/storeys.js';
import { exteriorWallIds, shellCloneSpec } from './features/studio/shell.js';
import {
    rectOpening,
    polygonArea,
    openingAreaMetres,
    pointInPolygon,
    openingAt,
    vertexAt,
    edgeAt,
    moveVertex,
    insertVertex,
    removeVertex,
    moveOpening,
    openingToWorld,
    cloneOpenings,
    openingCentroid
} from './features/studio/openings-plan.js';
import { buildTrussRoof } from './features/studio/roof.js';
import { textureUrlFor } from './metadata.js';
import { wallFinishOf } from './features/wall-finish.js';
import {
    WALK,
    clearanceToWalls,
    walkStartPoint,
    canvasToWorld,
    worldToCanvas
} from './features/studio/walk-mode.js';

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

console.log('\nStorey construction');
check('walls are 96 in', WALL_HEIGHT_IN === 96 && near(WALL_HEIGHT_M, 96 * INCH), `${WALL_HEIGHT_M.toFixed(4)} m`);
check('floor structure is 8 in', JOIST_DEPTH_IN === 8 && near(JOIST_DEPTH_M, 8 * INCH), `${JOIST_DEPTH_M.toFixed(4)} m`);
check('pitch is wall plus joist', near(STOREY_PITCH_M, WALL_HEIGHT_M + JOIST_DEPTH_M), `${STOREY_PITCH_M.toFixed(4)} m`);
check('pitch in feet and inches', near(STOREY_PITCH_M / INCH, 104), '104 in floor to floor');

const defaultConstruction = constructionOptions();
check('construction options default to 96 + 8', near(defaultConstruction.wallHeight, WALL_HEIGHT_M) && near(defaultConstruction.floorDepth, JOIST_DEPTH_M));
check('legacy height mirrors the pitch', near(defaultConstruction.height, STOREY_PITCH_M));

const custom = constructionOptions({ wallHeight: 3, floorDepth: 0.254 });
check('construction options accept a taller wall', near(custom.height, 3.254), `${custom.height} m`);

const fallback = storeyConstruction({ wallHeight: -4, floorDepth: 'x' });
check('unreadable parts fall back to 96 + 8', near(fallback.pitch, STOREY_PITCH_M), `${fallback.pitch.toFixed(3)} m`);
check('ceiling band matches the floor depth', near(fallback.ceilingDepth, JOIST_DEPTH_M));

const legacy = storeyConstruction({ height: 2.7 });
check('legacy storey keeps its floor-to-floor pitch', near(legacy.pitch, 2.7), `${legacy.pitch.toFixed(3)} m`);
check('legacy pitch takes the joist out of the wall', near(legacy.wallHeight, 2.7 - JOIST_DEPTH_M));

console.log('\nStoreys as floors');
const fresh = newStorey({ name: 'Attic' });
check('new storey carries the construction parts', near(fresh.wallHeight, WALL_HEIGHT_M) && near(fresh.floorDepth, JOIST_DEPTH_M) && near(fresh.height, STOREY_PITCH_M));
check('new storey starts empty', fresh.walls.length === 0 && fresh.fixtures.length === 0 && fresh.openings.length === 0);
check('new storey is visible', fresh.visible === true);

const state = { stories: [{ ...fresh, id: 'ground', name: 'Ground floor' }], currentStoryIndex: 0, walls: [], fixtures: [] };
state.stories[0].walls = state.walls;
state.stories[0].fixtures = state.fixtures;

const first = addStorey(state);
check('adding a storey names it by index', first.name === 'Floor 2', first.name);
check('storey count grows', state.stories.length === 2);
check('added storey uses 96 + 8', near(first.height, STOREY_PITCH_M));

const second = addStorey(state);
const stack = storeyStack(state.stories);
check('stack counts every storey', stack.length === 3);
check('ground floor starts at 0', near(stack[0].elevation, 0));
check('second floor sits one pitch up', near(stack[1].elevation, STOREY_PITCH_M), `${stack[1].elevation.toFixed(3)} m`);
check('third floor stacks again', near(stack[2].elevation, STOREY_PITCH_M * 2), `${stack[2].elevation.toFixed(3)} m`);
check('stack reports the wall and joist parts', near(stack[1].wallHeight, WALL_HEIGHT_M) && near(stack[1].floorDepth, JOIST_DEPTH_M));

state.walls.push(new Wall(0, 0, 100, 0));
syncActiveStorey(state);
check('active arrays write back to their storey', state.stories[0].walls.length === 1);

activateStorey(state, 1);
check('activating a storey swaps the active arrays', state.currentStoryIndex === 1 && state.walls === state.stories[1].walls);
check('activating a storey clears the selection', state.selectedFixture === null && state.selectedWallId === null);

state.stories[1].openings = [rectOpening({ x: 0, y: 0 }, { x: 60, y: 60 })];
const engine = engineStories(state);
check('engine stories carry openings', engine[1].openings.length === 1);
check('engine stories carry the pitch', near(engine[1].height, STOREY_PITCH_M));
check('engine stories keep visibility', engine.every((story) => story.visible !== false));

console.log('\nExterior shell copy');
const view = { width: 600, height: 600 };
const rectangle = [
    new Wall(100, 100, 500, 100), // top
    new Wall(500, 100, 500, 400), // right
    new Wall(500, 400, 100, 400), // bottom
    new Wall(100, 400, 100, 100) // left
];
const partition = new Wall(300, 100, 300, 400);
const plan = { walls: [...rectangle, partition], fixtures: [], openings: [] };

const exterior = exteriorWallIds(plan.walls, view);
check('four exterior walls found', exterior.size === 4, `${exterior.size} of ${plan.walls.length}`);
check('interior partition is not exterior', !exterior.has(partition.id));

const upperWindow = ItemFactory.create('window', 300, 100, 0);
upperWindow.boundToWallId = rectangle[0].id;
const looseWindow = ItemFactory.create('window', 500, 250, Math.PI / 2);
looseWindow.boundToWallId = 'deleted_wall';
const strayWindow = ItemFactory.create('window', 580, 560, 0);
strayWindow.boundToWallId = null;
plan.fixtures = [upperWindow, looseWindow, strayWindow];

const spec = shellCloneSpec(plan, view);
check('shell keeps only the exterior walls', spec.walls.length === 4, `${spec.walls.length} walls`);
check('shell walls repeat the footprint', spec.walls.every((wall, index) => near(wall.start.x, rectangle[index].start.x) && near(wall.end.y, rectangle[index].end.y)));
check('shell copies the windows', spec.windows.length === 2, `${spec.windows.length} windows`);
check('windows rebind to the empty shell', spec.windows.every(({ wallIndex }) => wallIndex >= 0 && wallIndex < spec.walls.length));
check('window on a removed wall finds the nearest shell wall', spec.windows.some(({ fixture }) => fixture === looseWindow));
check('stray window is dropped', !spec.windows.some(({ fixture }) => fixture === strayWindow));

const partitionsOnly = exteriorWallIds([partition], view);
check('an open plan treats walls as exterior', partitionsOnly.size === 1);

console.log('\nCutout openings');
const opening = rectOpening({ x: 200, y: 120 }, { x: 155, y: 90 });
check('rectangle normalises the drag', opening.points[0].x === 155 && opening.points[0].y === 90 && opening.points[2].x === 200 && opening.points[2].y === 120);
check('rectangle has four corners', opening.points.length === 4);

const square = rectOpening({ x: 0, y: 0 }, { x: 45, y: 30 });
check('area uses world metres', near(openingAreaMetres(square), 1.5, 1e-9), `${openingAreaMetres(square).toFixed(2)} m²`);
check('polygon area helper agrees', near(polygonArea(square.points), 45 * 30));

const point = { x: 20, y: 15 };
check('point inside the cutout', pointInPolygon(point, square.points));
check('point outside the cutout', !pointInPolygon({ x: 80, y: 15 }, square.points));
check('opening hit-test returns the polygon', openingAt([square], point) === square);
check('centroid is the middle', near(openingCentroid(square).x, 22.5) && near(openingCentroid(square).y, 15));

const corner = { x: 45, y: 30 };
check('corner hit-test finds a point', vertexAt(square, corner) === 2);
check('corner hit-test respects tolerance', vertexAt(square, { x: 60, y: 30 }) === -1);
check('edge hit-test finds an edge', edgeAt(square, { x: 22.5, y: 0 }) === 0);

const withPoint = insertVertex(square, 0, { x: 22.5, y: 0 });
check('inserting a point bends the edge', square.points.length === 5 && near(square.points[1].x, 22.5) && near(square.points[1].y, 0));

moveVertex(square, 1, { x: 24, y: -4 });
check('dragging a point moves it', near(square.points[1].x, 24) && near(square.points[1].y, -4));

const fourPoint = rectOpening({ x: 0, y: 0 }, { x: 60, y: 60 });
check('a point can be removed', removeVertex(fourPoint, 0) && fourPoint.points.length === 3);
check('a triangle keeps its last three points', removeVertex(fourPoint, 0) === false && fourPoint.points.length === 3);

const moved = rectOpening({ x: 0, y: 0 }, { x: 30, y: 30 });
moveOpening(moved, 15, -10);
check('the whole hole can be moved', moved.points.every((entry) => entry.x >= 15 && entry.y >= -10 && entry.y <= 20));

const centredView = { width: 600, height: 600 };
const centredHole = rectOpening({ x: 285, y: 285 }, { x: 315, y: 315 });
const world = openingToWorld(centredHole, centredView);
check('plan pixels map to world metres', near(world[0].x, -0.5) && near(world[0].z, -0.5), `${world[0].x} / ${world[0].z}`);
check('a centred 1 m hole is 1 m wide', near(world[1].x - world[0].x, 1));

const cloned = cloneOpenings([square]);
cloned[0].points[0].x = 999;
check('cloning openings is a deep copy', square.points[0].x !== 999);

console.log('\nTruss roof');
const roofWalls = [
    new Wall(100, 100, 500, 100),
    new Wall(500, 100, 500, 400),
    new Wall(500, 400, 100, 400),
    new Wall(100, 400, 100, 100)
];
const roof = buildTrussRoof(THREE, { walls: roofWalls, view });
const counts = { truss: 0, joist: 0, plane: 0, band: 0, king: 0, web: 0, bottom: 0, chord: 0 };
roof.traverse((child) => {
    if (child.name === 'roof-truss') counts.truss += 1;
    // Repeated joists and rim bands are one InstancedMesh now; count what it
    // draws rather than counting scene nodes.
    if (child.name === 'roof-ceiling-joists' && child.isInstancedMesh) counts.joist += child.count;
    else if (child.name === 'roof-ceiling-joist') counts.joist += 1;
    if (child.name === 'roof-plane') counts.plane += 1;
    if (child.name === 'roof-joist-bands' && child.isInstancedMesh) counts.band += child.count;
    else if (child.name === 'roof-joist-band') counts.band += 1;
    if (child.name === 'truss-king-post') counts.king += 1;
    if (child.name === 'truss-web') counts.web += 1;
    if (child.name === 'truss-bottom-chord') counts.bottom += 1;
    if (child.name === 'truss-top-chord') counts.chord += 1;
});

const expectedTrusses = Math.ceil((400 / PIXELS_PER_METER) / TRUSS_SPACING_M) + 1;
check('truss roof is grouped', roof.name === 'truss-roof');
check('trusses run at 24 in o.c.', counts.truss === expectedTrusses, `${counts.truss} trusses (expected ${expectedTrusses})`);
check('one ceiling joist per truss', counts.joist === counts.truss, `${counts.joist} joists`);
check('the 8 in band runs around the shell', counts.band === 4, `${counts.band} bands`);
check('two roof planes', counts.plane === 2);
check('every truss has a king post', counts.king === counts.truss);
check('every truss has four webs', counts.web === counts.truss * 4, `${counts.web} webs`);
check('every truss has bottom and top chords', counts.bottom === counts.truss && counts.chord === counts.truss * 2);
check('ridge runs along the long side', near(roof.userData.span, 300 / PIXELS_PER_METER, 1e-6) && near(roof.userData.length, 400 / PIXELS_PER_METER, 1e-6),
    `${roof.userData.span.toFixed(1)} × ${roof.userData.length.toFixed(1)} m`);
check('roof rise is capped', roof.userData.rise <= 2.4 && roof.userData.rise > 0.7, `${roof.userData.rise.toFixed(2)} m`);

const joistBand = roof.children.find((child) => child.name === 'roof-joist-bands' || child.name === 'roof-joist-band');
const bandMatrix = new THREE.Matrix4();
if (joistBand?.isInstancedMesh) joistBand.getMatrixAt(0, bandMatrix);
const bandY = joistBand?.isInstancedMesh
    ? new THREE.Vector3().setFromMatrixPosition(bandMatrix).y
    : joistBand?.position.y;
check('band sits in the joist space', counts.band === roofWalls.length
    && bandY < STOREY_PITCH_M - WALL_HEIGHT_M + 0.001, `${counts.band} bands at y=${Number(bandY || 0).toFixed(3)}`);

const emptyRoof = buildTrussRoof(THREE, { walls: [], view });
check('no walls means no roof', emptyRoof.children.length === 0);

const tinyRoof = buildTrussRoof(THREE, { walls: [new Wall(100, 100, 105, 100), new Wall(105, 100, 105, 105)], view });
check('a sliver footprint is skipped', tinyRoof.children.length === 0);

const customRoof = buildTrussRoof(THREE, { walls: roofWalls, view, spacing: 1.2, joistDepth: 0.4 });
const customTrusses = [];
customRoof.traverse((child) => { if (child.name === 'roof-truss') customTrusses.push(child); });
check('spacing controls the truss count', customTrusses.length === Math.ceil((400 / PIXELS_PER_METER) / 1.2) + 1, `${customTrusses.length} trusses`);
check('custom joist depth lifts the trusses', customTrusses[0].position.y >= 0.4 - 1e-6);

console.log('\nFinishes');
check('wall presets resolve to a texture URL', textureUrlFor('marble', 'walls') === '/textures/marble_wall.jpg');
check('floor presets resolve to a texture URL', textureUrlFor('wood', 'floors') === '/textures/wood_floor.jpg');
check('uploaded images pass through', textureUrlFor('data:image/png;base64,AAAA', 'walls') === 'data:image/png;base64,AAAA');
check('unknown keys resolve to nothing', textureUrlFor('velvet', 'walls') === null && textureUrlFor(null) === null);

const finishedWall = { id: 'w1' };
const uploaded = wallFinishOf(finishedWall, { w1: { texture: 'data:image/png;base64,AAAA' } });
check('a wall finish accepts an uploaded image', uploaded.textureUrl === 'data:image/png;base64,AAAA');
const presetWall = wallFinishOf(finishedWall, { w1: { texture: 'wood' } });
check('a wall finish resolves its preset', presetWall.textureUrl === '/textures/wood_wall.jpg');
check('the storey default only names the texture', wallFinishOf(finishedWall, {}, 'paint').textureUrl === null);

console.log('\nFirst-person walk');
const walkWalls = [
    new Wall(0, 0, 300, 0),
    new Wall(300, 0, 300, 300),
    new Wall(300, 300, 0, 300),
    new Wall(0, 300, 0, 0)
];
check('eye height is 1.6 m', WALK.eyeHeight === 1.6 && WALK.radius > 0.2);
check('the room centre is clear', near(clearanceToWalls({ x: 150, y: 150 }, walkWalls), 5, 1e-9), `${clearanceToWalls({ x: 150, y: 150 }, walkWalls).toFixed(2)} m`);
check('standing on a wall has no clearance', near(clearanceToWalls({ x: 150, y: 0 }, walkWalls), 0));
check('no walls means the canvas centre', near(walkStartPoint([], { width: 600, height: 400 }).x, 300));
check('the walk starts at the footprint centre', near(walkStartPoint(walkWalls, { width: 600, height: 600 }).x, 150));

const eye = canvasToWorld({ x: 300, y: 300 }, { width: 600, height: 600 }, 2.64 + 1.6);
check('the canvas centre maps to the world origin', near(eye.x, 0) && near(eye.z, 0), `${eye.x}, ${eye.z}`);
check('the eye sits above the storey elevation', near(eye.y, 4.24));
const back = worldToCanvas({ x: 1, z: -2 }, { width: 600, height: 600 });
check('world points map back to the plan', near(back.x, 330) && near(back.y, 240), `${back.x}, ${back.y}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
