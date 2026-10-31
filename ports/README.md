# floorplan3d core — Rust, Python and Lua ports

The platform's suites (`features/framing`, `features/deck`, `features/stairs`,
`features/roof`, `features/electrical`, `features/room-metrics`,
`features/cut-list`, `engine/wireframe`) are browser ES modules. This directory
reimplements the pure computation behind them three times — Rust, Python and Lua —
behind one JSON contract, so the numbers can be used from a CLI, a build step or
another service without a browser.

Everything here is pure: no DOM, no network, no clock, no randomness. The same plan
in produces the same canonical JSON out, byte for byte, in all three languages.

## Run

```bash
# one implementation
cargo run --quiet --manifest-path ports/rust/Cargo.toml -- ports/spec/plan.example.json
python ports/python/floorplan_core.py ports/spec/plan.example.json
lua ports/lua/floorplan_core.lua ports/spec/plan.example.json

# all three, compared byte for byte (this is the gate)
node ports/run-parity.mjs [plan.json ...]
```

`npm test` runs the same gate over every `ports/spec/*.json` fixture as
`scripts/check-ports.mjs`, alongside the rest of the repo checks.

`run-parity.mjs` builds the Rust binary, runs every port on each plan and fails on
the first byte that differs. It uses a real `lua`/`luajit` if one is installed and
otherwise runs the Lua port through `npm exec --package=fengari-node-cli -- fengari`
(Lua 5.3 on node). Only the Rust build needs cargo; the Rust port has no crates.

When no interpreter has file access (fengari) or a shell is in the way, the plan can
be passed base64-encoded: `lua floorplan_core.lua --b64 <base64>` or `--inline <json>`.

## Input

One plan JSON. Only `project`, `units`, `walls`, `rooms` and `fixtures` are
structural; every other section is optional and defaults to zero/empty, so a plan
can carry just the part you are pricing.

```json
{
  "project": "southern-farmhouse",
  "units": "m",
  "wallHeight": 2.7,
  "studSpacingMm": 406,
  "wastePct": 10,
  "rooms": [{ "name": "Living", "polygon": [[0,0],[3.5,0],[3.5,4.2],[0,4.2]] }],
  "walls": [{ "x1": 0, "y1": 0, "x2": 5.5, "y2": 0,
              "openings": [{ "width": 0.9, "height": 2.1, "type": "door" }] }],
  "stairs": { "rise": 2.85, "runAvailable": 3.6, "width": 1.0 },
  "deck": { "joistSpan": 3.6, "joistSpacing": 0.406, "postSpacing": 1.8,
            "soil": "clay", "depth": 0.9, "width": 3.6 },
  "roof": { "planArea": 120.0, "pitch": 6,
            "style": "hip", "span": 12.0, "length": 18.0, "overhang": 0.6,
            "spacing": 0.61, "sheathing": "ply-1932", "underlayment": "felt-30",
            "covering": "clay-tile", "gutter": "k6-alum", "gutters": 1,
            "iceShield": 1, "ridgeVent": 1, "soffitVent": 1, "chimney": 0,
            "pipeVents": 3, "tearOff": 1, "waste": 0.12, "climate": "cold" },
  "electrical": { "areaM2": 37.8, "smallApplianceCircuits": 2, "laundryCircuits": 1,
                  "appliancesVa": 9000, "heatingVa": 0, "coolingVa": 12000 },
  "sizing": { "species": "spf-2", "limit": 360,
              "members": [{ "id": "deck-joist", "group": "deck", "size": "2x10",
                            "spacing": 0.406, "load": 50, "span": 3.6 }] },
  "plumbing": { "width": 5.5, "depth": 4.2, "staticPressure": 62, "meterSize": "3/4",
                "fixtures": [{ "id": "wc1", "type": "toilet", "tag": "WC1", "x": 0.9, "y": 0.4 }] },
  "lighting": { "width": 5.5, "depth": 4.2, "targetLux": 200,
                "luminaires": [{ "x": 1.4, "y": 1.4, "lumens": 1100, "watts": 14 }] },
  "landscape": {
    "feature": { "type": "pool", "shape": "rectangle", "width": 5.2, "length": 9.5,
                 "shallow": 1.1, "deep": 1.9, "deck": 1.22, "turnoverHours": 6,
                 "head": 40, "suctionOutlets": 2 },
    "site": { "width": 10, "depth": 14, "deckSlopePercent": 2.0,
              "overheadClearance": 7.62, "receptacleDistance": 3.0,
              "equipmentClearance": 1.2, "bonded": 1, "gfci": 1,
              "filterMedia": "cartridge", "skimmers": 2,
              "ph": 7.4, "freeChlorine": 2, "alkalinity": 100, "cya": 40, "calcium": 300 }
  },
  "fixtures": [{ "id": "c1", "type": "cabinet_base", "width": 0.6, "depth": 0.6,
                 "height": 0.9, "label": "Base cabinet" }]
}
```

## Output

Canonical JSON, fixed key order, integers without a decimal point and every real
value rounded to three decimals exactly once. Numbers are rounded with
`floor(x*1000 + 0.5)/1000` in all three ports, so the text is identical and a plain
string compare is a valid parity check.

| Section | What it computes |
| --- | --- |
| `walls` | length, angle (0–360°), height, gross area, opening area, net area |
| `rooms` | shoelace area, perimeter, centroid, volume |
| `totals` | wall and room counts, areas, volumes, mean wall height |
| `finishes` | drywall sheets (2.4 × 1.2 m), paint (2 coats at 10 m²/L), flooring with waste, baseboard deducting openings |
| `framing` | studs per wall at the spacing plus two per opening, plates (bottom + double top = 3 runs), sheathing panels, plus `sizing` |
| `stairs` | risers, riser height, treads, tread, run, stringer, and the IRC 2021 R311.7 checks (riser ≤ 196 mm, tread ≥ 254 mm, width ≥ 914 mm, 2R+T comfort) |
| `deck` | joist count, post load (50 psf × post spacing × half the joist span), footing diameter from soil bearing (≥ 12 in), concrete bags, board count, plus `sizing` |
| `roof` | slope factor √(1+(pitch/12)²), roof area, squares, bundles at 3 per square, plus `roof.design` — the roof suite's takeoff (see below) |
| `electrical` | NEC 220.42 tiers on lighting + SABC + laundry, 75% appliances, larger of heat/cool, service amps (100 A dwelling minimum), optional 220.82 method |
| `cutList` | fixtures grouped by type and size with counts and ids, plus CSV |
| `wireframe` | OBJ vocabulary: vertex/edge counts and an FNV-1a 32-bit hash of the extruded wall wireframe |
| `plumbing` | fixture units, Hunter demand, water sizing/velocity/Hazen-Williams friction, residual pressure per fixture, DFU and stack sizing, trap-arm lengths, gas load and capacity |
| `lighting` | room index, coefficient of utilization, lumen method, point-by-point grid and uniformity, LPD, circuit VA and breaker load |
| `landscape` | water-feature sizing, site clearances, hydraulic train, the ISPSC/NEC checks and a costed bill of materials |

### Member sizing (NDS)

`framing.sizing` and `deck.sizing` check a member as a simply supported, uniformly
loaded beam about its strong axis, the way an NDS span table is built:

| Check | Span at which it is satisfied |
| --- | --- |
| bending | `L = √(8·Fb·S / w)` from `fb = M/S` with `M = wL²/8` |
| shear | `L = 4·Fv·A / (3·w)` from `fv = 1.5·V/A` with `V = wL/2` |
| deflection | `L = ∛(384·E·I / (5·limit·w))` from `Δ = 5wL⁴/(384EI) ≤ L/limit` |

`w` is the load along the member in **lb per inch** — `loadPsf × spacing_ft ÷ 12` —
so all three spans land in the same units. The shortest span governs and is
reported as `allowableSpan`; the member passes when its required `span` is within
it. `species` (`dfl-1`, `dfl-2`, `sp-1`, `sp-2`, `spf-1`, `spf-2`; default `spf-2`)
selects the NDS reference values, `limit` defaults to 360 (L/360) and can be set
per plan or per member (480 for L/480). Members are grouped by `group` (`framing`
or `deck`, default `framing`); an unknown nominal size is skipped rather than
guessed.

Section properties come from the dressed sizes: `A = b·d`, `S = b·d²/6`,
`I = b·d³/12`. No adjustment factors (Cd, Cr, CM, CL) are applied, so a reported
span is a reference-case span, not a permitted design — the local code and a
licensed engineer decide the assembly.

### Plumbing

`plumbing` takes a plan rectangle, the service data and a placed fixture list; a
fixture is one of the catalogue ids (`toilet`, `lavatory`, `bathtub`, `shower`,
`bidet`, `kitchen-sink`, `dishwasher`, `bar-sink`, `washing-machine`,
`laundry-sink`, `utility-sink`, `floor-drain`, `hose-bib`, `gas-range`,
`gas-dryer`, `gas-furnace`, `gas-grill`, `gas-fireplace`), each with its own supply
and drainage fixture units from `features/plumbing/catalog.js`.

- **Water.** Cold and hot fixture units, the Hunter demand curve interpolated to
  gpm, the service size that covers both the service-unit table and the 8 ft/s
  velocity limit, Hazen-Williams friction over the main run, and the meter loss
  scaled from its 10 gpm value. Each fixture is then connected to the nearest
  point of a one-bend orthogonal service tree; the friction along its path is
  subtracted from the static pressure to give `readings[].pressurePsi` and the
  worst fixture.
- **Drainage.** Total DFU, building-drain size from the main table, slope against
  the size's minimum, the invert the run needs, one stack per fixture group with
  the largest fixture drain governing the branch, and trap-arm lengths against
  the IPC limits.
- **Fuel gas.** Connected Btu, CFH at 1030 Btu/ft³ natural or 2516 propane,
  capacity derated from the 10 ft table by √(10/L), and the main size for the
  load at the run length.
- **Checks.** Ten `{ id, pass }` flags mirror the suite: hookup, residual pressure
  ≥ 8 psi, service velocity, meter size, sewer invert, slope, lateral size,
  trap arms, gas meter and gas main.

### Lighting

`lighting` is the suite's photometry (`features/lighting/photometry.js`) plus its
circuit arithmetic. Luminaire photometric properties are inputs, because the
catalogue is data rather than a calculation:

- **Lumen method.** Room index `w·d/(h·(w+d))`, coefficient of utilization from the
  stepped base curve nudged by ceiling and wall reflectance, then
  `lux = lumens·CU·LLF/area`. `requiredForTarget` is the fitting count that reaches
  `targetLux` at the first luminaire's lumen output.
- **Point-by-point.** A square sample grid at the work plane with the inverse-square
  + cosine law (`intensity = lumens/π`), giving min/max/average, uniformity
  `min/max` and `average/min`.
- **Circuits.** 180 VA per general receptacle, nameplate VA for a dedicated one,
  luminaire wattage otherwise; `pass` is the load within the breaker and
  `continuousPass` is the load within 80% of it.

Like the rest of the ports these are planning calculations from the suite's own
tables, not stamped designs: no NDS/IPC/CEC adjustment factors, no wet-vent
rules, no manufacturer photometric files.

### Roof suite

`roof.design` is `computeRoofDesign` from `features/roof/design.js`: the geometry of
one of the ten styles, every layer priced, and the checks the designer page shows.

- **Geometry.** `scripts`-free plane quads per family (gable, saltbox, gambrel, hip,
cross, shed), summed by fan triangulation exactly as `quadArea` does, giving
`roofArea`, plus eave, rake, ridge, hip and valley lengths from the style's own
planes. All inputs are metres; `pitch` is rise per 12 of run.
- **Layers.** Sheathing sheets at 1.22 × 2.44 m, underlayment rolls at the catalogue
coverage with 5% lap, ice-and-water shield at the eaves, covering units at 3 per
square (shingle) or the tile/slate count, starter strip and ridge/hip cap, then drip
edge, valley, step, apron, counter, kickout, boot and gutter-apron flashing.
- **Gutters.** Run length, automatic downspouts (one per 12 m and per the profile's
roof-area limit, minimum two), hangers at the profile spacing, end caps from the
eave runs, outlets and two elbows per downspout.
- **Structure and ventilation.** Truss count from the spacing, member length per
truss family, ceiling joists, net free vent area against the 1:300 requirement.
- **Costs.** Material rows, then tear-off, installation at 140 per square, gutter and
flashing labour, with `perSquare` and `perM2`.
- **Checks.** Pitch against the covering's window and the style's preference,
low-slope and ponding, dead load, truss spacing under tile, ice dam, ventilation,
gutter capacity, underlayment slope, overhang and waste allowance.

### Landscape

`landscape` is the water-feature suite: `computeWaterFeature` from
`features/landscape/design.js` plus the siting, hydraulic and cost work in
`engine.js`. Six feature types (pool, spa, fountain, pond, waterfall, water wall)
and five shapes share one calculation.

- **Water body.** Area from the shape (circle, rounded-end rectangle, kidney factor
0.82), average depth (pool mean of shallow and deep), volume, US gallons, turnover
and the flow it implies, pump horsepower from `gpm · head / (3960 · 0.65)`, bather
count from the ISPSC area per bather, and weir flow for a waterfall or water wall.
- **Siting.** Property-line clearances from the feature position clamped inside the
site, the setback that the zoning checks read, deck area, and the deck, barrier and
water perimeters.
- **Hydraulic train.** Filter media rate (sand 15, DE 2, cartridge 0.25 gpm/sq ft),
the smallest catalogue filter of that media that covers the flow, skimmers at one
per 500 sq ft, returns at one per 120 sq ft (minimum two), luminaires at one per
100 sq ft, cover face velocity against 1.5 ft/s, and heater Btu from an 8.34 lb/gal
20 °F rise over 24 h.
- **Checks.** Depth, diving, spa temperature and depth, pond depth, barrier and
latch, bonding, GFCI, overhead and receptacle clearances, equipment access,
accessibility, freeze protection, safety cover, spa shut-off and signage, filter
capacity, skimmers, drain velocity and the five water-chemistry windows.
- **Bill.** Excavation, shell (pond liner vs gunite), coping, deck, water, pump,
filter, heater, skimmers, suction covers, returns, luminaires, barrier, cover and
controls, priced per line and totalled.

Flags (`bonded`, `gfci`, `gutters`, `iceShield`, `on`, `dedicated`, …) take either a
boolean or a number, so `true` and `1` mean the same thing and `false` is a value
rather than a missing key; an absent flag keeps its default. All three readers keep
booleans, so `spec/plan.bool.json` exercises exactly that.

## Layout

```
ports/
  spec/plan.example.json     two-room plan, door/window openings, clay soil
  spec/plan.load.json        larger electrical load, sand soil, mixed wall heights
  spec/plan.site.json        hip roof in clay tile, cold climate, spa in a sand filter
  spec/plan.pool.json        gambrel roof in metal with no gutters, deficient pool
  rust/  Cargo.toml, src/main.rs
  python/floorplan_core.py
  lua/   floorplan_core.lua
  run-parity.mjs             the parity gate
```

## Not ported

The browser-side half of the platform stays where it is: three.js scene building,
the editors and panels, texture generation, WebGPU rendering, DOM measurement and
the import/export conversions that need browser APIs. This directory covers the
numbers; the visual and interactive features still live in `features/` and `scene/`.
