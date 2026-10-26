import { PIXELS_PER_METER } from '../../world-space.js';
import { roomSurfacesFromWalls, pointInRoom } from './room-surfaces.js';

/**
 * Exterior shell for a new storey.
 *
 * An upper floor repeats the exterior walls and the windows of the storey below,
 * not the interior partitions. A wall is exterior when exactly one side of it is
 * inside a closed room: interior partitions have a room on both sides, and a
 * wall on an open plan (no closed room yet) is treated as exterior.
 */

const isWindow = (fixture) => {
    const type = String(fixture?.type || '');
    return type === 'window' || type === 'round_window'
        || (fixture?.metadata?.type === 'in_wall' && fixture?.metadata?.sillHeight != null && !/door/i.test(type));
};

function segmentDistance(point, wall) {
    const ax = wall.start.x;
    const ay = wall.start.y;
    const bx = wall.end.x;
    const by = wall.end.y;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / lengthSq)) : 0;
    return Math.hypot(point.x - (ax + t * dx), point.y - (ay + t * dy));
}

/** Wall ids on the outside of the closed rooms (all walls when none close). */
export function exteriorWallIds(walls = [], view = { width: 1, height: 1 }) {
    const rooms = roomSurfacesFromWalls(walls, view, {});
    const ids = new Set();
    if (!rooms.length) {
        walls.forEach((wall) => { if (wall?.id) ids.add(wall.id); });
        return ids;
    }

    const probe = 0.3 * PIXELS_PER_METER;
    walls.forEach((wall) => {
        if (!wall?.id) return;
        const dx = wall.end.x - wall.start.x;
        const dy = wall.end.y - wall.start.y;
        const length = Math.hypot(dx, dy);
        if (!length) return;
        const nx = -dy / length;
        const ny = dx / length;
        const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
        const sides = [1, -1].map((side) => {
            const point = { x: mid.x + nx * probe * side, z: mid.y + ny * probe * side };
            return rooms.some((room) => pointInRoom(point, room.vertices));
        });
        if (sides[0] !== sides[1]) ids.add(wall.id);
    });
    return ids;
}

/**
 * Plain data for the shell copy: the exterior walls plus the windows attached to
 * them. `wallIndex` points into `walls` so the caller can rebind each window to
 * the new wall it sits on.
 */
export function shellCloneSpec(story = {}, view = { width: 1, height: 1 }) {
    const exterior = exteriorWallIds(story.walls || [], view);
    const walls = (story.walls || []).filter((wall) => exterior.has(wall.id));
    const indexById = new Map(walls.map((wall, index) => [wall.id, index]));
    const windows = [];

    (story.fixtures || []).filter(isWindow).forEach((fixture) => {
        let wallId = fixture.boundToWallId;
        if (!indexById.has(wallId)) {
            // A window that lost its binding still belongs on the nearest shell
            // wall; only skip it when there is no wall at all.
            let best = null;
            let bestDistance = Infinity;
            walls.forEach((wall) => {
                const distance = segmentDistance(fixture, wall);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = wall;
                }
            });
            if (!best || bestDistance > 1.5 * PIXELS_PER_METER) return;
            wallId = best.id;
        }
        windows.push({ fixture, wallIndex: indexById.get(wallId) });
    });

    return {
        walls: walls.map((wall) => ({
            start: { x: wall.start.x, y: wall.start.y },
            end: { x: wall.end.x, y: wall.end.y },
            thickness: wall.thickness,
            height: wall.height
        })),
        windows
    };
}
