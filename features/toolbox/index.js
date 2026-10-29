/**
 * The toolbox registry: one entry per shipped tool.
 *
 * The page navigation, the shell router and `scripts/check-toolbox.mjs` all read
 * this list, so a tool cannot be half-added — an entry without a panel fails the
 * gate, and a panel without an entry is unreachable.
 *
 * Clean-room: these are our own implementations of the utilities from
 * RenderHub's 3D toolbox page (colour space, UOM, texel density, texture
 * memory). Only the capability is shared; the copy, the UI and the maths come
 * from the public specs named in each module. The full roadmap for the tools
 * that are not built yet is in `toolplan.md`.
 */

export * from './units.js';
export * from './texture.js';

/** Phases from `toolplan.md`; the page shows only the groups that have tools. */
export const TOOLBOX_GROUPS = [
    { id: 'a', label: 'Conversion', planned: 4 },
    { id: 'b', label: 'Single images', planned: 6 },
    { id: 'c', label: 'Image sets & environment', planned: 3 },
    { id: 'd', label: 'Model pipeline', planned: 4 }
];

export const TOOLBOX = [
    {
        id: 'color-space',
        label: 'Color space converter',
        group: 'a',
        panel: 'color.js',
        summary: 'sRGB and linear values both ways, with the exact IEC 61966-2-1 transfer curve and the loudest warning when a value cannot be displayed.'
    },
    {
        id: 'units',
        label: 'Unit converter',
        group: 'a',
        panel: 'units.js',
        summary: 'Length, area, volume, mass, angle and data size, plus the scale-mismatch helper that names the unit slip behind a wrong-sized import.'
    },
    {
        id: 'texel-density',
        label: 'Texel density',
        group: 'a',
        panel: 'texel.js',
        summary: 'Pixels per metre, centimetre and inch for a surface, and the texture size a target density needs.'
    },
    {
        id: 'texture-memory',
        label: 'Texture memory',
        group: 'a',
        panel: 'memory.js',
        summary: 'GPU cost of a texture in every shipped format, with the mip chain and the saving from the previous power of two.'
    }
];

/** Tools of one group, in registry order. */
export function toolsInGroup(groupId) {
    return TOOLBOX.filter((tool) => tool.group === groupId);
}

/** One tool by id, or null. */
export function toolById(id) {
    return TOOLBOX.find((tool) => tool.id === id) || null;
}
