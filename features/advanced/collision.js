import { PIXELS_PER_METER } from '../../world-space.js';
import { itemDimensions } from '../../items.js';

/**
 * Advanced feature 21 - collision / overlap detection.
 *
 * Bounding boxes come from the same footprint the snapping code uses
 * (itemDimensions + rotation), so a rotated piece is tested by its real
 * axis-aligned extent. Used for the drag flag and the placement warnings.
 */

const EPSILON = 0.5; // plan pixels; touching edges are not an overlap

export function boundsOf(fixture) {
    const dims = itemDimensions(fixture);
    const width = dims.width * PIXELS_PER_METER;
    const depth = dims.depth * PIXELS_PER_METER;
    const rotation = fixture.rotation || 0;
    const cos = Math.abs(Math.cos(rotation));
    const sin = Math.abs(Math.sin(rotation));

    const halfW = (width * cos + depth * sin) / 2;
    const halfD = (width * sin + depth * cos) / 2;

    return {
        minX: fixture.x - halfW,
        maxX: fixture.x + halfW,
        minY: fixture.y - halfD,
        maxY: fixture.y + halfD
    };
}

export function boxesOverlap(a, b) {
    return a.minX + EPSILON < b.maxX && a.maxX - EPSILON > b.minX
        && a.minY + EPSILON < b.maxY && a.maxY - EPSILON > b.minY;
}

export function intersectionOf(a, b) {
    return {
        minX: Math.max(a.minX, b.minX),
        minY: Math.max(a.minY, b.minY),
        maxX: Math.min(a.maxX, b.maxX),
        maxY: Math.min(a.maxY, b.maxY)
    };
}

/** All overlapping pairs among visible items. */
export function findOverlaps(fixtures = []) {
    const visible = (fixtures || []).filter((fixture) => fixture && fixture.visible !== false);
    const boxes = visible.map(boundsOf);
    const overlaps = [];

    for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
            if (!boxesOverlap(boxes[i], boxes[j])) continue;
            overlaps.push({
                a: visible[i],
                b: visible[j],
                box: intersectionOf(boxes[i], boxes[j])
            });
        }
    }
    return overlaps;
}

/** Pairs involving one fixture, so a drag can flag just the moving piece. */
export function overlapsFor(fixture, fixtures = []) {
    if (!fixture) return [];
    const box = boundsOf(fixture);
    return (fixtures || [])
        .filter((other) => other && other !== fixture && other.visible !== false)
        .filter((other) => boxesOverlap(box, boundsOf(other)))
        .map((other) => ({ a: fixture, b: other, box: intersectionOf(box, boundsOf(other)) }));
}

/** Set of fixture ids that touch something else (for the warning summary). */
export function collisionIds(fixtures = []) {
    const ids = new Set();
    findOverlaps(fixtures).forEach(({ a, b }) => {
        ids.add(a.id);
        ids.add(b.id);
    });
    return ids;
}
