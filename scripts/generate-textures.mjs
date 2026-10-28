/**
 * Generates the twelve finish textures that core/metadata.js references.
 *
 * The materials in the 3D view expect seamless images at /textures/*.png. They
 * are synthesised here rather than checked in as photographs so the palette,
 * grain direction and repeat stay under version control and can be retuned in
 * one file. Run `node scripts/generate-textures.mjs` to rewrite the folder; the
 * output is deterministic (fixed seeds), so a rerun is a no-op diff.
 *
 * PNG is written by hand: the only dependency is node:zlib.
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;

/* ---------------------------------------------------------------- utilities */

const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgb) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;   // bit depth
    header[9] = 2;   // truecolour
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y += 1) {
        raw[y * (width * 3 + 1)] = 0; // filter: none
        rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * clamp(t);
const mixRgb = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (t) => t * t * (3 - 2 * t);

function rng(seed) {
    let state = seed >>> 0;
    return () => {
        state += 0x6d2b79f5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Periodic value noise, so every pattern tiles at the image edge. */
function noiseFactory(seed, period) {
    const random = rng(seed);
    const lattice = new Float32Array(period * period);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = random();
    return (x, y) => {
        const px = ((x % period) + period) % period;
        const py = ((y % period) + period) % period;
        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        const x1 = (x0 + 1) % period;
        const y1 = (y0 + 1) % period;
        const tx = smooth(px - x0);
        const ty = smooth(py - y0);
        const top = mix(lattice[y0 * period + x0], lattice[y0 * period + x1], tx);
        const bottom = mix(lattice[y1 * period + x0], lattice[y1 * period + x1], tx);
        return mix(top, bottom, ty);
    };
}

function fbm(noises, x, y) {
    let value = 0;
    let amplitude = 0.5;
    let total = 0;
    noises.forEach((noise, index) => {
        const scale = 1 << index;
        value += noise(x * scale, y * scale) * amplitude;
        total += amplitude;
        amplitude *= 0.5;
    });
    return value / total;
}

/* ----------------------------------------------------------------- patterns */

const PALETTE = {
    marbleFloor: { base: [236, 233, 227], vein: [166, 164, 158], accent: [206, 200, 190] },
    woodFloor: { light: [188, 152, 110], dark: [126, 92, 58], seam: [74, 52, 34] },
    tileFloor: { tile: [230, 227, 220], grout: [176, 171, 162], shade: [212, 206, 196] },
    concreteFloor: { light: [186, 184, 179], dark: [140, 138, 133] },
    stoneFloor: { light: [196, 188, 174], dark: [146, 138, 125], joint: [96, 90, 80] },
    carpet: { light: [148, 137, 122], dark: [104, 95, 84] },
    marbleWall: { base: [244, 242, 238], vein: [190, 188, 183], accent: [222, 217, 208] },
    woodWall: { light: [206, 176, 133], dark: [148, 114, 76], seam: [96, 70, 46] },
    tileWall: { tile: [243, 242, 238], grout: [198, 195, 189], shade: [228, 225, 218] },
    concreteWall: { light: [206, 204, 199], dark: [172, 170, 165] },
    stoneWall: { light: [212, 204, 190], dark: [162, 154, 141], joint: [112, 106, 96] },
    paint: { base: [244, 241, 234], shade: [230, 226, 217] }
};

function marble(size, palette, seed) {
    const octaves = [noiseFactory(seed, 4), noiseFactory(seed + 1, 8), noiseFactory(seed + 2, 16), noiseFactory(seed + 3, 32)];
    const cloud = noiseFactory(seed + 4, 6);
    const rgb = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const v = y / size;
            // Shear the noise so the veins run diagonally, then ridge it.
            const n = fbm(octaves, u * 4 + v * 1.6, v * 4);
            const ridge = 1 - Math.abs(2 * n - 1);
            const vein = Math.pow(ridge, 12);
            const shading = (cloud(u * 6, v * 6) - 0.5) * 0.16;
            let colour = mixRgb(palette.base, palette.accent, clamp(0.35 + shading + n * 0.3));
            colour = mixRgb(colour, palette.vein, vein);
            const speck = (fbm(octaves, u * 32, v * 32) - 0.5) * 8;
            const offset = (y * size + x) * 3;
            rgb[offset] = clamp(colour[0] + speck, 0, 255);
            rgb[offset + 1] = clamp(colour[1] + speck, 0, 255);
            rgb[offset + 2] = clamp(colour[2] + speck, 0, 255);
        }
    }
    return rgb;
}

function planks(size, palette, seed, { vertical = false, count = 6 } = {}) {
    const random = rng(seed);
    const grainNoise = noiseFactory(seed + 1, 8);
    const fineNoise = noiseFactory(seed + 2, 64);
    const plankTints = Array.from({ length: count }, () => (random() - 0.5) * 0.22);
    const plankWidth = size / count;
    const rgb = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const across = vertical ? x : y;
            const along = vertical ? y : x;
            const index = Math.min(count - 1, Math.floor(across / plankWidth));
            const within = (across - index * plankWidth) / plankWidth;
            // Long, stretched grain: noise is sampled far tighter across the
            // board than along it.
            const grain = fbm(
                [grainNoise, fineNoise],
                (vertical ? y : x) / size * 30 + index * 3.1,
                (vertical ? x : y) / size * 2.2
            );
            const edge = Math.min(within, 1 - within) * plankWidth;
            const seam = clamp(1 - edge / 2.5);
            let colour = mixRgb(palette.light, palette.dark, clamp(grain * 0.85 + plankTints[index] + 0.18));
            colour = mixRgb(colour, palette.seam, seam * 0.9);
            const offset = (y * size + x) * 3;
            rgb[offset] = colour[0];
            rgb[offset + 1] = colour[1];
            rgb[offset + 2] = colour[2];
        }
    }
    return rgb;
}

function tiles(size, palette, seed, { columns = 4, rows = 4, grout = 3 } = {}) {
    const random = rng(seed);
    const speckle = noiseFactory(seed + 1, 96);
    const tints = Array.from({ length: columns * rows }, () => (random() - 0.5) * 0.1);
    const cellW = size / columns;
    const cellH = size / rows;
    const rgb = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const column = Math.min(columns - 1, Math.floor(x / cellW));
            const row = Math.min(rows - 1, Math.floor(y / cellH));
            const dx = Math.min(x - column * cellW, (column + 1) * cellW - x);
            const dy = Math.min(y - row * cellH, (row + 1) * cellH - y);
            const toJoint = Math.min(dx, dy);
            const tint = tints[row * columns + column];
            const grain = (speckle(x / size * 24, y / size * 24) - 0.5) * 0.05;
            let colour = mixRgb(palette.tile, palette.shade, clamp(0.25 + tint + grain));
            const joint = clamp(1 - (toJoint - grout) / 2);
            colour = mixRgb(colour, palette.grout, joint);
            const offset = (y * size + x) * 3;
            rgb[offset] = colour[0];
            rgb[offset + 1] = colour[1];
            rgb[offset + 2] = colour[2];
        }
    }
    return rgb;
}

function concrete(size, palette, seed, { formBoards = false } = {}) {
    const octaves = [noiseFactory(seed, 8), noiseFactory(seed + 1, 32), noiseFactory(seed + 2, 128)];
    const blotch = noiseFactory(seed + 3, 5);
    const random = rng(seed + 4);
    const pits = Array.from({ length: 220 }, () => [random() * size, random() * size, 0.6 + random() * 1.8]);
    const rgb = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const grain = fbm(octaves, x / size * 8, y / size * 8);
            const cloud = blotch(x / size * 5, y / size * 5);
            let shade = clamp(grain * 0.7 + cloud * 0.5);
            let colour = mixRgb(palette.dark, palette.light, shade);
            if (formBoards) {
                // Board-formed walls show a horizontal shadow every 64 px.
                const board = (y % 64) / 64;
                const shadow = board > 0.94 ? 0.5 : board < 0.06 ? 0.3 : 0;
                colour = mixRgb(colour, palette.dark, shadow);
            }
            const offset = (y * size + x) * 3;
            let r = colour[0];
            let g = colour[1];
            let b = colour[2];
            for (const [px, py, radius] of pits) {
                const dist = Math.hypot(x - px, y - py);
                if (dist < radius) {
                    const depth = (1 - dist / radius) * 26;
                    r -= depth;
                    g -= depth;
                    b -= depth;
                }
            }
            rgb[offset] = clamp(r, 0, 255);
            rgb[offset + 1] = clamp(g, 0, 255);
            rgb[offset + 2] = clamp(b, 0, 255);
        }
    }
    return rgb;
}

function stone(size, palette, seed, { courses = 5 } = {}) {
    const random = rng(seed);
    const grain = [noiseFactory(seed + 1, 8), noiseFactory(seed + 2, 24), noiseFactory(seed + 3, 64)];
    const courseHeight = size / courses;
    const blocks = [];
    for (let row = 0; row < courses; row += 1) {
        let x = -random() * size * 0.4;
        while (x < size) {
            const width = size * (0.16 + random() * 0.2);
            blocks.push({ row, x, width, tint: (random() - 0.5) * 0.24 });
            x += width;
        }
    }
    const rgb = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y += 1) {
        const row = Math.min(courses - 1, Math.floor(y / courseHeight));
        const withinY = y - row * courseHeight;
        for (let x = 0; x < size; x += 1) {
            const block = blocks.find((entry) => entry.row === row && x >= entry.x && x < entry.x + entry.width)
                || blocks.find((entry) => entry.row === row);
            const withinX = x - block.x;
            const joint = Math.min(withinY, courseHeight - withinY, withinX, block.width - withinX);
            const n = fbm(grain, x / size * 6, y / size * 6);
            let colour = mixRgb(palette.light, palette.dark, clamp(0.35 + block.tint + n * 0.55));
            colour = mixRgb(colour, palette.joint, clamp(1 - (joint - 2) / 3));
            const offset = (y * size + x) * 3;
            rgb[offset] = colour[0];
            rgb[offset + 1] = colour[1];
            rgb[offset + 2] = colour[2];
        }
    }
    return rgb;
}

function carpet(size, palette, seed) {
    const fine = noiseFactory(seed, 128);
    const tuft = noiseFactory(seed + 1, 64);
    const random = rng(seed + 2);
    const rgb = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const n = fine(x / size * 128, y / size * 128) * 0.6 + tuft(x / size * 48, y / size * 48) * 0.4;
            const fleck = random() * 0.12;
            const colour = mixRgb(palette.dark, palette.light, clamp(n * 0.8 + fleck));
            const offset = (y * size + x) * 3;
            rgb[offset] = colour[0];
            rgb[offset + 1] = colour[1];
            rgb[offset + 2] = colour[2];
        }
    }
    return rgb;
}

function paint(size, palette, seed) {
    const roller = noiseFactory(seed, 6);
    const nap = noiseFactory(seed + 1, 96);
    const rgb = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const band = Math.sin((x / size) * Math.PI * 14) * 0.012;
            const n = (roller(x / size * 6, y / size * 6) - 0.5) * 0.05 + band;
            const fleck = (nap(x / size * 96, y / size * 96) - 0.5) * 0.018;
            const colour = mixRgb(palette.base, palette.shade, clamp(0.4 + n + fleck));
            const offset = (y * size + x) * 3;
            rgb[offset] = colour[0];
            rgb[offset + 1] = colour[1];
            rgb[offset + 2] = colour[2];
        }
    }
    return rgb;
}

/* ------------------------------------------------------------------ output */

const FILES = [
    ['marble_floor.png', () => marble(SIZE, PALETTE.marbleFloor, 101)],
    ['wood_floor.png', () => planks(SIZE, PALETTE.woodFloor, 202, { count: 6 })],
    ['ceramic_tile.png', () => tiles(SIZE, PALETTE.tileFloor, 303, { columns: 4, rows: 4, grout: 3 })],
    ['concrete_floor.png', () => concrete(SIZE, PALETTE.concreteFloor, 404)],
    ['stone_floor.png', () => stone(SIZE, PALETTE.stoneFloor, 505, { courses: 4 })],
    ['carpet.png', () => carpet(SIZE, PALETTE.carpet, 606)],
    ['marble_wall.png', () => marble(SIZE, PALETTE.marbleWall, 707)],
    ['wood_wall.png', () => planks(SIZE, PALETTE.woodWall, 808, { vertical: true, count: 8 })],
    ['wall_tile.png', () => tiles(SIZE, PALETTE.tileWall, 909, { columns: 5, rows: 5, grout: 2 })],
    ['concrete_wall.png', () => concrete(SIZE, PALETTE.concreteWall, 1010, { formBoards: true })],
    ['stone_wall.png', () => stone(SIZE, PALETTE.stoneWall, 1111, { courses: 6 })],
    ['painted_wall.png', () => paint(SIZE, PALETTE.paint, 1212)]
];

const destination = path.join(ROOT, 'textures');
await mkdir(destination, { recursive: true });
let total = 0;
for (const [name, build] of FILES) {
    const png = encodePng(SIZE, SIZE, build());
    await writeFile(path.join(destination, name), png);
    total += png.length;
    console.log(`${name.padEnd(20)} ${(png.length / 1024).toFixed(0)} KB`);
}
console.log(`\n${FILES.length} textures, ${(total / 1048576).toFixed(2)} MB -> textures/`);
