# Stair code reference (USA)

Reference sheet for the stair designer. Values are the model-code minimums used by
`features/stairs/design.js`. **This is a design aid, not a permit submission.**
Local amendments, occupancy, sprinklers, occupant load and the authority having
jurisdiction (AHJ) always govern.

Primary sources:

- **IRC 2021** — Chapter 3, R311.7 (stairways), R311.7.10.1 (spiral stairways).
- **IBC 2021** — Chapter 10, 1011 (stairways), including 1011.5.2 (treads/risers),
  1011.6 (landings), 1011.8 (vertical rise), 1011.9 (curved), 1011.10 (spiral).
  The R-3/R-2 dwelling-unit exception is part of 1011.5.2.
- **OSHA 29 CFR 1910** — 1910.21(a)(2) floor openings and 1910.23 guarding;
  1910.144/1910.145 for hazard marking and signs. OSHA interpretation letter,
  29 May 1992: fire poles are **not** an approved means of egress.
- Manufacturer data for sliding poles (e.g. McIntire Model 19) for practical
  diameters, floor opening and landing mat sizes.

## 1. Dimensions that drive the calculation

| Rule                     | IRC 2021 (dwelling)                                                           | IBC 2021                                                                        | Suite constant               |
|--------------------------|-----------------------------------------------------------------------------|-----------------------------------------------------------------------------------|------------------------------|
| Clear stair width        | **36 in / 914 mm** min (R311.7.1)                                           | **44 in / 1118 mm**; 36 in / 914 mm where occupant load < 50 (1011.2)             | `minWidth`                   |
| Maximum riser            | **7¾ in / 197 mm** (R311.7.5)                                               | **7 in / 178 mm** (1011.5.2); 7¾ in in R-3/R-2 dwelling units                     | `maxRiser`                   |
| Minimum riser            | 4 in is the practical floor; IRC does not set a separate usability minimum  | **4 in / 102 mm** (1011.5.2)                                                      | `minRiser`                   |
| Minimum tread            | **10 in / 254 mm** (R311.7.5), 11 in may omit the nosing                    | **11 in / 279 mm** rectangular (1011.5.2); 10 in in R-3/R-2 dwelling units        | `minTread`                   |
| Winder tread at walkline | **10 in; **6 in  minimum clear inside edge (1011.5.2 R-3/R-2 exception)     | **11 in / 279 mm** at walkline; **10 in / 254 mm** within clear width (1011.5.2)  | `winderTread`, `winderClear` |
| Walkline location        | **12 in / 305 mm** from the narrow edge (R311.7.5, commentary)              | **12 in / 305 mm** from the narrow edge (1011.5.2)                                | `walklineOffset`             |
| Headroom                 | **80 in / 2032 mm** (R311.7.2)                                              | **80 in / 2032 mm** (1011.3)                                                      | `headroom`                   |
| Maximum rise per flight  | **12 ft 7 in / 3835 mm** (R311.7.3)                                         | **12 ft / 3658 mm** (10118)                                                       | `maxFlightRise`              |
| Landing                  | Width not less than the stair; **36 in / 914 mm**                           | Width not less than the stair; depth equal to the stair width or **48 in          | `landingDepth`               |
| Handrail height          | **34–38 in / 864–965 mm** above nosing (R311.7.8)                           | **34–38 in / 864–965 mm** (1011.3/1014)                                           | `handrailMin/Max`            |
| Riser / tread uniformity | ⅜ in / 9.5 mm max variation in a flight (R311.7.5.1)                        | ⅜ in / 9.5 mm max variation (1011.5.4)                                            | `uniformity`                 |
| Nosing                   | ¾–1¼ in / 19–32 mm projection where required (R311.7.5.2)                   | 1¼ in / 32 mm maximum projection (1011.5.5.1)                                     | `nosing`                     |
| Curved stair radius      | Not restricted in R-3/R-2 dwelling units                                    | Smallest radius not less than **2× the stair width** (1011.9), except R-3/R-2     |`minRadius`                   |

### Spiral stairways

| Rule                          | IRC 2021 R311.7.10.1                         | IBC 2021 1011.10                                                                            |
|-------------------------------|----------------------------------------------|---------------------------------------------------------------------------------------------|
| Clear width at/below handrail | **26 in / 660 mm** min                       | **26 in / 660 mm** min                                                                      |
| Tread depth at walkline       | **7½ in / 190 mm** at 12 in from narrow edge | **6¾ in / 171 mm** at 12 in from narrow edge                                                |
| Riser height                  | **9½ in / 241 mm** maximum                   | **9½ in / 241 mm** maximum                                                                  |
| Headroom                      | **6 ft 6 in / 1981 mm** minimum              | **78 in / 1981 mm** minimum                                                                 |
| Use as egress                 | Allowed for dwelling units                   | Only in dwelling units, spaces ≤250 ft² serving ≤5 occupants, or technical production areas |

Spiral treads are measured at the **walkline radius** = column radius + 12 in.
The suite uses a 3.15 in (80 mm) centre column by default.

### Landings and doors

- Landings must be at least as wide as the stair and the code depth above.
- A door may not swing over a landing or reduce the required landing depth
  (IBC 1010.1.6 / IRC R311.3).
- The suite checks the landing depth against the widest stair it serves.

## 2. Comfort and geometry formulas (not code)

Code sets the legal envelope; these formulas set the preferred size:

- **Blondel / 2R + T:** `2 × riser + tread` should be **24–25 in
  (610–635 mm)**; 25 in is the classic target.
- **7–11 rule:** 7 in riser + 11 in tread (IBC commercial) lands at 25 in.
- Number of risers: `N = ceil(total_rise / max_riser)`, then
  `riser = total_rise / N`. Use the same riser for every step (uniformity).
- Number of treads in a flight: `N − 1`; the upper floor is the top “tread”.
- Straight run: `run = (N − 1) × tread`.
- Quarter-turn curved (90°): walkline arc = `R_walk × π/2`;
  tread at walkline = `R_walk × (π/2) / (N − 1)`.
- Half-turn curved (180°): same with `π`.
- Spiral: `tread at walkline = R_walk × (2π / (N − 1))` for a full turn.
- Maximum riser count between landings is bounded by `maxFlightRise`.
- Available space drives the result: the suite uses the entered run/width first,
  then reports whether the resulting riser/tread still meets the code.

## 3. Fireman’s pole (fire station)

A fire pole is a **rapid-descent device, not an egress stair**. OSHA’s
1992 interpretation says poles are not an approved means of access and the
floor opening is a **floor opening** that must be guarded by a railing or cover
(1910.21(a)(2), 1910.23). Required practice:

| Item                   | Value used                                                                | Basis                                             |
|------------------------|---------------------------------------------------------------------------|---------------------------------------------------|
| Pole diameter          | **2½ in / 63.5 mm** for drops up to 30 ft; 3–3½ in for longer/heavier use | Manufacturer standard; historic practice 2½–3½ in |
| Floor opening          | **37½ in / 953 mm** diameter                                              | McIntire Model 19 installation                    |
| Landing mat            | **32 in / 813 mm** diameter, 2 in thick, closed-cell neoprene             | Manufacturer                                      |
| Pole above upper floor | **36 in / 914 mm** minimum grab extension                                 | Best practice / manufacturer                      |
| Maximum standard drop  | **30 ft / 9.14 m** before an engineered pole                              | Manufacturer                                      |
| Guard at opening       | **42 in / 1067 mm** rail with self-closing gate                           | OSHA 1910.23 guardrail practice                   |
| Floor around opening   | Anti-skid mat, contrasting warning sign                                   | OSHA 1910.144/1910.145                            |
| Egress                 | **Not permitted as the only means of egress**                             | OSHA interpretation, 29 May 1992                  |

The suite models the pole, floor opening, landing mat, guard ring/gate posts and
warning sign position, and reports the OSHA warnings in the design result.

## 4. What the suite checks

For **straight**, **curve right**, **curve left** and **spiral** stairs:

1. Riser within min/max.
2. Tread at the walkline within min (and rectangular tread for straight).
3. Winder clear depth at the inside edge (curved).
4. Stair width within min.
5. Flight rise within the landing limit.
6. Curved inner radius ≥ 2× width (IBC commercial).
7. Spiral clear width, tread and headroom.
8. Comfort `2R + T`.
9. Required run / diameter vs. the available space.
10. Landing depth at the top and bottom.

For the **fire pole**: diameter, drop, opening, mat, guard, warning, and the
“not egress” warning.

## 5. Outdoor stair systems

Outdoor stairs are the same geometry with a different load path, guard height and
durability envelope. The suite ships five presets (`features/stairs/outdoor.js`):

| System                   | Code     | Width                            | Guard | Handrails | Footings             | Structure                          |
|--------------------------|----------|----------------------------------|-------|-----------|----------------------|------------------------------------|
| Wood deck stair          | IRC 2021 | 36 in                            | 36 in | 1 side    | 42 in piers          | 2x12 carriage, 4x4 posts           |
| Porch stair              | IRC 2021 | 36 in                            | 36 in | 1 side    | 42 in piers          | 2x12 carriage, closed risers       |
| Exterior building egress | IBC 2021 | 44 in (36 in under 50 occupants) | 42 in | 2 sides   | 42 in                | Steel channel stringer             |
| Apartment building       | IBC 2021 | 44 in                            | 42 in | 2 sides   | 42 in                | Steel or concrete, rated enclosure |
| Concrete walkway         | IBC 2021 | 60 in                            | 42 in | 2 sides   | Grade beam / footing | Cast-in-place, #4 each way         |

### Outdoor-specific rules

| Rule              | Requirement                                                                                                          | Reference                 |
|-------------------|----------------------------------------------------------------------------------------------------------------------|---------------------------|
| Guard trigger     | Guard required where the walking surface is more than **30 in / 762 mm** above grade                                 | IRC R312.1.1 / IBC 1015.2 |
| Residential guard | **36 in / 914 mm** high, no **4 in / 102 mm** sphere                                                                 | IRC R312.1.2 / R312.1.3   |
| Commercial guard  | **42 in / 1067 mm** high, **4 in** sphere, 200 lb concentrated load                                                  | IBC 1015.2 / 1015.4       |
| Open risers       | Must reject a **4 in** sphere; a 2x2 toe board keeps the gap legal                                                   | IRC R311.7.5.1            |
| Footings          | Extend below the frost line; **12 in / 305 mm** minimum below undisturbed grade; 36–42 in typical in the northern US | IRC R403.1.4              |
| Ledger            | Flashed and bolted per the span table; never supported by the deck                                                   | IRC R507.9                |
| Fasteners         | Hot-dip galvanised, stainless or coated in exterior/treated wood                                                     | IRC R317.3                |
| Door landing      | **36 in / 914 mm** deep in the direction of travel                                                                   | IRC R311.3                |
| Egress landing    | Stair width or **48 in / 1219 mm**, whichever is less                                                                | IBC 1011.6                |
| Exit discharge    | Directly to a public way or through an exit path                                                                     | IBC 1027.1                |
| Enclosure         | Opening protection for the building type and sprinkler status                                                        | IBC 1023.2                |
| Accessible route  | A stair is not accessible; provide a **1:12** ramp, lift or elevator                                                 | ADA 2010 405              |
| Concrete          | Riser **4–7 in**, tread **11 in** minimum, 2 in cover over reinforcement                                             | IBC 1011.5.2 / ACI 318    |
| Stringer span     | 2x12 carriage ≤ **13 ft** with the flight supported at both ends; add a mid-support beyond that                      | NDS / IRC Table R502.5    |
| Walkway slope     | Landings **¼ in per foot**; accessible routes use 1:12 ramps instead of stairs                                       | IRC R401.3 / ADA 405      |

### The BIM assembly model

Every stair is modelled as four sub-types (`features/stairs/assembly.js`), which
is the structure the major BIM stair tools use:

| Sub-type              | Fields                                                                                                                       |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------|
| **Run Type**          | stair type, risers, riser height, treads, tread depth, run width, nosing type/projection, tread and riser materials          |
| **Landing Type**      | top and bottom platforms (automatic unless disabled), depth, width, offset, material, intermediate landings authored by hand |
| **Base / Top Levels** | base elevation + base offset, top elevation + top offset, total rise                                                         |
| **Support Type**      | carriage (residential wood), stringer (industrial metal) or cast concrete flight; quantity and span                          |

Parametric control writes into the same four groups: riser height, tread depth,
run width, location line, base/top offsets, landing toggles and support type.
Automatic landings are generated at the top and bottom; intermediate landings
are manual, because their riser position is a design decision.

Coordination: `findStairClashes()` tests the footprint against walls (segment /
rectangle clip) and other fixtures, and flags headroom under the top landing.
`stairSectionProfile()` returns the side section (nosing line, soffit, landings)
for a 3D section or a drawing, so the plan, section and model agree.

### Parts and wireframe models

Every component is catalogued in `features/stairs/parts.js` at its **dressed US
size** (a 2x10 is 1½ × 9¼ in) and can be built as a solid or as a wireframe:
stringers, treads and risers, nosings, landing frames and decking, posts,
piers, anchors, hangers, rails, balusters, glass and cable infill, gates,
concrete flights, steps, rebar, forms, spiral columns and treads, and the fire
pole shaft, flange, guard and mat. Open `stair-parts.html` for the 3D catalogue
(every part at real size, framed on click) or call
`buildPartWireframe(THREE, key, options)` from the kit.

## 6. Sources

- IRC 2021 R311.7: https://up.codes/s/stairways-and-handrails
- IRC 2021 R311.7.6 landings: https://up.codes/s/landings-for-stairways
- IBC 2021 1011.5.2: https://up.codes/s/stair-treads-and-risers
- IBC 2021 1011.6: https://up.codes/s/stairway-landings
- IBC 2021 1011.9 curved: https://up.codes/s/curved-stairways
- IBC 2021 1011.10 spiral: https://up.codes/s/spiral-stairways
- Code overview (2021 IRC/IBC): https://www.buildingcode.blog/blog/stairwaycoderequirements
- OSHA fire-pole interpretation: https://www.osha.gov/laws-regs/standardinterpretations/1992-05-29
- McIntire Model 19 pole data: https://www.slidepole.com/m19_specifications.htm
- Fire pole dimensions/history: https://www.ffam.org/fire-poles-a-historic-tradition-in-the-fire-service/
