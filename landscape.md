# Landscape water feature code reference (USA)

Reference sheet for the landscape designer (`features/landscape/`): pools, spas,
fountains, ponds, waterfalls and water walls. Values are the model-code minimums
used by `computeWaterFeature()`. **This is a design aid, not a permit submission.**
State amendments, local zoning, the electrical AHJ and the health department
always govern.

Primary sources:

- **ISPSC 2021** — International Swimming Pool and Spa Code: Chapter 3 (barriers,
  decks, depth, slopes), Chapter 4 (energy), Chapter 5 (water quality), Chapter 6
  (spas/hot tubs), Chapter 7 (fountains and water features), Chapter 10 (suction
  entrapment).
- **IRC 2021 Appendix G** — swimming pools, spas and hot tubs for one- and
  two-family dwellings (largely mirrors the ISPSC).
- **VGB Act** (15 U.S.C. 8001; CPSC 16 CFR 1450) — anti-entrapment drain covers,
  two suction outlets, SVRS.
- **NEC 2021 Article 680** — swimming pools, fountains and similar installations:
  680.8 overhead conductors, 680.21 motors, 680.22 receptacles, 680.26 bonding.
- **ANSI/APSP/ICC-11** — water quality in public pools and spas.
- **ADA 2010 Standards 242 / 1009** — accessible pool entry (lift or sloped entry).
- Local zoning for setbacks, impervious cover and barrier equivalency.

## 1. Barrier, gates and alarms

| Rule | Requirement | Suite field |
|---|---|---|
| Barrier height | **48 in / 1219 mm** minimum above grade, measured on the outside (ISPSC 305.2) | `barrierHeight` |
| Sphere test | No opening may pass a **4 in / 102 mm** sphere (ISPSC 305.2) | `barrier.sphere` |
| Climbability | No footholds or handholds; horizontal members at least 45 in apart | — |
| Gates | Self-closing and self-latching, opening outward, latch **54 in / 1372 mm** above grade (ISPSC 305.3) | `gateSelfClosing`, `gateLatchHeight` |
| Dwelling wall | A wall of the dwelling may serve as part of the barrier only where it has no operable windows/doors that open into the pool area, or they are alarmed | — |
| Doors | An alarm or self-latching device at least 54 in above the floor if a door gives direct access | — |
| Above-ground pools | Barrier or lockable ladder/cover per ISPSC 305.5 | — |
| Safety cover | A powered or manual safety cover must meet ASTM F1346 | — |

## 2. Pool geometry

| Rule | Requirement | Suite field |
|---|---|---|
| Deck width | Unobstructed deck at least **4 ft / 1.22 m** around the pool (ISPSC 306.1) | `deck` |
| Minimum depth | **3 ft / 914 mm** water depth at the shallow end | `shallow` |
| Maximum residential depth | **8 ft / 2438 mm** without an engineered/diving design | `deep` |
| Diving depth | **7 ft 6 in – 9 ft** under a diving board, with the ISPSC diving envelope | `deep`, `diving` |
| Floor slope | Shallow end no steeper than **1:3**; transition **1:1** (ISPSC 306.3) | `shallowSlope` |
| Steps / ladders | Steps, ladders or a sloped entry at the shallow end; two means of entry for a pool over 30 ft long | — |
| Deck slope | **¼ in per foot** away from the pool and building (IRC R401.3) | — |
| Coping | Rounded or bullnose edge, 1–2 in overhang, slip-resistant | `coping` |

## 3. Circulation, filtration and suction

| Rule | Requirement | Suite field |
|---|---|---|
| Pool turnover | **6 h** residential (8 h maximum), 4 h for a public pool with heavy use | `turnoverHours` |
| Spa turnover | **30 min** | `turnoverHours` |
| Fountain / water feature | **1 h** typical, 30 min for a display fountain | `turnoverHours` |
| Flow | `gpm = gallons ÷ (turnover hours × 60)` | `flowGpm` |
| Pump power | `hp ≈ gpm × head (ft) ÷ (3960 × 0.65)` | `pumpHp` |
| Suction outlets | **Two** outlets at least **3 ft** apart, VGB-listed covers (ISPSC 310.2) | `suctionOutlets` |
| Cover velocity | Not over **1.5 ft/s** across the cover face (ISPSC 310.3) | `drainVelocity` |
| Entrapment | SVRS, vent pipe or a gravity drain where the outlet cannot be duplicated | — |
| Skimmers | One per 400–500 sq ft of surface, on the prevailing wind side | — |
| Bather load | 15 sq ft per bather in water under 5 ft; 20 sq ft in deeper water | `bathers` |
| Filters | Size from the flow rate at 15 gpm/sq ft for sand, 2 gpm/sq ft for cartridge | — |

## 4. Spas and hot tubs

| Rule | Requirement | Suite field |
|---|---|---|
| Water temperature | **104 °F / 40 °C** maximum (ISPSC 307.4 / 609.4) | `waterTempF` |
| Depth | **3 ft / 914 mm** maximum water depth | `deep` |
| Turnover | 30 minutes | `turnoverHours` |
| Suction | Two outlets, VGB covers, no single-blockable outlet | `suctionOutlets` |
| Jets | 10–15 gpm per jet; a booster pump when jet demand exceeds the filter flow | `jets`, `jetFlowGpm` |
| Controls | Emergency shut-off within 5 ft, timer limit of 15 minutes for air blowers | — |
| Signage | "No lifeguard", "Do not use alone", temperature and pregnancy warnings | — |
| Accessible | At least one accessible spa or a lift (ADA 242.2) | — |

## 5. Fountains, ponds, waterfalls and water walls

| Feature | Rule | Suite field |
|---|---|---|
| Fountain basin | Minimum 6 in / 150 mm water depth over the pump intake; splash radius free of traffic | `deep` |
| Fountain jet | Nozzle height from the pump curve; wind drift must not leave the basin | `head`, `jets` |
| Pond | **24 in / 610 mm** minimum depth for fish; 45 mil EPDM liner or clay seal; aeration above 18 in | `deep`, `aeration`, `liner` |
| Pond banks | Sloped **1:3** or steeper with coping to prevent slumping | — |
| Waterfall | Sharp-crested weir flow `Q = 3.33 × L × H^1.5` (cfs, ft) | `weirFlowGpm` |
| Weir lip | Level within 1/8 in across the spill; 1–2 gpm per inch of width minimum | `weirLength` |
| Water wall | Basin at least 6 in deep, autofill and overflow, pump accessible | `deep` |
| Recirculation | Basin volume recirculated in 30–60 minutes; splash loss replaced by autofill | — |
| Freeze | Drain and blow out exterior lines; slope basins to a sump | — |

## 6. Electrical and bonding (NEC 2021 Article 680)

| Rule | Requirement | Suite field |
|---|---|---|
| Overhead conductors | **25 ft** horizontal clearance from the pool edge for conductors up to 750 V; 27 ft for 750 V–15 kV (680.8) | — |
| Receptacles | At least **6 ft** from the pool edge and not more than **20 ft** (680.22(A)) | — |
| Equipotential bonding | #8 copper bonding of shell, deck, metal fittings and water (680.26) | — |
| Pool motors | GFCI protection; disconnect within sight (680.21 / 680.13) | — |
| Luminaires | Listed for pool use; 12 V or GFCI-protected (680.23) | — |
| Deck boxes / junction | At least 4 ft from the pool edge unless listed otherwise | — |
| Water wall / fountain | All electrical equipment listed for wet locations, GFCI protected | — |

## 7. Water chemistry (ANSI/APSP/ICC-11)

| Parameter | Range |
|---|---|
| pH | 7.2 – 7.8 |
| Free chlorine | 1 – 3 ppm (public pools 1 – 5 ppm) |
| Combined chlorine | ≤ 0.5 ppm |
| Total alkalinity | 80 – 120 ppm |
| Calcium hardness | 200 – 400 ppm |
| Cyanuric acid | 30 – 50 ppm (≤ 100 ppm) |
| Salt (salt systems) | 2700 – 3400 ppm |
| Spa temperature | ≤ 104 °F / 40 °C |

## 8. Formulas the suite uses

```
surface area   rectangle w×l · roman w×l minus corners · kidney 0.82×w×l
               lap w×l · circular πr²
volume (m³)    area × average depth          (pool: mean of shallow and deep)
gallons        m³ × 264.172
turnover gpm   gallons ÷ (hours × 60)
pump hp        gpm × head(ft) ÷ (3960 × 0.65)
weir gpm       3.33 × L(ft) × H(ft)^1.5 × 448.831
bather load    surface area ÷ 15 sq ft (shallow) or 20 sq ft (deep)
```

## 9. Design checklist

1. Barrier 48 in, 4 in sphere, self-closing gate with a 54 in latch.
2. Deck 4 ft wide, sloped ¼ in per foot away from the building.
3. Water depth within 3–8 ft; diving pool engineered to the ISPSC envelope.
4. Turnover 6 h pool / 30 min spa / 1 h feature; pump sized from the flow and head.
5. Two suction outlets 3 ft apart with VGB covers; no single-blockable drain.
6. Spa at or below 104 °F with an emergency shut-off and signage.
7. Bonding and GFCI per NEC 680; overhead lines 25 ft clear.
8. Fountains and waterfalls: basin depth, weir level and splash containment.
9. Ponds: 24 in minimum, liner, aeration and a 1:3 bank.
10. Accessible route and pool entry where the site is a public accommodation.
11. Setbacks, impervious cover and barrier equivalency confirmed with the AHJ.

## 10. Source links

- ISPSC 2021: https://codes.iccsafe.org/content/ISPSC2021P1
- ISPSC barriers, Chapter 3: https://codes.iccsafe.org/s/ISPSC2021P1/chapter-3-general-compliance
- IRC 2021 Appendix G: https://up.codes/s/swimming-pools-spas-and-hot-tubs
- NEC 680: https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70
- VGB Act / CPSC: https://www.cpsc.gov/Business--Manufacturing/Statutes-Rules-Regulations/Virginia-Graeme-Baker-Pool-and-Spa-Safety-Act
- ANSI/APSP/ICC-11 water quality: https://www.phta.org/standards-and-codes/
- ADA pool access: https://www.access-board.gov/ada/guides/chapter-10-recreation-facilities/
- Weir flow reference: https://www.engineeringtoolbox.com/weirs-flow-rate-d_592.html
