import { PIXELS_PER_METER } from './world-space.js';
import { snapToWalls } from './wall-snap.js';
import { constrainToLocks } from './features/transforms.js';

/**
 * Dragging for plan objects (fixtures, windows, doors).
 *
 * Points are plan-space canvas pixels, the same space the editors store walls
 * and fixtures in. In-wall items re-snap to their wall while dragging, which is
 * what keeps a window's opening attached to the window.
 */

/** Topmost fixture under a plan-space point, or null. */
export function fixtureAt(fixtures, point, { slack = 10 } = {}) {
    for (let i = fixtures.length - 1; i >= 0; i--) {
        const fixture = fixtures[i];
        if (fixture.visible === false) continue;

        const meta = fixture.metadata || {};
        const widthPx = (meta.width || 0.5) * PIXELS_PER_METER;
        const depthPx = (meta.depth || 0.5) * PIXELS_PER_METER;

        // Hit test in the fixture's own rotated frame.
        const rotation = fixture.rotation || 0;
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        const dx = point.x - fixture.x;
        const dy = point.y - fixture.y;
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;

        if (Math.abs(localX) <= widthPx / 2 + slack && Math.abs(localY) <= depthPx / 2 + slack) {
            return fixture;
        }
    }
    return null;
}

/** Capture the grab offset so the object does not jump to the cursor. */
export function beginDrag(fixture, point) {
    if (!fixture) return null;
    return {
        fixture,
        offset: { x: point.x - fixture.x, y: point.y - fixture.y },
        // Where the piece started, so locked axes have something to stay on.
        origin: { x: fixture.x, y: fixture.y }
    };
}

/**
 * Move the dragged object to the cursor with grid snapping, then snap it to a
 * wall: in-wall items ride the centreline (which updates the wall id used for
 * cutting the opening), floor items sit flush against the wall face.
 */
export function dragTo(drag, point, walls, { gridSize = 0, snapThreshold = 20, wallSnap = true } = {}) {
    if (!drag || !drag.fixture) return null;
    const { fixture, offset } = drag;

    let x = point.x - offset.x;
    let y = point.y - offset.y;

    if (gridSize > 0) {
        x = Math.round(x / gridSize) * gridSize;
        y = Math.round(y / gridSize) * gridSize;
    }

    if (typeof fixture.setPosition === 'function') {
        fixture.setPosition(x, y);
    } else {
        fixture.x = x;
        fixture.y = y;
    }

    const meta = fixture.metadata || {};
    if (meta.type === 'in_wall' || meta.type === 'in_wall_floor') {
        if (typeof fixture.snapToWall === 'function') {
            fixture.snapToWall(walls, snapThreshold);
        }
    } else if (wallSnap) {
        // Flush against the nearest wall, width along the wall
        const snapped = snapToWalls(fixture, walls, { threshold: snapThreshold });
        drag.snappedWall = snapped ? snapped.wall : null;
    }

    // Per-axis locks win over everything above: a locked axis keeps the
    // position the gesture started from.
    const constrained = constrainToLocks(fixture, { x: fixture.x, y: fixture.y }, drag.origin);
    fixture.x = constrained.x;
    fixture.y = constrained.y;

    return fixture;
}

/** Cursor for hovering a fixture. */
export function cursorFor(fixtures, point, options) {
    return fixtureAt(fixtures, point, options) ? 'move' : 'default';
}
