/**
 * Tool 3 — texel density calculator.
 *
 * `density = texturePixels / surfaceMetres`, with the UV-coverage correction:
 * an island that covers a fraction of the sheet only gets the square root of it
 * per side. The second half inverts the question — what texture size hits a
 * target density — because that is the number a bill of materials needs.
 */

import { formatNumber } from '../units.js';
import { TEXEL_SURFACES, TEXEL_TEXTURE_SIZES, texelDensity, texturePixelsForDensity } from '../texture.js';

export function mount(root) {
    root.innerHTML = `
        <div class="grid gap-3 xl:grid-cols-2">
            <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 class="text-[11px] font-bold uppercase tracking-wider text-slate-500">Density of a surface</h2>
                <div class="mt-2 grid grid-cols-2 gap-2">
                    <label class="block text-[10px] text-slate-500">Texture
                        <select id="texel-pixels" class="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-1 font-mono text-[11px]"></select>
                    </label>
                    <label class="block text-[10px] text-slate-500">Surface (m)
                        <input id="texel-surface" type="number" min="0.01" step="0.01" value="2.7"
                            class="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-1 font-mono text-[11px]">
                    </label>
                    <label class="block text-[10px] text-slate-500">UV coverage (%)
                        <input id="texel-uv" type="number" min="1" max="100" step="1" value="100"
                            class="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-1 font-mono text-[11px]">
                    </label>
                    <label class="block text-[10px] text-slate-500">Preset surface
                        <select id="texel-preset" class="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-1 text-[11px]"></select>
                    </label>
                </div>
                <dl class="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 font-mono text-[11px]">
                    <dt class="text-slate-500">per metre</dt><dd id="texel-density" class="text-right">—</dd>
                    <dt class="text-slate-500">per centimetre</dt><dd id="texel-cm" class="text-right">—</dd>
                    <dt class="text-slate-500">per inch</dt><dd id="texel-inch" class="text-right">—</dd>
                </dl>
                <p id="texel-error" class="mt-1 min-h-[1rem] text-[10px] text-red-600"></p>
            </section>

            <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 class="text-[11px] font-bold uppercase tracking-wider text-slate-500">Texture size for a target</h2>
                <label class="mt-2 block text-[10px] text-slate-500">Target density (px/m)
                    <input id="texel-target" type="number" min="1" step="1" value="512"
                        class="mt-0.5 w-32 rounded border border-slate-200 px-1.5 py-1 font-mono text-[11px]">
                </label>
                <dl class="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 font-mono text-[11px]">
                    <dt class="text-slate-500">exact</dt><dd id="texel-required" class="text-right">—</dd>
                    <dt class="text-slate-500">power of two</dt><dd id="texel-required-pot" class="text-right">—</dd>
                </dl>
                <p class="mt-3 text-[10px] leading-snug text-slate-500">
                    The 4K ceiling is a browser budget, not a format limit: a single 4096² RGBA8 texture is 64 MiB,
                    and every extra sheet is charged to the same tab.
                </p>
            </section>
        </div>
    `;

    const $ = (id) => root.querySelector(`#${id}`);
    const pixelsSelect = $('texel-pixels');
    const surfaceInput = $('texel-surface');
    const uvInput = $('texel-uv');
    const presetSelect = $('texel-preset');
    const targetInput = $('texel-target');

    TEXEL_TEXTURE_SIZES.forEach((size) => {
        const option = document.createElement('option');
        option.value = String(size);
        option.textContent = `${size} × ${size} px`;
        if (size === 1024) option.selected = true;
        pixelsSelect.appendChild(option);
    });

    const none = document.createElement('option');
    none.value = '';
    none.textContent = '—';
    presetSelect.appendChild(none);
    TEXEL_SURFACES.forEach((preset, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = preset.label;
        presetSelect.appendChild(option);
    });

    const paint = () => {
        try {
            const report = texelDensity({
                texturePixels: pixelsSelect.value,
                surfaceMetres: surfaceInput.value,
                uvFraction: Number(uvInput.value) / 100
            });
            $('texel-density').textContent = `${formatNumber(report.pixelsPerMetre, 4)} px/m`;
            $('texel-cm').textContent = `${formatNumber(report.pixelsPerCentimetre, 4)} px/cm`;
            $('texel-inch').textContent = `${formatNumber(report.pixelsPerInch, 4)} px/in`;
            $('texel-error').textContent = '';
        } catch (error) {
            ['texel-density', 'texel-cm', 'texel-inch'].forEach((id) => { $(id).textContent = '—'; });
            $('texel-error').textContent = error.message;
        }

        try {
            const required = texturePixelsForDensity({
                density: targetInput.value,
                surfaceMetres: surfaceInput.value,
                uvFraction: Number(uvInput.value) / 100
            });
            $('texel-required').textContent = `${formatNumber(required.exact, 1)} px`;
            $('texel-required-pot').textContent = `${required.powerOfTwo} × ${required.powerOfTwo} px`;
        } catch {
            $('texel-required').textContent = '—';
            $('texel-required-pot').textContent = '—';
        }
    };

    [pixelsSelect, surfaceInput, uvInput, targetInput].forEach((control) => {
        control.addEventListener('input', paint);
        control.addEventListener('change', paint);
    });
    presetSelect.addEventListener('change', () => {
        const preset = TEXEL_SURFACES[Number(presetSelect.value)];
        if (!preset) return;
        surfaceInput.value = String(preset.metres);
        paint();
    });

    paint();
}
