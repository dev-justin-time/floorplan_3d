/**
 * Checks for the 3D toolbox (phase 1 of `toolplan.md`):
 *   features/toolbox/units.js     sRGB <-> linear, unit table, scale hints
 *   features/toolbox/texture.js   texel density, format blocks, mip chains
 *   features/toolbox/index.js     the tool registry
 *   pages/toolbox.html            the one route that hosts every tool
 *
 * The maths is pure, so every number is pinned here without a browser; the page
 * and panel wiring is checked by importing each panel in Node (they only touch
 * the DOM inside `mount()`) and by reading the page's links.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    BYTES_PER_MIB,
    CHANNEL_ORDER,
    CHANNEL_PRESETS,
    NORMAL_CONVENTIONS,
    PACK_SLOTS,
    PLATFORM_MATERIALS,
    SCALE_HINTS,
    TEXEL_SURFACES,
    TEXEL_TEXTURE_SIZES,
    TEXTURE_FORMATS,
    TOOLBOX,
    TOOLBOX_GROUPS,
    UNIT_GROUPS,
    channelPreset,
    checkImage,
    cloneImage,
    colorReport,
    convertUnit,
    createImage,
    edgeSeamDelta,
    explainScale,
    findUnit,
    flattenLighting,
    flipNormalGreen,
    flipNormalGreenAll,
    flippedName,
    formatNumber,
    imageFromData,
    linearToSrgb,
    linearToSrgbColor,
    makeSeamless,
    mixImages,
    nextPowerOfTwo,
    packChannels,
    packSidecar,
    parseHexColor,
    potReduction,
    previousPowerOfTwo,
    relativeLuminance,
    resizeImage,
    rgbToHex,
    scaleMismatch,
    sceneTextureMemory,
    srgbToLinear,
    texelDensity,
    textureFormat,
    textureLevelBytes,
    textureMemory,
    texturePixelsForDensity,
    tileImage,
    toolById,
    toolsInGroup,
    wrapShift
} from '../features/toolbox/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
const failures = [];
const check = (name, condition, detail = '') => {
    if (condition) {
        pass += 1;
        console.log(`  ok  ${name}`);
    } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
};

const near = (a, b, tolerance = 1e-9) => Math.abs(Number(a) - Number(b)) <= tolerance;
const throws = (fn) => {
    try {
        fn();
        return false;
    } catch {
        return true;
    }
};

// --- sRGB <-> linear ------------------------------------------------------

console.log('\nsRGB and linear');

check('0.5 sRGB is 0.2140 linear', near(srgbToLinear(0.5), 0.21404114048223255, 1e-12), String(srgbToLinear(0.5)));
check('0.04 sRGB is 0.0031 linear', near(srgbToLinear(0.04), 0.0030959752321981426, 1e-12), String(srgbToLinear(0.04)));
check('the linear segment starts at 0.04045', near(srgbToLinear(0.04045), 0.04045 / 12.92, 1e-15));
check('black stays black', srgbToLinear(0) === 0);
check('white stays white', srgbToLinear(1) === 1);
check('out-of-range sRGB clamps', srgbToLinear(-1) === 0 && srgbToLinear(2) === 1);
check('a non-number is NaN', Number.isNaN(srgbToLinear('blue')));

const roundTrip = [0, 0.002, 0.04045, 0.2, 0.5, 0.75, 0.99, 1];
check(
    'srgb -> linear -> srgb round-trips for every channel',
    roundTrip.every((value) => Math.abs(linearToSrgb(srgbToLinear(value)) - value) <= 1e-12)
);
check('negative linear light has no sRGB encoding', Number.isNaN(linearToSrgb(-0.1)));
check('linear 0.2140 encodes back to about 0.5', near(linearToSrgb(0.21404114048223255), 0.5, 1e-12));

check('hex parses six digits', JSON.stringify(parseHexColor('#3b82f6')) === '{"r":59,"g":130,"b":246}', JSON.stringify(parseHexColor('#3b82f6')));
check('hex parses three digits', JSON.stringify(parseHexColor('#38f')) === '{"r":51,"g":136,"b":255}', JSON.stringify(parseHexColor('#38f')));
check('hex parses without the hash', parseHexColor('ffffff').r === 255);
check('rgb() parses', JSON.stringify(parseHexColor('rgb(255, 0, 1)')) === '{"r":255,"g":0,"b":1}', JSON.stringify(parseHexColor('rgb(255, 0, 1)')));
check('rgba() parses and ignores alpha', parseHexColor('rgba(0, 0, 0, 0.5)').r === 0);
check('an invalid colour returns null', parseHexColor('#12345') === null && parseHexColor('blue') === null);
check('hex output is lowercase and padded', rgbToHex({ r: 1, g: 15, b: 255 }) === '#010fff', rgbToHex({ r: 1, g: 15, b: 255 }));
check('hex output clamps bytes', rgbToHex({ r: -5, g: 999, b: 0 }) === '#00ff00', rgbToHex({ r: -5, g: 999, b: 0 }));

const report = colorReport('#3b82f6');
check('a colour report carries every space', !report.error && report.hex === '#3b82f6' && report.rgb255.r === 59);
check('the report linearises each channel', near(report.linear.r, srgbToLinear(59 / 255), 1e-15));
check('the report computes relative luminance', near(report.luminance, relativeLuminance(report.linear), 1e-15));
check('white is luminance 1', near(colorReport('#ffffff').luminance, 1, 1e-12), String(colorReport('#ffffff').luminance));
check('black is luminance 0', colorReport('#000000').luminance === 0);
check('an invalid colour reports an error message', /hex colour/.test(colorReport('nope').error || ''), colorReport('nope').error);

const reverse = linearToSrgbColor({ r: 0.21404114048223255, g: 0.21404114048223255, b: 0.21404114048223255 });
check('linear -> sRGB gives the 8-bit triple', reverse.hex === '#808080', reverse.hex);
check('a clean linear triple has no warnings', reverse.warnings.length === 0);
const clamped = linearToSrgbColor({ r: -0.2, g: 0.5, b: 1.5 });
check('negative and over-white values are clamped', clamped.srgb.r === 0 && clamped.srgb.b === 1);
check('each clamp is reported', clamped.warnings.length === 2, clamped.warnings.join(' | '));

// --- unit table -----------------------------------------------------------

console.log('\nUnits');

check('the length table agrees with the DXF importer', findUnit('mm').unit.factor === 0.001 && findUnit('in').unit.factor === 0.0254 && findUnit('ft').unit.factor === 0.3048);
check('unit ids are unique across the table', new Set(UNIT_GROUPS.flatMap((group) => group.units.map((unit) => unit.id))).size === UNIT_GROUPS.flatMap((group) => group.units).length);
check('every group lists its own base unit', UNIT_GROUPS.every((group) => group.units.some((unit) => unit.id === group.base && unit.factor === 1)));

check('inches to millimetres is 25.4', near(convertUnit(1, 'in', 'mm'), 25.4, 1e-12), String(convertUnit(1, 'in', 'mm')));
check('twelve inches is one foot', near(convertUnit(12, 'in', 'ft'), 1, 1e-12));
check('a metre is 1000 mm', near(convertUnit(1, 'm', 'mm'), 1000, 1e-12));
check('a plan pixel is 1/30 m', near(convertUnit(30, 'planpx', 'm'), 1, 1e-12));
check('square metres to square feet is 10.7639', near(convertUnit(1, 'm2', 'ft2'), 10.763910416709722, 1e-9), String(convertUnit(1, 'm2', 'ft2')));
check('a cubic foot is 28.3168 litres', near(convertUnit(1, 'ft3', 'l'), 28.316846592, 1e-12));
check('a pound is 0.45359237 kg', convertUnit(1, 'lb', 'kg') === 0.45359237);
check('180 degrees is pi radians', near(convertUnit(180, 'deg', 'rad'), Math.PI, 1e-12));
check('a mebibyte is 1048576 bytes', convertUnit(1, 'mebibyte', 'byte') === 1048576);
check('a mebibyte is 1.048576 megabytes', near(convertUnit(1, 'mebibyte', 'megabyte'), 1.048576, 1e-12));
check('converting across quantities throws', throws(() => convertUnit(1, 'm', 'kg')));
check('an unknown unit throws', throws(() => convertUnit(1, 'm', 'furlong')));
check('a non-numeric value throws', throws(() => convertUnit('wide', 'm', 'mm')));
check('a zero value is allowed', convertUnit(0, 'm', 'mm') === 0);

check('formatNumber trims trailing zeros', formatNumber(25.4) === '25.4', formatNumber(25.4));
check('formatNumber keeps four places', formatNumber(0.003095975) === '0.0031', formatNumber(0.003095975));
check('formatNumber uses an exponent for tiny values', /e-/.test(formatNumber(0.0000001234)), formatNumber(0.0000001234));
check('formatNumber reports a non-number', formatNumber('wide') === '—');

// --- scale mismatch -------------------------------------------------------

console.log('\nScale mismatch');

check('a thousandfold slip names the metre-millimetre pair', /metres → millimetres/.test(explainScale(1000)?.label || ''), explainScale(1000)?.label);
check('a thousandth slip names the inverse pair', /millimetres → metres/.test(explainScale(0.001)?.label || ''), explainScale(0.001)?.label);
check('25.4 names inches and millimetres', /inches → millimetres/.test(explainScale(25.4)?.label || ''));
check('12 names feet and inches', /feet → inches/.test(explainScale(12)?.label || ''));
check('30 names the plan pixel', /30 px\/m/.test(explainScale(30)?.label || ''), explainScale(30)?.label);
check('an unrelated factor has no hint', explainScale(1.2345) === null);
check('the hint table has no duplicate factors', new Set(SCALE_HINTS.map((hint) => hint.factor)).size === SCALE_HINTS.length);

const mismatch = scaleMismatch(3, 3000);
check('a 3 m plan read as 3000 is a factor of 0.001', near(mismatch.factor, 0.001, 1e-15), String(mismatch.factor));
check('the mismatch names the unit slip', /millimetres → metres/.test(mismatch.hint || ''), mismatch.hint);
check('a matching pair reports no hint', scaleMismatch(2.7, 2.7).hint === null);
check('a zero model length throws', throws(() => scaleMismatch(3, 0)));
check('a non-number throws', throws(() => scaleMismatch('long', 2)));

// --- texel density --------------------------------------------------------

console.log('\nTexel density');

const density = texelDensity({ texturePixels: 1024, surfaceMetres: 2 });
check('1024 px over 2 m is 512 px/m', density.pixelsPerMetre === 512, String(density.pixelsPerMetre));
check('that is 5.12 px/cm', near(density.pixelsPerCentimetre, 5.12, 1e-12));
check('that is 13.0048 px/in', near(density.pixelsPerInch, 13.0048, 1e-12), String(density.pixelsPerInch));
check('a quarter of the sheet halves the density', texelDensity({ texturePixels: 1024, surfaceMetres: 2, uvFraction: 0.25 }).pixelsPerMetre === 256);
check('density is monotonic in texture size', texelDensity({ texturePixels: 2048, surfaceMetres: 2 }).pixelsPerMetre === 1024);
check('a zero texture size throws', throws(() => texelDensity({ texturePixels: 0, surfaceMetres: 2 })));
check('a zero surface throws', throws(() => texelDensity({ texturePixels: 512, surfaceMetres: 0 })));
check('UV coverage above 1 throws', throws(() => texelDensity({ texturePixels: 512, surfaceMetres: 2, uvFraction: 1.5 })));
check('the texture-size presets are the platform sizes', [512, 1024, 2048, 4096].every((size) => TEXEL_TEXTURE_SIZES.includes(size)));
check('the surface presets include the 96 in wall', TEXEL_SURFACES.some((preset) => near(preset.metres, 2.4384, 1e-12)));

const required = texturePixelsForDensity({ density: 512, surfaceMetres: 2 });
check('512 px/m over 2 m needs 1024 px', required.exact === 1024 && required.powerOfTwo === 1024);
check('an odd need rounds up to the next power of two', texturePixelsForDensity({ density: 700, surfaceMetres: 2 }).powerOfTwo === 2048);
check('the UV fraction inflates the requirement', near(texturePixelsForDensity({ density: 512, surfaceMetres: 2, uvFraction: 0.25 }).exact, 2048, 1e-9));

// --- texture memory -------------------------------------------------------

console.log('\nTexture memory');

check('a 4096 RGBA8 texture is 64 MiB', textureMemory({ width: 4096, height: 4096, format: 'rgba8' }).bytes === 67108864);
check('the MiB figure matches the bytes', near(textureMemory({ width: 4096, height: 4096, format: 'rgba8' }).mib, 64, 1e-12));
check('a 4096 BC1 texture is 8 MiB', near(textureMemory({ width: 4096, height: 4096, format: 'bc1' }).mib, 8, 1e-12));
check('a 4096 BC7 texture is 16 MiB', near(textureMemory({ width: 4096, height: 4096, format: 'bc7' }).mib, 16, 1e-12));
check('ASTC 4x4 is 16 MiB (128-bit blocks)', near(textureMemory({ width: 4096, height: 4096, format: 'astc4x4' }).mib, 16, 1e-12));
check('ASTC 8x8 is 4 MiB', near(textureMemory({ width: 4096, height: 4096, format: 'astc8x8' }).mib, 4, 1e-12));
check('ASTC 12x12 is 1.78 MiB', textureMemory({ width: 4096, height: 4096, format: 'astc12x12' }).bytes === 342 * 342 * 16, String(textureMemory({ width: 4096, height: 4096, format: 'astc12x12' }).bytes));
check('BC1 reports its block grid', JSON.stringify(textureMemory({ width: 64, height: 32, format: 'bc1' }).blocks) === '{"across":16,"down":8,"bytesPerBlock":8}');
check('a non-multiple size rounds blocks up', textureLevelBytes(100, 100, 'bc1') === 5000, String(textureLevelBytes(100, 100, 'bc1')));
check('ASTC 6x6 of 100x100 is 17x17 blocks', JSON.stringify(textureMemory({ width: 100, height: 100, format: 'astc6x6' }).blocks) === '{"across":17,"down":17,"bytesPerBlock":16}');
check('ASTC 6x6 of 100x100 is 4624 bytes', textureMemory({ width: 100, height: 100, format: 'astc6x6' }).bytes === 4624);
check('RGBA16F is 8 bytes per pixel', textureMemory({ width: 256, height: 256, format: 'rgba16f' }).bytes === 524288);

const mip = textureMemory({ width: 4096, height: 4096, format: 'rgba8', mips: true });
check('the full chain of a 4096 texture has 13 levels', mip.levelCount === 13, String(mip.levelCount));
check('the chain is 85.33 MiB', near(mip.mib, 64 * 4 / 3, 0.0001), String(mip.mib));
check('the base level is still 64 MiB', mip.levels[0].bytes === 67108864);
check('the last level is one pixel', mip.levels[12].width === 1 && mip.levels[12].height === 1);
check('each level halves', mip.levels.slice(1, 4).every((level, index) => level.width === 2048 >> index));
check('a BC1 chain is 10.67 MiB', near(textureMemory({ width: 4096, height: 4096, format: 'bc1', mips: true }).mib, 10.6667, 1e-4), String(textureMemory({ width: 4096, height: 4096, format: 'bc1', mips: true }).mib));
check('a mip chain always costs more than the base level', textureMemory({ width: 512, height: 512, format: 'rgba8', mips: true }).bytes > textureMemory({ width: 512, height: 512, format: 'rgba8' }).bytes);
check('a non-square chain still reaches 1x1', textureMemory({ width: 256, height: 64, format: 'rgba8', mips: true }).levels.at(-1).width === 1);
check('a zero size throws', throws(() => textureMemory({ width: 0, height: 512, format: 'rgba8' })));
check('an unknown format throws', throws(() => textureMemory({ width: 512, height: 512, format: 'jpeg' })));

check('nextPowerOfTwo rounds up', nextPowerOfTwo(100) === 128 && nextPowerOfTwo(1024) === 1024 && nextPowerOfTwo(1) === 1);
check('nextPowerOfTwo repairs a bad input', nextPowerOfTwo(0) === 1 && nextPowerOfTwo('wide') === 1);
check('previousPowerOfTwo rounds down', previousPowerOfTwo(100) === 64 && previousPowerOfTwo(1024) === 1024);
const reduction = potReduction({ width: 1500, height: 1500, format: 'rgba8' });
check('1500 rounds down to 1024', reduction.width === 1024);
check('the POT saving is the byte difference', reduction.savedBytes === 1500 * 1500 * 4 - 1024 * 1024 * 4, String(reduction.savedBytes));
check('a power-of-two texture has no saving', potReduction({ width: 1024, height: 1024, format: 'rgba8' }) === null);

check('the platform ships twelve materials', PLATFORM_MATERIALS.count === 12);
const scene = sceneTextureMemory();
check('the material set is 12 MiB', near(scene.mib, 12, 1e-12), String(scene.mib));
check('the material set is 12 x 512 x 512 RGBA8', scene.bytes === 12 * 512 * 512 * 4);
check('one MiB is 1048576 bytes', BYTES_PER_MIB === 1048576);

check('every format id is unique', new Set(TEXTURE_FORMATS.map((format) => format.id)).size === TEXTURE_FORMATS.length);
check('every format has a label and a cost', TEXTURE_FORMATS.every((format) => format.label && (format.bitsPerPixel || format.block)));
check('the format table covers the BC, ETC2/EAC and ASTC families', ['bc1', 'bc7', 'etc2rgba', 'eacr11', 'astc12x12'].every((id) => TEXTURE_FORMATS.some((format) => format.id === id)));
check('textureFormat resolves an object unchanged', textureFormat({ id: 'custom' }).id === 'custom');

// --- image kernels --------------------------------------------------------

console.log('\nImage kernels');

const solid = (value, width = 2, height = 2) => createImage(width, height, [value, value, value, 255]);
const rampImage = (width = 4, height = 2, vertical = false) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const span = (vertical ? height : width) - 1;
            const value = span > 0 ? Math.round((255 * (vertical ? y : x)) / span) : 0;
            const offset = (y * width + x) * 4;
            data[offset] = value;
            data[offset + 1] = value;
            data[offset + 2] = value;
            data[offset + 3] = 255;
        }
    }
    return { width, height, data };
};
const spread = (image, inset = 0) => {
    let min = 255;
    let max = 0;
    for (let y = inset; y < image.height - inset; y += 1) {
        for (let x = inset; x < image.width - inset; x += 1) {
            const value = image.data[(y * image.width + x) * 4];
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
    }
    return max - min;
};

check('createImage allocates four bytes per pixel', createImage(4, 4).data.length === 64);
check('createImage fills every pixel', createImage(2, 2, [10, 20, 30, 255]).data[7] === 255 && createImage(2, 2, [10, 20, 30, 255]).data[6] === 30);
check('createImage refuses a zero or fractional size', throws(() => createImage(0, 4)) && throws(() => createImage(4, 1.5)));
check('imageFromData converts an array and checks the length', imageFromData([1, 2, 3, 4], 1, 1).data[3] === 4 && throws(() => imageFromData([1, 2, 3], 1, 1)));
check('checkImage names a short buffer', throws(() => checkImage({ width: 2, height: 2, data: new Uint8ClampedArray(3) })));

const quad = imageFromData([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 255, 255, 255, 255], 2, 2);
const cloned = cloneImage(quad);
cloned.data[0] = 9;
check('cloneImage does not alias its source', quad.data[0] === 0 && cloned.data[0] === 9);
check('a box resize averages the covered area', resizeImage(quad, 1, 1).data[0] === 139, String(resizeImage(quad, 1, 1).data[0]));
check('a box resize to the same size copies the corners', resizeImage(quad, 2, 2).data[15] === 255);
const enlarged = resizeImage(quad, 4, 4, { mode: 'nearest' });
check('a nearest resize keeps source pixels', enlarged.data[0] === 0 && enlarged.data[12] === 100, String(enlarged.data[12]));
check('an unknown resize mode throws', throws(() => resizeImage(quad, 2, 2, { mode: 'lanczos' })));

const tiled = tileImage(quad, 2, 2);
check('tiling doubles both sides', tiled.width === 4 && tiled.height === 4);
check('tiling repeats the source', tiled.data[8] === 0 && tiled.data[28] === 255, `${tiled.data[8]}/${tiled.data[28]}`);
check('tileImage refuses a zero count', throws(() => tileImage(quad, 0, 2)));
check('wrapShift moves pixels modulo the size', wrapShift(quad, 1, 1).data[0] === 255 && wrapShift(quad, 1, 1).data[8] === 100, `${wrapShift(quad, 1, 1).data[0]}/${wrapShift(quad, 1, 1).data[8]}`);

const ramp = rampImage(4, 2);
const rampSeam = edgeSeamDelta(ramp);
check('a horizontal ramp has a full-scale left/right seam', rampSeam.leftRight === 255 && rampSeam.topBottom === 0, `${rampSeam.leftRight}/${rampSeam.topBottom}`);
check('edgeSeamDelta normalises the worst edge', rampSeam.max === 255 && rampSeam.normalised === 1);

const repaired = makeSeamless(ramp, { blend: 0.25, offset: false });
check('the seam pass makes both edges identical', edgeSeamDelta(repaired).max === 0, String(edgeSeamDelta(repaired).max));
check('the seam pass keeps the source size', repaired.width === 4 && repaired.height === 2);
check('both edge columns hold the averaged pair', repaired.data[0] === 128 && repaired.data[3 * 4] === 128, `${repaired.data[0]}/${repaired.data[3 * 4]}`);
check('the seam band leaves the interior alone', repaired.data[1 * 4] === 85, String(repaired.data[1 * 4]));

const offsetTile = makeSeamless(ramp, { blend: 0.25 });
check('offsetting by half is tileable too', edgeSeamDelta(offsetTile).max === 0);
check('offsetting moves the border into the interior', offsetTile.data[1 * 4] === 255, String(offsetTile.data[1 * 4]));
check('a vertical ramp is repaired', edgeSeamDelta(makeSeamless(rampImage(2, 4, true), { blend: 0.25 })).max === 0);
check('a zero blend throws', throws(() => makeSeamless(ramp, { blend: 0 })));
check('a blend above half throws', throws(() => makeSeamless(ramp, { blend: 0.6 })));
check('a flatten amount outside 0–1 throws', throws(() => makeSeamless(ramp, { flatten: 1.5 })));

const lit = rampImage(8, 8);
const flat = flattenLighting(lit, { radius: 2 });
check('flattening removes the gradient across the interior', spread(flat, 2) < spread(lit, 2) / 4, `${spread(flat, 2)} vs ${spread(lit, 2)}`);
check('flattening a flat image changes nothing', (() => {
    const even = flattenLighting(solid(90, 8, 8), { radius: 2 });
    return even.data[0] === 90 && even.data[1] === 90 && even.data[3] === 255;
})(), 'a flat image must pass through');
check('flattenLighting rejects a zero radius', throws(() => flattenLighting(lit, { radius: 0 })));
check('a flattened tile is still tileable', edgeSeamDelta(makeSeamless(lit, { blend: 0.2, flatten: 1 })).max === 0);
check('mixImages blends between two buffers', mixImages(solid(0), solid(200), 0.5).data[0] === 100 && mixImages(solid(0), solid(200), 0).data[0] === 0);
check('mixImages refuses mismatched sizes', throws(() => mixImages(solid(0, 2, 2), solid(200, 4, 4), 0.5)));

// --- channel packing and normal maps --------------------------------------

console.log('\nPBR maps');

check('the presets cover glTF, Unreal and Unity', ['gltf-orm', 'unreal', 'unity-mask'].every((id) => CHANNEL_PRESETS.some((preset) => preset.id === id)));
check(
    'the glTF preset is R=AO, G=roughness, B=metalness, A=none',
    JSON.stringify(channelPreset('gltf-orm').channels) === '{"r":"ao","g":"roughness","b":"metalness","a":null}',
    JSON.stringify(channelPreset('gltf-orm').channels)
);
check('the Unity mask puts metalness in red and smoothness in alpha', channelPreset('unity-mask').channels.r === 'metalness' && channelPreset('unity-mask').channels.a === 'smoothness');
check('an unknown preset throws', throws(() => channelPreset('cryengine')));
check('every pack slot has a unique id and a byte default', new Set(PACK_SLOTS.map((slot) => slot.id)).size === PACK_SLOTS.length && PACK_SLOTS.every((slot) => Number.isInteger(slot.default) && slot.default >= 0 && slot.default <= 255));
check('occlusion defaults to 255 and metalness to 0', PACK_SLOTS.find((slot) => slot.id === 'ao').default === 255 && PACK_SLOTS.find((slot) => slot.id === 'metalness').default === 0);

const aoMap = solid(30);
const roughnessMap = solid(120);
const metalnessMap = solid(200);
const orm = packChannels(
    { r: aoMap, g: roughnessMap, b: metalnessMap },
    { channels: { r: 'ao', g: 'roughness', b: 'metalness', a: null } }
);
check('ORM packs AO, roughness and metalness in order', Array.from(orm.image.data.slice(0, 4)).join(',') === '30,120,200,255', Array.from(orm.image.data.slice(0, 4)).join(','));
check('a channel with no source takes its slot default', orm.defaulted.length === 1 && orm.defaulted[0].channel === 'a' && orm.defaulted[0].value === 255);
check('every pixel of a flat source is packed', orm.image.data[4] === 30 && orm.image.data[5] === 120 && orm.image.data[7] === 255);

const redMask = createImage(1, 1, [255, 0, 0, 255]);
check('a colour mask is read as luminance', packChannels({ g: redMask }, { channels: { r: null, g: 'roughness', b: null, a: null } }).image.data[1] === 54);
check('missing maps fall back to their own defaults', (() => {
    const packed = packChannels({ r: solid(0) }, { channels: { r: 'ao', g: 'roughness', b: 'metalness', a: null } });
    return packed.image.data[1] === 255 && packed.image.data[2] === 0;
})(), 'expected roughness 255 and metalness 0');

const stretched = packChannels({ r: solid(100, 2, 2) }, { channels: { r: 'ao' }, width: 4, height: 4 });
check('a smaller source is box-resampled to the pack size', stretched.width === 4 && stretched.resized.length === 1 && stretched.resized[0].from.width === 2);
check('a resampled flat map keeps its value', stretched.image.data[0] === 100 && stretched.image.data[60] === 100);

const swapped = packChannels({ r: metalnessMap, g: aoMap }, { channels: { r: 'metalness', g: 'ao' } });
check('a custom mapping decides which source feeds each channel', swapped.image.data[0] === 200 && swapped.image.data[1] === 30);
check('packing with no source throws', throws(() => packChannels({}, { channels: { r: 'ao' } })));
check('an unknown channel source throws', throws(() => packChannels({ r: solid(0) }, { channels: { r: 'gloss' } })));
check('an empty mapping throws', throws(() => packChannels({ r: solid(0) }, { channels: { r: null, g: null, b: null, a: null } })));

const sidecar = packSidecar(orm, { preset: 'gltf-orm', files: { r: 'ao.png', g: 'rough.png', b: 'metal.png' } });
check('the sidecar records the preset and size', sidecar.preset === 'gltf-orm' && sidecar.size.width === 2 && sidecar.tool === 'channel-packer');
check('the sidecar names the file behind each channel', sidecar.channels.g.slot === 'roughness' && sidecar.channels.g.file === 'rough.png');
check('the sidecar records a defaulted channel', sidecar.channels.a.slot === null && sidecar.channels.a.value === 255 && sidecar.channels.a.file === null);
check('the sidecar carries every channel', CHANNEL_ORDER.every((channel) => channel in sidecar.channels));
check('a sidecar without a pack throws', throws(() => packSidecar(null)));

const normal = imageFromData([120, 200, 250, 255, 10, 5, 0, 40], 2, 1);
const flippedNormal = flipNormalGreen(normal);
check('the green channel is inverted', flippedNormal.data[1] === 55 && flippedNormal.data[5] === 250);
check('red, blue and alpha are copied through', flippedNormal.data[0] === 120 && flippedNormal.data[2] === 250 && flippedNormal.data[3] === 255);
check('flipping twice restores every byte', flipNormalGreen(flippedNormal).data.every((value, index) => value === normal.data[index]));
check('a batch flip returns one map per input', flipNormalGreenAll([normal, normal]).length === 2);
check('flipping a short buffer throws', throws(() => flipNormalGreen({ width: 2, height: 2, data: new Uint8ClampedArray(4) })));
check('the convention table names both targets', NORMAL_CONVENTIONS.map((entry) => entry.id).join(',') === 'opengl,directx');
check('a plain name gains the target suffix', flippedName('rock_n.png', 'directx') === 'rock_n_dx.png');
check('a DirectX name flips back to OpenGL', flippedName('rock_n_dx.png', 'opengl') === 'rock_n_gl.png');
check('an existing suffix is replaced, not doubled', flippedName('rock_n_gl.png', 'directx') === 'rock_n_dx.png');
check('a name without an extension gets .png', flippedName('rock_n') === 'rock_n_dx.png');

// --- registry and page wiring --------------------------------------------

console.log('\nRegistry and page wiring');

check('seven tools ship across phases 1 and 2', TOOLBOX.length === 7, String(TOOLBOX.length));
check('tool ids are unique and slug-shaped', new Set(TOOLBOX.map((tool) => tool.id)).size === TOOLBOX.length && TOOLBOX.every((tool) => /^[a-z0-9-]+$/.test(tool.id)));
check('every tool has a label, a summary and a panel', TOOLBOX.every((tool) => tool.label && tool.summary && tool.panel));
check('every tool belongs to a declared group', TOOLBOX.every((tool) => TOOLBOX_GROUPS.some((group) => group.id === tool.group)));
check('toolsInGroup returns one group in registry order', toolsInGroup('a').map((tool) => tool.id).join(',') === 'color-space,units,texel-density,texture-memory');
check('the single-image group ships three tools', toolsInGroup('b').map((tool) => tool.id).join(',') === 'seamless-texture,channel-packer,normal-flip');
check('toolById finds a tool and refuses a stranger', toolById('units').id === 'units' && toolById('nope') === null);
check('the planned counts exceed what ships', TOOLBOX_GROUPS.reduce((sum, group) => sum + group.planned, 0) > TOOLBOX.length);

for (const tool of TOOLBOX) {
    const file = path.join(ROOT, 'features/toolbox/panels', tool.panel);
    const exists = await stat(file).then(() => true).catch(() => false);
    check(`the ${tool.id} panel file exists`, exists, tool.panel);
    if (!exists) continue;
    const module = await import(pathToFileURL(file).href);
    check(`the ${tool.id} panel exports mount()`, typeof module.mount === 'function');
}

const page = await readFile(path.join(ROOT, 'pages/toolbox.html'), 'utf8');
check('the page boots the toolbox', page.includes('../features/toolbox/page.js'));
check('the page mounts the shared chrome', page.includes('../shared/site.js'));
check('the page loads the error reporter', page.includes('../shared/error-reporting.js'));
check('the page uses the compiled stylesheet', page.includes('../assets/tailwind.css'));
check('the page has the nav and work hosts', page.includes('id="toolbox-list"') && page.includes('id="toolbox-work"'));
check('the page has a live status line', page.includes('id="toolbox-status"') && page.includes('aria-live="polite"'));
check('the page declares a language and a description', page.includes('lang="en"') && /<meta name="description"/.test(page));
check('the page loads no remote asset', !/https?:\/\//.test(page), (page.match(/https?:\/\/[^\s"']+/g) || []).join(', '));
check('the page has no inline handler', !/\son[a-z]+\s*=/.test(page));

const shell = await readFile(path.join(ROOT, 'features/toolbox/shell.js'), 'utf8');
check('the shell exposes the harness handle', /window\.toolboxKit\s*=/.test(shell));
check('the shell routes on the tool query', /\?tool=|searchParams\.get\('tool'\)/.test(shell));
check('the shell drops a panel that mounts late', /mountToken/.test(shell));

const runner = await readFile(path.join(ROOT, 'scripts/run-checks.mjs'), 'utf8');
check('the gate runs this harness', runner.includes("'check-toolbox.mjs'"));
check('the gate runs the toolbox browser harness', runner.includes("'check-toolbox-browser.mjs'"));

const browserHarness = await readFile(path.join(ROOT, 'scripts/check-toolbox-browser.mjs'), 'utf8').catch(() => '');
check('the browser harness drives every registry tool', browserHarness.includes('window.toolboxKit.select') && (browserHarness.match(/id: '[a-z-]+', label:/g) || []).length >= 7);
check('the browser harness reads the downloaded bytes', /createObjectURL\s*=/.test(browserHarness) && /__pngHead/.test(browserHarness));

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
