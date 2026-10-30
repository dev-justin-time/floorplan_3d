# Page Readme — every page, what it does, and where the site should go

> 37 pages (sitemap-verified). The product is a **plan-first construction
> planning suite**: draw the floorplan once in `Editor.html`, then size every
> system off that plan (foundation → structure → envelope → services →
> fit-out → outdoor → cost/schedule/permits). Shared state is localStorage
> drafts (`*-draft`, `project-schedule-v1`, `permits-inspections-v1`,
> `site-plan-draft`) plus `shared/project-context.js`, `shared/related-pages.js`
> and `shared/site.js` chrome (flow strip, Works-with links, subcategory chips,
> related pricing, floating Project-3D button).

Design aids only — IRC 2021 / IBC 2021 / NEC 2021 / OSHA model-code maths, local
amendments + licensed engineer + AHJ govern.

---

## 1. Core plan + hubs

### `pages/Editor.html` — 3D Blueprint Editor (the source of truth)
- **Abilities:** 2D plan draw (walls click+drag with pointer capture,
  snap/angle, cutouts/openings, doors/windows), storeys, room labels/metrics,
  finishes (wall/floor textures), framing overlay, roof preview, deck /
  electrical / framing / stair / landscape kits, walk mode, elevation views,
  comments/collaboration, projects save/load, JSON import, image underlay,
  DXF/KML/KMZ/GeoJSON drawing import, AI wall scan, **open-source OCR**
  (Tesseract.js words + local `ocr-symbols.js` shapes) with boxes, numbered
  badges at origins, copy/print-at-origins, autosave + `fromDesigner` draft
  placement.
- **Use case:** draw/verify the plan everything else stacks onto; import a
  scanned plan and read its words + symbols before tracing.
- **Status:** strongest page. Keep as canonical plan owner.

### `pages/plan-studio.html` — plan creation hub
- **Abilities:** six plan cards in build order (site → floorplan → foundation
  → framing → MEP → cost) with live exists/not-started state, live floorplan
  visual from Editor autosave, stacked site+foundation+services overlay,
  progress bar, deep links.
- **Use case:** "where do I start / what is missing" + handoff between plan
  creators.

### `pages/site-plan.html` — interactive site plan creator
- **Abilities:** lot + setbacks → buildable area, draggable house (Editor
  footprint), driveway, north arrow, scale bar, coverage + setback PASS/FAIL,
  Site CSV, `site-plan-draft`.
- **Use case:** siting check before foundation/permits.

### `pages/demo.html` / `pages/app.html` / `pages/webgpu-demo.html`
- **demo:** guided demo of the editor flow. **app:** legacy full app (kept for
  regression). **webgpu-demo:** renderer experiment.
- **Use case:** demo for new users; app for back-compat; webgpu for perf R&D.
- **Merge note:** keep demo; consider archiving `app.html` (legacy) behind a
  link and folding `webgpu-demo` into toolbox/Editor when WebGPU ships.

---

## 2. Structure + shell

### `pages/foundation-designer.html` — footings, slab, foundation walls
- Footprint from Editor, soil kPa → strip/pad sizing, frost cover, slab +
  wall concrete, rebar allowance, section + slab-plan canvas, CSV takeoff,
  `foundation-suite-draft`.

### `pages/wall-designer.html` — paint, finishes, coverings
- 35 coverings, sheens/colours, substrates, packs/coverage/cost, fire/vapour/
  wet-area/grade checks, area + waste takeoff, previews.

### `pages/framing-designer.html` — walls, studs, headers, floors
- Plan/elevation/cutlist, stud/bore rules, members schedule, CSV.

### `pages/roof-designer.html` — truss designer + takeoff
- 10 truss styles, span/length/pitch/overhang, sheathing/underlayment/covering,
  gutters/downspouts, venting, climate, elevation + 3D, cost, CSV, glossary.

### Stair family (8 pages — see merge notes below)
- **`stair-designer.html`** (straight): Blondel solver (630) or length solver,
  auto steps, landing step/overlap, opening/headroom, comfort bar, elevation +
  3D, takeoff CSV, `stair-designer-draft` → Editor.
- **`stair-l-designer.html`** (quarter-turn 90° winders), **`stair-u-designer.html`**
  (half-turn 180° + landing option), **`stair-spiral-designer.html`** (helical,
  walkline/diameter/clear-width), **`stair-steep-designer.html`** (alternating /
  ships / OSHA selector): all share `features/stairs/stair-type-page.js`
  (engine `computeStairDesign` + editor-identical plan symbol + 3D +
  generic takeoff + same draft key).
- **`stair-gallery.html`**: 12 parametric model families side-by-side with
  code checks. **`stair-parts.html`**: wireframe part catalogue at dressed
  sizes. **`stair-glossary.html`**: terms + 10 formulas + worked example.

---

## 3. Services + fit-out

### `pages/plumbing-designer.html` — rough-in + finish
- Water/DWV/gas rough, fixtures/trim, pipe + fittings takeoff, clash notes
  (vs electrical/framing), permits tie-in.

### `pages/electrical-designer.html` — service, panel, branch circuits
- Article 220 standard/optional load calc, panel schedule, VD/conduit/grounding,
  AFCI/GFCI, demand + takeoff + rules + glossary, MEP layer overlay.

### `pages/lighting-designer.html` — switches, sockets, photometry
- Room-by-room lights/zones, lux + controls, fixtures + wire takeoff.

### `pages/kitchen-designer.html` — runs, gaps, fillers, clearances
- Wall-to-wall run builder (base/sink/range/fridge/DW/tall), filler/air-gap/
  landing/aisle policy, elevation + gap table, NKBA checks, score, rules,
  send-to-editor.

---

## 4. Outdoor + cost/time

### `pages/deck-designer.html` — framing, footings, guards, stairs
- Joists/beams/posts/footings/guards/stairs, IRC R507/R312/R311.7 + NDS,
  framing plan canvas, schedule/takeoff/cutlist/rules/glossary, CSVs.

### `pages/landscape-designer.html` — pools, spas, water features
- Grading/planting + pool/spa/runoff, water-feature 3D, takeoff.

### `pages/price-book.html` — supplier quotes; `pages/bid-builder.html` — one costed package
- Price book: quoted unit costs per suite, coverage %. Bid: pulls every
  suite draft via `features/bid/sources.js` + price book, manual/alternate
  lines, scope text, proposal, CSVs.

### `pages/project-dashboard.html` / `pages/project-schedule.html` / `pages/permits-inspections.html`
- Dashboard: every suite in one place. Schedule: 11 phases, editable durations,
  Gantt, progress from real drafts, red hold when an inspection fails
  (`project-schedule-v1`). Permits: gates per phase (footing before pour, rough
  before cover) feeding the schedule (`permits-inspections-v1`).

---

## 5. Calculators, tools, marketing

### `pages/calc.html` — Pro Construction Calculator Suite
- 5 tools: lumber span (NDS bending + L/360), stair builder, concrete volume
  (rect/round), roof pitch/rafter, deck footing diameter. Each shows its formula.

### `pages/toolbox.html` — 3D toolbox
- sRGB/linear colour, units/scale, texel density, GPU texture memory, seamless
  tiling, PBR packing, normal-map flips. All local.

### Marketing: `index.html`, `features.html`, `pricing.html`, `gallery.html`, `about.html`, `contact.html`
- Landing, feature list, pricing, gallery, about/contact. `index.html` carries
  the hero 3D viewer.

---

## 6. Recommended merges (fewer, stronger pages)

1. **One Stair hub instead of 8 top-level entries.** Keep the 5 designers
   (straight/L/U/spiral/steep) — they are genuinely different maths — but put
   them under a single `Stairs` menu group with a shared sub-nav (already
   cross-linked in headers), and merge `stair-gallery.html` + `stair-parts.html`
   content *into* the designers as a "Models / Parts" tab. Keep
   `stair-glossary.html` as the single formulas reference all 5 link to.
2. **Merge `calc.html` ↔ suite calculators.** The span/footing/stair/roof/
   concrete calcs duplicate logic inside deck/framing/roof/stair suites. Keep
   `calc.html` as the quick-standalone tool, but have it import the suite
   engines instead of re-implementing (single source of truth).
3. **Merge `app.html` → archive.** It is legacy; link it from Editor as
   "legacy build" so it stops competing in nav/SEO with `Editor.html`.
4. **Merge `toolbox.html` + `webgpu-demo.html`.** Toolbox is the right home;
   make WebGPU a toolbox tab ("Renderer") rather than a standalone page.
5. **Consider merging `plan-studio.html` + `project-dashboard.html`.** Both are
   hubs ("what exists / what is next"). Keep plan-studio as the *plan-creation*
   hub and dashboard as the *whole-job* hub, but render them from one status
   component so counts never disagree.
6. **Keep separate (do NOT merge):** Editor vs any designer; price-book vs
   bid-builder (quotes vs package); schedule vs permits (plan vs gates);
   plumbing vs electrical vs lighting (different codes, clashes matter).

---

## 7. Gaps, errors, missing logic (observed)

### Missing suites / pages
- **No HVAC / mechanical suite** (heating, cooling, ventilation, ducts,
  combustion air, exhaust). Biggest gap for a "complete construction" claim.
- **No energy / envelope suite** (insulation R-values, air sealing, vapour,
  window/door U-values, Manual J/D hooks).
- **No doors/windows schedule page** (the Editor draws them but no suite
  sizes/schedules/prices them).
- **No excavation/grading/septic/well page** (site-plan covers setbacks only).
- **No fire/life-safety page** (smoke/CO, egress windows, fire separation) —
  only scattered checks.
- **No solar/generator/backup page** (electrical has service but no DER).
- **No change-order / contingency / allowance tracker** (bid is lump-only).

### Missing / weak logic
- **Units are mixed** (metric designers vs imperial calc + staircode in/FT).
  Add a global unit toggle + per-page display, with engines staying metric.
- **Headroom/landing checks are straight-stair only** in spirit; L/U rely on
  the generic engine path — verify landing-depth + door-swing-over-landing
  rules on turns.
- **Steep pages show landing-inclusive footprints** (3.7 m deep on a 1.9 m
  run) — correct per assembly but confusing; label "run vs footprint incl.
  landings" explicitly.
- **Calc duplicates engines** (stair rise/run, deck footing, roof pitch) and
  can disagree with suite outputs. Point calc at the suite functions.
- **Price coverage is partial** — stairs have "quantities only, no priced
  takeoff" (see `docs/bidrules.md`); several suites lack price-book keys, so
  bids undercount. Add priced takeoffs per suite or mark allowances clearly.
- **OCR/symbols are session-only** (cleared on new upload, not saved in
  project JSON). Persist or warn before navigation.
- **Contact form is a placeholder** (no backend); pricing page plans vs
  actual paywall/entitlement are undefined.
- **Accessibility/SEO:** canvas-heavy pages need text fallbacks (some have
  them, stair-type pages do via results/checks — keep it); verify every page
  has description/canonical/OG (most do).

### Errors / inconsistencies to fix
- `stair-steep-designer.html` slope input (`in-slope`) is collected but never
  used in `readConfig` — wire it (constrain run from slope) or remove it.
- `features/stairs/stair-type-page.js` `render()` divides by `Math.sin(...)`
  then multiplies by 1.5 — verify framing distance on very tall/narrow stairs
  (spiral) does not clip; clamp near/far per size.
- `drawPlanPreview` re-computes `stairPlanBounds` for fit then `drawStairPlan`
  recomputes design again — pass the already-sized design through to avoid
  double compute + any drift.
- Cross-link drift: new stair pages are in `site.js`/`related-pages.js` +
  sitemap, but older pages' headers still link only `stair-designer.html`.
  Add the L/U/spiral/steep links to the shared menu (done in site.js groups)
  and to `docs/workflow.md` / `docs/start2finish.md` if they enumerate stairs.
- `sitemap.xml` is generated — re-run `npm run sitemap` after every new page
  (done: 37 pages) and keep `pages/app.html` out of the sitemap if archived.

---

## 8. Nice-to-haves (ordered)

1. **One "Add to plan" contract** — every designer saves `{ stair|deck|… }`
   + preview image + quantities under one draft schema; Editor shows a
   placement ghost before commit.
2. **Clash view** — plumbing vs electrical vs framing bores in one overlay
   (the data already exists in three suites).
3. **Cost-load the schedule** — bid lines × phase % → cash-flow curve.
4. **Permit pack export** — one PDF: site plan + floorplan + footing/roof/
   stair schedules + check list.
5. **Save/share projects** — named cloud/local projects with links (Editor
   has local + collaboration stubs; extend to suites).
6. **Takeoff-to-cart** — price-book quotes attach to takeoff rows; bid pulls
   live.
7. **Offline/PWA** — Tesseract + three already CDN-pinned; add service worker
   + manifest for site use.
8. **Guided onboarding** — plan-studio becomes a checklist wizard (site →
   plan → foundation → … → bid) with per-step completion.

---

## 9. Tech / ability suggestions

- **Units:** one `shared/units.js` (metric store, metric/imperial display,
  per-page toggle persisted in localStorage).
- **Engines:** make `calc.html` import `features/{deck,framing,roof,stairs}`
  engines; add `features/hvac/` + `features/envelope/` later using the same
  pattern (design.js + plan.js + page.js + rules doc + CSV).
- **3D:** consolidate on three r160 import map; move WebGPU behind a
  feature flag in the Editor/toolbox instead of a page; add
  `ResizeObserver` + DPR caps everywhere (stair-type helper already does).
- **OCR:** persist `planText`/`planSymbols` in project JSON (versioned);
  add word→room auto-label ("BEDROOM" → room name) and dimension→scale
  inference with user confirm.
- **Data:** JSON Schema for every `*-draft` + a `scripts/check-drafts.mjs`
  gate (exists — extend to new stair pages); migrate drafts with
  `PROJECT_SCHEMA_VERSION`.
- **Testing:** extend `scripts/browser-check.mjs` + `run-checks.mjs` to the
  four stair pages (compute → plan bounds → 3D group → draft round-trip),
  and add a price-coverage check (every takeoff row has a price-book key or
  explicit allowance).
- **Docs:** each new suite gets `docs/<suite>.md` + `.csv` + glossary, like
  deck/elec/framing/land/stair already do; wire Rules tabs to them.
- **Perf:** lazy-load three/Tesseract per page (dynamic import), code-split
  suite pages, preconnect CDN + cache worker/core/lang data.
- **SEO/a11y:** keep titles/descriptions/canonical/OG on every page (done
  for stair pages), add keyboard/ARIA for canvas controls + text fallbacks,
  honour `prefers-reduced-motion` in 3D loops.
