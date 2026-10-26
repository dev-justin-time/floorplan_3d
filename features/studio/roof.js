import { PIXELS_PER_METER, ROOF_OVERHANG } from '../../world-space.js';
import { TRUSS_SPACING_M, TRUSS_MEMBER_M, JOIST_DEPTH_M } from './construction.js';

/**
 * Top-storey roof (studio feature 41).
 *
 * The last storey gets an 8 in ceiling/joist band, then a gable truss system:
 * bottom chords, top chords, a king post and two webs per truss at 24 in o.c.,
 * with the roof planes on top. Everything is generated from the wall footprint,
 * so the roof follows the exterior shell.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function footprint(walls = [], view = { width: 1, height: 1 }) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    (walls || []).forEach((wall) => {
        [wall.start, wall.end].forEach((point) => {
            if (!point) return;
            const x = (point.x - view.width / 2) / PIXELS_PER_METER;
            const z = (point.y - view.height / 2) / PIXELS_PER_METER;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        });
    });
    if (!Number.isFinite(minX)) return null;
    return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

function box(THREE, w, h, d, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

/** One truss in its own local plane: span along x, rise along y, member along z. */
function truss(THREE, span, rise, material) {
    const group = new THREE.Group();
    const { width, depth } = TRUSS_MEMBER_M;
    const half = span / 2;
    const chordLength = Math.hypot(half, rise);
    const angle = Math.atan2(rise, half);

    const bottom = box(THREE, span, depth, width, material);
    bottom.position.y = 0;
    bottom.name = 'truss-bottom-chord';
    group.add(bottom);

    [1, -1].forEach((side) => {
        const chord = box(THREE, chordLength, depth, width, material);
        chord.position.set((side * half) / 2, rise / 2, 0);
        chord.rotation.z = side > 0 ? angle : -angle;
        chord.name = 'truss-top-chord';
        group.add(chord);
    });

    const king = box(THREE, width, rise, depth, material);
    king.position.y = rise / 2;
    king.name = 'truss-king-post';
    group.add(king);

    // Two webs each side, from the quarter points up to the top chords. The
    // member is edge-on (3.5 in deep, 1.5 in wide) and leans with the chord.
    [0.5, 0.75].forEach((fraction) => {
        [1, -1].forEach((side) => {
            const x = side * half * fraction;
            const topX = side * half * (fraction / 2);
            const topY = rise * (1 - fraction / 2);
            const webLength = Math.hypot(topX - x, topY);
            const web = box(THREE, webLength, depth, width, material);
            web.position.set((x + topX) / 2, topY / 2, 0);
            web.rotation.z = Math.atan2(topY, topX - x);
            web.name = 'truss-web';
            group.add(web);
        });
    });

    group.userData = { type: 'roof-truss', span, rise };
    return group;
}

/**
 * Build the top storey roof group, placed at the wall top. The group owns the
 * 8 in joist band, the ceiling joists and the trusses, so the engine only has
 * to position it once.
 */
export function buildTrussRoof(THREE, {
    walls = [],
    view = { width: 1, height: 1 },
    overhang = ROOF_OVERHANG,
    spacing = TRUSS_SPACING_M,
    joistDepth = JOIST_DEPTH_M
} = {}) {
    const group = new THREE.Group();
    group.name = 'truss-roof';
    group.userData = { type: 'truss-roof' };
    const plan = footprint(walls, view);
    if (!plan || plan.width < 0.3 || plan.depth < 0.3) return group;

    const ridgeAlongX = plan.width >= plan.depth;
    const span = ridgeAlongX ? plan.depth : plan.width;
    const length = ridgeAlongX ? plan.width : plan.depth;
    const rise = clamp(span * 0.34, 0.7, 2.4);
    const centre = { x: (plan.minX + plan.maxX) / 2, z: (plan.minZ + plan.maxZ) / 2 };

    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x8f6b45, roughness: 0.85 });
    const trussMaterial = new THREE.MeshStandardMaterial({ color: 0xb0895e, roughness: 0.8 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x7f4a3a, roughness: 0.9, metalness: 0.05 });
    const joistMaterial = new THREE.MeshStandardMaterial({ color: 0xa37b52, roughness: 0.85 });

    // 8 in joist/ceiling band around the shell.
    walls.forEach((wall) => {
        if (!wall?.start || !wall?.end) return;
        const x1 = (wall.start.x - view.width / 2) / PIXELS_PER_METER;
        const z1 = (wall.start.y - view.height / 2) / PIXELS_PER_METER;
        const x2 = (wall.end.x - view.width / 2) / PIXELS_PER_METER;
        const z2 = (wall.end.y - view.height / 2) / PIXELS_PER_METER;
        const wallLength = Math.hypot(x2 - x1, z2 - z1);
        if (wallLength < 0.05) return;
        const rim = box(THREE, wallLength, joistDepth, 0.05, rimMaterial);
        rim.position.set((x1 + x2) / 2, joistDepth / 2, (z1 + z2) / 2);
        rim.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        rim.name = 'roof-joist-band';
        group.add(rim);
    });

    const count = Math.max(2, Math.ceil(length / spacing) + 1);
    let trusses = 0;
    let joists = 0;
    for (let i = 0; i < count; i += 1) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const along = -length / 2 + t * length;

        const ceiling = box(THREE, span, 0.038, 0.14, joistMaterial);
        ceiling.position.set(
            ridgeAlongX ? centre.x + along : centre.x,
            joistDepth / 2,
            ridgeAlongX ? centre.z : centre.z + along
        );
        if (ridgeAlongX) ceiling.rotation.y = Math.PI / 2;
        ceiling.name = 'roof-ceiling-joist';
        group.add(ceiling);
        joists += 1;

        const frame = truss(THREE, span, rise, trussMaterial);
        frame.position.set(
            ridgeAlongX ? centre.x + along : centre.x,
            joistDepth,
            ridgeAlongX ? centre.z : centre.z + along
        );
        if (ridgeAlongX) frame.rotation.y = Math.PI / 2;
        frame.name = 'roof-truss';
        group.add(frame);
        trusses += 1;
    }

    // Roof planes, built in the same local frame as the trusses then rotated.
    const roofFrame = new THREE.Group();
    roofFrame.position.set(centre.x, joistDepth, centre.z);
    if (ridgeAlongX) roofFrame.rotation.y = Math.PI / 2;
    const eaveX = span / 2 + overhang;
    const eaveY = -rise * (overhang / (span / 2));
    const slopeLength = Math.hypot(eaveX, rise + eaveY);
    const planeLength = length + overhang * 2;
    [1, -1].forEach((side) => {
        const plane = new THREE.Mesh(new THREE.BoxGeometry(slopeLength, 0.05, planeLength), roofMaterial);
        plane.position.set((side * eaveX) / 2, (rise + eaveY) / 2, 0);
        plane.rotation.z = side > 0 ? -Math.atan2(rise + eaveY, eaveX) : Math.atan2(rise + eaveY, eaveX);
        plane.castShadow = true;
        plane.receiveShadow = true;
        plane.name = 'roof-plane';
        roofFrame.add(plane);
    });
    group.add(roofFrame);

    group.userData = { type: 'truss-roof', trusses, joists, span, length, rise, pitch: rise / (span / 2) };
    return group;
}
