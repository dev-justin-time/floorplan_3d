import * as THREE from 'three';
import { PIXELS_PER_METER } from '../../world-space.js';
import { stairDesignForItem } from './design.js';
import { buildStairAssembly } from './assembly.js';

/**
 * Stair geometry.
 *
 * The run is built in stair-local metres; the assembly adds the top and bottom
 * landings (automatic unless the assembly disables them), the outdoor footings
 * and guard, and the support type. The returned root group sits at y = 0 on the
 * lower floor with its footprint centred on the item origin, so the engine can
 * place it like any other fixture.
 */

const TREAD_THICKNESS = 0.045;
const RISER_THICKNESS = 0.028;
const RAIL_HEIGHT = 0.9;
const POST_RADIUS = 0.018;

function materials(color = 0x8b5a2b) {
    return {
        tread: new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 }),
        riser: new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.8 }),
        stringer: new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5, metalness: 0.4 }),
        rail: new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.35, metalness: 0.75 }),
        column: new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.3, metalness: 0.8 }),
        concrete: new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.95 }),
        footing: new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.95 }),
        warning: new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.6 })
    };
}

function mesh(geometry, material, { cast = true } = {}) {
    const object = new THREE.Mesh(geometry, material);
    object.castShadow = cast;
    object.receiveShadow = true;
    return object;
}

function addRail(group, points, mat) {
    if (points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points);
    const rail = mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), 0.025, 6, false), mat);
    group.add(rail);
}

function addPost(group, x, y, z, mat, height = RAIL_HEIGHT) {
    const post = mesh(new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, height, 6), mat);
    post.position.set(x, y + height / 2, z);
    group.add(post);
}

function sectorShape(inner, outer, a0, a1, clockwise) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outer, a0, a1, clockwise);
    shape.absarc(0, 0, inner, a1, a0, !clockwise);
    shape.closePath();
    return shape;
}

function sectorTread(inner, outer, a0, a1, top, clockwise, treadMaterial) {
    const shape = sectorShape(inner, outer, a0, a1, clockwise);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: TREAD_THICKNESS, bevelEnabled: false, curveSegments: 10 });
    // Shape XY -> world XZ; extrusion depth becomes thickness below the top.
    geometry.rotateX(Math.PI / 2);
    const tread = mesh(geometry, treadMaterial);
    tread.position.y = top;
    return tread;
}

function straightStair(design, mats) {
    const group = new THREE.Group();
    const { width, rise, risers, treadDepth, runUsed } = design;
    const run = runUsed;

    for (let i = 0; i < risers - 1; i++) {
        const top = (i + 1) * rise;
        const z = -run / 2 + (i + 0.5) * treadDepth;
        const tread = mesh(new THREE.BoxGeometry(width, TREAD_THICKNESS, treadDepth + 0.02), mats.tread);
        tread.position.set(0, top - TREAD_THICKNESS / 2, z);
        group.add(tread);

        const riser = mesh(new THREE.BoxGeometry(width, rise, RISER_THICKNESS), mats.riser);
        riser.position.set(0, top - rise / 2, z - treadDepth / 2 + 0.01);
        group.add(riser);
    }

    // Sloped stringers on both sides.
    const length = Math.hypot(run, rise);
    [-1, 1].forEach((side) => {
        const stringer = mesh(new THREE.BoxGeometry(0.06, 0.26, length), mats.stringer);
        stringer.position.set(side * (width / 2 + 0.03), rise / 2 + 0.02, 0);
        stringer.rotation.x = -Math.atan2(rise, run);
        group.add(stringer);

        const railPoints = [];
        for (let i = 0; i < risers - 1; i += 2) {
            const z = -run / 2 + (i + 0.5) * treadDepth;
            const top = (i + 1) * rise;
            addPost(group, side * (width / 2 - 0.04), top, z, mats.rail);
        }
        for (let i = 0; i < risers - 1; i++) {
            const z = -run / 2 + (i + 0.5) * treadDepth;
            railPoints.push(new THREE.Vector3(side * (width / 2 - 0.04), (i + 1) * rise + RAIL_HEIGHT, z));
        }
        addRail(group, railPoints, mats.rail);
    });

    return group;
}

function curvedStair(design, mats) {
    const group = new THREE.Group();
    const { innerRadius, outerRadius, walklineRadius, startAngle, sweep, direction, treads, rise } = design;

    for (let i = 0; i < treads; i++) {
        const a0 = startAngle + direction * sweep * (i / treads);
        const a1 = startAngle + direction * sweep * ((i + 1) / treads);
        const top = (i + 1) * rise;
        group.add(sectorTread(innerRadius, outerRadius, a0, a1, top, direction < 0, mats.tread));

        // Landing edge is the top of the flight; the floor above closes it.
        if (i % 2 === 0) {
            const angle = (a0 + a1) / 2;
            addPost(group, outerRadius * Math.cos(angle), top, outerRadius * Math.sin(angle), mats.rail);
        }
    }

    const railPoints = [];
    for (let i = 0; i <= treads; i++) {
        const angle = startAngle + direction * sweep * (i / treads);
        railPoints.push(new THREE.Vector3(
            (outerRadius - 0.03) * Math.cos(angle),
            Math.min(i + 1, treads) * rise + RAIL_HEIGHT,
            (outerRadius - 0.03) * Math.sin(angle)
        ));
    }
    addRail(group, railPoints, mats.rail);

    // Newel at the bottom and a slim stringer band under the walkline.
    addPost(group, walklineRadius * Math.cos(startAngle), 0, walklineRadius * Math.sin(startAngle), mats.rail, RAIL_HEIGHT + 0.15);
    return group;
}

function spiralStair(design, mats) {
    const group = new THREE.Group();
    const { columnRadius, outerRadius, startAngle, sweep, treads, rise } = design;

    const column = mesh(new THREE.CylinderGeometry(columnRadius, columnRadius, rise, 16), mats.column);
    column.position.y = rise / 2;
    group.add(column);

    for (let i = 0; i < treads; i++) {
        const a0 = startAngle + sweep * (i / treads);
        const a1 = startAngle + sweep * ((i + 1) / treads);
        const top = (i + 1) * rise;
        group.add(sectorTread(columnRadius, outerRadius, a0, a1, top, false, mats.tread));
        if (i % 2 === 0) {
            const angle = (a0 + a1) / 2;
            addPost(group, (outerRadius - 0.03) * Math.cos(angle), top, (outerRadius - 0.03) * Math.sin(angle), mats.rail);
        }
    }

    const railPoints = [];
    for (let i = 0; i <= treads * 2; i++) {
        const s = i / (treads * 2);
        const angle = startAngle + sweep * s;
        railPoints.push(new THREE.Vector3(
            (outerRadius - 0.03) * Math.cos(angle),
            s * rise + RAIL_HEIGHT,
            (outerRadius - 0.03) * Math.sin(angle)
        ));
    }
    addRail(group, railPoints, mats.rail);
    return group;
}

function firePole(design, mats) {
    const group = new THREE.Group();
    const { rise, pole } = design;
    const radius = pole.diameter / 2;
    const top = rise + pole.aboveFloor;

    const shaft = mesh(new THREE.CylinderGeometry(radius, radius, top + 0.05, 20), mats.column);
    shaft.position.y = top / 2;
    shaft.name = 'fire-pole-shaft';
    group.add(shaft);

    const flange = mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.02, 24), mats.column);
    flange.position.y = 0.01;
    group.add(flange);

    // Escutcheon at the upper floor and the anti-skid landing mat.
    const ring = mesh(new THREE.TorusGeometry(pole.opening / 2, 0.025, 8, 32), mats.stringer);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = rise;
    group.add(ring);

    if (pole.landingMat) {
        const mat = mesh(new THREE.RingGeometry(radius + 0.01, pole.mat / 2, 32), mats.warning, { cast: false });
        mat.rotation.x = -Math.PI / 2;
        mat.position.y = rise + 0.012;
        group.add(mat);
    }

    if (pole.guard) {
        const guardRadius = pole.opening / 2 + 0.06;
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
            addPost(group, guardRadius * Math.cos(angle), rise, guardRadius * Math.sin(angle), mats.rail, pole.guardHeight);
        }
        const guard = mesh(new THREE.TorusGeometry(guardRadius, 0.022, 6, 30), mats.rail);
        guard.rotation.x = Math.PI / 2;
        guard.position.y = rise + pole.guardHeight;
        group.add(guard);
    }

    // Warning sign above the opening.
    const sign = mesh(new THREE.BoxGeometry(0.22, 0.16, 0.015), mats.warning);
    sign.position.set(0, rise + 1.35, -0.32);
    group.add(sign);

    return group;
}

/** Depth of a landing stone/tread platform. */
const LANDING_THICKNESS = 0.06;

/**
 * Add a landing platform at the entry or exit of the run.
 * `end` is 1 for the top landing, 0 for the bottom one.
 */
function addLanding(group, design, assembly, end, mats) {
    const landing = end === 1 ? assembly.subTypes.landing.top : assembly.subTypes.landing.bottom;
    if (!landing?.enabled || !design.path) return;
    const t = end;
    const width = landing.width || design.width;
    const depth = landing.depth;
    if (!(depth > 0)) return;

    const point = design.path.pointAt(t);
    const tangent = design.path.tangentAt(t);
    const direction = end === 1 ? 1 : -1;
    const height = end === 1 ? design.rise : 0;
    const platform = mesh(
        new THREE.BoxGeometry(width, LANDING_THICKNESS, depth),
        assembly.structure === 'concrete' ? mats.concrete : mats.tread
    );
    platform.position.set(
        point.x + tangent.x * direction * (depth / 2 + landing.offset),
        height + LANDING_THICKNESS / 2,
        point.z + tangent.z * direction * (depth / 2 + landing.offset)
    );
    platform.rotation.y = -Math.atan2(tangent.x, tangent.z);
    platform.name = end === 1 ? 'top-landing' : 'bottom-landing';
    platform.userData = { landing: end === 1 ? 'top' : 'bottom', depth, width };
    group.add(platform);

    // Guard posts at the free corners of the landing.
    if (assembly.design?.guard?.required !== false) {
        const sideX = -tangent.z;
        const sideZ = tangent.x;
        [-1, 1].forEach((side) => {
            const x = platform.position.x + (sideX * side * width) / 2;
            const z = platform.position.z + (sideZ * side * width) / 2;
            addPost(group, x, height, z, mats.rail, 1.0);
        });
    }
}

/** Outdoor structure: piers under the stringers and posts at the landing. */
function addOutdoorStructure(group, design, assembly, mats) {
    if (!assembly?.system) return;
    const spec = assembly.design?.spec;
    if (!spec || spec.structure === 'concrete' || !spec.footingDepth) return;
    const depth = spec.footingDepth;
    const width = design.width;
    const run = design.runUsed || 0;
    [-1, 1].forEach((side) => {
        [0, 1].forEach((end) => {
            const z = end ? run / 2 : -run / 2;
            const footing = mesh(new THREE.CylinderGeometry(0.15, 0.15, depth, 14), mats.footing, { cast: false });
            footing.position.set(side * width / 2, -depth / 2, z);
            footing.name = 'pier-footing';
            group.add(footing);
        });
    });
}

/**
 * Build the 3D stair/pole for an item. Returns a Group at local y = 0 (the lower
 * floor), footprint centred on the item origin.
 */
export function buildStairGeometry(item, { storeyHeight, color = 0x8b5a2b, design = null } = {}) {
    const resolved = design || stairDesignForItem(item, storeyHeight);
    const assembly = buildStairAssembly({
        design: resolved,
        system: item?.stair?.system || null,
        structure: item?.stair?.structure,
        support: item?.stair?.support,
        material: item?.stair?.material,
        nosing: item?.stair?.nosing,
        baseElevation: 0,
        landings: item?.stair?.landings,
        nosingEnabled: item?.stair?.nosingEnabled
    });
    const mats = materials(color);
    let inner;

    if (resolved.type === 'fire-pole') {
        inner = firePole(resolved, mats);
    } else if (resolved.type === 'spiral') {
        inner = spiralStair(resolved, mats);
    } else if (resolved.type === 'curve-right' || resolved.type === 'curve-left') {
        inner = curvedStair(resolved, mats);
    } else {
        inner = straightStair(resolved, mats);
        addLanding(inner, resolved, assembly, 1, mats);
        addLanding(inner, resolved, assembly, 0, mats);
        addOutdoorStructure(inner, resolved, assembly, mats);
    }

    inner.position.set(-resolved.offset.x, 0, -resolved.offset.z);
    inner.userData = {
        type: 'stair',
        stairType: resolved.type,
        design: resolved,
        assembly,
        walkable: resolved.type !== 'fire-pole'
    };
    inner.name = `stair-${resolved.type}`;

    // The root group is free for the engine to position at the item centre.
    const root = new THREE.Group();
    root.add(inner);
    root.userData = { ...inner.userData };
    return root;
}

/**
 * 2D plan symbol for a stair item, drawn in canvas pixels at the item's plan
 * position and rotation. Shows the footprint, every tread and the up direction.
 */
export function drawStairPlan(ctx, item, { storeyHeight, scale = PIXELS_PER_METER, color = '#475569' } = {}) {
    const design = stairDesignForItem(item, storeyHeight);
    const px = (metres) => metres * scale;
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotation || 0);

    const isSelected = item.selected;
    ctx.strokeStyle = isSelected ? '#f59e0b' : color;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = isSelected ? 3 : 1;

    if (design.type === 'spiral') {
        ctx.beginPath();
        ctx.arc(0, 0, px(design.outerRadius), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, px(design.columnRadius), 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < design.treads; i++) {
            const a = design.startAngle + (i / design.treads) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * px(design.columnRadius), Math.sin(a) * px(design.columnRadius));
            ctx.lineTo(Math.cos(a) * px(design.outerRadius), Math.sin(a) * px(design.outerRadius));
            ctx.stroke();
        }
    } else if (design.type === 'curve-right' || design.type === 'curve-left') {
        const { innerRadius, outerRadius, startAngle, sweep, direction, treads } = design;
        ctx.beginPath();
        ctx.arc(-px(design.offset.x), -px(design.offset.z), px(outerRadius), startAngle, startAngle + direction * sweep, direction < 0);
        ctx.arc(-px(design.offset.x), -px(design.offset.z), px(innerRadius), startAngle + direction * sweep, startAngle, direction > 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        for (let i = 0; i <= treads; i++) {
            const a = startAngle + direction * sweep * (i / treads);
            ctx.beginPath();
            ctx.moveTo(-px(design.offset.x) + Math.cos(a) * px(innerRadius), -px(design.offset.z) + Math.sin(a) * px(innerRadius));
            ctx.lineTo(-px(design.offset.x) + Math.cos(a) * px(outerRadius), -px(design.offset.z) + Math.sin(a) * px(outerRadius));
            ctx.stroke();
        }
    } else {
        const w = px(design.width);
        const run = px(design.runUsed || 0);
        ctx.beginPath();
        ctx.rect(-w / 2, -run / 2, w, run);
        ctx.fill();
        ctx.stroke();
        const tread = px(design.treadDepth || 0);
        ctx.beginPath();
        for (let i = 1; i < (design.treads || 0); i++) {
            const z = -run / 2 + i * tread;
            ctx.moveTo(-w / 2, z);
            ctx.lineTo(w / 2, z);
        }
        ctx.stroke();

        if (design.landingDepth > 0) {
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(-w / 2, run / 2, w, px(design.landingDepth));
            ctx.setLineDash([]);
        }
    }

    // Up arrow along the walkline.
    ctx.strokeStyle = isSelected ? '#b45309' : '#0f172a';
    ctx.beginPath();
    const arrowLength = px(0.5);
    ctx.moveTo(0, px(design.footprint.depth * 0.18));
    ctx.lineTo(0, px(design.footprint.depth * 0.18) - arrowLength);
    ctx.lineTo(-0.1 * scale / 3, px(design.footprint.depth * 0.18) - arrowLength + 0.1 * scale / 3);
    ctx.moveTo(0, px(design.footprint.depth * 0.18) - arrowLength);
    ctx.lineTo(0.1 * scale / 3, px(design.footprint.depth * 0.18) - arrowLength + 0.1 * scale / 3);
    ctx.stroke();

    if (design.type === 'fire-pole') {
        ctx.beginPath();
        ctx.arc(0, 0, px(design.pole.mat) / 2, 0, Math.PI * 2);
        ctx.strokeStyle = '#dc2626';
        ctx.stroke();
    }

    ctx.restore();
    return design;
}

/** Flat plan footprint used by callers that only need size and shape. */
export function stairPlanOutline(item, storeyHeight) {
    const design = stairDesignForItem(item, storeyHeight);
    return {
        design,
        width: design.footprint.width,
        depth: design.footprint.depth,
        shape: design.footprint.shape
    };
}
