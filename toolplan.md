# Tool Plan — a 3D toolbox inside this platform

Plan for building the 17 browser utilities listed on RenderHub's
[3D Toolbox](https://www.renderhub.com/3d-toolbox/) as part of this project, in the same
static, vendored, gate-checked style as the rest of the tree.

Status: **phase 0 and phase 1 are built** — the shell, the four conversion tools,
`pages/toolbox.html` and `scripts/check-toolbox.mjs`. Groups B–D are still plans. Counts and
paths below refer to the tree as it stands after that work (`npm test` → 19 checks, 1,533
assertions, 29 routes).

## 1. What we are building (and what we are not)

The reference page is a capability list: model inspection, UV/texel checks, texture-map
generation and conversion, colour/unit conversion, HDRI editing, LOD generation, splat
viewing. We reimplement the capabilities we actually need, as client-side modules that feed
this platform's own workflows (plans, suites, finishes, imported furniture, environment
previews).

Not in scope:

- Copying any JavaScript from RenderHub or from any other site. Same rule as the IngeTrazo
  import work: **clean-room only**, from public specifications (W3C PNG, ZIP APPNOTE, Khronos
  glTF / KTX2 / Basis, OpenGL vs DirectX tangent conventions, CIE/IOR reference tables).
  RenderHub's toolbox is referenced for capability and UX comparison only.
- A server, an account, or an upload path. Every tool runs from `file://`-style static
  hosting with no request leaving the origin (the platform's zero-external-request rule).
- A second design system. Tools use the existing Tailwind build, `assets/tailwind.css`, the
  shared error reporter and the page conventions in `pages/*.html`.

## 2. What already exists to build on

| Asset | Where | Reuse |
| --- | --- | --- |
| three.js 0.160 + addons | `vendor/three/`, import map in every page | Viewers, GLTF/OBJ/Draco/GLTFExporter already used by `engine/ConversionEngine3D.js`, `features/advanced/exporter.js` |
| Vendor copier | `scripts/vendor-deps.mjs` | Adding `RGBELoader`/`EXRLoader`/`SimplifyModifier` imports is enough; the script walks the addon closure |
| Seamless PNG synthesis (deterministic, zlib only) | `scripts/generate-textures.mjs` | The tiling/blending maths to port to the browser for the seamless tool |
| Unit table | `features/import/dxf.js` (`INS_UNITS`) | Unit converter shares one table with the DXF importer |
| Plan scale | `core/world-space.js` (`PIXELS_PER_METER`, `INCH`) | Texel density and UOM results expressed in the same units the editor uses |
| PBR materials | `core/metadata.js`, `textures/*.png` (12 × 512²) | Memory/texel calculators can quote the platform's real material set |
| Release gate | `scripts/run-checks.mjs` (`CHECKS`), `scripts/check-*.mjs` | New harnesses are registered; docs updated in `docs/audit.md` |
| Page sweep | `scripts/check-pages.mjs` walks every `.html` in the tree | A new page joins the 28-route sweep automatically |

## 3. Architecture

One route, many tools. Adding 17 pages would triple link maintenance and the sweep's
surface for no benefit.

```
pages/toolbox.html                 shell: tool list, work area, drop zone, status bar
features/toolbox/page.js           bootstrap: mounts the shell (built)
features/toolbox/index.js          barrel: TOOLBOX registry + kit (built)
features/toolbox/shell.js          routing (?tool=slug), file drop, download, worker host (built)
features/toolbox/units.js          UOM + colour-space conversions (pure, built)
features/toolbox/image.js          decode/tile/resize/channel kernels (pure over ImageData)
features/toolbox/png.js            PNG encode/decode via canvas; zip for sprite sheets
features/toolbox/model.js          GLB/OBJ/STL/PLY loading, mesh stats, UV/texel sampling
features/toolbox/pbr.js            albedo/F0, channel pack, normal combine/flip, map synthesis
features/toolbox/texture.js        memory tables, texel density (pure, built)
features/toolbox/splat.js          Gaussian splat spike (phase 3, behind a flag)
features/toolbox/panels/*.js       one panel per tool: form + preview + actions
```

Rules that keep this consistent with the existing suites:

- **Pure core, thin panel.** Every tool's maths lives in a module that takes numbers or
  `ImageData` and returns numbers or `ImageData`, with no DOM. Panels only wire inputs to it.
  That is what makes the checks meaningful and fast.
- **One registry entry per tool** (`{ id, label, group, panel, files }`) so the shell, the
  tests and `features.html` all read the same list.
- **Heavy work in a worker** (`features/toolbox/worker.js`): pixel kernels above 1 MP, GLB
  parsing above 50 MB, LOD reduction. The main thread only shows progress.
- **Determinism.** Seeded noise (same approach as `generate-textures.mjs`) so a test can
  hash the output of the seamless and map-generator tools.
- **No storage writes.** Tools are stateless; the shell may remember the last tool in
  `sessionStorage` only.

Test split, matching the existing gate:

- `scripts/check-toolbox.mjs` — Node, no Chrome. Units, colour, memory tables, texel maths,
  channel/normal kernels on small `ImageData` buffers, sprite-sheet arithmetic, PBR tables,
  registry wiring.
- `scripts/check-toolbox-browser.mjs` — CDP, like `check-editor-wiring.mjs`. Loads
  `pages/toolbox.html`, drives each tool through the DOM, checks the exported blob's
  signature and (for PNGs) decoded pixels, and asserts no console error.

## 4. The tools

Grouped by the work they need, not by the order on the page. Effort: S ≤ 1 day, M 2–3 days,
L 4–6 days, XL > 1 week (needs a spike first).

### Group A — pure conversion (no images, no 3D)

| # | Tool | Module | Formats / data | Effort |
| --- | --- | --- | --- | --- |
| 1 | Color Space Converter | `features/toolbox/units.js` | hex ↔ RGB ↔ sRGB/linear, per-channel transfer | S |
| 2 | UOM Converter | `features/toolbox/units.js` | length, area, volume, mass, angle, data size | S |
| 3 | Texel Density Calculator | `features/toolbox/texture.js` | texture px, surface metres, UV fraction | M |
| 4 | Texture Memory Calculator | `features/toolbox/texture.js` | RGBA8, BC1–BC7, ETC2, ASTC, RGBA16F/32F, mips, POT | S |

**1. Color Space Converter.** Two-way sRGB/linear with exact IEC 61966-2-1 transfer
(not a gamma 2.2 approximation), 8-bit hex parsing, out-of-gamut warning for negative linear
values, and the formula shown for shader/lighting use. The editor already tags textures
`THREE.SRGBColorSpace`; this tool is where a user checks a value before typing it into a
material. Tests: round-trip within 1e-6, known pairs (0.5 sRGB → 0.2140 linear, 0.04 sRGB →
0.0031 linear), black/white endpoints, invalid input.

**2. UOM Converter.** Shares `INS_UNITS` with the DXF importer and adds area, volume, mass,
angle and byte units. The point beyond a generic converter is the **scale-mismatch helper**:
given a measured plan length and a model length, report the factor (1000, 25.4, 0.3048, …)
and the likely cause. Tests: inch↔mm↔ft exactness, area/volume derived by squaring/cubing,
hint list for the platform's own scales (30 px/m, 96 in walls).

**3. Texel Density Calculator.** `density = texturePixels / surfaceMetres` (px/m) and the
inverse (required texture size for a target density), plus the variant using the UV fraction
actually covered. Presets for the platform's texture sizes (512², 1024², 2048²) and wall
heights (2.7 m, 96 in). When model loading lands (Group D), the same kernel samples density
per triangle; until then it is arithmetic only.

**4. Texture Memory Calculator.** Worse-case GPU size tables for uncompressed, BC1–BC7,
ETC2/EAC, ASTC 4×4…12×12 and float formats, plus `×4/3` for a full mip chain and the
saving from the next power-of-two size. Includes the platform's twelve 512² materials as a
"current scene" row so the number is concrete. Tests: 4096² RGBA8 = 64 MiB, BC1 = 8 MiB,
BC7 = 16 MiB, mip total = 85.3 MiB, ASTC block rounding on non-multiples of 4.

### Group B — single-image tools

| # | Tool | Module | In → out | Effort |
| --- | --- | --- | --- | --- |
| 5 | Seamless Texture Generator | `features/toolbox/image.js` | photo → tileable PNG | M |
| 6 | PBR Channel Packer | `features/toolbox/pbr.js` | 2–4 grey maps → RGBA PNG | M |
| 7 | Normal Map Channel Inverter | `features/toolbox/pbr.js` | normal PNG(s) → PNG(s) | S |
| 8 | Normal Map Combiner | `features/toolbox/pbr.js` | base + detail normals → PNG | M |
| 9 | PBR Albedo & Reflectance Picker | `features/toolbox/pbr.js` | colour → verdict + F0 | S |
| 10 | Sprite Sheet Packer / Unpacker | `features/toolbox/image.js` | image sequence ↔ grid sheet | M |

**5. Seamless Texture Generator.** Port the edge-blend of `scripts/generate-textures.mjs`
to a canvas kernel: wrap-shift by half, feathered cross-fade at the seam, optional
high-pass to flatten lighting, tile preview 2×2, and PNG export. It must also prove
seamlessness: the tool reports the max channel delta between the left/right and top/bottom
edges before and after. Tests: a synthetic gradient becomes edge-continuous (delta < 2/255),
output size preserved, deterministic for a fixed seed.

**6. PBR Channel Packer.** Presets for glTF ORM (R = AO, G = roughness, B = metalness),
Unreal (R/G/B/A configurable), Unity mask and a custom mapping. Resamples inputs to a common
size, warns on mismatched sources, exports PNG plus a JSON sidecar describing the mapping.
This is the tool that makes the platform's imported GLB furniture cheaper: three's
`aoMap`/`roughnessMap`/`metalnessMap` can share one texture. Tests: channel placement per
preset, alpha pass-through, unequal sizes resampled, sidecar matches the pixels.

**7. Normal Map Channel Inverter.** Green-channel flip (OpenGL ↔ DirectX) as an involution,
batch input with per-file download and a ZIP for the batch. Unchanged R/B, no renormalisation
(flipping Y is exact). Tests: flipping twice is identity, R/B untouched, 8-bit values
preserved, batch ZIP names.

**8. Normal Map Combiner.** Whiteout/linear blend of a base normal with one or more detail
maps: `n = normalize(vec3(xy_base*strength + xy_detail, z_product))`, source-space
normalisation, adjustable output size (nearest or box), and a lit preview sphere with a
movable light so the user can see the result. Tests: flat base + flat detail = flat, tilt
direction preserved, output within [0,255] and normalised, combining is close to
commutative within tolerance.

**9. PBR Albedo & Reflectance Picker.** Checks a base colour against practical albedo
ranges by material class (charcoal 0.04–0.05, fresh snow 0.8–0.9, …), and computes non-metal
F0 from IOR with the three outputs the page names (linear, sRGB, Unreal "specular" 0–1
remap). Reference swatches for the platform's own finishes (paint, plaster, tile, timber).
Tests: F0 for IOR 1.5 = 0.04, Unreal mapping endpoints, in/out-of-range verdicts, sRGB
round-trip.

**10. Sprite Sheet Packer / Unpacker.** Grid packer with padding, power-of-two option,
per-frame trim detection, animated preview at a chosen fps; unpacker reads a sheet plus
columns/rows and emits frames. Exports PNG (+ JSON frame map) and a ZIP of frames. Tests:
grid arithmetic for ragged counts, padding offsets, round-trip pack→unpack pixel equality on
a synthetic sequence, frame-map JSON.

### Group C — image sets and lighting

| # | Tool | Module | In → out | Effort |
| --- | --- | --- | --- | --- |
| 11 | PBR Workflow Converter | `features/toolbox/pbr.js` | MR ↔ SG texture sets | M |
| 12 | PBR Map Generator / Viewer | `features/toolbox/pbr.js` | one image → 6 maps + preview | L |
| 13 | HDRI Environment Viewer / Editor | `features/toolbox/env.js` | .hdr/.exr panorama → edited panorama | L |

**11. PBR Workflow Converter.** Metal/roughness ↔ specular/glossiness using the standard
conversion (dielectric F0 → specular colour, roughness → glossiness `1 - r`), with an
explicit **approximation notice**: the round trip is lossy for metals, so the panel shows
the error estimate for a test patch. Presets for Unity (metallic/smoothness), Unreal
(roughness), glTF (MR) and Godot. Tests: roughness→gloss exactness, dielectric conversions
at F0 0.04, metal pass-through of base colour, non-metal round trip within a stated epsilon.

**12. PBR Map Generator / Viewer.** Height/roughness/AO/normal derivation from one image:
luminance → height, Sobel → normal (with strength and OpenGL/DirectX switch), blurred
inverse → AO, local variance → roughness, plus metallic as a constant or mask. Live preview
on a lit sphere/plane with adjustable light and environment, matching the material previews
in `features/wall/preview.js`. Tests: flat image gives flat normal (128,128,255) and full
AO, a ramp gives a consistent normal sign, normal length ≈ 1, deterministic seeded noise.

**13. HDRI Environment Viewer / Editor.** Needs `RGBELoader` (Radiance `.hdr`) and
`EXRLoader` (`.exr`) vendored; then exposure, gamma, saturation, clamp, blur (separable box
or mip-based), rotation and background/lighting split, preview on a chrome sphere and on a
sample box. This is the biggest new dependency surface, which is why it sits late. Tests:
loader import resolves in the browser harness, exposure 0 keeps pixels, clamp bounds,
rotation is a horizontal wrap, exported `.hdr` re-loads with the same dimensions.

### Group D — model pipeline

| # | Tool | Module | In → out | Effort |
| --- | --- | --- | --- | --- |
| 14 | Model Inspector | `features/toolbox/model.js` | GLB/glTF/OBJ/STL/PLY → report | M |
| 15 | UV Layout & Checker | `features/toolbox/model.js` | model → layout PNG + checker | L |
| 16 | Polygon Reducer / LOD Generator | `features/toolbox/lod.js` | model → N LODs | XL |
| 17 | Gaussian Splat Viewer | `features/toolbox/splat.js` | .ply/.splat → viewer | XL (spike) |

**14. Model Inspector.** Wrap the existing `GLTFLoader` (+Draco) and add OBJ/STL/PLY
parsers (small, text/binary format reading only). Report triangles/vertices, draw calls,
materials, texture sizes, morph targets, skins, UV sets, degenerate triangles, non-manifold
edges (edge-count pass), loose vertices, missing UVs and normals, bounding box in metres, and
per-material texture memory via tool 4. Shaded/wireframe/textured toggles. Tests: stats on a
generated cube GLB, degenerate triangles counted, missing-UV detection, OBJ/STL/PLY parse of
in-memory fixtures.

**15. UV Layout & Checker.** Rasterise UV triangles into a 1024² PNG (line drawing), report
out-of-0..1 islands, overlapping/mirrored islands (signed UV area), and stretch via a
per-triangle 3D-area / UV-area ratio; render a checker material on the model and export the
checker texture. Texel density per island uses the tool 3 kernel. Tests: a known cube unwrap
gives expected area ratios, mirrored detection on a negated island, layout PNG non-empty,
out-of-range UVs reported.

**16. Polygon Reducer / LOD Generator.** Quadric edge-collapse decimation preserving UV
seams and material boundaries, run in a worker, producing a meshopt-style LOD chain
(100/50/25/10 %) with a triangle/vertex/memory table and GLB/OBJ/STL/PLY export per level.
This is the one place a third-party algorithm (Garland–Heckbert) must be implemented from
the paper; no library is vendored for it and `SimplifyModifier` is too lossy to ship. Spike
first: one sphere, measure seam preservation and error. Tests: triangle counts hit the
target ±2 %, UVs stay in range, no NaN positions, exported GLB parses back with the same
counts.

**17. Gaussian Splat Viewer.** Spike only in this plan: parse `.ply` (property-listed
position/scale/rotation/opacity/SH) and `.splat`, then render with an instanced quad +
sorting shader. three r160 has no splat primitive, so this is a custom renderer; decide after
the spike whether to ship it (it is the only tool with no existing platform hook). Gate:
loads a 10k-splat fixture, orbit works, no context loss, frame budget stated.

## 5. Sequencing

| Phase | Work | Tools | Est. | Status |
| --- | --- | --- | --- | --- |
| 0 | Shell, registry, kit, `check-toolbox.mjs` skeleton, page in the sweep | — | 3 d | built |
| 1 | Pure conversions (Group A) | 1, 2, 4, 3 (arithmetic part) | 5 d | built |
| 2 | Single-image tools (Group B) | 5, 6, 7, 9, 10, 8 | 12 d | next |
| 3 | Image sets + environment (Group C) | 11, 12, 13 | 14 d |
| 4 | Model pipeline (Group D) | 14, 15 | 9 d |
| 5 | LOD + splat spike | 16, 17 | 6 d + spike outcome |

Dependencies that matter: 6 and 16 need `png.js`/`model.js`; 3's per-model part needs 14;
4 is reused inside 14's report; 12 reuses 6; 15 reuses 3 and 14.

## 6. Gate and docs

- `check-toolbox.mjs` is registered in `scripts/run-checks.mjs` (`CHECKS`, after
  `check-imports`). It pins the pure maths and imports each panel in Node, so a registry entry
  without a panel fails the gate. The CDP harness (`check-toolbox-browser.mjs`) arrives with
  phase 2, the first tool that needs a canvas; until then the page is covered by the route
  sweep, which fails on any console error or 404.
- `pages/toolbox.html` is picked up by `check-pages.mjs` automatically (it walks every
  `.html` in the tree); the route count moved 28 → 29 and the docs' figures are current.
- Every panel gets an `id`-addressed handle on `window.toolboxKit` (mirroring `editorKit`,
  `systemsKit`, `planOcr`) so the browser harness drives the real DOM rather than calling
  internals.
- Mutation-test each new assertion group once, as with the imports gate: a changed constant
  (mm scale, mip factor, glTF channel order) must fail the suite.
- `docs/audit.md` §1/§4/§7 counts and a §8 entry are updated. `features.html` does not list
  the individual tools — the registry is the single list, the page is linked from the site
  menu's Tools group, and an assertion compares `TOOLBOX` with the panels on disk.

## 7. Risks and open questions

1. **HDRI codecs.** `.hdr` is straightforward; `.exr` is a large vendored addon and pulls
   `EXRLoader` dependencies. Decide: ship `.hdr` first, `.exr` behind the same phase if the
   vendor size is acceptable (current vendor tree is ~2.6 MB).
2. **LOD quality.** A faithful QEM implementation is the largest single item here. Fallback
   if the spike disappoints: vertex-clustering decimation with seam constraints (simpler,
   lower quality) and an honest quality caveat in the UI.
3. **Splat rendering.** No platform hook, custom renderer, unclear payoff. Keep it a spike
   behind `?tool=splat` and do not count it in the phase estimates until it proves useful.
4. **Memory ceilings.** 8K PBR sets in a browser tab need workers and tiling; the plan caps
   single-image operations at 4096² with a clear message rather than silently thrashing.
5. **Canvas colour management.** Browsers may colour-manage images on decode; every kernel
   must read `ImageData` (unpremultiplied sRGB bytes) and never round-trip through CSS or a
   `<canvas>` style, or the "linear" values will be wrong.
6. **Naming.** The registry labels mirror the reference page for recognisability, but copy
   and UI are ours; do not link out to their tools from the shipped page.

## 8. Definition of done (per tool)

- Panel works from a dropped file or typed values, with an error state that names the
  problem (wrong channel count, unsupported codec, degenerate mesh).
- Exports are named and typed (`*.png`, `*.glb`, `*.zip`) and re-import cleanly through the
  same tool or three's loader.
- Its assertions run in `npm test`; the mutation check for its core constant fails.
- `features.html` and `TOOLBOX` agree; `docs/audit.md` counts are current.
- No request leaves the origin, no inline handler added, no new npm dependency without
  `scripts/vendor-deps.mjs` covering it.
