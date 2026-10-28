# Production-release audit — Shaker 3D floor plan

Date: 2026-10-28 (final pass) · Scope: the whole tracked tree (163 JS modules plus 17
scripts, 27 pages plus the root redirect, 25 docs) and the 28 routes they serve. Method:
`npm test` was run end to end — all 17 scripts, the 28-route sweep, both page sweeps — plus
targeted browser probes for the error reporting, the failed-save notice and the corrected
lighting rule.

> **Verdict: the six release blockers are closed; this build is ready to deploy.** Every
> gate below is green: **1,265 assertions pass / 0 fail**, 28/28 pages load with no console
> error and no missing asset, and the site makes **zero third-party runtime requests**.
> What remains in §3 is launch-week polish, not release blockers.

---

## 1. Release gate status

| Gate | Measured 2026-10-28 | Status |
| --- | --- | --- |
| Scripts with assertions (13 `check-*` + `browser-check`) | **1,265 pass / 0 fail** | pass |
| Page sweep (28 routes) | **28/28 clean** — no console errors, no failed local asset | pass |
| Local links and module specifiers | every local `href`/`src`/`url()` and every module specifier resolves | pass |
| Runtime dependencies | none external: three.js, CSG, pathfinding helper, joystick, Tailwind, fonts and hero images are all local | pass |
| Error reporting | `shared/error-reporting.js` on 27 pages; save failures surface in the editor | pass |
| Licence | `LICENSE` (proprietary, all rights reserved) + `"license": "UNLICENSED"` | pass |
| Automated gate | `npm test` runs all 17 scripts; `.github/workflows/checks.yml` runs it on every push | pass |
| Data durability | debounced autosave, flush on `beforeunload` + `pagehide`, visible failure notice with Export | pass (local-only by design) |
| Accessibility | 7 pages without `lang`, 111 inline `onclick`, canvas-only outputs | open (§3) |
| Responsive/mobile | 71 breakpoint utilities across 27 pages; editor is desktop-first | open (§3) |

Counts re-derived: 158 of 163 tracked modules are reachable from a page (the five misses are
the unused barrels in §5); 28 routes = 27 pages plus the root redirect; 17 scripts = 13
assertion harnesses + the link/console sweep (`check-pages`) + 2 page sweeps (one of them,
`browser-check`, carries its own 206 assertions) + 1 repricing script.

## 2. Blockers — all closed

| # | Blocker (2026-10-28 audit) | Fix | Evidence |
| --- | --- | --- | --- |
| B1 | 12 finish textures referenced, none on disk; 4 404s on 3 routes; silent flat-colour fallback | `scripts/generate-textures.mjs` writes 12 seamless 512² PNGs to `textures/`; `core/metadata.js` and the finishes presets point at them | `check-pages` 28/28 clean; `check-studio` 86/86 with the new URLs |
| B2 | Title 24 dimming tested per fitting (9 × 14 W = no warning); stale `CODE_SCOPE` assertion | rule now sums the **controlled load per switch** (`features/lighting/engine.js`), exemption applied to the load; assertion updated to the California codes | `check-lighting` **123/123**; probe: nine 14 W on one plain switch → “Controlled loads: 126 W” warning |
| B3 | every page loaded three.js from esm.sh, Tailwind from the Play CDN, fonts and hero images from Google; npm deps unused | `scripts/vendor-deps.mjs` copies the 255-file addon closure + three/CSG/bvh/nipplejs; Tailwind compiled to `assets/tailwind.css`; `scripts/vendor-fonts.mjs` self-hosts 11 font files; hero images downloaded into `assets/images/` | 0 external URLs left in `pages/*.html`; 0 remote module imports; 28/28 pages clean |
| B4 | no error reporting; failed `localStorage` write only logged to console | `shared/error-reporting.js` (classic script, 27 pages) captures errors, rejections and resource failures into a sessionStorage ring buffer with an optional `error-endpoint` meta; the editor shows a “Project not saved / Export” notice and reports it | probe: uncaught throw → logged + notice; forced `QuotaExceededError` → save notice + `save: Could not save the project to local storage` |
| B5 | no licence | `LICENSE` with a proprietary all-rights-reserved notice plus a design-aid disclaimer; `package.json` `"license": "UNLICENSED"` | files committed |
| B6 | nothing enforced the checks; two failures survived two commits | `scripts/run-checks.mjs` runs all 17 scripts, starts the server the sweeps need, skips browser checks when no Chrome is installed, and exits non-zero on any failure; `npm test`; CI runs build/vendor/texture drift checks, then the suite | `npm test`: **17 checks passed, 0 failed, 0 skipped** |

### Notes on the fixes

- **Textures are generated, not photographed.** They are tileable pattern textures (marble,
  wood planks, ceramic grid, concrete, stone courses, carpet, paint) at design-aid quality —
  no 404s, and the finishes are visibly different. Replacing them with photographed
  materials is a content task, not a code change.
- **The lighting rule now reports the load it measured**, e.g. “9 luminaire(s) have no
  dimmer… Controlled loads: 126 W”, so a failed inspection is explainable.
- **Third-party code is vendored, not bundled.** Import maps resolve `three`,
  `three/addons/`, `three/nodes`, `three-bvh-csg`, `three-mesh-bvh` to `vendor/`; the legacy
  `app.html` loads the UMD nipplejs build as a classic script. A static deploy needs no
  `npm install`, and `scripts/vendor-deps.mjs` reproduces the tree from `package.json`.
- **One harness timing fix.** `browser-check` held WASD for 1.4 s; with real textures the
  SwiftShader software renderer produces so few frames that the walker sometimes never
  ticked. The hold is now 4 s — the assertion (>0.5 m moved) is unchanged.

## 3. Launch-week polish (not blockers)

1. **Accessibility.** Seven pages lack `<html lang>` (`about`, `contact`, `Editor`,
   `features`, `gallery`, `index`, `pricing`); the elevation bar toggles classes without
   `aria-pressed`; the wall stepper is icon-only; canvas output (plan, elevation, 3D) has no
   text equivalent. The save-failure and error notices do use `role="alert"`.
2. **SEO/social metadata.** 26 of 27 pages have no `<meta name="description">`, none has
   Open Graph/Twitter tags, and there is no `robots.txt` or `sitemap.xml`.
3. **Payload and rebuild cost.** `pages/Editor.html` pulls 110 local modules / 1.3 MB
   unminified plus vendored three.js, and every committed edit still runs
   `saveAndSync()` → `update3D()` → `conversionEngine.convert()` (full CSG rebuild).
4. **Kitchen clearance copy disagrees with itself.** `features/kitchen/catalog.js` uses a
   380 mm range landing; `features/studio/layout-solver.js` uses 900 mm (both 1.07 m aisle).
   The same kitchen can pass one check and fail the other.
5. **Support matrix is unstated.** The studio is mouse/keyboard and desktop-first
   (`Editor.html`: no `@media`, 2 breakpoint utilities, 2 pointer handlers).
6. **CSP.** Removing the CDNs made a policy possible, but 111 inline `onclick` handlers and
   4 inline `<script>` blocks still require `'unsafe-inline'`. Convert them to listeners
   first, then ship `Content-Security-Policy: default-src 'self'`.
7. **One stray file.** `resnet-18-classification-paddleocr.ipynb` (850 KB, unrelated ML
   notebook) is still on disk untracked; it is not committed, but a folder-upload deploy
   would include it. Delete it when convenient.

## 4. What is production-quality

- All 28 routes load; every internal link, asset and module specifier resolves; no console
  error on any route.
- 1,265 assertions pass across the ten design suites, the editor, the upload pipeline, the
  shared plan modules, the 28-route sweep and two browser sweeps. `browser-check`
  (206/206) drives stairs, landscape, roof and wall through the real editor.
- The site is self-contained: no runtime request leaves the origin, so CDN outages,
  corporate proxies and supply-chain tampering cannot take it down mid-session.
- Projects are versioned (`migrateProject`/`stampProject`), export/import as JSON, and the
  upload → studio hand-off (55 walls, 2 room slabs) round-trips.
- Autosave is throttled and dirty-only, flushes on both unload events, and a failed write is
  visible to the user with an Export escape hatch.
- Every designer draft is consumed once; the wall/roof/landscape/stair suites carry their
  rule registers and design-aid disclaimers into the UI.

## 5. Architecture debt that raises production risk

**One 5,609-line controller with no exports.** `editor/editor.js` holds the whole studio;
every action is a `window.*` global or an inline `onclick`, and `grep "^export "` returns
nothing. All pages, drafts and browser harnesses boot through it.

**`ConversionEngine3D` (792 lines) is a god class.** Textures, lights, floors, ceilings, CSG
wall cuts, roof extrusion, measurement sprites, GLB loading and item dispatch all live in
`convert()`, which `saveAndSync()` calls on every interaction (line 5325).

**Three application states.** `editor/editor.js:191`, `demo/demo.js:18` and
`app/js/main.js:17` each define an `AppState` with different fields.

**Renderer/camera setup is duplicated.** `new THREE.WebGLRenderer` is called 12 times in
9 files — editor 1, `demo/*` 4, `scene/SharedViewer.js` 2 (panorama and plan),
`features/roof/preview.js` 1, `features/wall/preview.js` 1, legacy `app/js/main.js` 3. Only
`scene/scene-camera.js` (framing) is shared.

**Snapping is split four ways** — `core/wall-snap.js`, `core/elevation-snap.js`,
`features/advanced/snapping.js`, `InWallItem.calculateSnap` — with thresholds in three
units. `Item.isValidPosition()` is a real rotated-footprint test, enforced before add and
drag commit.

**Drafts are unversioned localStorage contracts.** Nine `*-editor-draft` keys, each
consumed once by an `apply*EditorDraft()`; a malformed draft is dropped silently.

**Dead code and leftovers.** Five unused barrels (`features/{bid,deck,electrical,framing,
wall}/index.js`); `AppState.graph` is written at `editor/editor.js:4674` and
`demo/demo.js:356` and never read.

## 6. Deployment checklist

1. **Serve from the repository root** (the import maps and page links use `/vendor/…` and
   `/assets/…` absolute paths). Any static host works; no build step is required because
   `vendor/`, `textures/` and `assets/tailwind.css` are committed.
2. **Add hosting config**: gzip/brotli for `*.js`, `*.css`, `*.svg`, `*.md`; long-lived
   caching for `vendor/`, `assets/fonts/` and `textures/` (their names are stable — add a
   query string or path prefix when they change); `no-cache` for `*.html`.
3. **Security headers**: `X-Content-Type-Options: nosniff`, `Referrer-Policy:
   strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`. Add
   `Content-Security-Policy: default-src 'self'` once §3.6 is done; `img-src 'self' data:
   blob:` and `connect-src 'self'` cover the current app.
4. **Watch errors**: add `<meta name="error-endpoint" content="…">` to the pages if you
   want the captured reports posted; support can otherwise read `window.errorLog()`.
5. **Staging pass**: deploy to a staging origin and run `npm test` against it by setting
   `BASE_URL`; the suite's sweep covers every route.
6. **Housekeeping**: delete the untracked notebook (§3.7).

## 7. Verification log (2026-10-28, final)

| Script | Result |
| --- | --- |
| `check-kitchen.js` | 27 / 27 |
| `check-kitchen-page.mjs` | 29 / 29 |
| `check-scene-upload.mjs` | 32 / 32 |
| `check-editor-wiring.mjs` | 14 / 14 |
| `check-studio.js` | 86 / 86 |
| `check-framing.mjs` | 49 / 49 |
| `check-new-suites.mjs` | 53 / 53 |
| `check-plumbing.js` | 128 / 128 |
| `check-roof.js` | 126 / 126 |
| `check-wall.js` | 151 / 151 |
| `check-stairs.js` | 185 / 185 |
| `check-ocr.js` | 56 / 56 |
| `check-lighting.js` | **123 / 123** |
| `browser-check.mjs` | 206 / 206 |
| `check-pages.mjs` | 28 / 28 pages clean |
| `browser-pages.mjs` | 4 legacy pages, 0 console errors |
| `check-price-suites.mjs` | every quoted row in 8 suites repriced at its quoted price |

`npm test` → **17 checks passed, 0 failed, 0 skipped; 1,265 assertions passed.**

Targeted probes (run, then removed):

- **Controlled load:** a 6 × 5 m living room, nine 14 W downlights, one single-pole switch
  → `energy-controls` warning, “Controlled loads: 126 W”.
- **Error capture:** `setTimeout(() => { throw new Error('probe-boom') })` → entry
  `error: Uncaught Error: probe-boom` in `window.errorLog()`, `role="alert"` notice shown.
- **Failed save:** `localStorage.setItem('floorplan3d_autosave', …)` forced to throw
  `QuotaExceededError` → “Project not saved … Export” notice plus a `save:` log entry.
- **Offline:** no `https://` URL remains in `pages/*.html`, and no JS module imports a
  remote specifier.

## 8. Changes this session

- **Textures shipped.** `scripts/generate-textures.mjs` + 12 PNGs in `textures/`; metadata
  and preset expectations moved from `.jpg` to `.png`.
- **Lighting rule corrected** to compare controlled load per switch; the stale `CODE_SCOPE`
  assertion now checks the California codes the document cites.
- **Dependencies vendored.** `scripts/vendor-deps.mjs` (255 files, 2.6 MB) and the import
  maps rewritten in 15 pages; `three-mesh-bvh` added to `package.json`;
  `scripts/vendor-fonts.mjs` (11 files, 576 KB); hero images local.
- **Tailwind compiled.** `tailwind.config.cjs`, `assets/tailwind.src.css`,
  `assets/tailwind.css` (59 KB); the Play CDN and the inline `tailwind.config` blocks were
  removed from 26 pages, including the calculator's `brand` palette and Inter face.
- **Error reporting added.** `shared/error-reporting.js` on all 27 pages; the editor reports
  and displays failed saves; the per-save `console.log` was removed from
  `core/storage.js`; autosave flushes on `pagehide` as well as `beforeunload`.
- **Licence added.** Proprietary `LICENSE` + `"license": "UNLICENSED"`.
- **Release gate added.** `scripts/run-checks.mjs`, `npm test`, and a CI workflow that also
  rejects stale `assets/tailwind.css`, `vendor/` or `textures/`.
- **Repo hygiene.** `.server.log` untracked and removed; `.gitignore` now covers logs,
  `.freebuff/` and `node_modules/`.
- **Harness timing.** `browser-check` holds WASD for 4 s so the software renderer can tick;
  the assertion threshold is unchanged.

## 9. Historical notes

- The lab demos were folded into `features/lab/kit.js` and wired into the editor; the React
  prototype, lab pages and unused lab components were removed.
- The unwired root dumps (`Qwen_javascript_*.js`, `pages/helper.html`, `pages/Qwen_html_*`,
  `txt.txt`, `TXT2.TXT`, vendored `three.js`) were merged or deleted; no unreferenced dump
  files remain.
- Earlier audits' fixed findings (dead wall selection, always-true `isValidPosition`, fixed
  1 m grid, unversioned project schema, unused `footprint()`, noisy autosave) are recorded
  in git history and are no longer true.
