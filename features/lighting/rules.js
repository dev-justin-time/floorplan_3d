/**
 * Rules and regulations for the lighting and power plan, written for a
 * designer rather than a lawyer. The model code is the 2021 IRC (which adopts
 * the 2020 NEC for electrical) plus the 2021 IECC; local amendments can be
 * stricter and always win.
 */

export const RULE_CATEGORIES = [
    { id: 'lighting', label: 'Lighting & switching' },
    { id: 'receptacles', label: 'Receptacles' },
    { id: 'rooms', label: 'Kitchens & wet rooms' },
    { id: 'power', label: 'Circuits & protection' },
    { id: 'energy', label: 'Energy & quality' },
    { id: 'inspection', label: 'Inspection' }
];

export const CODE_SCOPE = {
    title: '2021 IRC · 2021 IECC · 2020 NEC',
    body: 'Chapter 39 of the 2021 International Residential Code covers receptacle spacing, GFCI/AFCI protection and lighting outlets. The IECC adds efficacy and control requirements. This page is a design aid: confirm the edition and amendments adopted in your jurisdiction, and have the final plan reviewed by a licensed electrician.'
};

export const RULES = [
    {
        id: 'lighting-outlet',
        category: 'lighting',
        title: 'A switched lighting outlet in every habitable room, kitchen and bathroom',
        code: 'IRC 2021 §E3903.2',
        level: 'required',
        summary: 'At least one lighting outlet controlled by a listed wall-mounted control device is required in every habitable room, kitchen and bathroom.',
        requirements: [
            'The lighting outlet is the box and circuit, not the fixture; a luminaire is installed at it later.',
            'The control must be wall mounted and listed; a pull chain or a lamp switch does not satisfy it.',
            'A switched receptacle can satisfy the requirement only where the code allows it, not as a substitute in every room.'
        ],
        checkIds: ['lighting-outlet', 'switch-control'],
        detail: 'Place at least one luminaire, bind it to a switch, and check that the switch sits on the wall by the door. Bedrooms, living rooms, dining rooms, kitchens and bathrooms all need this; closets and storage rooms have their own requirement.'
    },
    {
        id: 'additional-locations',
        category: 'lighting',
        title: 'Hallways, stairways, garages and outdoor entrances',
        code: 'IRC 2021 §E3903.3 · NEC 210.70(A)(2)',
        level: 'required',
        summary: 'Hallways, stairways, attached garages and outdoor entrances need at least one wall-switch-controlled lighting outlet.',
        requirements: [
            'A stairway with six or more risers needs a switch at the top and bottom of the flight.',
            'An outdoor entrance needs a switch inside the door, not only a motion light.',
            'A garage needs a switched light that is not on the door-operator circuit.'
        ],
        checkIds: ['stair-switch', 'switch-entry', 'lighting-outlet'],
        detail: 'The suite gives a stairway two three-way switches automatically. For a long hallway, two three-ways at the ends are a comfort upgrade even where one switch is code-minimum.'
    },
    {
        id: 'switch-location',
        category: 'lighting',
        title: 'Put the switch where the door opens',
        code: 'IRC §E3903.2 · practice',
        level: 'recommended',
        summary: 'A wall control needs to be reachable on entry, on the latch side of the door and clear of the door swing.',
        requirements: [
            'About 1.0–1.5 m from the door opening, at 1.2 m above the floor.',
            'Latch side, so you are not reaching across the door.',
            'Never inside a closet or behind a door that opens against it.',
            'A dimmer or sensor still needs a manual control unless the code exception applies.'
        ],
        checkIds: ['switch-entry'],
        detail: 'The suite warns when the nearest switch is more than 1.6 m from the entry point. Move it to the latch side and keep 100 mm clear of the trim.'
    },
    {
        id: 'receptacle-spacing',
        category: 'receptacles',
        title: 'The 6 ft / 12 ft receptacle rule',
        code: 'IRC 2021 §E3901.2.2',
        level: 'required',
        summary: 'No point along the floor line of a wall space may be more than 6 ft (1.83 m) from a receptacle; in practice, receptacles are no more than 12 ft (3.66 m) apart.',
        requirements: [
            'Wall spaces 2 ft (610 mm) or wider count, including the space between a door and an adjoining wall.',
            'A floor receptacle counts only if it is within 18 in (457 mm) of the wall.',
            'Fixed room dividers and sliding panels create separate wall spaces.',
            'The rule applies in living, dining, bedroom, kitchen, family and similar rooms.'
        ],
        checkIds: ['socket-spacing', 'socket-count'],
        detail: 'The suite places sockets to keep every point within half the configured spacing. The default 3.66 m spacing gives a 1.83 m maximum from a corner and 3.66 m between sockets.'
    },
    {
        id: 'countertop',
        category: 'rooms',
        title: 'Countertop receptacles: 24 in from anywhere',
        code: 'IRC 2021 §E3901.4',
        level: 'required',
        summary: 'Every wall countertop space 12 in (305 mm) or wider needs a receptacle, and no point may be more than 24 in (610 mm) from one.',
        requirements: [
            'Not more than 12 in (305 mm) below the countertop.',
            'Not behind a range, refrigerator or sink; split the counter space around the appliance.',
            'Islands and peninsulas need at least one receptacle, with exceptions for certain small islands.',
            'Every countertop receptacle needs GFCI protection.'
        ],
        checkIds: ['socket-spacing', 'socket-count', 'gfci'],
        detail: 'A 1.83 m spacing on the kitchen preset is a planning approximation of the 600 mm counter rule. Lay out the actual cabinet run and put a receptacle in every 305 mm+ counter segment.'
    },
    {
        id: 'small-appliance',
        category: 'rooms',
        title: 'Two kitchen small-appliance circuits',
        code: 'IRC 2021 §E3901.3',
        level: 'required',
        summary: 'Kitchen countertop receptacles must be supplied by at least two 20 A small-appliance branch circuits.',
        requirements: [
            '20 A, 12 AWG copper, GFCI protected.',
            'No lighting outlets and no other general receptacles on these circuits.',
            'A dining room, breakfast room or pantry receptacle may be on either circuit.',
            'A dedicated appliance circuit (range, dishwasher, disposal) is separate.'
        ],
        checkIds: ['kitchen-circuits', 'circuit-80', 'circuit-overload'],
        detail: 'The suite creates K1 and K2 for a kitchen and splits counter receptacles between them. Keep the lighting on L1 so a tripped appliance circuit does not black out the room.'
    },
    {
        id: 'bathroom',
        category: 'rooms',
        title: 'Bathroom receptacle and light',
        code: 'IRC 2021 §E3901.6 · §E3902.1 · §E3903.2',
        level: 'required',
        summary: 'A bathroom needs a GFCI-protected receptacle within 3 ft of the basin, and a switch-controlled lighting outlet.',
        requirements: [
            'At least one receptacle within 36 in (914 mm) of the outside edge of the basin.',
            'No receptacle inside a tub or shower space, including a compartment.',
            'All 125 V, 15/20 A bathroom receptacles need GFCI protection.',
            'The luminaire must be damp rated, and a fixture over a tub or shower must be wet rated and listed for the location.'
        ],
        checkIds: ['gfci', 'wet-luminaire', 'lighting-outlet'],
        detail: 'Put the vanity on its own 20 A circuit, GFCI at the first receptacle or at the breaker, and light the face from both sides of the mirror instead of straight down.'
    },
    {
        id: 'laundry',
        category: 'rooms',
        title: 'Laundry circuit and GFCI',
        code: 'IRC 2021 §E3901.8 · §E3902.7',
        level: 'required',
        summary: 'A laundry area needs at least one 20 A receptacle circuit, and its receptacles need GFCI protection.',
        requirements: [
            'At least one 20 A laundry branch circuit for the washing machine.',
            'No other outlets on that circuit, with limited exceptions for a laundry light or exhaust fan.',
            'GFCI protection for laundry, utility and bar sink receptacles.',
            'A gas dryer still needs a 120 V receptacle; an electric dryer needs a dedicated 30 A, 240 V circuit.'
        ],
        checkIds: ['gfci', 'socket-count'],
        detail: 'The suite marks a laundry with a GFCI 20 A receptacle and a B/Y circuit. Do not share the laundry circuit with the garage or outdoor receptacles.'
    },
    {
        id: 'outdoor',
        category: 'rooms',
        title: 'Outdoor receptacles and wet-location fixtures',
        code: 'IRC 2021 §E3901.7 · §E3902.3 · NEC 210.52(E)',
        level: 'required',
        summary: 'A one-family dwelling needs at least one outdoor receptacle at the front and one at the back, not more than 6.5 ft above grade, with GFCI, WR rating and an in-use cover.',
        requirements: [
            'GFCI protection for all 125 V, 15/20 A outdoor receptacles.',
            'Weather-resistant (WR) receptacle and an in-use (bubble) cover.',
            'Wet-location luminaires with gasketed boxes; a damp-rated fixture is not enough.',
            'Keep the cover closed on an unused receptacle and drain the box.'
        ],
        checkIds: ['gfci', 'wr', 'wet-luminaire'],
        detail: 'An outdoor switch belongs inside the door; a weatherproof switch on the exterior wall is for a dedicated exterior circuit and still needs a gasketed cover.'
    },
    {
        id: 'garage',
        category: 'rooms',
        title: 'Garage receptacles and lights',
        code: 'IRC 2021 §E3901.9 · §E3902.2',
        level: 'required',
        summary: 'An attached garage needs at least one receptacle and a switched lighting outlet; garage receptacles need GFCI protection.',
        requirements: [
            'At least one 125 V, 15/20 A receptacle in an attached garage.',
            'GFCI protection for garage and accessory-building receptacles.',
            'A switched light that is independent of the door operator.',
            'Keep the panel and its working clearance clear of stored goods.'
        ],
        checkIds: ['gfci', 'lighting-outlet', 'switch-entry'],
        detail: 'A garage shop light on a chain or cable clears the door track. Use a listed fixture and keep the lamp away from flammable storage.'
    },
    {
        id: 'gfci',
        category: 'power',
        title: 'Where GFCI protection is required',
        code: 'IRC 2021 §E3902 · NEC 210.8',
        level: 'required',
        summary: 'GFCI protection is required for receptacles in bathrooms, kitchens, laundry areas, garages, outdoors, crawlspaces, unfinished basements and near sinks.',
        requirements: [
            'Bathrooms, kitchens and countertop surfaces.',
            'Laundry, utility and bar sinks.',
            'Garages and accessory buildings, outdoors, crawlspaces and unfinished basements.',
            'Within 6 ft of a sink, bathtub or shower in other rooms.',
            'GFCI protection can be at the breaker or at the first receptacle; downstream receptacles are then protected.'
        ],
        checkIds: ['gfci'],
        detail: 'A GFCI does not replace the equipment ground and does not protect against a short circuit. Keep the line/load terminals correct or the downstream receptacles will not be protected.'
    },
    {
        id: 'afci',
        category: 'power',
        title: 'AFCI protection for 120 V branch circuits',
        code: 'IRC 2021 §E3902.20 · NEC 210.12',
        level: 'required',
        summary: 'Most 120 V, single-phase, 15 and 20 A branch circuits supplying outlets in a dwelling need combination-type AFCI protection.',
        requirements: [
            'Living, dining, bedrooms, closets, hallways, laundry, kitchen and similar areas.',
            'Use a combination-type AFCI breaker at the origin of the circuit.',
            'An outlet-branch AFCI is an alternative only where the code permits it.',
            'Label the panel clearly; an AFCI trip is a diagnostic, not a nuisance to bypass.'
        ],
        checkIds: ['afci'],
        detail: 'The suite records ACI as an advisory because the breaker type is chosen at the panel, not on the plan. Mark every 120 V branch as AFCI on the panel schedule.'
    },
    {
        id: 'circuits',
        category: 'power',
        title: 'Do not overload a branch circuit',
        code: 'IRC 2021 §E3905 · NEC 210.19–210.23',
        level: 'required',
        summary: 'The connected load must stay within the branch-circuit rating; continuous loads are limited to 80% of the breaker.',
        requirements: [
            '15 A lighting circuit: 14 AWG copper, typically 12 A of continuous load.',
            '20 A receptacle circuit: 12 AWG copper, 16 A of continuous load.',
            'General receptacles count 180 VA each for the calculation.',
            'A dedicated appliance is sized from its nameplate, not a rule of thumb.'
        ],
        checkIds: ['circuit-80', 'circuit-overload', 'circuit-missing'],
        detail: 'The suite warns above 80% and fails above 100%. It does not perform a service load calculation; add the range, dryer, water heater and EV charger before sizing the service.'
    },
    {
        id: 'boxes',
        category: 'power',
        title: 'Box fill and cable support',
        code: 'IRC 2021 §E3905.12 · NEC 314.16',
        level: 'required',
        summary: 'Every box needs enough cubic-inch capacity for its conductors, clamps, grounding and device, and cable must be supported and protected.',
        requirements: [
            'Count each current-carrying conductor, the grounded conductor and the equipment ground.',
            'Add one allowance for the device and one for internal clamps.',
            'A 2-1/8 in deep single-gang box is not automatically large enough for two 12/2 cables plus a dimmer.',
            'Support cable within 12 in of a box and every 4.5 ft; protect it where it passes through framing.',
            'Use a listed connector and never strip more sheath than needed inside the box.'
        ],
        checkIds: [],
        detail: 'The suite counts one box per device for pricing, not box fill. Check the fill calculation on a crowded switch box, especially with smart dimmers that have a large body.'
    },
    {
        id: 'ic-fire',
        category: 'power',
        title: 'IC, airtight and fire-rated recessed luminaires',
        code: 'IRC 2021 §E3904 · NEC 410.116 · listed instructions',
        level: 'required',
        summary: 'A recessed luminaire in an insulated ceiling must be IC rated; in a fire-resistance-rated assembly it must be listed for the assembly.',
        requirements: [
            'IC-rated and airtight for a ceiling that touches insulation.',
            'Non-IC cans need a clearance box or the insulation kept clear; the instructions govern.',
            'A fire-rated ceiling needs a fire-rated luminaire or a listed protection of the membrane.',
            'Do not bury a driver or junction box under insulation unless it is listed for it.'
        ],
        checkIds: ['ic-rating', 'fire-rating'],
        detail: 'The suite warns when a recessed fitting lacks IC or fire rating. A surface fixture avoids the ceiling penetration entirely, at the cost of ceiling height.'
    },
    {
        id: 'damp-wet',
        category: 'power',
        title: 'Damp and wet location ratings',
        code: 'IRC 2021 §E3904 · NEC 410.10',
        level: 'required',
        summary: 'Bathrooms, covered porches and other damp locations need damp-rated luminaires; exposed outdoor locations need wet-rated luminaires and boxes.',
        requirements: [
            'A damp location is protected from weather but may be wet; a wet location is exposed.',
            'Use gasketed, listed fixtures and boxes outdoors.',
            'A luminaire over a tub or shower must be wet rated and listed for the application.',
            'Keep the driver and connections inside the listed enclosure, not in the wall cavity.'
        ],
        checkIds: ['wet-luminaire'],
        detail: 'The suite treats bathrooms as damp and the outdoor entry as wet. A recessed downlight over a shower needs a wet-location listing even though the rest of the bathroom only needs damp.'
    },
    {
        id: 'energy-controls',
        category: 'energy',
        title: 'Dimmer or occupant sensor in habitable spaces',
        code: 'IECC 2021 §R404.2 · IRC §N1104.2',
        level: 'required',
        summary: 'Permanently installed lighting in habitable spaces needs a dimmer, an occupant sensor or an equivalent control.',
        requirements: [
            'Applies to living, sleeping, eating and cooking spaces.',
            'A simple on/off switch may not satisfy the control requirement.',
            'Some fixtures have the control built in; document it.',
            'Commission the dimmer with the actual LED load and confirm no flicker or buzz.'
        ],
        checkIds: ['energy-controls'],
        detail: 'The suite auto-selects a dimmer where the room preset asks for one. A smart dimmer may need a neutral at the switch box; check before the cable is pulled.'
    },
    {
        id: 'efficacy',
        category: 'energy',
        title: 'High-efficacy sources only',
        code: 'IECC 2021 §R404.1',
        level: 'required',
        summary: 'Permanently installed luminaires must contain only high-efficacy sources, in practice 65 lm/W or better.',
        requirements: [
            'All catalog luminaires in this suite are LED and exceed the threshold.',
            'A screw-in lamp in a permanently installed fixture counts; choose the lamp as carefully as the fixture.',
            'Kitchen appliance lighting and some specialty fixtures have limited exceptions.',
            'Keep the cut sheet to prove efficacy and CCT at inspection.'
        ],
        checkIds: ['efficacy', 'lpd'],
        detail: 'The suite reports installed lumens per watt. A luminaire with a poor driver can be under 65 lm/W even with good LED chips, so use the fixture cut sheet rather than the lamp claim.'
    },
    {
        id: 'quality',
        category: 'energy',
        title: 'Design quality targets beyond the code',
        code: 'Good practice · not a code minimum',
        level: 'recommended',
        summary: 'Code sets safety, not comfort. Target 150–300 lx for living and bedrooms, 300–500 lx on a kitchen worktop, CRI 90+ and one CCT per room.',
        requirements: [
            'Average illuminance at the work plane, not at the ceiling.',
            'Uniformity of 0.40 or better; keep the max-to-average ratio under 3.',
            'CRI 90+ and R9 for wood, fabric and skin.',
            'Layer ambient, task and accent, and dim each layer separately.',
            'Keep the CCT range within 500 K across one open view.'
        ],
        checkIds: ['target', 'target-low', 'target-high', 'uniformity', 'cri', 'cct-mix', 'task-layer'],
        detail: 'The suite scores these as advisory checks. A room can pass every code check and still feel flat; use the heatmap and the layer balance to judge the design.'
    },
    {
        id: 'working-clearance',
        category: 'inspection',
        title: 'Panel and equipment working clearance',
        code: 'IRC 2021 §E3405 · NEC 110.26',
        level: 'required',
        summary: 'Keep a clear working space in front of the panel and service equipment: typically 30 in wide, 36 in deep and 6 ft 6 in high.',
        requirements: [
            'The space must be clear from floor to the required height, not shelved over.',
            'Do not place the panel in a closet or behind a door swing.',
            'A panel in a garage needs protection from vehicle impact.',
            'Label every circuit clearly and keep the directory current.'
        ],
        checkIds: [],
        detail: 'This plan puts a panel marker at the lower-left corner. Move it to a real wall with clear access before construction; the suite does not model the service room.'
    },
    {
        id: 'inspection',
        category: 'inspection',
        title: 'What the inspector will want to see',
        code: 'Plan review and rough-in',
        level: 'required',
        summary: 'A clear plan, a panel schedule, box fill and cable support, and evidence that every required outlet is present.',
        requirements: [
            'Dimensioned plan with every receptacle, switch, luminaire and circuit identified.',
            'Panel schedule with breaker size, circuit type, AFCI/GFCI and connected load.',
            'Cut sheets for luminaires, dimmers and any smart control.',
            'Rough-in photos before insulation and drywall, especially at boxes and fire-rated ceilings.',
            'GFCI/AFCI test and a written dimmer compatibility check.'
        ],
        checkIds: ['circuit-missing', 'switch-control', 'lighting-outlet'],
        detail: 'Export the schedule CSV and the takeoff from this suite as the basis for the electrical plan. Have a licensed electrician review and stamp the final drawing set.'
    }
];

export function rulesByCategory() {
    return RULE_CATEGORIES.map((category) => ({
        ...category,
        rules: RULES.filter((rule) => rule.category === category.id)
    }));
}

export function searchRules(query) {
    const term = String(query || '').trim().toLowerCase();
    if (!term) return RULES;
    return RULES.filter((rule) => [
        rule.title, rule.code, rule.summary, rule.detail,
        ...(rule.requirements || [])
    ].join(' ').toLowerCase().includes(term));
}

export function ruleStatus(rule, checks = []) {
    if (!rule.checkIds?.length) return { state: 'info', label: 'Review' };
    const related = checks.filter((check) => rule.checkIds.includes(check.id));
    if (!related.length) return { state: 'info', label: 'Not modelled' };
    if (related.some((check) => check.severity === 'error')) return { state: 'error', label: 'Fix' };
    if (related.some((check) => check.severity === 'warn')) return { state: 'warn', label: 'Review' };
    if (related.every((check) => check.severity === 'info')) return { state: 'info', label: 'Note' };
    return { state: 'ok', label: 'Pass' };
}

export const RULE_LEVEL_LABEL = {
    required: 'Required',
    recommended: 'Recommended',
    energy: 'Energy code'
};
