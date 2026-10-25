# Codebase audit — Shaker 3D floor plan

Date: 2026-10-25 · Scope: every tracked file at the project root (66 indexed files, no build
tooling, no test suite). Method: file reads, import/reference greps, then 30 node checks and
19 headless-Chrome checks against the modules touched this session.

---

## 1. What actually runs

| Entry page | Script | State of it |
| --- | --- | --- |
| `index.html` | `SharedViewer.js` (plus an import map for three 0.160) | live, single-file viewer |
| `Editor.html` | `editor.js` → `items`, `state-manager`, `storage`, `floorplan-graph`, `measurements`, `scene-camera`, `scene-drag`, `scene-gizmo`, `scene-elevation`, `wall-snap`, `elevation-snap`, `ConversionEngine3D`, `furnitureBuilders`, `wireframe`, `world-space`, `metadata` | live, the real editor |
| `demo.html` | `demo.js` + `demo-floorplan-sync`, `demo-material-system`, `demo-floorplan-upload`, `demo-placement-constraints` | live demo gallery |
| `labs.html` | inline module script + `LabApp.js` and the `Lab*.js` experiments | live lab index |
| `webgpu-demo.html` | inline script | standalone experiment |

Everything else at the root is either a module imported by one of the above, or unwired (below).

## 2. Unwired files — nothing imports them

Confirmed by grepping every `.js/.jsx/.ts/.tsx/.html/.md` for the filename and by checking the
`<script>` tags of every page:

| File | Evidence | Note |
| --- | --- | --- |
| `main.js` (1383 lines) | only ever named in `labs.html` prose ("Functions split into modular `main.js`") | older editor implementation; it is the **only** caller of `ConversionEngine3D.updateItemTransform` |
| `Wall.js` | no importer; the model in `items.js` supersedes it | duplicate `Wall` class |
| `orbitcontrols.js`, `three.js` | vendored copies; `orbitcontrols.js` imports only local `three.js`; no page loads either | both pages use the CDN/import-map three instead |
| `App.jsx`, `page.tsx`, `Scene.jsx`, `FloorPlan3D.tsx`, `KitchenScene.jsx`, `Cabinet.js`, `ViewControls.js`, `ControlPanel.js`, `Cutlist.js`, `CustomizationPanel.tsx`, `UploadFloorPlan.tsx`, `testData.ts` | they import each other, but no HTML or `package.json` script builds them; `package.json` has the React dependencies and `"start": "npx serve ."` — no bundler, no tsconfig | a React/R3F prototype that cannot currently be run |
| `3dConversionEngine.txt`, `txt.txt` | old source dumps of the converter | documentation debris |

`test-data.js` survives only because `LabApp.js` and the dead `main.js` import it.

## 3. Unwired logic inside live code

| Where | What | Why it matters |
| --- | --- | --- |
| `ConversionEngine3D.js:180, 354` | `appState.selectedWallId` styles a highlighted wall | `editor.js` never sets `selectedWallId` (0 hits) → the whole wall-selection look is dead |
| `editor.js:33` + `ConversionEngine3D.js:189` | `showRoof` | no editor UI toggles it (only `demo.js:491`); roof rendering is unreachable in the editor |
| `ConversionEngine3D.js:119` | `updateItemTransform()` | used only by the dead `main.js`; the editor rebuilds instead of transforming |
| `items.js:25` | `Item.isValidPosition()` always returns `true` | an unused collision/validity hook; nothing calls it |
| `wall-snap.js:41` | `footprint()` | exported, no caller (`extentAlong` is used internally) |
| `metadata.js` | `getRecommendedTextures`, `DEFAULT_TEXTURES` | no live caller (`DEFAULT_TEXTURES` only in the orphan `CustomizationPanel.tsx`) |
| `world-space.js` | `canvasToWorld`, `worldToCanvas`, `wallLengthMetres`, `INCH`, `DOOR_HEIGHT`, `FLOOR_ELEVATION`, `UNITS_PER_METER` | never imported outside the module |
| `editor.js:713`, `demo.js:356` | `AppState.graph = graph` | written once, never read — no consumer of the graph after conversion |
| `demo-placement-constraints.js` | `PlacementConstraintsDemo` (wall collision + constrained dragging) | the editor reimplements dragging without it |

## 4. OOP / architecture

**Duplicated models.** `items.js` has `Item → FloorItem | InWallItem → InWallFloorItem`; `Wall.js`
is a second, unused wall class; `main.js`, `demo.js` and `editor.js` each define their own
`AppState` object literal with overlapping but non-identical fields (`stories` exists in
`main.js`/`StateManager`, not in the editor).

**Two snapping implementations.** `InWallItem.calculateSnap/snapToWall` (closest point on segment,
in `items.js`) and `wall-snap.js:closestPoint/snapToWalls` (same maths, flush-to-face semantics).
The editor now also has `elevation-snap.js` for the run axis. Three modules, three thresholds
(`20`, `24/scale`, `12 cm`), no shared definition of "snap".

**`ConversionEngine3D` is a 520-line god class.** It owns textures/caching, lighting, floor,
ceiling, CSG wall cuts, roof extrusion, measurement sprites, GLTF loading and item dispatch. Item
*construction* already lives behind `FurnitureFactory`, so the split is half-done: everything else
is still in the engine, which is why every edit is a full rebuild.

**Builders set absolute height.** Each builder writes its own `group.position.y`
(`height/2` for floor pieces, `metadata.mountHeight` for wall pieces — e.g.
`furnitureBuilders.js:697`). That is why per-item elevation had to be added as a post-hoc offset in
`ConversionEngine3D.js:294` rather than as item state the builder reads. A `Cabinet` base class with
`defaultBottom`/`defaultTop` would remove the special case.

**Metadata is doing three jobs**: dimension schema, visual defaults (colour, wireframe, model URL),
and construction config (`mountHeight`, `scale`, `line`). Nothing validates it, and
`metadata.js` references `WINDOW_SILL_HEIGHT` in the `ITEM_METADATA` literal while importing it
~120 lines *below*, relying on import hoisting.

**UI is global-function based.** `editor.js` exports nothing; every action is `window.undo`,
`window.toggleView`, `window.setElevationView`, inline `onclick` in `Editor.html`, and class-list
toggling. `editor.js` is now 1090 lines with no seam for tests.

**Duplicated 3D bootstrap.** Renderer + lights + camera + controls are re-created in `editor.js`,
`demo.js`, `main.js`, `SharedViewer.js`, four `demo-*.js` classes and the lab files. `scene-camera.js`
was factored out for framing, but nothing else of the setup is shared.

## 5. Gaps and likely bugs, ranked

1. **Grid snap is 1 m for everything.** `editor.js:34` sets `gridSize: 30` px (= `PIXELS_PER_METER`),
   and both placement (`getCanvasCoordinates`) and dragging (`scene-drag.dragTo`) snap to it.
   Cabinet modules are 610–914 mm, so a dragged cabinet can never land on a 3" increment in 2D.
   The elevation drag has no grid at all, only 12 cm snapping.
2. **Deletion is centre-distance based.** `editor.js:303` deletes whatever fixture centre is within
   20 px of the click, ignoring the rotated footprint. Clicking the end of an island deletes
   nothing (or the wrong neighbour); `fixtureAt()` already does this properly.
3. **Full CSG rebuild per interaction.** Every `saveAndSync` (and every throttled 2D drag frame)
   re-extrudes and re-subtracts every wall opening. With four walls and a few openings this is the
   heaviest thing in the app, and it now also runs on every elevation drag release.
4. **Elevation views are axis-aligned only.** Front/back/left/right, so a run on a diagonal wall
   cannot be viewed head-on; `rotation` is ignored when framing. The near-wall hiding rule is a
   mid-plane test (`scene-elevation.js:applyElevationVisibility`), so perpendicular walls are still
   drawn edge-on across the view.
5. **Elevation has no annotations and no plan feedback.** No height/dimension strings in the
   elevation, no dashed projection of mounted pieces on the 2D plan, no indicator that an item has
   been lifted.
6. **Snapping stops at the run.** Cabinet-to-cabinet snapping handles along-run butt joints and
   vertical stacking, but not front-face/depth alignment or inside-corner joins.
7. **No schema/version on saved projects.** `StorageManager.importProject` accepts any JSON;
   `restoreState` will throw on `data.fixtures` not being an array. `elevation` is now serialised by
   `Item.toJSON`, but older files and the demo restore paths simply ignore it.
8. **`StorageManager` logs on every autosave** (`storage.js:5`) and rewrites the whole project JSON
   on every `saveAndSync` (each drag commit, each placement).
9. **Accessibility/UX of the new controls**: `elevation-btn` swaps Tailwind classes for the active
   state but exposes no `aria-pressed`; the header toggle and the elevation bar can disagree in
   intent (picking an elevation force-enables the 3D toggle).
10. **No tests, no build.** `package.json` only runs a static server; there is no typing check
    either (the `.ts/.tsx` files are not compiled by anything).

## 6. Improvements

**Quick wins (low risk)**
- Delete `Wall.js`, `orbitcontrols.js`, `three.js`, `main.js`, `3dConversionEngine.txt`, `txt.txt`;
  decide the fate of the React prototype (wire it with a build or remove it).
- Make delete footprint-aware by reusing `fixtureAt()`.
- Add a grid/snap-size control (or per-item snapping in 3" increments) instead of the fixed 30 px.
- Either set `selectedWallId` from a 3D wall pick or delete the highlight path; same for `showRoof`.
- Serialise only the fields the editor edits, and version the saved JSON.

**Medium**
- One `snapping.js` module: `snapGrid`, `snapWallFace`, `snapAlongRun`, `snapVertical`, all pure and
  fed by `PIXELS_PER_METER`, used by 2D drag, 3D drag and elevation drag. It would delete
  `InWallItem.calculateSnap` and unify the three thresholds.
- Extract an `ItemModel`/`Cabinet` base class that owns `width/height/depth/defaultBottom` so
  builders no longer hard-code mounting, and elevation becomes ordinary item state.
- Split `ConversionEngine3D` into `SceneBuilder` (lights/floor/ceiling), `WallBuilder` (CSG),
  `ItemBuilder` (factory + materials) with a dirty-flag render instead of `convert()` on every edit.
- Elevation polish: dimension strings between pieces, a height readout on drag, and a faint
  height guide in the 2D plan for lifted items.

**Larger**
- A single `EditorState`/store shared by `editor.js`, `demo.js` and the labs, with `StateManager`
  taking a serialiser instead of knowing `.toJSON()` on two model classes.
- An actual build (`esbuild` is already used ad hoc) + a test entry so pure modules can be unit
  tested (`snapping`, `wall-snap`, `elevation-snap`, `measurements`, `floorplan-graph` are all
  DOM-free today).
- Extract the 3D bootstrap into one `createViewer(container, options)` used by every page.

## 7. What was verified this session

- `elevation-snap` / `scene-elevation`: 30 node checks (butt joints, centre alignment, stack onto a
  top, floor snap, same-run filtering, all four cameras, aspect/frustum fit, wall hiding/restore,
  and the engine lifting/lowering pieces).
- Real browser: 19 headless-Chrome checks — pointer drag raycasts the piece, snaps it flush to its
  neighbour (`430 px → 422.86 px` = 762 mm centre), stacks a dropped wall cabinet onto a base at
  0.9 m, tiny lifts fall back to the floor, clicks and non-elevation views move nothing, and the
  editor's `setElevationView()` switches cameras, highlights the button and leaves no page errors.
- These were throwaway harnesses (`.elevation-check.mjs`, `.elev-probe.html`); they are not part of
  the repo, which is the test-suite gap listed above.

## 8. Elevation work added in this pass (for reference)

- `elevation-snap.js` — run-axis edges (`edgesAlong`), same-run filter (`inSameRun`), horizontal
  butt/centre snapping (`snapAlongAxis`), vertical stacking and floor snapping (`snapVertically`).
- `scene-elevation.js` — `frameElevation()` (orthographic front/back/left/right framing),
  `applyElevationVisibility()` (hides the walls between camera and plan centre),
  `createElevationDrag()` (vertical plane drag, live mesh preview, snapping, commit).
- `items.js` — `elevation` on every item, serialised in `toJSON` and restored in `fromJSON`.
- `ConversionEngine3D.js` — applies `fixture.elevation` on top of the builder's default height.
- `editor.js` / `Editor.html` — orthographic camera + controls, camera switching, elevation bar
  (`3D | Front | Back | Left | Right`), context hint, gizmo detached while in elevation.
- Known limits: floor-plane drag only in the 3D orbit view; elevation snapping is along-run and
  vertical only; no rotation in elevation; no height annotations.
