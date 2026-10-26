# Codebase audit — Shaker 3D floor plan

Date: 2026-10-26 (every count re-measured after the changes in §8) · Scope: all 242
tracked files (180 JS modules, 27 pages plus the root redirect, 25 docs, 17 scripts in
`scripts/`: 13 assertion harnesses, one repricing script, two browser sweeps). Method:
import/reachability scan from every HTML page, targeted reads, and the full check suite.
No build tooling and no test runner are configured; the checks are plain Node/browser
scripts.

> The previous revision of this file described the flat root layout and several defects
> that have since been fixed. §9 lists the corrections so the old findings are not trusted.

---

## 1. What actually runs

| Area | Pages | Loads |
| --- | --- | --- |
| Studio | `pages/Editor.html` | `editor/editor.js` (5,609 lines) plus `core/`, `scene/`, `engine/`, `features/` |
| Landing / upload | `pages/index.html` (+ root `index.html` redirect) | `scene/SharedViewer.js`, `engine/floorPlanProcessor.js`, `shared/site.js` |
| Design suites | `kitchen`, `lighting`, `electrical`, `plumbing`, `framing`, `deck`, `landscape`, `roof`, `wall`, `stair` designers | one `features/<suite>/page.js` each |
| Demo / legacy app | `pages/demo.html`, `pages/app.html`, `pages/webgpu-demo.html` | `demo/demo.js` chain, `app/js/main.js`, inline WebGPU scene |
| Tools | `calc`, `price-book`, `bid-builder`, `project-dashboard` | feature page modules |
| Marketing / reference | `index`, `features`, `pricing`, `gallery`, `about`, `contact`, `stair-parts`, `stair-gallery`, `stair-glossary` | inline modules, `SharedViewer` on the marketing pages |

All 28 routes (27 pages plus the root redirect) were loaded in headless Chrome; 25 are
clean. The three failing routes are unresolved `/textures/*.jpg` requests — four in
total (§5.6).

## 2. Repository layout

```
core/      world-space, measurements, floorplan-graph, metadata, items,
           state-manager, storage, wall-snap, elevation-snap
engine/    floorPlanProcessor, 3dConversionEngine, ConversionEngine3D,
           furnitureBuilders, wireframe, plan-overlays
scene/     SharedViewer, scene-abilities, scene-camera, scene-drag,
           scene-elevation, scene-gizmo
editor/    editor.js
demo/      demo.js + four demo modules + test-data
features/  ten design suites (kitchen, lighting, electrical, plumbing, framing,
           deck, landscape, roof, wall, stairs), lab, studio, advanced, bid,
           dashboard, pricing, plus 15 shared plan modules (grid, shell,
           visibility, room-labels, cut-list, ocr, …)
assets/    style.css, animated-card.css, blueprint.png, sc-bp-bath.png, shaker.glb
docs/      rules registers, design guides, audit
pages/     27 HTML pages
scripts/   17 scripts: 13 assertion harnesses, one repricing script, two browser sweeps
shared/    site.js (page menu + footer)
app/       legacy full app loaded by pages/app.html
```

Root holds only `index.html`, `package.json`, `package-lock.json`, `.gitignore` and the
empty `.server.log` (besides the ignored `node_modules/` and the local `.freebuff/`).

## 3. Reachability and dead code

A module-graph walk from every page reaches **158 of the 180 tracked JS modules**; the
remaining 22 are the 17 check scripts (intentionally page-less) and five unused barrels.

| Item | Evidence | Note |
| --- | --- | --- |
| `features/{bid,deck,electrical,framing,wall}/index.js` | no importer anywhere | pure re-export barrels; the editor and pages import the concrete modules instead |
| `AppState.graph` | written at `editor/editor.js:4674`, `demo/demo.js:356`; never read | conversion stores the graph but nothing consumes it |
| `.server.log` | tracked, 0 lines; `.gitignore` only lists `node_modules/` | should be ignored/untracked |
| `docs/*.md` references | prose still names flat-root paths (`items.js`, `editor.js`, …) | links out of the pages are fixed; the docs' internal paths are stale |

There are no unreferenced feature modules beyond those barrels, and no leftover dump
files. `pages/app.html` still loads `app/js/main.js` (1,418 lines), so it is live code, not
dead code.

## 4. Architecture

**Three application states.** `editor/editor.js:191`, `demo/demo.js:18` and
`app/js/main.js:17` each define an `AppState` with overlapping but non-identical fields.
The editor's is the superset (storeys, room materials, comments, drafts); the other two
drift.

**The editor is a 5,609-line controller with no exports.** Every action is a `window.*`
global or an inline `onclick`; `grep "^export " editor/editor.js` returns 0. It is the
single seam every page, check harness and draft hand-off goes through, which is why the
browser checks all boot the real editor rather than mocking it.

**`ConversionEngine3D` is a 792-line god class.** Textures, lights, floors, ceilings, CSG
wall cuts, roof extrusion, measurement sprites, GLB loading and item dispatch all live in
`convert()`. Item construction is behind `FurnitureFactory`, so the split is half-done.
`update3D()` → `conversionEngine.convert()` runs on every `saveAndSync()` (line 5325),
including each committed drag, so every interaction re-extrudes and re-subtracts every
wall opening.

**Eight live WebGL bootstraps.** `new THREE.WebGLRenderer` is constructed 12 times across
`editor/editor.js`, four demo files (`demo/demo.js`, `demo/demo-floorplan-sync.js`,
`demo/demo-material-system.js`, `demo/demo-placement-constraints.js`),
`scene/SharedViewer.js` (panorama and plan), `features/roof/preview.js` and
`features/wall/preview.js`; the legacy `app/js/main.js` adds three calls, for nine
bootstrap files and 15 renderers in total. Renderer, lights, camera and controls are
re-created in each; only `scene-camera.js` (framing) is shared.

**Snapping is split four ways.** `core/wall-snap.js` (flush-to-face cabinets),
`core/elevation-snap.js` (run axis and stacking), `features/advanced/snapping.js`
(threshold helpers used by elevation) and `InWallItem.calculateSnap` in `core/items.js`.
Thresholds are expressed in three different units and there is no shared "snap" contract.
`Item.isValidPosition()` is now a real rotated-footprint vs wall-centreline test and is
called before adding and before committing a drag.

**Kitchen constants duplicate the plan solver.** `features/kitchen/catalog.js` defines
sink landing 600 mm, range landing 380 mm and aisle 1.07 m; `features/studio/layout-solver.js`
defines sink 600 mm, range **900 mm** and aisle 1.07 m. The suite and the editor's
"Kitchen check" can therefore disagree about the same range.

**Shared site chrome is injected at runtime.** `shared/site.js` appends a grouped
`<details>` menu to the first `<header>` and a footer to `<body>` on all 27 pages. It is
one source of truth, but there is no nav/footer without JS, and on full-screen suites
(`html, body { overflow: hidden }`) the footer exists in the DOM but is out of view.

**Draft hand-offs are localStorage contracts.** Nine `*-editor-draft` keys are written by
suite pages and consumed once by `apply*EditorDraft()` in the editor. They have no schema
version of their own; a malformed draft is simply removed and ignored.

## 5. Gaps and likely bugs, ranked

1. **Full CSG rebuild per interaction.** `saveAndSync()` calls `update3D()`, which calls
   `convert()` and rebuilds every wall and opening. It is the dominant cost on drags,
   inspector edits and elevation drops.
2. **Kitchen runs ignore openings.** `applyKitchenEditorDraft()` (`editor/editor.js:2489`)
   lays modules along the longest wall from one end. It never checks doors, windows or
   openings, so a run can cover a door or a cutout, and no collision test runs on the
   placement. Its "bind to the wall" step is also a no-op: `item.snapToWall` exists only on
   `InWallItem`, and every cabinet the run creates is a `FloorItem`, so the guard never
   fires and nothing records `boundToWallId`.
3. **Kitchen and plan-level checks disagree.** Range landing is 380 mm in the suite and
   900 mm in `layout-solver.js`; the aisle input is checked but no opposing run is created,
   so the suite validates a gap it cannot show.
4. **Uploading a plan into the studio replaces the project.** `applyFloorplanEditorDraft()`
   resets the storeys, fixtures, finishes and comments with no confirmation; the only hint
   is the explicit "Edit in Studio" button.
5. **Elevation still frames axis-aligned façades.** Front/back/left/right only; a diagonal
   wall is framed by its axis-aligned bounds (`frameElevation`), so it is never head-on.
   The wall list is every wall in plan order, including perpendicular walls seen end-on;
   the item filter is a 1.1 m band around the shown wall, which can include a nearby island.
6. **Missing texture assets.** `core/metadata.js` holds 12 distinct `/textures/*.jpg` URLs
   (24 references) and there is no `textures/` directory. Only the default floor and wall
   materials are ever requested, so the sweep sees four 404s on three routes:
   `ceramic_tile.jpg` on `Editor.html` and `app.html`, `marble_floor.jpg` and
   `ceramic_tile.jpg` on `demo.html`. `loadTexture()` swaps in a white pixel on error, so
   every affected material renders as its flat base colour.
7. **Two lighting checks fail — one of them a real rule bug.** `check-lighting.js` reports
   121 pass / 2 fail. "A plain switch warns about the energy control rule" fails because
   the Title 24 dimming test uses `light.watts >= 20` per luminaire
   (`features/lighting/engine.js:536`) instead of the controlled load for the space: a
   living room of nine 14 W downlights on a single-pole switch is treated as exempt, so
   the `energy-controls` warning never fires (reproduced: 9 × 14 W, no dimming, no
   warning). "Code scope names the IRC and IECC" fails because `CODE_SCOPE` in
   `features/lighting/rules.js` was rewritten to the 2022 California Electrical Code and
   Title 24 Part 6 and no longer mentions those codes, so that assertion is stale rather
   than the copy being wrong.
8. **Autosave is noisy and wholesale.** `StorageManager.saveProject` logs on every write
   (`core/storage.js:6`), and each `saveAndSync` serialises the entire project.
9. **Accessibility.** Elevation bar buttons toggle classes without `aria-pressed`; the new
   wall-step buttons are icon-only with `title` text; the kitchen canvas has a gap table
   but no text equivalent of the elevation.
10. **No runner/build.** `package.json` only starts a static server. The 17 check scripts
    must be run by name, type checking is absent, and there is no CI entry point.
11. **Hygiene.** `.server.log` is tracked and empty; `.gitignore` ignores only
    `node_modules`; five re-export barrels are unused.

## 6. Improvements

**Quick wins**
- Ignore and untrack `.server.log`; delete the five unused
  `features/{bid,deck,electrical,framing,wall}/index.js` barrels.
- Point the kitchen catalogue at the shared NKBA constants (or make `layout-solver.js`
  import them) so range landing is one number.
- In the kitchen importer, subtract wall openings and skip placements that would cover a
  door/window, reusing `openingsForWall`.
- Remove or read `AppState.graph`; if conversions need it, keep it behind one accessor.
- Add `npm test` (run the Node checks) and `npm run check:pages` so the harnesses are
  discoverable.
- Add `aria-pressed` to the elevation buttons and `aria-label` to the wall stepper.
- In the Title 24 rule, compare the controlled load (or the design's total watts) with the
  20 W exemption instead of a single luminaire's wattage; update the `CODE_SCOPE`
  assertion to the California codes the document now cites.

**Medium**
- Dirty-flag scene updates: rebuild only the wall/opening that changed instead of calling
  `conversionEngine.convert()` from every `saveAndSync`.
- One snapping module (`snapGrid`, `snapWallFace`, `snapAlongRun`, `snapVertical`) fed by
  `PIXELS_PER_METER`, deleting the duplicated maths in `items.js` and the elevation path.
- Group elevation walls into façades (parallel to the chosen side, then plan order) and
  frame the run's own axis, not the AABB.
- After a kitchen import, run `analyzeLayout()` on the placed fixtures and show the
  plan-level result in the suite, so the run and the plan use one report.
- Split `ConversionEngine3D` into `SceneBuilder`, `WallBuilder` and `ItemBuilder` behind a
  dirty-flag render loop.

**Larger**
- One editor store shared by `editor.js`, `demo.js` and `app/js/main.js`, with the draft
  keys and project schema versioned together.
- Extract the eight live WebGL bootstraps (12 renderers) into
  `createViewer(container, options)`, and delete or port the legacy app's three.
- Build the shared nav/footer into the pages (or a `<site-nav>` custom element with a
  static fallback) instead of injecting it at runtime.

## 7. Verification inventory

Run from the project root; browser harnesses start their own server/Chrome unless noted.

| Harness | Result (2026-10-26) |
| --- | --- |
| `scripts/check-kitchen.js` | 27 / 27 — fillers, air gaps, landings, aisle, overflow, rules |
| `scripts/check-kitchen-page.mjs` | 29 / 29 — suite UI, gap table, send-to-editor, import, elevation stepping, add-level, nav/footer |
| `scripts/check-scene-upload.mjs` | 32 / 32 — upload → 55 walls / 2 room slabs → Edit in Studio → 55 walls imported and editable |
| `scripts/check-pages.mjs` | 28 routes; every local link resolves, menu/footer on all; 4 texture 404s on 3 routes |
| `scripts/check-editor-wiring.mjs` | 14 / 14 — wall draw/select/pick, inspector, 3D scene |
| `scripts/check-studio.js` | 86 / 86 — storeys, openings, walk mode, room surfaces, projects |
| `scripts/check-framing.mjs` | 49 / 49 |
| `scripts/check-new-suites.mjs` | 53 / 53 |
| `scripts/check-plumbing.js` | 128 / 128 |
| `scripts/check-roof.js` | 126 / 126 |
| `scripts/check-wall.js` | 151 / 151 |
| `scripts/check-stairs.js` | 185 / 185 |
| `scripts/check-lighting.js` | 121 pass / **2 fail** |
| `scripts/check-ocr.js` | 56 / 56 |
| `scripts/check-price-suites.mjs` | repricing script, no assertions |
| `scripts/browser-check.mjs`, `scripts/browser-pages.mjs` | long-form browser sweeps, not run in this pass |

Total after the re-run: **1,057 passing / 2 failing assertions** across 13 assertion
harnesses, plus 28 page loads. The two lighting failures and the four texture requests
are the only red results.

## 8. Changes this session (2026-10-26)

- **Root reorganisation.** Shared modules split into `core/`, `engine/`, `scene/`,
  `editor/`, `demo/`; assets into `assets/`; rules/docs into `docs/`; checks into
  `scripts/`; shared chrome into `shared/`. Every module specifier, `<script src>`,
  `<link href>` and CSS/asset URL was rewritten, and all doc links on the designer pages
  now resolve into `docs/`.
- **Upload pipeline.** `SharedViewer.updateFloorplan()` builds the plan in its own group,
  renders one floor slab per detected room, and the landing page hands the converted plan
  to the studio through `floorplan-editor-draft`.
- **Elevation.** One wall at a time with `‹ ›` stepping and a `Wall n/m · length` readout;
  walls and items off the shown wall are hidden, everything is restored on exit.
- **Add level.** A labelled `#add-level-btn` in the editor header calls `addStorey()`.
- **Kitchen suite.** `features/kitchen/` with catalogue, gap engine, rule register and a
  canvas suite at `pages/kitchen-designer.html`; the run imports into the editor along the
  longest wall, and both the header and the NKBA panel link to it.
- **Shared chrome.** `shared/site.js` adds the grouped Pages menu and common footer to all
  27 pages.
- **Audit re-run.** Every figure in this file was re-measured against the current tree:
  the module graph (158 of 180 reachable), the 13 assertion harnesses (1,057 pass /
  2 fail), the 28-route browser sweep (25 clean, 4 texture 404s on 3 routes), and the
  source line references. The kitchen-import, WebGL and texture details above are the
  corrected versions; nothing in this file is carried over unverified.

## 9. Corrections to the previous audit

| Old finding | Current state |
| --- | --- |
| `selectedWallId` never set / wall highlight dead | live: 2D/3D selection, inspector, wall-builder highlight |
| Delete is centre-distance based | selection uses `fixtureAt()`, so deletion is footprint-aware |
| Grid snap fixed at 1 m | `gridSize` is editable and settable via `window.setGridSize` |
| `Item.isValidPosition()` always true / unused | real rotated-footprint wall test, called before placement and drag commit |
| `footprint()` unused | used by `scene-drag.js` |
| `getRecommendedTextures`/`DEFAULT_TEXTURES` unused | used by the finishes panel |
| No schema/version on saved projects | schema v2 with `migrateProject`/`stampProject` |
| No tests / no build | 13 assertion harnesses, 1,057 passing / 2 failing; still no build or npm test entry |
| Elevation has no annotations | height readout and `features/advanced/elevation-dims.js` in the elevation |
| `Wall.js` is an unused second wall class | no such file; `Wall` lives in `core/items.js` |
| `main.js` is dead | live: `pages/app.html` loads `app/js/main.js` |
| `AppState.graph` read after conversion | still write-only (`editor/editor.js:4674`, `demo/demo.js:356`) |
| Full CSG rebuild per interaction | still true (`saveAndSync` → `update3D` → `convert`) |
| StorageManager logs every save | still true (`core/storage.js:6`) |

## 10. Historical notes

- The lab demos were folded into `features/lab/kit.js` and wired into the editor; the React
  prototype, lab pages and unused lab components were removed (§9 of the previous audit).
- The unwired root dumps (`Qwen_javascript_*.js`, `pages/helper.html`, `pages/Qwen_html_*`,
  `txt.txt`, `TXT2.TXT`, vendored `three.js`) were merged or deleted; no unreferenced dump
  files remain.
