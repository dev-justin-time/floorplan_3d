# Editor audit — `pages/Editor.html` vs connected actions

Date: 2026-10-30. Method: static cross-reference (`.demo-work/audit-editor-wiring.mjs`)
plus headless functional clicks asserting real state changes
(`.demo-work/probe-editor-actions.mjs`, `.demo-work/probe-editor-fix.mjs`).

## Verdict

Every interactive control in `pages/Editor.html` resolves to a real handler and
performs its action. Two real bugs were found and fixed (see §3).

## 1. Static wiring — 94 connected, 0 broken

- All `data-click` / `data-input` / `data-change` names resolve to `window.*`
  functions in `editor/editor.js` (dotted owners `planOcr.*`, `editorKit.*`, … included).
- All `data-show` / `data-hide` / `data-disclosure` targets exist.
- All `getElementById(...).addEventListener` targets exist in the HTML.
- All `data-item` palette values exist in `ITEM_METADATA` (`core/metadata.js`,
  consumed by `ItemFactory.create`): structure, outdoor stairs, landscape,
  furniture, decor, merlot/shaker lines.
- All `data-tool` values are real branches (`wall`, `select`, `delete`, `cutout`).
- 58 `window.*` handles have no HTML trigger on purpose (harness/API handles:
  `editorKit`, `featureKit`, `stairKit`, `deckKit`, `electricalKit`,
  `framingKit`, `systemsKit`, `studioKit`, `lightingKit`, …).

## 2. Functional audit — 14/14 pass, zero uncaught errors

Real clicks, real state changes on a fresh headless profile (seeded farmhouse plan):

| # | Control exercised | Proof |
|---|---|---|
| 1 | Wall tool button + canvas drag | walls 13 → 14 |
| 2 | Undo / redo header buttons | 14 → 13 → 14 |
| 3 | Door palette button + canvas click | fixtures 41 → 42 |
| 4 | Delete tool button + canvas click | fixtures 42 → 41 |
| 5 | Cutout tool drag | openings 0 → 1 |
| 6 | Abilities panel toggle (grid) | ability true → false, box follows |
| 7 | Ability action (Center plan) | runs, plan intact |
| 8 | Systems Framing tab | `systemsKit.active() === 'framing'` |
| 9 | Import popup open / close | modal visible → hidden |
| 10 | Merlot select + canvas click | fixtures 41 → 42 |
| 11 | Ceiling switch both ways | false → true → false |
| 12 | Elevation prev/next stepper | wall fh-w1 → fh-w2 |
| 13 | 3D view switch | live WebGL canvas, opacity 1 |
| 14 | Start New / Master Scene | blank plan / all-overlays 3D |

`check-editor-wiring` gate: **44/44** after the fixes.

## 3. Bugs found and fixed

1. **Upload modal blocked the canvas.** `#upload-modal` missed `hidden`, so the
   popup overlay sat over the plan on load and swallowed wall drags and palette
   clicks. Now hidden until Import is pressed.
2. **`setStatus()` was called but never defined** — a `ReferenceError` on the
   invalid-placement path. Added the missing transient toast.
3. **Delegated `preventDefault()` reverted checkbox switches.** `shared/site.js`
   called `event.preventDefault()` for every `data-click`, including checkboxes.
   The browser applies the revert *after* dispatch, clobbering the handler's own
   sync: the Dims switch was stuck visually ON while the ability toggled, and
   Ceiling/Roof showed the pre-click state. Fix: skip `preventDefault()` for
   checkbox/radio `data-click` elements; `toggleDimensions` now re-syncs the
   header switch and `applyAbilityPanel` keeps it in step.

## 4. Follow-up fixes after this audit (same session)

- **Master scene with grid on all pages, full-page in Editor.** The floating
  ⬢ Project 3D viewer (`shared/project-viewer.js`, injected by `site.js` on
  all 37 pages) had no grid, and — worse — it never opened on suite pages:
  it imported bare `three` / `three/addons`, which only resolve where a page
  defines an import map (deck, electrical, framing, … have none), so the FAB
  silently fell back to navigating to the Editor. Fixed: a 1 m `GridHelper`
  (on by default, chip-toggles like any layer), relative vendor imports plus a
  self-contained orbit/zoom/pan rig (addons import bare `three` too), and
  `openProjectViewer({ full })` — the Editor opens it full-page
  (`100vw × 100dvh`), every other page as the dialog. Probe
  `.demo-work/probe-master-scene.mjs`: **8/8** (opens on suite page, grid on,
  grid toggles off, dialog-sized; Editor full-page with filling canvas).
- **Dims/Ceiling/Roof switches vs `preventDefault`.** Root-caused during this
  audit (see §3.3): fixed in `site.js`, header Dims re-sync in `editor.js`.
  Re-ran action probe: **14/14**; `check-editor-wiring` still **44/44**.

## 5. Not headless-testable (wired, reviewed, manual check advised)

- Import tiles (image/JSON/DXF/AI/OCR) arm a real file chooser — wiring and
  `wireUploadModal` paths reviewed, but a person must click through once.
- Download buttons (Save Project, OBJ/GLTF/GLB, CSV/DXF takeoffs).
- Walk mode, AR placement, WebGPU preview (need device/GPU + user gesture).
- `demo.html` uses the same `data-click` checkbox pattern and inherits the §3.3
  fix via `site.js`; its own toggle handlers were not functionally probed here.
