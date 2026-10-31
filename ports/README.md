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
  "roof": { "planArea": 120.0, "pitch": 6 },
  "electrical": { "areaM2": 37.8, "smallApplianceCircuits": 2, "laundryCircuits": 1,
                  "appliancesVa": 9000, "heatingVa": 0, "coolingVa": 12000 },
  "sizing": { "species": "spf-2", "limit": 360,
              "members": [{ "id": "deck-joist", "group": "deck", "size": "2x10",
                            "spacing": 0.406, "load": 50, "span": 3.6 }] },
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
| `roof` | slope factor √(1+(pitch/12)²), roof area, squares, bundles at 3 per square |
| `electrical` | NEC 220.42 tiers on lighting + SABC + laundry, 75% appliances, larger of heat/cool, service amps (100 A dwelling minimum), optional 220.82 method |
| `cutList` | fixtures grouped by type and size with counts and ids, plus CSV |
| `wireframe` | OBJ vocabulary: vertex/edge counts and an FNV-1a 32-bit hash of the extruded wall wireframe |

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

## Layout

```
ports/
  spec/plan.example.json     two-room plan, door/window openings, clay soil
  spec/plan.load.json        larger electrical load, sand soil, mixed wall heights
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
