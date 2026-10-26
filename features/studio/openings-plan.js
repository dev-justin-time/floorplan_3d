import { PIXELS_PER_METER, planToWorld } from '../../world-space.js';

/**
 * Floor openings drawn on the plan (the cutout tool).
 *
 * An opening belongs to the storey whose floor it cuts, so it is stored on that
 * story in `story.openings` as a polygon in plan canvas pixels. The 3D engine
 * converts it through `openingToWorld` and adds it to the room floor shape as a
 * hole. Points can be dragged one at a time, so a rectangle becomes any polygon
 * without a separate mode.
 */

let openingCounter = 0;
const nextOpeningId = () => `opening_${Date.now()}_${(openingCounter += 1)}`;

const clean = (value) => Math.round(value * 10) / 10;

export function rectOpening(start, end) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    return {
        id: nextOpeningId(),
        points: [
            { x: clean(minX), y: clean(minY) },
            { x: clean(maxX), y: clean(minY) },
            { x: clean(maxX), y: clean(maxY) },
            { x: clean(minX), y: clean(maxY) }
        ]
    };
}

export function polygonArea(points = []) {
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
}

export function openingAreaMetres(opening) {
    return opening ? polygonArea(opening.points) / (PIXELS_PER_METER * PIXELS_PER_METER) : 0;
}

export function pointInPolygon(point, points = []) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        if ((a.y > point.y) !== (b.y > point.y)) {
            const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
            if (point.x < x) inside = !inside;
        }
    }
    return inside;
}

export function openingAt(openings = [], point) {
    for (let i = openings.length - 1; i >= 0; i -= 1) {
        if (pointInPolygon(point, openings[i].points)) return openings[i];
    }
    return null;
}

export function vertexAt(opening, point, tolerance = 8) {
    if (!opening) return -1;
    return opening.points.findIndex((vertex) => Math.hypot(vertex.x - point.x, vertex.y - point.y) <= tolerance);
}

export function edgeAt(opening, point, tolerance = 8) {
    if (!opening) return -1;
    const points = opening.points;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        if (!lengthSq) continue;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
        const px = a.x + t * dx;
        const py = a.y + t * dy;
        if (Math.hypot(point.x - px, point.y - py) <= tolerance) return i;
    }
    return -1;
}

export function moveVertex(opening, index, point) {
    if (!opening?.points?.[index]) return opening;
    opening.points[index] = { x: clean(point.x), y: clean(point.y) };
    return opening;
}

/** Insert a vertex on `edge` at `point`, so a rectangle can grow a notch. */
export function insertVertex(opening, edge, point) {
    if (!opening || edge < 0) return opening;
    opening.points.splice(edge + 1, 0, { x: clean(point.x), y: clean(point.y) });
    return opening;
}

/** Remove a vertex; a polygon needs at least three. */
export function removeVertex(opening, index) {
    if (!opening || opening.points.length <= 3 || index < 0) return false;
    opening.points.splice(index, 1);
    return true;
}

export function moveOpening(opening, dx, dy) {
    if (!opening) return opening;
    opening.points.forEach((point) => {
        point.x = clean(point.x + dx);
        point.y = clean(point.y + dy);
    });
    return opening;
}

/** Plan pixels -> world x/z metres, in the same mapping as walls and items. */
export function openingToWorld(opening, view = { width: 1, height: 1 }) {
    return (opening?.points || []).map((point) => planToWorld({
        x: (point.x - view.width / 2) / PIXELS_PER_METER,
        z: (point.y - view.height / 2) / PIXELS_PER_METER
    }));
}

/** A deep copy, so a history snapshot cannot share point objects. */
export function cloneOpenings(openings = []) {
    return openings.map((opening) => ({
        id: opening.id || nextOpeningId(),
        points: (opening.points || []).map((point) => ({ x: Number(point.x), y: Number(point.y) }))
    }));
}
