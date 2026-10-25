import * as THREE from 'three';
import { PIXELS_PER_METER, WALL_HEIGHT } from './world-space.js';
import { pickItemId } from './scene-gizmo.js';
import { inSameRun, snapAlongAxis, snapVertically, ELEVATION_SNAP } from './elevation-snap.js';

/**
 * Elevation views for the 3D preview.
 *
 * A side elevation is an orthographic camera looking straight at the plan from
 * one of the four sides, so a wall of cabinetry reads flat: the screen's
 * horizontal axis runs along the wall, the vertical axis is height above the
 * floor. In that view pieces can be dragged up/down and side to side, and each
 * drag snaps to the pieces of the same run (butt joints and stacking).
 *
 * Walls between the camera and the plan centre are hidden so the run behind
 * them stays visible - the look of a drawing, not a walk-through.
 */

export const ELEVATION_SIDES = ['front', 'back', 'left', 'right'];

/**
 * Plan-space axes for a side.
 *   normal  unit plan vector pointing from the plan toward the camera
 *   axis    unit plan vector along the screen's horizontal axis
 * (world x -> plan x, world z -> plan y)
 */
export function elevationAxes(side) {
    switch (side) {
        case 'front': return { normal: { x: 0, y: 1 }, axis: { x: 1, y: 0 } };
        case 'back': return { normal: { x: 0, y: -1 }, axis: { x: -1, y: 0 } };
        case 'left': return { normal: { x: -1, y: 0 }, axis: { x: 0, y: 1 } };
        case 'right': return { normal: { x: 1, y: 0 }, axis: { x: 0, y: -1 } };
        default: return null;
    }
}

const span = (min, max) => Math.max(max - min, 1);

/**
 * Framed so the whole run fills the viewport: width of the plan along the
 * view direction and wall height (plus padding). Returns the look-at target.
 */
export function frameElevation(camera, { bounds, side, aspect = 1, height = WALL_HEIGHT, padding = 1.15 } = {}) {
    const axes = elevationAxes(side);
    if (!camera || !axes || !bounds) return null;

    const centreX = (bounds.minX + bounds.maxX) / 2;
    const centreZ = (bounds.minZ + bounds.maxZ) / 2;
    const horizontal = (side === 'front' || side === 'back')
        ? span(bounds.minX, bounds.maxX)
        : span(bounds.minZ, bounds.maxZ);
    const depthSpan = (side === 'front' || side === 'back')
        ? span(bounds.minZ, bounds.maxZ)
        : span(bounds.minX, bounds.maxX);

    const safeAspect = Math.max(aspect || 1, 0.01);
    const halfHeight = Math.max((height * padding) / 2, (horizontal * padding) / 2 / safeAspect);
    const halfWidth = halfHeight * safeAspect;

    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;

    const target = new THREE.Vector3(centreX, height / 2, centreZ);
    const distance = Math.max(horizontal, depthSpan, height) * 1.5 + 6;
    camera.position.set(
        centreX + axes.normal.x * distance,
        height / 2,
        centreZ + axes.normal.y * distance
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target);

    camera.near = 0.1;
    camera.far = distance + Math.max(horizontal, depthSpan, height) * 2 + 20;
    camera.updateProjectionMatrix();

    return target;
}

/**
 * Hide the walls that stand between the camera and the plan centre, so a run
 * on the far wall is not buried behind the near wall. Passing no side (or no
 * bounds) makes every wall visible again.
 */
export function applyElevationVisibility(scene, side, bounds) {
    if (!scene) return;
    const axes = side ? elevationAxes(side) : null;
    const centreX = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
    const centreZ = bounds ? (bounds.minZ + bounds.maxZ) / 2 : 0;
    const point = new THREE.Vector3();

    scene.traverse((object) => {
        if (!object.userData || object.userData.type !== 'wall') return;
        if (!axes || !bounds) {
            object.visible = true;
            return;
        }
        object.getWorldPosition(point);
        const depth = (point.x - centreX) * axes.normal.x + (point.z - centreZ) * axes.normal.y;
        object.visible = depth <= 0;
    });
}

/**
 * Down/up and side-to-side dragging inside an elevation view.
 *
 * Pointer movement is projected onto a vertical plane through the grabbed
 * piece, so the drag follows the drawing: horizontal moves along the run,
 * vertical changes the height off the floor. Both axes snap to the other
 * pieces of the same run while the pointer is held; the mesh is moved
 * directly during the drag (no CSG rebuild per frame) and rebuilt on release.
 */
export function createElevationDrag({
    scene,
    domElement,
    getCamera,
    getSide,
    getView,
    getFixtures,
    getObject,
    onDraggingChange,
    onCommit,
    threshold = ELEVATION_SNAP
}) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const plane = new THREE.Plane();
    let drag = null;

    function pointOnPlane(event) {
        const camera = getCamera();
        if (!camera || !domElement) return null;
        const rect = domElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        pointer.set(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(pointer, camera);
        const hit = new THREE.Vector3();
        return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
    }

    function collectOthers(fixture, normal) {
        const fixtures = getFixtures() || [];
        const others = [];
        for (const other of fixtures) {
            if (!other || other.id === fixture.id || other.visible === false) continue;
            if (!inSameRun(fixture, other, normal)) continue;
            const object = getObject(other.id);
            if (!object) continue; // no mesh yet (async model, or not built)
            const box = new THREE.Box3().setFromObject(object);
            if (!Number.isFinite(box.min.y) || !Number.isFinite(box.max.y)) continue;
            others.push({ fixture: other, bottom: box.min.y, top: box.max.y });
        }
        return others;
    }

    function startDrag(event) {
        if (!drag) {
            const side = getSide();
            if (!side) return;
            const camera = getCamera();
            if (!camera || !scene) return;
            const id = pickItemId(scene, camera, domElement, event);
            if (!id) return;

            const fixture = (getFixtures() || []).find((f) => f.id === id);
            const object = getObject(id);
            // Locked and hidden pieces cannot be lifted either.
            if (!fixture || !object || fixture.locked || fixture.visible === false) return;

            const axes = elevationAxes(side);
            const box = new THREE.Box3().setFromObject(object);
            if (!Number.isFinite(box.min.y)) return;
            const centre = box.getCenter(new THREE.Vector3());
            plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(axes.normal.x, 0, axes.normal.y), centre);

            const start = pointOnPlane(event);
            if (!start) return;

            const lift = fixture.elevation || 0;
            drag = {
                fixture,
                object,
                axes,
                start,
                startX: fixture.x,
                startY: fixture.y,
                startObjectY: object.position.y,
                startBottom: box.min.y,
                defaultBottom: box.min.y - lift,
                height: box.max.y - box.min.y,
                others: collectOthers(fixture, axes.normal),
                moved: false,
                bottom: box.min.y
            };
            onDraggingChange?.(true);
        }
    }

    function moveDrag(event) {
        if (!drag) return;
        const hit = pointOnPlane(event);
        if (!hit) return;

        const { fixture, object, axes, start } = drag;
        const view = getView ? getView() : { width: 0, height: 0 };

        // Screen-horizontal -> along the run
        const alongDelta = (hit.x - start.x) * axes.axis.x + (hit.z - start.z) * axes.axis.y;
        fixture.x = drag.startX + axes.axis.x * alongDelta * PIXELS_PER_METER;
        fixture.y = drag.startY + axes.axis.y * alongDelta * PIXELS_PER_METER;

        const runFixtures = drag.others.map((other) => other.fixture);
        const joint = snapAlongAxis(fixture, runFixtures, axes.axis, { threshold });
        if (joint.snapped) {
            fixture.x += axes.axis.x * joint.delta * PIXELS_PER_METER;
            fixture.y += axes.axis.y * joint.delta * PIXELS_PER_METER;
        }

        // Screen-vertical -> height off the floor
        let bottom = Math.max(0, drag.startBottom + (hit.y - start.y));
        const stack = snapVertically(
            { bottom, top: bottom + drag.height },
            drag.others,
            { threshold, floor: 0 }
        );
        bottom = Math.min(stack.bottom, Math.max(0, WALL_HEIGHT - drag.height));
        bottom = Math.max(0, bottom);

        drag.bottom = bottom;
        fixture.elevation = bottom - drag.defaultBottom;

        // Live preview of the real mesh; the engine rebuild waits for release.
        object.position.set(
            (fixture.x - view.width / 2) / PIXELS_PER_METER,
            drag.startObjectY + (bottom - drag.startBottom),
            (fixture.y - view.height / 2) / PIXELS_PER_METER
        );

        if (Math.abs(alongDelta) > 0.005 || Math.abs(hit.y - start.y) > 0.005) drag.moved = true;
    }

    function endDrag() {
        if (!drag) return;
        const finished = drag;
        drag = null;
        onDraggingChange?.(false);
        if (finished.moved) onCommit?.(finished.fixture);
    }

    const onPointerDown = (event) => {
        if (event.button !== 0) return;
        startDrag(event);
    };
    const onPointerMove = (event) => {
        moveDrag(event);
    };
    const onPointerUp = () => {
        endDrag();
    };
    const onPointerCancel = () => {
        endDrag();
    };

    if (domElement) {
        domElement.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
    }

    return {
        begin: startDrag,
        move: moveDrag,
        end: endDrag,
        get dragging() { return Boolean(drag); },
        dispose() {
            drag = null;
            if (!domElement) return;
            domElement.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
        }
    };
}
