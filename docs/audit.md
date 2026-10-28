# Production-release audit — Shaker 3D floor plan

Date: 2026-10-28 (final pass) · Scope: the whole tracked tree (163 JS modules plus 17
scripts, 27 pages plus the root redirect, 25 docs) and the 28 routes they serve. Method:
`npm test` was run end to end — all 17 scripts, the 28-route sweep, both page sweeps — plus
targeted browser probes for the error reporting, the failed-save notice and the corrected
lighting rule.

> **Verdict: the six release blockers are closed; this build is ready to deploy.** Every
> gate below is green: **1,267 assertions pass / 0 fail**, 28/28 pages load with no console
> error and no missing asset, and the site makes **zero third-party runtime requests**.
> The accessibility, metadata, clearance and support-matrix items from §3 are now closed too;
> what remains there is payload size and the CSP, neither a release blocker.

---

## 1. Release gate status

| Gate | Measured 2026-10-28 | Status |
| --- | --- | --- |
| Scripts with assertions (13 `check-*` + `browser-check`) | **1,267 pass / 0 fail** | pass |
| Page sweep (28 routes) | **28/28 clean** — no console errors, no failed local asset | pass |
| Local links and module specifiers | every local `href`/`src`/`url()` and every module specifier resolves | pass |
| Runtime dependencies | none external: three.js, CSG, pathfinding helper, joystick, Tailwind, fonts and hero images are all local | pass |
| Error reporting | `shared/error-reporting.js` on 27 pages; save failures surface in the editor | pass |
| Licence | `LICENSE` (proprietary, all rights reserved) + `"license": "UNLICENSED"` | pass |
| Automated gate | `npm test` runs all 17 scripts; `.github/workflows/checks.yml` runs it on every push | pass |
| Data durability | debounced autosave, flush on `beforeunload` + `pagehide`, visible failure notice with Export | pass (local-only by design) |
| Accessibility | `lang` on every page; `aria-pressed` on the view and elevation toggles; labels on icon-only controls; a `aria-live` text summary of the plan behind the canvases | pass (§3.1 closed, 111 inline `onclick` remain) |
| Responsive/mobile | support matrix stated on `features.html`; editor is desktop-first by design | pass (§3.5 closed) |

Counts re-derived: every tracked module is reachable from a page — the five system barrels
(`features/{bid,deck,electrical,framing,wall}/index.js`) are now imported by
`features/systems.js`, which builds the studio's Systems panel; 28 routes = 27 pages plus the
root redirect; 17 scripts = 13 assertion harnesses + the link/console sweep (`check-pages`)
+ 2 page sweeps (one of them, `browser-check`, carries its own 206 assertions) + 1 repricing
script.

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

1. **Accessibility — closed.** Every page carries `lang`; the 2D/3D/Elevation switch and the
   five elevation buttons now report `aria-pressed` as the state changes
   (`updateViewButtons`/`updateElevationButtons`); the icon-only wall stepper has
   `aria-label`; the plan canvas is `tabindex="0"` with `aria-describedby`, the 3D host is
   `role="img"`, and both point at a `aria-live="polite"` summary that
   `updatePlanA11ySummary()` rewrites on every rebuild (“Floor plan: 4 walls, 1 room, 3
   fixtures. Nothing is selected.”). The save-failure and error notices use `role="alert"`.
   Still open: the canvases have no non-text visual equivalent for a blind user, and 111
   inline `onclick` handlers remain (see 6).
2. **SEO/social metadata — closed except the sitemap.** Every one of the 27 pages now has a
   unique `<meta name="description">` plus Open Graph and Twitter-card tags (title,
   description, image, site name), and `robots.txt` allows crawling. `sitemap.xml` is not
   included because a sitemap needs absolute URLs and the production origin is not declared
   anywhere in the repository; add it (and `og:url`/`canonical`) once the origin is known.
3. **Payload and rebuild cost — open.** `pages/Editor.html` pulls **140 local modules / 1.8 MB**
   unminified (measured 2026-10-28 after the Systems panel was wired) plus vendored three.js,
   and every committed edit still runs `saveAndSync()` → `update3D()` →
   `conversionEngine.convert()` (full CSG rebuild).
4. **Kitchen clearance — closed.** `features/studio/layout-solver.js` no longer keeps a second
   copy of the numbers: `NKBA.aisle`, `sinkLanding`, `stoveLanding` and `counterDepth` are
   read from `KITCHEN_GAPS` in `features/kitchen/catalog.js`, so the studio's plan check and
   the kitchen run check apply the same 240 mm sink landing, 380 mm range landing and 1.07 m
   aisle. The 900 mm figure the solver used is gone; the suite's rule copy (15 in each side,
   one side minimum, both preferred) is now what both checks enforce.
5. **Support matrix — closed.** `pages/features.html` has a “What you need” section: current
   desktop Chrome/Edge/Firefox/Safari, WebGL 2 (WebGPU demo needs Chrome/Edge 113+), mouse
   and keyboard for the studio, 1024 px minimum width, and the local-storage durability note.
6. **CSP — open.** Removing the CDNs made a policy possible, but **111 inline `onclick`
   handlers, 15 inline import maps and 12 inline `<script type="module">` blocks** still
   require `'unsafe-inline'`. Move the maps and bootstraps into files and convert the handlers
   to listeners first, then ship `Content-Security-Policy: default-src 'self'`.
7. **One stray file — still on disk.** `resnet-18-classification-paddleocr.ipynb` (830 KB,
   unrelated ML notebook) is untracked; it is not committed, but a folder-upload deploy would
   include it. It was left alone rather than deleted because it is not part of this project.

## 4. What is production-quality

- All 28 routes load; every internal link, asset and module specifier resolves; no console
  error on any route.
- 1,267 assertions pass across the ten design suites, the editor, the upload pipeline, the
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

**One 5,876-line controller with no exports.** `editor/editor.js` holds the whole studio;
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

**Dead code and leftovers — closed.** The five system barrels are no longer dead re-exports:
`features/systems.js` imports `features/{bid,deck,electrical,framing,wall}/index.js` and is
the only module the editor uses to build the studio's Systems panel, so each barrel (and its
new `studio-panel.js`) is the single construction point for its system. The two written-never-
read `AppState.graph` assignments (`editor/editor.js`, `demo/demo.js`) are removed.

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
6. **Housekeeping**: delete the untracked notebook (§3.7) and add `sitemap.xml` with the
   production origin (§3.2).

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
| `check-wall.js` | 153 / 153 |
| `check-stairs.js` | 185 / 185 |
| `check-ocr.js` | 56 / 56 |
| `check-lighting.js` | **123 / 123** |
| `browser-check.mjs` | 206 / 206 |
| `check-pages.mjs` | 28 / 28 pages clean |
| `browser-pages.mjs` | 4 legacy pages, 0 console errors |
| `check-price-suites.mjs` | every quoted row in 8 suites repriced at its quoted price |

`npm test` → **17 checks passed, 0 failed, 0 skipped; 1,267 assertions passed.**

Targeted probes (run, then removed):

- **Controlled load:** a 6 × 5 m living room, nine 14 W downlights, one single-pole switch
  → `energy-controls` warning, “Controlled loads: 126 W”.
- **Error capture:** `setTimeout(() => { throw new Error('probe-boom') })` → entry
  `error: Uncaught Error: probe-boom` in `window.errorLog()`, `role="alert"` notice shown.
- **Failed save:** `localStorage.setItem('floorplan3d_autosave', …)` forced to throw
  `QuotaExceededError` → “Project not saved … Export” notice plus a `save:` log entry.
- **Offline:** no `https://` URL remains in `pages/*.html`, and no JS module imports a
  remote specifier.
- **Accessibility state:** drawing one wall set the live region to “Floor plan: 1 wall, 0
  rooms, 0 fixtures. Nothing is selected.”; pressing 2D → 3D → Elevation flipped
  `aria-pressed` on the mode group and the elevation group (3D, then Front) and left no
  runtime error.
- **Studio systems panel:** the five tabs render and the bid panel builds from the barrels
  (“No suites · $1650”, empty state) with no console error; the 3D view composites 1,895
  distinct colours after a four-wall plan, so the studio render is live.

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
- **The five system barrels are the construction point.** `features/systems.js` imports them
  and builds the studio's Systems panel (one `studio-panel.js` per system); the editor now
  imports every cross-suite helper from `features/{bid,deck,electrical,framing,wall}/index.js`
  instead of deep module paths, and `check-wall.js` asserts the barrel wiring.
- **Accessibility wiring.** `aria-pressed` on the view-mode and elevation buttons (updated in
  `updateViewButtons`/`updateElevationButtons`), `aria-label` on the wall stepper, a focusable
  plan canvas with a `aria-live` summary rewritten by `updatePlanA11ySummary()`, and
  `role="img"` on the 3D host.
- **Metadata.** A unique description, Open Graph and Twitter-card tags on all 27 pages;
  `robots.txt` at the root. No `sitemap.xml`: the production origin is unknown.
- **One clearance policy.** `features/studio/layout-solver.js` reads its landing, aisle and
  counter-depth minima from `KITCHEN_GAPS`, so the plan check and the kitchen run check cannot
  disagree again.
- **Support matrix stated.** `pages/features.html` gained “What you need” (browsers, WebGL 2,
  pointer input, 1024 px, local-storage durability).
- **Dead state removed.** The two `AppState.graph` assignments that nothing read are gone.
- **3D render robustness.** The WebGL renderer now matches `devicePixelRatio` (capped at 2), a
  frame requested while the 3D tab is hidden stays pending instead of being consumed by a
  frame that draws nothing, a `ResizeObserver` resizes the drawing buffer when the panel
  changes size without a window resize (a stale or 0×0 buffer is what a blank 3D view looks
  like), and a lost context is reported and repainted on `webglcontextrestored`.
- **Plan canvas is still 1×.** `blueprint-canvas` keeps a CSS-pixel backing store because its
  coordinates *are* the plan's coordinate space (`PIXELS_PER_METER` snapping, fixture
  positions, hit testing); making it DPR-aware means threading a scale factor through that
  model, so the 3D view was fixed first.

## 9. Historical notes

- The lab demos were folded into `features/lab/kit.js` and wired into the editor; the React
  prototype, lab pages and unused lab components were removed.
- The unwired root dumps (`Qwen_javascript_*.js`, `pages/helper.html`, `pages/Qwen_html_*`,
  `txt.txt`, `TXT2.TXT`, vendored `three.js`) were merged or deleted; no unreferenced dump
  files remain.
- Earlier audits' fixed findings (dead wall selection, always-true `isValidPosition`, fixed
  1 m grid, unversioned project schema, unused `footprint()`, noisy autosave) are recorded
  in git history and are no longer true.

## 10. Issue register — pros and cons of every open item

Measured 2026-10-28, after the §3 fixes. Each entry defines the issue, then costs fixing it
against leaving it, and records a verdict. Nothing in this section is a release blocker;
§2 lists the blockers that are closed.

### 10.1 Residual accessibility — canvases have no text equivalent

**What it is.** The plan, elevation and 3D views are canvases. A screen-reader user now gets
`#plan-a11y-summary` (“Floor plan: 4 walls, 1 room, 3 fixtures. Nothing is selected.”) and can
focus the plan, but cannot inspect geometry: wall lengths, openings, fixture positions.

- **Fix pros.** Closes the last real WCAG gap in the studio; needed for a VPAT or a public-
  sector sale; a structured export (SVG or text) also serves print and integration use.
- **Fix cons.** A true equivalent is a new output surface (SVG/text of the plan), not a patch;
  it needs its own tests (geometry, units, ordering) and will drift from the canvas unless the
  same model feeds both.
- **Cost.** Days, and a product decision about what a “text plan” contains.
- **Verdict.** The announcement layer is done. Treat the export as a feature request.

### 10.2 Sitemap, canonical and `og:url`

**What it is.** All 27 pages carry a unique description plus Open Graph/Twitter tags, and
`robots.txt` allows crawling. `sitemap.xml`, `<link rel="canonical">` and `og:url` are absent:
a sitemap needs absolute URLs and no origin is declared in this repository.

- **Fix pros.** Correct indexing and canonical consolidation; correct social preview when a
  page is shared by absolute link; `robots.txt` can advertise the sitemap.
- **Fix cons.** A placeholder or wrong origin publishes 28 canonical URLs pointing at another
  domain — strictly worse than shipping nothing. The origin then has to stay in step with the
  deploy, in 28 files, unless a small generator script is added to the gate.
- **Cost.** ~15 minutes once the origin is known, plus an optional `scripts/generate-sitemap.mjs`
  (reads one `SITE_ORIGIN` constant) if the origin should be enforced by `npm test`.
- **Verdict.** Blocked on one input: the production origin.

### 10.3 Payload and rebuild cost

**What it is.** The editor reaches **140 modules / 1.8 MB** unminified plus vendored three.js
(measured; the earlier 110 / 1.3 MB figure predates the Systems panel). Every committed edit
still calls `saveAndSync()` → `update3D()` → `conversionEngine.convert()`, a full CSG rebuild.

- **Fix pros.** 1.8 MB becomes roughly 350–450 KB minified (one bundle gzips to ~220 KB), so
  first paint on mobile-class hardware improves by seconds; a bundled build also simplifies
  CSP and hosts that do not do HTTP/2.
- **Fix cons.** It ends the “no build step, commit `vendor/` and serve the repo” property that
  §6 relies on; adds a bundler to `devDependencies` and a CI drift check; the import maps and
  page-level inline modules have to move to build output; a regression here is a silently
  broken page that only `browser-check` (206 assertions) would catch.
- **Cost.** A project, not a patch — a day plus a full harness pass on both sides.
- **Verdict.** Worth doing, as its own change with measurements before and after.

### 10.4 Content-Security-Policy

**What it is.** 111 inline `onclick` handlers, 15 inline import maps and 12 inline
`<script type="module">` blocks. A static host cannot nonce them, so `'self'` blocks them all;
the CDN removal is what made the policy conceivable in the first place.

- **Fix pros.** Real XSS containment on pages that render user text and import uploaded JSON;
  once the inline code is gone the header is a host setting with no app change.
- **Fix cons.** 15 import maps must become external files (or the maps must be dropped in
  favour of a build); 12 module bootstraps must move into modules; 111 handlers must become
  delegated listeners — each one a missed binding away from a dead toolbar button that only
  the browser harnesses would notice.
- **Cost.** The largest item here: about a day of mechanical work plus a full harness pass.
- **Verdict.** High value, high churn. Reuse the `shared/site.js` injection pattern so pages
  stop carrying scripts at all, then add the header at the host.

### 10.5 Stray notebook

**What it is.** `resnet-18-classification-paddleocr.ipynb` (830 KB), untracked, unrelated to
the app; a folder-upload deploy would ship it.

- **Fix pros.** One fewer unrelated artifact in a deploy; no ambiguity about what the project
  contains.
- **Fix cons.** It is the only copy on disk — deletion is not recoverable from this repository.
- **Cost.** One `rm`.
- **Verdict.** Safe only on an explicit decision; left in place for that reason.

### 10.6 One 5,876-line controller with no exports

**What it is.** `editor/editor.js` holds the whole studio; every action is a `window.*` global
or an inline `onclick`; `grep "^export "` returns nothing; all pages, drafts and harnesses
boot through it.

- **Fix pros.** Testable seams; small diffs; drag, snapping and the Systems panels could be
  unit-tested instead of driven through headless Chrome.
- **Fix cons.** Every `window.*` global and 111 inline handlers are consumers; splitting it
  without a compatibility facade breaks those, the three harnesses and saved user sessions.
  Highest regression risk of anything in §5.
- **Cost.** Weeks, in slices, not one change.
- **Verdict.** Refactor behind a facade only when a feature needs it.

### 10.7 `ConversionEngine3D` (792 lines) is a god class

**What it is.** Textures, lights, floors, ceilings, CSG wall cuts, roof extrusion, measurement
sprites, GLB loading and item dispatch all live in `convert()`, which runs on every commit.

- **Fix pros.** The rebuild is the editor's hot path; separating floors/ceilings/CSG/roof
  would allow rebuilding only what changed — the structural fix behind 10.3's cost.
- **Fix cons.** The CSG output is what the 3D pick, the elevation cut and the measurement
  sprites index into; a wrong split changes geometry that only a human eye catches, and the
  SwiftShader render checks are weak evidence.
- **Cost.** Weeks, with visual review after every slice.
- **Verdict.** Defer until profiling justifies it; riskiest refactor in the tree.

### 10.8 Three `AppState` definitions

**What it is.** `editor/editor.js`, `demo/demo.js` and `app/js/main.js` each define an
`AppState` with different fields.

- **Fix pros.** One project model, one migration path, drafts and storage stop diverging.
- **Fix cons.** The demo and the legacy app are separate entry points by design; unifying them
  means porting `app/js/main.js` onto the studio model — a rewrite of a working page with no
  user-visible gain.
- **Cost.** Days.
- **Verdict.** Leave; retire the legacy page instead if it is not a product surface.

### 10.9 Twelve `WebGLRenderer` constructions in nine files

**What it is.** Editor 1, `demo/*` 4, `scene/SharedViewer.js` 2, `features/roof/preview.js` 1,
`features/wall/preview.js` 1, legacy `app/js/main.js` 3; only `scene/scene-camera.js` is shared.

- **Fix pros.** One factory would centralise tone mapping, pixel ratio, context-loss handling
  and disposal, which differ per page today.
- **Fix cons.** Each caller sets different size/DPR/antialias options; a factory that guesses
  wrong costs a debugging session per page, for no user-visible gain.
- **Cost.** Hours, spread across pages that each need a visual pass.
- **Verdict.** Cosmetic; fold it into whichever renderer change comes next.

### 10.10 Snapping is split four ways

**What it is.** `core/wall-snap.js`, `core/elevation-snap.js`, `features/advanced/snapping.js`
and `InWallItem.calculateSnap`, with thresholds in three units. `Item.isValidPosition()` is a
real rotated-footprint test, enforced before add and drag commit.

- **Fix pros.** One threshold unit and one order means a fixture snaps identically in 2D,
  elevation and 3D; today four priorities can disagree.
- **Fix cons.** Changing snap order changes stored coordinates, so existing saved projects
  place fixtures differently; the validity test interacts with both add and drag commit.
- **Cost.** Days, plus a decision about existing projects.
- **Verdict.** Worth unifying, but it needs a migration story; not a drop-in.

### 10.11 Nine unversioned `*-editor-draft` localStorage keys

**What it is.** Each draft is consumed once by an `apply*EditorDraft()`; a malformed draft is
dropped silently.

- **Fix pros.** A version field plus a drop-and-log path turns “the draft vanished” into a
  diagnosable event; one helper and nine call sites.
- **Fix cons.** Old drafts without the version field must still be tolerated, so the win is
  diagnostics, not compatibility.
- **Cost.** An hour.
- **Verdict.** Best value-per-risk item in §5 — cheap hygiene, do it when convenient.

### 10.12 Hosting config and security headers

**What it is.** §6 asks for gzip/brotli, long-lived caching for `vendor/`, `assets/fonts/` and
`textures/`, `no-cache` for HTML, plus `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` and `X-Frame-Options: SAMEORIGIN`.

- **Fix pros.** Cheapest real win on this list: no code change, immediate transport and
  clickjacking/mime-sniff protection, and the CSP slot becomes ready for 10.4.
- **Fix cons.** It lives on the host, so `npm test` cannot verify it and it can rot silently;
  it must be kept in step with the deploy (documented in §6).
- **Cost.** Minutes per host, plus a note in the deploy runbook.
- **Verdict.** Do it first.

### 10.13 Error endpoint and staging run

**What it is.** §6 asks for `<meta name="error-endpoint">` so captured reports are posted, and
`BASE_URL=<staging> npm test` against the deployed origin.

- **Fix pros.** Turns the `sessionStorage` ring buffer into something support can see; the
  staging run catches deploy-path breakage (absolute `/vendor/…` links) before users do.
- **Fix cons.** An endpoint is a privacy and retention decision, and needs a service choice;
  posting client errors also needs a volume/quota plan.
- **Cost.** The staging run is free; the endpoint is a design decision plus a small receiver.
- **Verdict.** Run the suite against staging now; add the endpoint when there is a place to
  send it.

### Recommended order

| Order | Item | Why now |
| --- | --- | --- |
| 1 | 10.12 hosting config/headers | No code, immediate benefit, opens the CSP slot |
| 2 | 10.11 draft versioning | An hour, no behaviour change, better diagnostics |
| 3 | 10.2 sitemap/canonical | Waiting only on the production origin |
| 4 | 10.4 CSP (incl. the 111 inline handlers) | The project-sized item; unblocks the header |
| 5 | 10.3 payload/bundling | Only once a build step is acceptable |
| 6 | 10.6, 10.7, 10.10 refactors | Defer until a feature or a profile demands them |
