#!/usr/bin/env python3
"""floorplan3d core features: geometry, takeoffs, framing, stairs, deck, roof,
electrical, cut list and wireframe export.

This is the Python member of ports/. It reads the same plan JSON and prints the
same canonical result JSON as ports/rust and ports/lua, so ports/run-parity.mjs
can diff them.

Usage: python floorplan_core.py <plan.json>
"""

import json
import math
import sys

IN = 0.0254
FT = 12 * IN
M2_PER_SQFT = 0.09290304
DRYWALL_SHEET_M2 = 2.4 * 1.2
SQFT_PER_SQUARE = 100.0
CONCRETE_BAG_M3 = 0.017
FNV_OFFSET = 0x811C9DC5
FNV_PRIME = 0x01000193
MASK32 = 0xFFFFFFFF

MAX_RISER_MM = 196.0
MIN_TREAD_MM = 254.0
MIN_WIDTH_MM = 914.0
COMFORT_TARGET = 25 * IN
COMFORT_MIN = 24 * IN
COMFORT_MAX = 25 * IN
MAX_TREAD = 0.36

# NDS reference design values in psi: Fb bending, Fv shear, E modulus. The keys
# match the species list on the site's span calculator; values are NDS Supplement
# reference values for visually graded dimension lumber at 19% moisture content and
# normal load duration. No adjustment factors (Cd, Cr, CM, CL) are applied.
SPECIES = {
    "dfl-1": (1000.0, 180.0, 1700000.0),
    "dfl-2": (900.0, 180.0, 1600000.0),
    "sp-1": (1150.0, 175.0, 1600000.0),
    "sp-2": (850.0, 175.0, 1400000.0),
    "spf-1": (875.0, 135.0, 1400000.0),
    "spf-2": (775.0, 135.0, 1300000.0),
}

# Dressed width and depth in inches for a nominal lumber size.
SECTIONS = {
    "1x4": (0.75, 3.5),
    "1x6": (0.75, 5.5),
    "1x8": (0.75, 7.25),
    "2x2": (1.5, 1.5),
    "2x4": (1.5, 3.5),
    "2x6": (1.5, 5.5),
    "2x8": (1.5, 7.25),
    "2x10": (1.5, 9.25),
    "2x12": (1.5, 11.25),
    "4x4": (3.5, 3.5),
    "6x6": (5.5, 5.5),
    "5/4x6": (1.0, 5.5),
}

SOIL_PSF = {"clay": 1500, "sand": 3000, "gravel": 3000, "silt": 1500}
DEFAULT_SOIL_PSF = 2000
DECK_LOAD_PSF = 50.0
SERVICE_SIZES = [100, 125, 150, 200, 225, 320, 400]


# --- helpers ---------------------------------------------------------------

def r3(value):
    """Round to three decimals, half away from zero. Same in all three ports."""
    scaled = value * 1000.0
    rounded = math.floor(scaled + 0.5) if scaled >= 0 else math.ceil(scaled - 0.5)
    return rounded / 1000.0


def clamp(value, low, high):
    return max(low, min(high, value))


def f3(value):
    """Canonical number text: integers without a decimal point, else 3 decimals."""
    value = r3(value)
    if value == int(value):
        return str(int(value))
    return "%.3f" % value


def jstr(text):
    out = ['"']
    for ch in str(text):
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\n":
            out.append("\\n")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def jobj(pairs):
    return "{" + ",".join(jstr(k) + ":" + v for k, v in pairs) + "}"


def jarr(items):
    return "[" + ",".join(items) + "]"


def flag(value):
    return "true" if value else "false"


# --- geometry --------------------------------------------------------------

def polygon_area(points):
    total = 0.0
    count = len(points)
    for i in range(count):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % count]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def polygon_perimeter(points):
    total = 0.0
    count = len(points)
    for i in range(count):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % count]
        dx, dy = x2 - x1, y2 - y1
        total += math.sqrt(dx * dx + dy * dy)
    return total


def polygon_centroid(points):
    count = len(points)
    twice = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(count):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % count]
        cross = x1 * y2 - x2 * y1
        twice += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(twice) < 1e-12:
        sx = sum(p[0] for p in points) / count if count else 0.0
        sy = sum(p[1] for p in points) / count if count else 0.0
        return (sx, sy)
    return (cx / (3.0 * twice), cy / (3.0 * twice))


def wall_metrics(wall, default_height):
    x1, y1 = float(wall["x1"]), float(wall["y1"])
    x2, y2 = float(wall["x2"]), float(wall["y2"])
    height = float(wall.get("height", default_height))
    dx, dy = x2 - x1, y2 - y1
    length = math.sqrt(dx * dx + dy * dy)
    angle = math.degrees(math.atan2(y2 - y1, x2 - x1)) % 360.0
    gross = length * height
    openings = [o for o in wall.get("openings", [])]
    opening_area = sum(float(o["width"]) * float(o["height"]) for o in openings)
    opening_area = min(opening_area, gross)
    return {
        "length": length,
        "angle": angle,
        "height": height,
        "gross": gross,
        "openings": opening_area,
        "net": gross - opening_area,
        "openingWidths": sum(float(o["width"]) for o in openings),
        "openingCount": len(openings),
    }


# --- feature sections ------------------------------------------------------

def build_rooms(plan):
    rooms = []
    for room in plan.get("rooms", []):
        points = [(float(p[0]), float(p[1])) for p in room["polygon"]]
        area = polygon_area(points)
        perimeter = polygon_perimeter(points)
        centroid = polygon_centroid(points)
        height = float(room.get("height", plan.get("wallHeight", 2.7)))
        rooms.append({
            "name": room.get("name", "Room"),
            "area": area,
            "perimeter": perimeter,
            "centroid": centroid,
            "height": height,
            "volume": area * height,
        })
    return rooms


def build_finishes(rooms, walls, plan):
    net_area = sum(w["net"] for w in walls)
    ceiling = sum(r["area"] for r in rooms)
    drywall = math.ceil((net_area + ceiling) / DRYWALL_SHEET_M2 - 1e-9) if net_area + ceiling > 0 else 0
    paint = math.ceil(((net_area + ceiling) * 2.0) / 10.0 - 1e-9) if net_area + ceiling > 0 else 0
    waste = float(plan.get("wastePct", 10.0)) / 100.0
    flooring = ceiling * (1.0 + waste)
    baseboard = sum(r["perimeter"] for r in rooms) - sum(w["openingWidths"] for w in walls)
    return {
        "wallNetArea": net_area,
        "ceilingArea": ceiling,
        "drywallSheets": drywall,
        "paintLitres": paint,
        "flooringM2": max(0.0, flooring),
        "baseboardM": max(0.0, baseboard),
    }


def build_framing(wall_metrics_list, plan):
    spacing = float(plan.get("studSpacingMm", 406.0))
    studs_by_wall = []
    studs = 0
    for w in wall_metrics_list:
        run = math.floor(w["length"] * 1000.0 / spacing + 1e-9) + 1
        run += 2 * w["openingCount"]
        studs_by_wall.append(run)
        studs += run
    plates = sum(w["length"] for w in wall_metrics_list) * 3.0
    gross = sum(w["gross"] for w in wall_metrics_list)
    panels = math.ceil(gross / DRYWALL_SHEET_M2 - 1e-9) if gross > 0 else 0
    return {
        "spacingMm": spacing,
        "studs": studs,
        "studsByWall": studs_by_wall,
        "plates": plates,
        "sheathingPanels": panels,
    }


def build_sizing(plan):
    """NDS member check: simply supported, uniformly loaded, strong axis."""
    sizing = plan.get("sizing", {})
    default_species = str(sizing.get("species", "spf-2"))
    default_limit = float(sizing.get("limit", 360.0))
    members = []

    for member in sizing.get("members", []):
        size = str(member.get("size", ""))
        if size not in SECTIONS:
            continue  # unknown nominal size: nothing to size
        b, d = SECTIONS[size]
        species = str(member.get("species", default_species))
        if species not in SPECIES:
            species = "spf-2"
        fb, fv, e = SPECIES[species]
        load = float(member.get("load", 0.0))
        spacing = float(member.get("spacing", 0.0))
        span = float(member.get("span", 0.0))
        limit = float(member.get("limit", default_limit))

        area = b * d
        section_modulus = b * d * d / 6.0
        inertia = b * d * d * d / 12.0
        # Uniform load along the member, lb per inch of span.
        distributed = load * (spacing / FT) / 12.0

        bending = shear = deflection = 0.0
        allowable = 0.0
        governing = "none"
        passed = False

        if distributed > 0:
            # M = wL^2/8 and fb = M/S  =>  L = sqrt(8 Fb S / w).
            bending = math.sqrt(8.0 * fb * section_modulus / distributed) * IN
            # V = wL/2 and fv = 1.5 V/A  =>  L = 4 Fv A / (3 w).
            shear = 4.0 * fv * area / (3.0 * distributed) * IN
            # delta = 5wL^4/(384EI) <= L/limit  =>  L = cbrt(384 E I / (5 limit w)).
            deflection = (384.0 * e * inertia / (5.0 * limit * distributed)) ** (1.0 / 3.0) * IN

            allowable = bending
            governing = "bending"
            if shear < allowable:
                allowable = shear
                governing = "shear"
            if deflection < allowable:
                allowable = deflection
                governing = "deflection"
            passed = span <= allowable + 1e-9

        members.append({
            "id": str(member.get("id", "")),
            "group": str(member.get("group", "framing")),
            "size": size,
            "species": species,
            "b": b,
            "d": d,
            "area": area,
            "sectionModulus": section_modulus,
            "inertia": inertia,
            "load": load,
            "spacing": spacing,
            "span": span,
            "limit": limit,
            "plf": distributed * 12.0,
            "bending": bending,
            "shear": shear,
            "deflection": deflection,
            "allowable": allowable,
            "governing": governing,
            "pass": passed,
        })
    return members


def sized_json(member):
    return jobj([
        ("id", jstr(member["id"])),
        ("group", jstr(member["group"])),
        ("size", jstr(member["size"])),
        ("species", jstr(member["species"])),
        ("bIn", f3(member["b"])),
        ("dIn", f3(member["d"])),
        ("areaIn2", f3(member["area"])),
        ("sectionModulusIn3", f3(member["sectionModulus"])),
        ("inertiaIn4", f3(member["inertia"])),
        ("loadPsf", f3(member["load"])),
        ("spacing", f3(member["spacing"])),
        ("span", f3(member["span"])),
        ("plf", f3(member["plf"])),
        ("limit", f3(member["limit"])),
        ("bendingSpan", f3(member["bending"])),
        ("shearSpan", f3(member["shear"])),
        ("deflectionSpan", f3(member["deflection"])),
        ("allowableSpan", f3(member["allowable"])),
        ("governing", jstr(member["governing"])),
        ("pass", flag(member["pass"])),
    ])


def sizing_json(members, group):
    """The sized members of one suite, in input order."""
    chosen = [m for m in members if m["group"] == group]
    return jobj([
        ("count", str(len(chosen))),
        ("pass", flag(all(m["pass"] for m in chosen))),
        ("members", jarr([sized_json(m) for m in chosen])),
    ])


def build_stairs(stairs):
    rise = float(stairs.get("rise", 0.0))
    width = float(stairs.get("width", 0.0))
    run_available = float(stairs.get("runAvailable", 0.0))

    max_riser = MAX_RISER_MM / 1000.0
    min_tread = MIN_TREAD_MM / 1000.0
    risers = max(3, math.ceil(rise / max_riser - 1e-9))
    riser_height = rise / risers
    treads = risers - 1
    ideal = clamp(COMFORT_TARGET - 2.0 * riser_height, min_tread, MAX_TREAD)
    tread = ideal
    if run_available > 0:
        tread = clamp(run_available / treads, 0.0, MAX_TREAD)
    run = tread * treads
    stringer = math.sqrt(rise * rise + run * run)
    two_r_plus_t = 2.0 * riser_height + tread
    checks = {
        "riser": riser_height <= max_riser + 1e-9,
        "tread": tread >= min_tread - 1e-9,
        "width": width >= MIN_WIDTH_MM / 1000.0 - 1e-9,
        "comfort": COMFORT_MIN - 1e-9 <= two_r_plus_t <= COMFORT_MAX + 1e-9,
    }
    return {
        "risers": risers,
        "riserHeight": riser_height,
        "treads": treads,
        "tread": tread,
        "run": run,
        "runAvailable": run_available,
        "totalRise": rise,
        "stringer": stringer,
        "width": width,
        "twoRPlusT": two_r_plus_t,
        "checks": checks,
        "pass": all(checks.values()),
    }


def build_deck(deck):
    joist_span = float(deck.get("joistSpan", 0.0))
    joist_spacing = float(deck.get("joistSpacing", 0.406))
    post_spacing = float(deck.get("postSpacing", 0.0))
    soil = str(deck.get("soil", "default"))
    soil_psf = SOIL_PSF.get(soil, DEFAULT_SOIL_PSF)
    depth = float(deck.get("depth", 0.9))
    width = float(deck.get("width", 0.0))

    joist_count = math.floor(joist_span / joist_spacing + 1e-9) + 1
    post_load_lb = math.floor(
        DECK_LOAD_PSF * (post_spacing / FT) * (joist_span / FT) / 2.0 + 0.5
    )
    footing_area_ft2 = post_load_lb / soil_psf
    required_diameter = 12.0 * math.sqrt(max(0.0, 4.0 * footing_area_ft2 / math.pi))
    diameter_in = max(12.0, math.ceil(required_diameter - 1e-9))
    volume = math.pi / 4.0 * (diameter_in * IN) ** 2 * depth
    bags = math.ceil(volume / CONCRETE_BAG_M3 - 1e-9) if volume > 0 else 0
    boards = math.ceil(width * 1000.0 / (140.0 + 5.0) - 1e-9) if width > 0 else 0

    return {
        "joistSpan": joist_span,
        "joistSpacing": joist_spacing,
        "joistCount": joist_count,
        "postSpacing": post_spacing,
        "postLoadLb": post_load_lb,
        "soil": soil,
        "soilPsf": soil_psf,
        "footingDiameterIn": float(diameter_in),
        "footingVolume": volume,
        "concreteBags": bags,
        "boards": boards,
    }


def build_roof(roof):
    plan_area = float(roof.get("planArea", 0.0))
    pitch = float(roof.get("pitch", 0.0))
    slope_factor = math.sqrt(1.0 + (pitch / 12.0) ** 2)
    roof_area = plan_area * slope_factor
    squares = roof_area / (SQFT_PER_SQUARE * M2_PER_SQFT)
    bundles = math.ceil(squares * 3.0 - 1e-9) if squares > 0 else 0
    return {
        "planArea": plan_area,
        "pitch": pitch,
        "slopeFactor": slope_factor,
        "angle": math.degrees(math.atan(pitch / 12.0)),
        "roofArea": roof_area,
        "squares": squares,
        "bundles": bundles,
    }


def build_electrical(electrical):
    area_m2 = float(electrical.get("areaM2", 0.0))
    sabc = int(electrical.get("smallApplianceCircuits", 0))
    laundry = int(electrical.get("laundryCircuits", 0))
    appliances = float(electrical.get("appliancesVa", 0.0))
    heating = float(electrical.get("heatingVa", 0.0))
    cooling = float(electrical.get("coolingVa", 0.0))

    area_ft2 = area_m2 / M2_PER_SQFT
    general = area_ft2 * 3.0
    sabc_va = sabc * 1500.0
    laundry_va = laundry * 1500.0
    subtotal = general + sabc_va + laundry_va

    # NEC 220.42 tiers: first 3000 VA at 100%, to 120000 at 35%, over at 25%.
    first = min(subtotal, 3000.0)
    second = clamp(subtotal, 3000.0, 120000.0) - 3000.0
    third = max(0.0, subtotal - 120000.0)
    demand = first * 1.0 + second * 0.35 + third * 0.25

    appliance_demand = appliances * 0.75
    hvac = max(heating, cooling)
    total = demand + appliance_demand + hvac
    amps = math.ceil(total / 240.0 - 1e-9) if total > 0 else 0
    service = next((s for s in SERVICE_SIZES if s >= amps), SERVICE_SIZES[-1])

    optional_base = general + sabc_va + laundry_va + appliances
    optional = min(optional_base, 10000.0) + max(0.0, optional_base - 10000.0) * 0.40 + hvac
    optional_amps = math.ceil(optional / 240.0 - 1e-9) if optional > 0 else 0

    return {
        "areaM2": area_m2,
        "areaFt2": area_ft2,
        "generalVa": general,
        "sabcVa": sabc_va,
        "laundryVa": laundry_va,
        "serviceDemandVa": demand,
        "applianceVa": appliance_demand,
        "hvacVa": hvac,
        "totalVa": total,
        "amps": float(amps),
        "serviceAmps": float(service),
        "optionalVa": optional,
        "optionalAmps": float(optional_amps),
    }


def build_cut_list(fixtures):
    groups = {}
    order = []
    for fixture in fixtures:
        if not fixture:
            continue
        kind = str(fixture.get("type", "item"))
        width = r3(float(fixture.get("width", 0.0)))
        depth = r3(float(fixture.get("depth", 0.0)))
        height = r3(float(fixture.get("height", 0.0)))
        key = (kind, width, depth, height)
        if key not in groups:
            groups[key] = {
                "type": kind,
                "label": str(fixture.get("label", kind.replace("_", " "))),
                "width": width,
                "depth": depth,
                "height": height,
                "ids": [],
            }
            order.append(key)
        groups[key]["ids"].append(str(fixture.get("id", "")))
    rows = [groups[key] for key in order]
    rows.sort(key=lambda row: (row["type"], row["width"], row["depth"], row["height"]))
    return rows


def cut_list_csv(rows):
    lines = ["type,label,count,width_m,depth_m,height_m"]
    for row in rows:
        lines.append(
            "%s,%s,%d,%.3f,%.3f,%.3f"
            % (row["type"], row["label"], len(row["ids"]), row["width"], row["depth"], row["height"])
        )
    return "\n".join(lines)


def fnv1a32(text):
    """FNV-1a 32-bit: a Lua build may only have 32-bit integers (fengari does)."""
    value = FNV_OFFSET
    for byte in text.encode("utf-8"):
        value ^= byte
        value = (value * FNV_PRIME) & MASK32
    return value


def build_wireframe(wall_metrics_list, walls, depth):
    obj_lines = []
    vertices = 0
    edges = 0
    for wall in walls:
        x1, y1 = float(wall["x1"]), float(wall["y1"])
        x2, y2 = float(wall["x2"]), float(wall["y2"])
        obj_lines.append("v %.3f %.3f %.3f" % (x1, y1, 0.0))
        obj_lines.append("v %.3f %.3f %.3f" % (x2, y2, 0.0))
        obj_lines.append("v %.3f %.3f %.3f" % (x1, y1, depth))
        obj_lines.append("v %.3f %.3f %.3f" % (x2, y2, depth))
        base = vertices
        obj_lines.append("l %d %d" % (base + 1, base + 2))
        obj_lines.append("l %d %d" % (base + 3, base + 4))
        obj_lines.append("l %d %d" % (base + 1, base + 3))
        obj_lines.append("l %d %d" % (base + 2, base + 4))
        vertices += 4
        edges += 4
    text = "\n".join(obj_lines)
    return {
        "vertices": vertices,
        "edges": edges,
        "objHash": "%08x" % fnv1a32(text),
    }


# --- shared helpers --------------------------------------------------------

def round_to(value, digits):
    """Round half up at `digits`, the way the suites' round(value, digits) does."""
    factor = 10.0 ** digits
    return math.floor(value * factor + 0.5) / factor


# --- plumbing ---------------------------------------------------------------

# features/plumbing/catalog.js: supply fixture units, drainage fixture units,
# fixture drain size, IPC trap-arm limit and connected gas input.
FIXTURE_TYPES = {
    "toilet": {"group": "bath", "cold": 2.5, "hot": 0.0, "dfu": 3.0, "drain": "3", "trapArmMax": 1.8, "btu": 0.0},
    "lavatory": {"group": "bath", "cold": 0.7, "hot": 0.7, "dfu": 1.0, "drain": "1-1/4", "trapArmMax": 1.5, "btu": 0.0},
    "bathtub": {"group": "bath", "cold": 0.7, "hot": 0.7, "dfu": 2.0, "drain": "2", "trapArmMax": 1.8, "btu": 0.0},
    "shower": {"group": "bath", "cold": 0.7, "hot": 0.7, "dfu": 2.0, "drain": "2", "trapArmMax": 1.8, "btu": 0.0},
    "bidet": {"group": "bath", "cold": 0.7, "hot": 0.7, "dfu": 1.0, "drain": "1-1/4", "trapArmMax": 1.5, "btu": 0.0},
    "kitchen-sink": {"group": "kitchen", "cold": 0.7, "hot": 0.7, "dfu": 2.0, "drain": "2", "trapArmMax": 1.5, "btu": 0.0},
    "dishwasher": {"group": "kitchen", "cold": 0.0, "hot": 1.0, "dfu": 2.0, "drain": "1-1/2", "trapArmMax": 1.5, "btu": 0.0},
    "bar-sink": {"group": "kitchen", "cold": 0.7, "hot": 0.7, "dfu": 1.0, "drain": "1-1/4", "trapArmMax": 1.5, "btu": 0.0},
    "washing-machine": {"group": "laundry", "cold": 0.7, "hot": 0.7, "dfu": 2.0, "drain": "2", "trapArmMax": 1.8, "btu": 0.0},
    "laundry-sink": {"group": "laundry", "cold": 0.7, "hot": 0.7, "dfu": 2.0, "drain": "1-1/2", "trapArmMax": 1.5, "btu": 0.0},
    "utility-sink": {"group": "utility", "cold": 0.7, "hot": 0.7, "dfu": 2.0, "drain": "1-1/2", "trapArmMax": 1.5, "btu": 0.0},
    "floor-drain": {"group": "utility", "cold": 0.0, "hot": 0.0, "dfu": 2.0, "drain": "2", "trapArmMax": 2.0, "btu": 0.0},
    "hose-bib": {"group": "outdoor", "cold": 2.5, "hot": 0.0, "dfu": 0.0, "drain": "", "trapArmMax": 0.0, "btu": 0.0},
    "gas-range": {"group": "kitchen", "cold": 0.0, "hot": 0.0, "dfu": 0.0, "drain": "", "trapArmMax": 0.0, "btu": 65000.0},
    "gas-dryer": {"group": "laundry", "cold": 0.0, "hot": 0.0, "dfu": 0.0, "drain": "", "trapArmMax": 0.0, "btu": 22000.0},
    "gas-furnace": {"group": "utility", "cold": 0.0, "hot": 0.0, "dfu": 0.0, "drain": "", "trapArmMax": 0.0, "btu": 100000.0},
    "gas-grill": {"group": "outdoor", "cold": 0.0, "hot": 0.0, "dfu": 0.0, "drain": "", "trapArmMax": 0.0, "btu": 40000.0},
    "gas-fireplace": {"group": "utility", "cold": 0.0, "hot": 0.0, "dfu": 0.0, "drain": "", "trapArmMax": 0.0, "btu": 45000.0},
    "water-heater": {"group": "utility", "cold": 0.0, "hot": 0.0, "dfu": 0.0, "drain": "", "trapArmMax": 0.0, "btu": 0.0},
}

WATER_SIZES = [
    {"id": "1/2", "pex": 0.475, "copper": 0.545, "maxWsfu": 6.0, "maxServiceWsfu": 8.0},
    {"id": "3/4", "pex": 0.671, "copper": 0.785, "maxWsfu": 12.0, "maxServiceWsfu": 18.0},
    {"id": "1", "pex": 0.863, "copper": 0.995, "maxWsfu": 25.0, "maxServiceWsfu": 35.0},
    {"id": "1-1/4", "pex": 1.054, "copper": 1.245, "maxWsfu": 45.0, "maxServiceWsfu": 60.0},
    {"id": "1-1/2", "pex": 1.244, "copper": 1.481, "maxWsfu": 75.0, "maxServiceWsfu": 100.0},
    {"id": "2", "pex": 1.589, "copper": 1.959, "maxWsfu": 130.0, "maxServiceWsfu": 180.0},
]

DWV_SIZES = [
    {"id": "1-1/4", "branchDfu": 1.0, "stackDfu": 2.0, "mainDfu": 1.0, "minSlope": 0.02},
    {"id": "1-1/2", "branchDfu": 3.0, "stackDfu": 5.0, "mainDfu": 3.0, "minSlope": 0.02},
    {"id": "2", "branchDfu": 6.0, "stackDfu": 10.0, "mainDfu": 6.0, "minSlope": 0.02},
    {"id": "3", "branchDfu": 20.0, "stackDfu": 30.0, "mainDfu": 42.0, "minSlope": 0.02},
    {"id": "4", "branchDfu": 100.0, "stackDfu": 160.0, "mainDfu": 160.0, "minSlope": 0.01},
]

GAS_SIZES = [
    {"id": "1/2", "capacity10": 130.0},
    {"id": "3/4", "capacity10": 280.0},
    {"id": "1", "capacity10": 520.0},
    {"id": "1-1/4", "capacity10": 1100.0},
    {"id": "1-1/2", "capacity10": 1600.0},
    {"id": "2", "capacity10": 3000.0},
]


def fixture_type(type_id):
    return FIXTURE_TYPES.get(type_id, FIXTURE_TYPES["toilet"])


def water_size(size_id):
    for entry in WATER_SIZES:
        if entry["id"] == size_id:
            return entry
    return WATER_SIZES[1]


def dwv_size(size_id):
    for entry in DWV_SIZES:
        if entry["id"] == size_id:
            return entry
    return DWV_SIZES[2]


def dwv_index(size_id):
    for index, entry in enumerate(DWV_SIZES):
        if entry["id"] == size_id:
            return index
    return -1


def gas_size(size_id):
    for entry in GAS_SIZES:
        if entry["id"] == size_id:
            return entry
    return GAS_SIZES[0]


def water_pipe_diameter(size_id, material):
    size = water_size(size_id)
    return size["copper"] if material == "copper" else size["pex"]


DEMAND_CURVE = [
    (1.0, 1.0), (2.0, 1.5), (3.0, 2.5), (4.0, 3.2), (5.0, 3.8), (6.0, 4.4),
    (8.0, 5.2), (10.0, 5.8), (15.0, 6.8), (20.0, 7.6), (25.0, 8.4), (30.0, 9.2),
    (40.0, 10.4), (50.0, 11.5), (75.0, 13.5), (100.0, 15.5), (150.0, 18.5),
    (200.0, 21.0),
]


def demand_for_wsfu(wsfu):
    """Hunter-style demand curve (gpm), linearly interpolated."""
    value = max(wsfu, 0.0)
    if value <= 0:
        return 0.0
    if value <= DEMAND_CURVE[0][0]:
        return DEMAND_CURVE[0][1]
    for index in range(1, len(DEMAND_CURVE)):
        x1, y1 = DEMAND_CURVE[index - 1]
        x2, y2 = DEMAND_CURVE[index]
        if value <= x2:
            return round_to(y1 + ((value - x1) / (x2 - x1)) * (y2 - y1), 2)
    return DEMAND_CURVE[-1][1]


def velocity_fps(gpm, diameter_in):
    if not gpm > 0 or not diameter_in > 0:
        return 0.0
    return round_to(0.4085 * gpm / (diameter_in * diameter_in), 2)


def friction_psi(gpm, diameter_in, length_m, c=150.0):
    """Hazen-Williams friction loss in psi over a length in metres."""
    if not gpm > 0 or not diameter_in > 0 or not length_m > 0:
        return 0.0
    length_ft = length_m / 0.3048
    return round_to(
        4.52 * gpm ** 1.852 * length_ft / (c ** 1.852 * diameter_in ** 4.871), 3
    )


def meter_loss_psi(meter_size, demand_gpm):
    at_ten = {"5/8": 4.5, "1": 1.7, "1-1/4": 1.0}.get(meter_size, 2.7)
    return round_to(at_ten * (max(demand_gpm, 0.0) / 10.0) ** 1.85, 2)


def water_size_for_wsfu(wsfu, service=False):
    key = "maxServiceWsfu" if service else "maxWsfu"
    for entry in WATER_SIZES:
        if entry[key] >= wsfu:
            return entry["id"]
    return WATER_SIZES[-1]["id"]


def dwv_size_for(dfu, kind="branch"):
    key = {"main": "mainDfu", "stack": "stackDfu"}.get(kind, "branchDfu")
    for entry in DWV_SIZES:
        if entry[key] >= dfu:
            return entry["id"]
    return DWV_SIZES[-1]["id"]


def gas_capacity(size_id, length_m, fuel="natural"):
    """Fuel-gas capacity derated from the 10 ft table by the square root of length."""
    size = gas_size(size_id)
    length_ft = max(length_m / 0.3048, 10.0)
    derate = math.sqrt(10.0 / length_ft)
    fuel_factor = 0.94 if fuel == "propane" else 1.0
    return round_to(size["capacity10"] * derate * fuel_factor, 1)


def gas_size_for_load(cfh, length_m, fuel="natural"):
    for entry in GAS_SIZES:
        if gas_capacity(entry["id"], length_m, fuel) >= cfh:
            return entry["id"]
    return GAS_SIZES[-1]["id"]


def gas_cfh(btu, fuel="natural"):
    factor = 2516.0 if fuel == "propane" else 1030.0
    return round_to(btu / factor, 2)


def distance(a, b):
    dx = b["x"] - a["x"]
    dy = b["y"] - a["y"]
    return math.sqrt(dx * dx + dy * dy)


def manhattan(a, b):
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def path_length(points):
    total = 0.0
    for index in range(1, len(points)):
        total += distance(points[index - 1], points[index])
    return total


def orthogonal_route(a, b):
    """One-bend orthogonal route, along the longer axis first."""
    if abs(a["x"] - b["x"]) < 1e-6 or abs(a["y"] - b["y"]) < 1e-6:
        return [a, b]
    if abs(b["x"] - a["x"]) >= abs(b["y"] - a["y"]):
        return [a, {"x": round_to(b["x"], 2), "y": a["y"]}, b]
    return [a, {"x": a["x"], "y": round_to(b["y"], 2)}, b]


def build_tree(root, targets):
    """Nearest-node service tree, targets taken in manhattan order from the root."""
    nodes = [{"id": "root", "point": root, "weight": 0.0}]
    edges = []
    parents = [None]
    node_of = [0] * len(targets)
    order = sorted(range(len(targets)), key=lambda i: manhattan(root, targets[i][1]))
    for index in order:
        target_id, point, weight = targets[index]
        best = 0
        best_score = float("inf")
        for node_index, node in enumerate(nodes):
            score = manhattan(node["point"], point)
            if score < best_score:
                best_score = score
                best = node_index
        points = orthogonal_route(nodes[best]["point"], point)
        length = round_to(path_length(points), 3)
        to = len(nodes)
        edges.append({
            "from": best, "to": to, "points": points, "length": length,
            "load": 0.0, "size": "", "capacity": 0.0,
        })
        parents.append(len(edges) - 1)
        nodes.append({"id": target_id, "point": point, "weight": weight})
        node_of[index] = to
    raw = [node["weight"] for node in nodes]
    for index in range(len(edges) - 1, -1, -1):
        edge = edges[index]
        edge["load"] = round_to(raw[edge["to"]], 3)
        raw[edge["from"]] += raw[edge["to"]]
    return {"edges": edges, "parents": parents, "node_of": node_of}


def path_edges(tree, node):
    out = []
    current = node
    guard = 0
    while tree["parents"][current] is not None and guard < 200:
        edge_index = tree["parents"][current]
        out.insert(0, edge_index)
        current = tree["edges"][edge_index]["from"]
        guard += 1
    return out


def build_plumbing(plan):
    plumbing = plan.get("plumbing", {})
    width = float(plumbing.get("width", 0.0))
    depth = float(plumbing.get("depth", 0.0))
    wall_height = float(plan.get("wallHeight", 2.7))

    fixtures = []
    for entry in plumbing.get("fixtures", []):
        fixtures.append({
            "id": str(entry.get("id", "")),
            "tag": str(entry.get("tag", entry.get("id", ""))),
            "type": fixture_type(str(entry.get("type", ""))),
            "point": {"x": float(entry.get("x", 0.0)), "y": float(entry.get("y", 0.0))},
        })

    heater = plumbing.get("heater")
    has_heater = isinstance(heater, dict)
    heater_btu = float(heater.get("btu", 0.0)) if has_heater else 0.0
    heater_point = {
        "x": float(heater.get("x", 0.0)) if has_heater else 0.0,
        "y": float(heater.get("y", 0.0)) if has_heater else 0.0,
    }

    pressure = float(plumbing.get("staticPressure", 55.0))
    meter_size = str(plumbing.get("meterSize", "3/4"))
    material = str(plumbing.get("serviceMaterial", "pex"))

    cold_wsfu = sum(f["type"]["cold"] for f in fixtures) + (1.0 if has_heater else 0.0)
    cold_wsfu = round_to(cold_wsfu, 2)
    hot_wsfu = round_to(sum(f["type"]["hot"] for f in fixtures), 2)
    total_wsfu = round_to(cold_wsfu + hot_wsfu, 2)
    demand = demand_for_wsfu(total_wsfu)

    candidates = [entry for entry in WATER_SIZES if entry["maxServiceWsfu"] >= total_wsfu]
    service_id = None
    for entry in candidates:
        if velocity_fps(demand, water_pipe_diameter(entry["id"], material)) <= 8.0:
            service_id = entry["id"]
            break
    if service_id is None:
        service_id = candidates[-1]["id"] if candidates else WATER_SIZES[-1]["id"]

    service_velocity = velocity_fps(demand, water_pipe_diameter(service_id, material))
    main_length = max(float(plumbing.get("mainLength", 12.0)), 3.0)
    main_friction = friction_psi(demand, water_pipe_diameter(service_id, material), main_length, 150.0)
    meter_loss = meter_loss_psi(meter_size, demand)
    static_at_fixture = round_to(pressure - 0.433 * 1.2, 2)

    cold_fixtures = [i for i, f in enumerate(fixtures) if f["type"]["cold"] > 0 or f["type"]["hot"] > 0]
    hot_fixtures = [i for i, f in enumerate(fixtures) if f["type"]["hot"] > 0]

    cold_targets = [(fixtures[i]["id"], fixtures[i]["point"], fixtures[i]["type"]["cold"]) for i in cold_fixtures]
    if has_heater:
        cold_targets.append(("heater_inlet", heater_point, 1.0))
    water_hookup = {
        "x": float(plumbing.get("waterHookupX", width)),
        "y": float(plumbing.get("waterHookupY", 0.0)),
    }
    cold_tree = build_tree(water_hookup, cold_targets) if cold_targets else None

    hot_targets = [(fixtures[i]["id"], fixtures[i]["point"], fixtures[i]["type"]["hot"]) for i in hot_fixtures]
    hot_tree = build_tree(heater_point, hot_targets) if has_heater and hot_targets else None

    def size_tree(tree):
        if tree is None:
            return 0.0
        total = 0.0
        for edge in tree["edges"]:
            edge["size"] = water_size_for_wsfu(max(edge["load"], 0.5))
            total += edge["length"]
        return round_to(total, 2)

    cold_length = size_tree(cold_tree)
    hot_length = size_tree(hot_tree)

    def edge_friction(edge):
        flow = demand_for_wsfu(edge["load"])
        return friction_psi(flow, water_pipe_diameter(edge["size"], material), edge["length"], 150.0)

    # node_of is indexed by position in the tree's own target list, so a fixture
    # index has to be mapped through the trees that actually carry it.
    def branch_loss(index):
        total = 0.0
        if cold_tree is not None and index in cold_fixtures:
            for edge_index in path_edges(cold_tree, cold_tree["node_of"][cold_fixtures.index(index)]):
                total += edge_friction(cold_tree["edges"][edge_index])
        if fixtures[index]["type"]["hot"] > 0 and hot_tree is not None and index in hot_fixtures:
            for edge_index in path_edges(hot_tree, hot_tree["node_of"][hot_fixtures.index(index)]):
                total += edge_friction(hot_tree["edges"][edge_index])
        return total

    readings = []
    for index in cold_fixtures:
        readings.append((
            fixtures[index]["tag"],
            round_to(static_at_fixture - meter_loss - main_friction - branch_loss(index), 2),
        ))
    if has_heater:
        readings.append(("Water heater", round_to(static_at_fixture - meter_loss - main_friction, 2)))

    worst = None
    for reading in readings:
        if worst is None or reading[1] < worst[1]:
            worst = reading
    residual = worst[1] if worst else 0.0

    # Drainage.
    drains = [i for i, f in enumerate(fixtures) if f["type"]["dfu"] > 0]
    total_dfu = round_to(sum(fixtures[i]["type"]["dfu"] for i in drains), 2)
    main_size = dwv_size_for(total_dfu, "main")
    slope = float(plumbing.get("sewerSlope", 0.02))
    minimum_slope = dwv_size(main_size)["minSlope"]
    sewer_length = max(float(plumbing.get("sewerMainLength", 14.0)), 3.0)
    required_invert = round_to(-(sewer_length * slope) - 0.3, 2)

    groups = []
    for index in drains:
        group = fixtures[index]["type"]["group"]
        for entry in groups:
            if entry[0] == group:
                entry[1].append(index)
                break
        else:
            groups.append((group, [index]))

    stacks = []
    trap_arms = []
    for group, members in groups:
        mean_x = sum(fixtures[i]["point"]["x"] for i in members) / len(members)
        mean_y = sum(fixtures[i]["point"]["y"] for i in members) / len(members)
        stack = {
            "x": round_to(clamp(mean_x, 0.45, width - 0.45), 2),
            "y": round_to(0.48 if mean_y < depth / 2 else depth - 0.48, 2),
        }
        stack_dfu = round_to(sum(fixtures[i]["type"]["dfu"] for i in members), 2)
        largest = "1-1/2"
        for index in members:
            if dwv_index(fixtures[index]["type"]["drain"]) > dwv_index(largest):
                largest = fixtures[index]["type"]["drain"]
        branch_size = dwv_size_for(stack_dfu, "branch")
        if dwv_index(largest) > dwv_index(branch_size):
            branch_size = largest
        stack_size = dwv_size_for(stack_dfu, "stack")
        if dwv_index(stack_size) <= dwv_index(branch_size):
            stack_size = branch_size
        stacks.append({
            "id": "stack_" + group,
            "group": group,
            "x": stack["x"],
            "y": stack["y"],
            "dfu": stack_dfu,
            "branchSize": branch_size,
            "size": stack_size,
            "ventSize": stack_size,
            "ventLength": round_to(wall_height + 1.2, 2),
        })
        for index in members:
            points = orthogonal_route(stack, fixtures[index]["point"])
            length = round_to(path_length(points), 2)
            limit = fixtures[index]["type"]["trapArmMax"]
            trap_arms.append({
                "fixtureId": fixtures[index]["id"],
                "tag": fixtures[index]["tag"],
                "length": length,
                "limit": limit,
                "pass": length <= limit,
            })

    main_y = round_to(depth - 0.22, 2)
    main_start = {"x": 0.28, "y": main_y}
    main_end = {"x": round_to(width - 0.28, 2), "y": main_y}
    sewer_point = {
        "x": float(plumbing.get("sewerHookupX", width)),
        "y": float(plumbing.get("sewerHookupY", depth)),
    }
    main_route_length = round_to(distance(main_start, main_end) + distance(main_end, sewer_point), 2)

    # Fuel gas.
    fuel = "propane" if str(plumbing.get("gasType", "natural")) == "propane" else "natural"
    gas_length = max(float(plumbing.get("gasMainLength", 15.0)), 5.0)
    gas_meter = float(plumbing.get("gasMeterCapacity", 0.0))
    gas_targets = [(f["id"], f["point"], f["type"]["btu"]) for f in fixtures if f["type"]["btu"] > 0]
    if has_heater and heater_btu > 0:
        gas_targets.append(("heater_gas", heater_point, heater_btu))
    total_btu = round_to(sum(target[2] for target in gas_targets), 0)
    uses_gas = bool(gas_targets)
    total_cfh = gas_cfh(total_btu, fuel)
    gas_hookup = {
        "x": float(plumbing.get("gasHookupX", 0.0)),
        "y": float(plumbing.get("gasHookupY", 0.0)),
    }
    gas_tree = build_tree(gas_hookup, gas_targets) if uses_gas else None
    if gas_tree is not None:
        for edge in gas_tree["edges"]:
            edge["size"] = gas_size_for_load(edge["load"], edge["length"], fuel)
            edge["capacity"] = gas_capacity(edge["size"], edge["length"], fuel)
    gas_main_size = gas_size_for_load(total_cfh, gas_length, fuel)
    gas_capacity_main = gas_capacity(gas_main_size, gas_length, fuel) if uses_gas else 0.0
    longest_run = 0.0
    if gas_tree is not None:
        for edge in gas_tree["edges"]:
            longest_run = max(longest_run, edge["length"])
    longest_run = round_to(longest_run, 2)

    checks = [
        ("water-hookup", pressure > 0),
        ("residual-pressure", worst is not None and residual >= 8.0),
        ("service-velocity", service_velocity <= 8.0),
        ("meter", not (meter_size == "3/4" and demand > 14.0)),
        ("sewer-invert", float(plumbing.get("sewerInvert", -2.0)) <= required_invert),
        ("sewer-slope", slope >= minimum_slope),
        ("sewer-size", dwv_index(str(plumbing.get("sewerSize", "4"))) >= dwv_index(main_size)),
        ("trap-arms", all(arm["pass"] for arm in trap_arms)),
        ("gas-meter", (not uses_gas) or total_cfh <= gas_meter),
        ("gas-size", (not uses_gas) or total_cfh <= gas_capacity_main),
    ]

    return {
        "width": width,
        "depth": depth,
        "coldWsfu": cold_wsfu,
        "hotWsfu": hot_wsfu,
        "totalWsfu": total_wsfu,
        "demandGpm": demand,
        "coldDemandGpm": demand_for_wsfu(cold_wsfu),
        "hotDemandGpm": demand_for_wsfu(hot_wsfu),
        "serviceSize": service_id,
        "serviceMaterial": material,
        "serviceVelocityFps": service_velocity,
        "mainLength": main_length,
        "mainFrictionPsi": main_friction,
        "meterLossPsi": meter_loss,
        "staticAtFixturePsi": static_at_fixture,
        "residualPsi": residual,
        "worstFixture": worst[0] if worst else "",
        "coldLength": cold_length,
        "hotLength": hot_length,
        "readings": readings,
        "totalDfu": total_dfu,
        "mainSize": main_size,
        "slope": slope,
        "minimumSlope": minimum_slope,
        "requiredInvert": required_invert,
        "sewerMainLength": sewer_length,
        "mainY": main_y,
        "mainRouteLength": main_route_length,
        "stacks": stacks,
        "trapArms": trap_arms,
        "usesGas": uses_gas,
        "fuel": fuel,
        "totalBtu": total_btu,
        "totalCfh": total_cfh,
        "gasMainSize": gas_main_size,
        "gasCapacityCfh": gas_capacity_main,
        "longestRun": longest_run,
        "gasMeterCapacityCfh": gas_meter,
        "applianceCount": len(gas_targets),
        "checks": checks,
    }


def plumbing_json(plan):
    result = build_plumbing(plan)
    reading_rows = [
        jobj([("tag", jstr(tag)), ("pressurePsi", f3(value))])
        for tag, value in result["readings"]
    ]
    stack_rows = []
    for stack in result["stacks"]:
        stack_rows.append(jobj([
            ("id", jstr(stack["id"])),
            ("group", jstr(stack["group"])),
            ("x", f3(stack["x"])),
            ("y", f3(stack["y"])),
            ("dfu", f3(stack["dfu"])),
            ("branchSize", jstr(stack["branchSize"])),
            ("size", jstr(stack["size"])),
            ("ventSize", jstr(stack["ventSize"])),
            ("ventLength", f3(stack["ventLength"])),
        ]))
    trap_rows = []
    for arm in result["trapArms"]:
        trap_rows.append(jobj([
            ("fixtureId", jstr(arm["fixtureId"])),
            ("tag", jstr(arm["tag"])),
            ("length", f3(arm["length"])),
            ("limit", f3(arm["limit"])),
            ("pass", flag(arm["pass"])),
        ]))
    check_rows = [
        jobj([("id", jstr(check_id)), ("pass", flag(passed))])
        for check_id, passed in result["checks"]
    ]

    return jobj([
        ("water", jobj([
            ("coldWsfu", f3(result["coldWsfu"])),
            ("hotWsfu", f3(result["hotWsfu"])),
            ("totalWsfu", f3(result["totalWsfu"])),
            ("demandGpm", f3(result["demandGpm"])),
            ("coldDemandGpm", f3(result["coldDemandGpm"])),
            ("hotDemandGpm", f3(result["hotDemandGpm"])),
            ("serviceSize", jstr(result["serviceSize"])),
            ("serviceMaterial", jstr(result["serviceMaterial"])),
            ("serviceVelocityFps", f3(result["serviceVelocityFps"])),
            ("mainLength", f3(result["mainLength"])),
            ("mainFrictionPsi", f3(result["mainFrictionPsi"])),
            ("meterLossPsi", f3(result["meterLossPsi"])),
            ("staticAtFixturePsi", f3(result["staticAtFixturePsi"])),
            ("residualPsi", f3(result["residualPsi"])),
            ("worstFixture", jstr(result["worstFixture"])),
            ("coldLength", f3(result["coldLength"])),
            ("hotLength", f3(result["hotLength"])),
            ("readings", jarr(reading_rows)),
        ])),
        ("drain", jobj([
            ("totalDfu", f3(result["totalDfu"])),
            ("mainSize", jstr(result["mainSize"])),
            ("slope", f3(result["slope"])),
            ("minimumSlope", f3(result["minimumSlope"])),
            ("requiredInvert", f3(result["requiredInvert"])),
            ("sewerMainLength", f3(result["sewerMainLength"])),
            ("mainY", f3(result["mainY"])),
            ("mainRouteLength", f3(result["mainRouteLength"])),
            ("ventCount", str(len(result["stacks"]))),
            ("cleanoutCount", str(len(result["stacks"]) + 1)),
            ("stacks", jarr(stack_rows)),
            ("trapArms", jarr(trap_rows)),
        ])),
        ("gas", jobj([
            ("usesGas", flag(result["usesGas"])),
            ("fuel", jstr(result["fuel"])),
            ("totalBtu", f3(result["totalBtu"])),
            ("totalCfh", f3(result["totalCfh"])),
            ("mainSize", jstr(result["gasMainSize"])),
            ("capacityCfh", f3(result["gasCapacityCfh"])),
            ("longestRun", f3(result["longestRun"])),
            ("meterCapacityCfh", f3(result["gasMeterCapacityCfh"])),
            ("applianceCount", str(result["applianceCount"])),
        ])),
        ("checks", jarr(check_rows)),
    ])


# --- lighting ---------------------------------------------------------------

def room_index(width, depth, mounting_height):
    w = max(width, 0.1)
    d = max(depth, 0.1)
    h = max(mounting_height, 0.1)
    return (w * d) / (h * (w + d))


def coefficient_of_utilization(index, ceiling, wall):
    k = max(index, 0.0)
    if k < 0.7:
        cu = 0.44
    elif k < 1.0:
        cu = 0.52
    elif k < 1.5:
        cu = 0.60
    elif k < 2.0:
        cu = 0.66
    elif k < 3.0:
        cu = 0.72
    elif k < 5.0:
        cu = 0.77
    else:
        cu = 0.80
    cu += (ceiling - 0.7) * 0.08
    cu += (wall - 0.5) * 0.06
    return min(max(cu, 0.35), 0.88)


def illuminance_at(px, py, lights, work_plane):
    lux = 0.0
    for light in lights:
        if not light["on"]:
            continue
        dx = px - light["x"]
        dy = py - light["y"]
        h = max(light["mount"] - work_plane, 0.1)
        distance_squared = dx * dx + dy * dy + h * h
        dist = math.sqrt(distance_squared)
        cos = h / dist
        intensity = light["lumens"] / math.pi
        lux += (intensity * cos) / distance_squared
    return lux


def build_lighting(plan):
    lighting = plan.get("lighting", {})
    width = float(lighting.get("width", 5.0))
    depth = float(lighting.get("depth", 4.0))
    mounting = float(lighting.get("mountingHeight", 2.4))
    work_plane = float(lighting.get("workPlane", 0.75))
    target_lux = float(lighting.get("targetLux", 200.0))
    llf = float(lighting.get("llf", 0.8))
    reflectances = lighting.get("reflectances", {})
    ceiling = float(reflectances.get("ceiling", 0.8))
    wall = float(reflectances.get("wall", 0.5))

    lights = []
    for entry in lighting.get("luminaires", []):
        lights.append({
            "x": float(entry.get("x", width / 2)),
            "y": float(entry.get("y", depth / 2)),
            "lumens": float(entry.get("lumens", 0.0)),
            "watts": float(entry.get("watts", 0.0)),
            "mount": float(entry.get("mountHeight", mounting)),
            "dim": float(entry.get("dim", 100.0)),
            "on": float(entry.get("on", 1)) != 0,
            "spacing_ratio": float(entry.get("spacingRatio", 1.1)),
        })

    area = max(width * depth, 0.1)
    total_lumens = sum(light["lumens"] for light in lights)
    index = room_index(width, depth, mounting)
    cu = coefficient_of_utilization(index, ceiling, wall)
    average_lux = total_lumens * cu * llf / area

    raw_steps = round_to(float(lighting.get("steps", 16.0)), 0)
    if raw_steps == 0:
        raw_steps = 16.0
    steps = int(min(max(raw_steps, 4.0), 60.0))
    grid_w = max(width, 0.1)
    grid_d = max(depth, 0.1)
    grid_min = float("inf")
    grid_max = 0.0
    grid_sum = 0.0
    for row in range(steps):
        y = ((row + 0.5) / steps) * grid_d
        for col in range(steps):
            x = ((col + 0.5) / steps) * grid_w
            lux = illuminance_at(x, y, lights, work_plane)
            grid_min = min(grid_min, lux)
            grid_max = max(grid_max, lux)
            grid_sum += lux
    grid_average = grid_sum / (steps * steps)
    if not math.isfinite(grid_min):
        grid_min = 0.0
    uniformity = grid_min / grid_max if grid_max > 0 else 0.0
    average_to_min = grid_min / grid_average if grid_average > 0 else 0.0

    lit_lumens = sum(light["lumens"] * light["dim"] / 100.0 for light in lights if light["on"])
    connected_w = sum(light["watts"] for light in lights)
    spacing = max(lights[0]["spacing_ratio"] * max(mounting, 0.5), 0.6) if lights else 0.0
    per_luminaire = lights[0]["lumens"] if lights else 0.0
    if per_luminaire > 0 and cu * llf > 0:
        required = math.ceil(target_lux * area / (per_luminaire * cu * llf) - 1e-9)
    else:
        required = 0

    circuits = []
    for circuit in lighting.get("circuits", []):
        voltage = float(circuit.get("voltage", 120.0))
        breaker = float(circuit.get("breakerA", 15.0))
        va = 0.0
        for device in circuit.get("devices", []):
            kind = str(device.get("kind", "luminaire"))
            if kind == "socket":
                if float(device.get("dedicated", 0)) != 0:
                    va += float(device.get("ratingA", 0.0)) * float(device.get("voltage", voltage))
                else:
                    va += 180.0
            elif kind == "luminaire":
                va += float(device.get("watts", 0.0))
        amps = va / voltage if voltage > 0 else 0.0
        circuits.append({
            "id": str(circuit.get("id", "")),
            "name": str(circuit.get("name", "")),
            "va": round_to(va, 1),
            "amps": round_to(amps, 2),
            "breakerA": breaker,
            "percent": round_to(amps / breaker * 100.0, 1) if breaker > 0 else 0.0,
            "pass": amps <= breaker + 1e-9,
            "continuousPass": amps <= breaker * 0.8 + 1e-9,
        })

    return {
        "area": round_to(area, 2),
        "roomIndex": round_to(index, 2),
        "cu": round_to(cu, 2),
        "llf": llf,
        "ceiling": ceiling,
        "wall": wall,
        "totalLumens": round_to(total_lumens, 0),
        "litLumens": round_to(lit_lumens, 0),
        "averageLux": round_to(average_lux, 1),
        "targetLux": target_lux,
        "targetRatio": round_to(average_lux / target_lux, 2) if target_lux > 0 else 0.0,
        "meetsTarget": target_lux <= 0 or average_lux >= target_lux - 1e-9,
        "spacing": round_to(spacing, 2),
        "connectedW": round_to(connected_w, 1),
        "wattsPerM2": round_to(connected_w / area, 2),
        "efficacy": round_to(total_lumens / connected_w, 1) if connected_w > 0 else 0.0,
        "requiredForTarget": float(required),
        "steps": steps,
        "gridMin": round_to(grid_min, 1),
        "gridMax": round_to(grid_max, 1),
        "gridAverage": round_to(grid_average, 1),
        "uniformity": round_to(uniformity, 2),
        "averageToMin": round_to(average_to_min, 2),
        "circuits": circuits,
    }


def lighting_json(plan):
    result = build_lighting(plan)
    circuit_rows = []
    for circuit in result["circuits"]:
        circuit_rows.append(jobj([
            ("id", jstr(circuit["id"])),
            ("name", jstr(circuit["name"])),
            ("va", f3(circuit["va"])),
            ("amps", f3(circuit["amps"])),
            ("breakerA", f3(circuit["breakerA"])),
            ("percent", f3(circuit["percent"])),
            ("pass", flag(circuit["pass"])),
            ("continuousPass", flag(circuit["continuousPass"])),
        ]))

    return jobj([
        ("photometry", jobj([
            ("area", f3(result["area"])),
            ("roomIndex", f3(result["roomIndex"])),
            ("cu", f3(result["cu"])),
            ("llf", f3(result["llf"])),
            ("ceilingReflectance", f3(result["ceiling"])),
            ("wallReflectance", f3(result["wall"])),
            ("totalLumens", f3(result["totalLumens"])),
            ("litLumens", f3(result["litLumens"])),
            ("averageLux", f3(result["averageLux"])),
            ("targetLux", f3(result["targetLux"])),
            ("targetRatio", f3(result["targetRatio"])),
            ("meetsTarget", flag(result["meetsTarget"])),
            ("spacing", f3(result["spacing"])),
            ("connectedW", f3(result["connectedW"])),
            ("wattsPerM2", f3(result["wattsPerM2"])),
            ("efficacy", f3(result["efficacy"])),
            ("requiredForTarget", f3(result["requiredForTarget"])),
        ])),
        ("grid", jobj([
            ("steps", str(result["steps"])),
            ("minLux", f3(result["gridMin"])),
            ("maxLux", f3(result["gridMax"])),
            ("averageLux", f3(result["gridAverage"])),
            ("uniformity", f3(result["uniformity"])),
            ("averageToMin", f3(result["averageToMin"])),
        ])),
        ("circuits", jarr(circuit_rows)),
    ])


# --- roof suite ------------------------------------------------------------

ROOF_STYLES = [
    {"key": "gable-king", "name": "Gable · king post", "family": "gable", "truss": "king-post", "minPitch": 3.0},
    {"key": "gable-fink", "name": "Gable · Fink", "family": "gable", "truss": "fink", "minPitch": 3.0},
    {"key": "gable-howe", "name": "Gable · Howe", "family": "gable", "truss": "howe", "minPitch": 3.0},
    {"key": "gable-scissor", "name": "Gable · scissor", "family": "gable", "truss": "scissor", "minPitch": 4.0},
    {"key": "gable-attic", "name": "Gable · attic (room in roof)", "family": "gable", "truss": "attic", "minPitch": 5.0},
    {"key": "gambrel", "name": "Gambrel", "family": "gambrel", "truss": "gambrel", "minPitch": 5.0},
    {"key": "hip", "name": "Hip", "family": "hip", "truss": "hip", "minPitch": 3.0},
    {"key": "cross-gable", "name": "Cross gable", "family": "cross", "truss": "cross", "minPitch": 3.0},
    {"key": "shed", "name": "Shed · mono-pitch", "family": "shed", "truss": "shed", "minPitch": 3.0},
    {"key": "saltbox", "name": "Saltbox", "family": "saltbox", "truss": "saltbox", "minPitch": 3.0},
]

SHEATHING = {
    "osb-716": {"label": "7/16 in OSB", "nailMm": 150.0, "cost": 21.0},
    "ply-1532": {"label": "15/32 in plywood", "nailMm": 150.0, "cost": 34.0},
    "ply-1932": {"label": "19/32 in plywood", "nailMm": 100.0, "cost": 46.0},
}

UNDERLAYMENT = {
    "felt-15": {"label": "15 lb felt", "coverage": 92.9, "cost": 38.0, "minPitch": 2.0},
    "felt-30": {"label": "30 lb felt", "coverage": 92.9, "cost": 55.0, "minPitch": 1.0},
    "synthetic": {"label": "Synthetic underlayment", "coverage": 92.9, "cost": 118.0, "minPitch": 1.0},
    "peel-stick": {"label": "Peel-and-stick membrane", "coverage": 18.6, "cost": 145.0, "minPitch": 0.25},
}

COVERINGS = {
    "asphalt-3tab": {"label": "3-tab asphalt shingle", "family": "shingle", "minPitch": 2.0, "maxPitch": 20.0, "unit": "bundle", "unitsPerSquare": 3.0, "costPerSquare": 115.0, "weight": 8.5, "starterLfPerUnit": 35.0, "ridgeCapLfPerUnit": 35.0, "warranty": "25-year limited"},
    "asphalt-arch": {"label": "Architectural (dimensional) shingle", "family": "shingle", "minPitch": 2.0, "maxPitch": 20.0, "unit": "bundle", "unitsPerSquare": 3.0, "costPerSquare": 155.0, "weight": 11.0, "starterLfPerUnit": 35.0, "ridgeCapLfPerUnit": 35.0, "warranty": "30-year limited"},
    "metal-standing-seam": {"label": "Standing-seam metal", "family": "metal", "minPitch": 3.0, "maxPitch": 24.0, "unit": "square", "unitsPerSquare": 1.0, "costPerSquare": 520.0, "weight": 6.5, "starterLfPerUnit": 0.0, "ridgeCapLfPerUnit": 0.0, "warranty": "40-year finish / 50-year substrate"},
    "clay-tile": {"label": "Clay barrel tile", "family": "tile", "minPitch": 4.0, "maxPitch": 16.0, "unit": "tile", "unitsPerSquare": 100.0, "costPerSquare": 920.0, "weight": 45.0, "starterLfPerUnit": 0.0, "ridgeCapLfPerUnit": 0.0, "warranty": "50-year material"},
    "concrete-tile": {"label": "Concrete tile", "family": "tile", "minPitch": 4.0, "maxPitch": 16.0, "unit": "tile", "unitsPerSquare": 95.0, "costPerSquare": 690.0, "weight": 50.0, "starterLfPerUnit": 0.0, "ridgeCapLfPerUnit": 0.0, "warranty": "50-year material"},
    "slate": {"label": "Natural slate", "family": "tile", "minPitch": 4.0, "maxPitch": 24.0, "unit": "slate", "unitsPerSquare": 220.0, "costPerSquare": 1650.0, "weight": 55.0, "starterLfPerUnit": 0.0, "ridgeCapLfPerUnit": 0.0, "warranty": "75-year material"},
    "modified-bitumen": {"label": "Modified bitumen membrane", "family": "low-slope", "minPitch": 1.0, "maxPitch": 4.0, "unit": "roll", "unitsPerSquare": 1.0, "costPerSquare": 210.0, "weight": 5.5, "starterLfPerUnit": 0.0, "ridgeCapLfPerUnit": 0.0, "warranty": "15-year material"},
    "bur": {"label": "Built-up roof (3-ply BUR)", "family": "low-slope", "minPitch": 0.25, "maxPitch": 3.0, "unit": "ply-square", "unitsPerSquare": 3.0, "costPerSquare": 460.0, "weight": 12.0, "starterLfPerUnit": 0.0, "ridgeCapLfPerUnit": 0.0, "warranty": "20-year system"},
    "tpo": {"label": "Single-ply TPO / EPDM", "family": "low-slope", "minPitch": 0.25, "maxPitch": 3.0, "unit": "square", "unitsPerSquare": 1.0, "costPerSquare": 420.0, "weight": 2.5, "starterLfPerUnit": 0.0, "ridgeCapLfPerUnit": 0.0, "warranty": "20-year membrane"},
    "roll-roofing": {"label": "Roll roofing", "family": "low-slope", "minPitch": 1.0, "maxPitch": 4.0, "unit": "roll", "unitsPerSquare": 1.0, "costPerSquare": 130.0, "weight": 4.5, "starterLfPerUnit": 0.0, "ridgeCapLfPerUnit": 0.0, "warranty": "5-year material"},
}

GUTTERS = {
    "k5-alum": {"label": "5 in K-style aluminium", "maxArea": 55.0, "costPerLf": 9.0, "downspoutCost": 14.0, "hangerSpacing": 0.6, "downspout": "2 x 3 in rectangular"},
    "k6-alum": {"label": "6 in K-style aluminium", "maxArea": 95.0, "costPerLf": 12.0, "downspoutCost": 18.0, "hangerSpacing": 0.6, "downspout": "3 x 4 in rectangular"},
    "half-round-5": {"label": "5 in half-round aluminium", "maxArea": 45.0, "costPerLf": 14.0, "downspoutCost": 16.0, "hangerSpacing": 0.5, "downspout": "3 in round"},
    "box-4": {"label": "4 in box steel", "maxArea": 40.0, "costPerLf": 16.0, "downspoutCost": 18.0, "hangerSpacing": 0.6, "downspout": "3 in round"},
    "copper-k6": {"label": "6 in K-style copper", "maxArea": 95.0, "costPerLf": 42.0, "downspoutCost": 65.0, "hangerSpacing": 0.6, "downspout": "3 x 4 in copper"},
}


def roof_style(key):
    for entry in ROOF_STYLES:
        if entry["key"] == key:
            return entry
    return ROOF_STYLES[0]


def roof_ceil(value):
    return float(math.ceil(max(value, 0.0) - 1e-9))


def hypot2(a, b):
    return math.sqrt(a * a + b * b)


def tri_area(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    cx = uy * vz - uz * vy
    cy = uz * vx - ux * vz
    cz = ux * vy - uy * vx
    return math.sqrt(cx * cx + cy * cy + cz * cz) / 2.0


def plane_area(points):
    total = 0.0
    index = 1
    while index + 1 < len(points):
        total += tri_area(points[0], points[index], points[index + 1])
        index += 1
    return total


def roof_geometry(family, span, length, pitch, overhang):
    safe_span = max(span, 1.2)
    safe_length = max(length, 1.2)
    safe_pitch = max(pitch, 0.1)
    run = safe_pitch / 12.0
    half = safe_span / 2.0
    over = max(overhang, 0.0)
    z1 = -safe_length / 2.0 - over
    z2 = safe_length / 2.0 + over
    eave_y = -over * run
    rise = safe_span * run if family == "shed" else half * run
    ridge_x = 0.0
    cross_rise = 0.0
    ridge_length = safe_length
    valley_length = 0.0
    hip_length = 0.0
    planes = []

    def gable_plane(rx, ry, ex, ey, za, zb):
        return plane_area([(rx, ry, za), (ex, ey, za), (ex, ey, zb), (rx, ry, zb)])

    if family == "gable":
        planes.append(gable_plane(0.0, rise, half + over, eave_y, z1, z2))
        planes.append(gable_plane(0.0, rise, -half - over, eave_y, z1, z2))
        ridge_length = safe_length + 2.0 * over
    elif family == "saltbox":
        left_run = safe_span * 0.38
        right_run = safe_span * 0.62
        ridge_x = -half + left_run
        left_slope = rise / left_run
        right_slope = rise / right_run
        planes.append(gable_plane(ridge_x, rise, half + over, -over * right_slope, z1, z2))
        planes.append(gable_plane(ridge_x, rise, -half - over, -over * left_slope, z1, z2))
        ridge_length = safe_length + 2.0 * over
    elif family == "gambrel":
        break_x = half * 0.55
        lower_rise = rise * 0.45
        lower_slope = lower_rise / (half - break_x)
        lower_eave_y = -over * lower_slope
        for side in (1.0, -1.0):
            sign = side
            planes.append(plane_area([
                (sign * break_x, lower_rise, z1),
                (sign * (half + over), lower_eave_y, z1),
                (sign * (half + over), lower_eave_y, z2),
                (sign * break_x, lower_rise, z2),
            ]))
            planes.append(plane_area([
                (0.0, rise, z1),
                (sign * break_x, lower_rise, z1),
                (sign * break_x, lower_rise, z2),
                (0.0, rise, z2),
            ]))
        ridge_length = safe_length + 2.0 * over
    elif family == "hip":
        ridge_length = max(safe_length - safe_span, 0.4)
        ridge_z = ridge_length / 2.0
        eave_x = half + over
        eave_z = safe_length / 2.0 + over
        hip_length = 4.0 * hypot2(hypot2(eave_x, eave_z - ridge_z), rise - eave_y)
        planes.append(gable_plane(0.0, rise, eave_x, eave_y, -ridge_z, ridge_z))
        planes.append(gable_plane(0.0, rise, -eave_x, eave_y, -ridge_z, ridge_z))
        planes.append(plane_area([(0.0, rise, -ridge_z), (-eave_x, eave_y, -eave_z), (eave_x, eave_y, -eave_z)]))
        planes.append(plane_area([(0.0, rise, ridge_z), (eave_x, eave_y, eave_z), (-eave_x, eave_y, eave_z)]))
    elif family == "cross":
        cross_rise = rise * 0.85
        cross_half = safe_length * 0.28
        cross_eave_y = -over * (cross_rise / cross_half)
        x1 = -half - over
        x2 = half + over
        planes.append(gable_plane(0.0, rise, half + over, eave_y, z1, z2))
        planes.append(gable_plane(0.0, rise, -half - over, eave_y, z1, z2))
        planes.append(plane_area([
            (x1, cross_rise, 0.0),
            (x2, cross_rise, 0.0),
            (x2, cross_eave_y, cross_half + over),
            (x1, cross_eave_y, cross_half + over),
        ]))
        planes.append(plane_area([
            (x2, cross_rise, 0.0),
            (x1, cross_rise, 0.0),
            (x1, cross_eave_y, -cross_half - over),
            (x2, cross_eave_y, -cross_half - over),
        ]))
        ridge_length = safe_length + safe_span * 0.9
        valley_length = 4.0 * hypot2(safe_span * 0.22, rise * 0.35)
    elif family == "shed":
        high_over = rise + over * run
        low_over = -over * run
        planes.append(plane_area([
            (-half - over, high_over, z1),
            (half + over, low_over, z1),
            (half + over, low_over, z2),
            (-half - over, high_over, z2),
        ]))
        ridge_length = 0.0

    roof_area = 0.0
    for entry in planes:
        roof_area += entry
    footprint_area = safe_span * safe_length

    def slope_length_of(run_x, rise_y, over_x, over_y):
        return hypot2(run_x + over_x, rise_y + over_y)

    if family == "hip":
        rake_length = 0.0
    elif family == "shed":
        rake_length = 2.0 * slope_length_of(safe_span, rise, over, over * run)
    elif family == "gambrel":
        break_x = half * 0.55
        lower_rise = rise * 0.45
        lower_slope = lower_rise / (half - break_x)
        rake_length = 4.0 * hypot2(half - break_x + over, lower_rise + over * lower_slope) + 4.0 * hypot2(break_x, rise - lower_rise)
    elif family == "saltbox":
        left_run = half + ridge_x
        right_run = half - ridge_x
        rake_length = 2.0 * slope_length_of(left_run, rise, over, over * (rise / left_run)) + 2.0 * slope_length_of(right_run, rise, over, over * (rise / right_run))
    elif family == "cross":
        main_slope = slope_length_of(half, rise, over, over * run)
        cross_half = safe_length * 0.28
        cross_slope = slope_length_of(cross_half, cross_rise, over, 0.0)
        rake_length = 4.0 * main_slope + 4.0 * cross_slope
    else:
        rake_length = 4.0 * slope_length_of(half, rise, over, over * run)

    if family == "hip":
        eave_length = 2.0 * (safe_length + 2.0 * over) + 2.0 * (safe_span + 2.0 * over)
    elif family == "shed":
        eave_length = safe_length + 2.0 * over
    elif family == "cross":
        eave_length = 2.0 * (safe_length + 2.0 * over) + 2.0 * (safe_span + 2.0 * over)
    else:
        eave_length = 2.0 * (safe_length + 2.0 * over)

    return {
        "pitch": safe_pitch,
        "angle": (math.atan(run) * 180.0) / math.pi,
        "span": safe_span,
        "length": safe_length,
        "overhang": over,
        "half": half,
        "rise": rise,
        "ridgeX": ridge_x,
        "crossRise": cross_rise,
        "ridgeLength": ridge_length,
        "hipLength": hip_length,
        "valleyLength": valley_length,
        "eaveLength": eave_length,
        "rakeLength": rake_length,
        "roofArea": roof_area,
        "footprintArea": footprint_area,
        "slopeLength": hypot2(half, rise),
    }


def truss_member_length(truss, geometry):
    half = geometry["half"]
    rise = geometry["rise"]
    members = []

    def add(x1, y1, x2, y2):
        members.append((x1, y1, x2, y2))

    def bottom():
        add(-half, 0.0, half, 0.0)

    def top_chords(ridge_y=None, at_x=0.0):
        value = rise if ridge_y is None else ridge_y
        add(-half, 0.0, at_x, value)
        add(half, 0.0, at_x, value)

    if truss == "king-post":
        bottom()
        top_chords()
        add(0.0, 0.0, 0.0, rise)
        for fraction in (0.5, 0.75):
            for side in (1.0, -1.0):
                add(side * half * fraction, 0.0, (side * half * fraction) / 2.0, rise * (1.0 - fraction / 2.0))
    elif truss == "fink":
        bottom()
        top_chords()
        add(-half * 0.5, 0.0, -half * 0.25, rise * 0.5)
        add(-half * 0.25, rise * 0.5, 0.0, 0.0)
        add(half * 0.25, rise * 0.5, 0.0, 0.0)
        add(half * 0.5, 0.0, half * 0.25, rise * 0.5)
    elif truss == "howe":
        bottom()
        top_chords()
        for side in (1.0, -1.0):
            add(side * half * 0.5, 0.0, side * half * 0.5, rise * 0.5)
            add(0.0, 0.0, side * half * 0.5, rise * 0.5)
    elif truss == "scissor":
        top_chords()
        add(-half, rise * 0.12, half * 0.55, rise * 0.82)
        add(half, rise * 0.12, -half * 0.55, rise * 0.82)
        add(0.0, rise * 0.28, 0.0, rise * 0.9)
    elif truss == "attic":
        bottom()
        top_chords()
        tie = rise * 0.52
        add(-half * 0.78, tie, half * 0.78, tie)
        for side in (1.0, -1.0):
            add(side * half * 0.78, 0.0, side * half * 0.78, tie)
        add(0.0, tie, 0.0, rise)
    elif truss == "gambrel":
        bottom()
        break_x = half * 0.55
        lower_rise = rise * 0.45
        for side in (1.0, -1.0):
            add(side * half, 0.0, side * break_x, lower_rise)
            add(side * break_x, lower_rise, 0.0, rise)
            add(side * break_x, 0.0, side * break_x, lower_rise)
        add(0.0, 0.0, 0.0, rise)
    elif truss == "saltbox":
        bottom()
        add(-half, 0.0, geometry["ridgeX"], rise)
        add(half, 0.0, geometry["ridgeX"], rise)
        add(geometry["ridgeX"], 0.0, geometry["ridgeX"], rise)
        for side in (1.0, -1.0):
            add(side * half * 0.5, 0.0, side * half * 0.25, rise * 0.45)
    elif truss == "shed":
        add(-half, 0.0, half, 0.0)
        add(-half, rise, half, 0.0)
        add(-half, 0.0, -half, rise)
        add(0.0, 0.0, 0.0, rise * 0.5)
    else:
        bottom()
        top_chords()
        add(0.0, 0.0, 0.0, rise)
        for fraction in (0.5, 0.75):
            for side in (1.0, -1.0):
                add(side * half * fraction, 0.0, (side * half * fraction) / 2.0, rise * (1.0 - fraction / 2.0))

    total = 0.0
    for x1, y1, x2, y2 in members:
        total += hypot2(x2 - x1, y2 - y1)
    return total


def roof_design_json(plan):
    roof = plan.get("roof", {}) or {}
    definition = roof_style(roof.get("style", "gable-king"))
    span = float(roof.get("span", 10.0))
    length = float(roof.get("length", 14.0))
    pitch = float(roof.get("pitch", 6.0))
    overhang = float(roof.get("overhang", 0.5))
    geometry = roof_geometry(definition["family"], span, length, pitch, overhang)

    sheathing = SHEATHING.get(roof.get("sheathing", "osb-716"), SHEATHING["osb-716"])
    underlayment = UNDERLAYMENT.get(roof.get("underlayment", "synthetic"), UNDERLAYMENT["synthetic"])
    covering = COVERINGS.get(roof.get("covering", "asphalt-arch"), COVERINGS["asphalt-arch"])
    gutter = GUTTERS.get(roof.get("gutter", "k5-alum"), GUTTERS["k5-alum"])
    spacing = min(max(float(roof.get("spacing", 0.61)), 0.3), 1.2)
    waste = min(max(float(roof.get("waste", 0.1)), 0.0), 0.4)

    def flag_of(key, fallback):
        value = roof.get(key)
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return float(value) != 0.0
        return fallback

    gutters = flag_of("gutters", True)
    ice_shield = flag_of("iceShield", True)
    ridge_vent = flag_of("ridgeVent", True)
    soffit_vent = flag_of("soffitVent", True)
    chimney = flag_of("chimney", False)
    tear_off = flag_of("tearOff", False)
    climate = roof.get("climate", "moderate")
    pipe_vents = round_half_up(float(roof.get("pipeVents", 2.0)))

    area = geometry["roofArea"]
    squares = area / 9.2903
    squares_with_waste = squares * (1.0 + waste)
    plan_area = geometry["footprintArea"]

    sheet_m2 = 1.22 * 2.44
    sheets = roof_ceil((area * (1.0 + waste)) / sheet_m2)
    underlay_rolls = roof_ceil((area * 1.05) / underlayment["coverage"])
    ice_shield_m2 = geometry["eaveLength"] * min(0.9, geometry["slopeLength"]) if ice_shield else 0.0
    ice_shield_rolls = roof_ceil(ice_shield_m2 / 18.6) if ice_shield_m2 > 0.0 else 0.0

    covering_units = roof_ceil(squares_with_waste * covering["unitsPerSquare"])
    if covering["family"] == "shingle":
        covering_unit = "bundle"
    elif covering["family"] == "metal":
        covering_unit = "square"
    else:
        covering_unit = covering["unit"]
    starter_lf = geometry["eaveLength"] if covering["family"] == "shingle" else 0.0
    starter_units = roof_ceil(starter_lf / covering["starterLfPerUnit"]) if covering["starterLfPerUnit"] > 0.0 else 0.0
    ridge_cap_lf = geometry["ridgeLength"] + geometry["hipLength"]
    ridge_cap_units = 0.0
    ridge_cap_unit = ""
    ridge_cap_cost = 0.0
    if covering["ridgeCapLfPerUnit"] > 0.0:
        ridge_cap_units = roof_ceil(ridge_cap_lf / covering["ridgeCapLfPerUnit"])
        ridge_cap_unit = "bundle"
        ridge_cap_cost = 58.0
    elif covering["family"] == "tile":
        ridge_cap_units = roof_ceil(ridge_cap_lf / 0.45)
        ridge_cap_unit = "piece"
        ridge_cap_cost = 13.0
    elif covering["family"] == "metal":
        ridge_cap_units = ridge_cap_lf
        ridge_cap_unit = "m"
        ridge_cap_cost = 22.0

    member_length = truss_member_length(definition["truss"], geometry)
    main_trusses = roof_ceil(geometry["length"] / spacing) + 1.0
    cross_trusses = roof_ceil((geometry["span"] * 0.9) / spacing) + 1.0 if definition["family"] == "cross" else 0.0
    truss_count = main_trusses + cross_trusses
    truss_lumber_m = member_length * truss_count
    ceiling_joists = truss_count
    truss_unit_cost = round_to(38.0 + geometry["span"] * 9.5 + (12.0 if definition["family"] == "hip" else 0.0), 2)

    if definition["family"] in ("hip", "cross"):
        eave_runs = 4.0
    elif definition["family"] == "shed":
        eave_runs = 1.0
    else:
        eave_runs = 2.0
    gutter_lf = geometry["eaveLength"] if gutters else 0.0
    auto_downspouts = max(roof_ceil(gutter_lf / 12.0), roof_ceil(area / gutter["maxArea"]), 2.0)
    downspouts = auto_downspouts if gutters else 0.0
    hangers = roof_ceil(gutter_lf / gutter["hangerSpacing"]) if gutters else 0.0
    end_caps = 0.0
    if gutters:
        end_caps = 0.0 if definition["family"] == "hip" else eave_runs * 2.0
    outlets = downspouts
    elbows = downspouts * 2.0

    drip_edge = geometry["eaveLength"] + geometry["rakeLength"]
    valley = geometry["valleyLength"]
    step_m = 4.0 if chimney else 0.0
    apron_m = 2.4 if chimney else 0.0
    counter_m = 2.4 if chimney else 0.0
    kickouts = 2.0 if definition["family"] == "cross" else 0.0
    pipe_boots = max(pipe_vents, 0.0)
    gutter_apron = geometry["eaveLength"] if gutters else 0.0
    ridge_vent_m = geometry["ridgeLength"] if ridge_vent else 0.0
    soffit_vent_m = geometry["eaveLength"] if soffit_vent else 0.0
    required_nfva = area / 300.0
    provided_nfva = ridge_vent_m * 0.025 + soffit_vent_m * 0.02

    rows = []

    def add(group, item, qty, unit, unit_cost, note=""):
        if not qty > 0.0:
            return
        rows.append({
            "group": group,
            "item": item,
            "qty": round_to(qty, 2),
            "unit": unit,
            "unitCost": round_to(unit_cost, 2),
            "note": note,
        })

    add("Deck", "%s sheets" % sheathing["label"], sheets, "sheet", sheathing["cost"])
    add("Deck", "Sheathing nails / clips", sheets, "sheet", 3.2)
    add("Deck", "%s rolls" % underlayment["label"], underlay_rolls, "roll", underlayment["cost"])
    add("Deck", "Ice & water shield", ice_shield_m2, "m2", 14.0)
    add("Deck", "Ice & water shield rolls", ice_shield_rolls, "roll", 145.0)
    add("Covering", covering["label"], covering_units, covering_unit, covering["costPerSquare"] / max(covering["unitsPerSquare"], 1.0))
    if starter_units > 0.0:
        add("Covering", "Starter strip", starter_units, "bundle", 48.0)
    if ridge_cap_units > 0.0:
        add("Covering", "Ridge and hip cap", ridge_cap_units, ridge_cap_unit, ridge_cap_cost)
    if covering["family"] == "metal":
        add("Covering", "Closures and fasteners", area, "m2", 6.0)
    if chimney:
        add("Covering", "Chimney cricket", 1.0, "each", 180.0)
    add("Flashing", "Drip edge (eave and rake)", drip_edge, "m", 6.0)
    add("Flashing", "Valley metal", valley, "m", 18.0)
    add("Flashing", "Step flashing", step_m, "m", 12.0)
    add("Flashing", "Apron flashing", apron_m, "m", 16.0)
    add("Flashing", "Counter flashing", counter_m, "m", 16.0)
    add("Flashing", "Kickout flashing", kickouts, "each", 14.0)
    add("Flashing", "Pipe vent boots", pipe_boots, "each", 12.0)
    add("Flashing", "Gutter apron", gutter_apron, "m", 7.0)
    if gutters:
        add("Gutter", "%s run" % gutter["label"], gutter_lf, "m", gutter["costPerLf"])
        add("Gutter", "Downspouts (%s)" % gutter["downspout"], downspouts, "each", gutter["downspoutCost"])
        add("Gutter", "Hangers", hangers, "each", 1.8)
        add("Gutter", "End caps", end_caps, "each", 3.5)
        add("Gutter", "Outlets", outlets, "each", 4.5)
        add("Gutter", "Downspout elbows", elbows, "each", 5.0)
    add("Structure", "Roof trusses", truss_count, "truss", truss_unit_cost)
    add("Structure", "Truss lumber (2 x 4 equivalent)", truss_lumber_m, "m", 4.6)
    add("Structure", "Ceiling joists", ceiling_joists, "joist", 12.0)
    add("Ventilation", "Ridge vent", ridge_vent_m, "m", 22.0)
    add("Ventilation", "Soffit vent strip", soffit_vent_m, "m", 9.0)

    material = 0.0
    for row in rows:
        material += row["qty"] * row["unitCost"]
    material_cost = round_to(material, 2)
    tear_off_cost = squares * 90.0 if tear_off else 0.0
    install_cost = squares_with_waste * 140.0
    gutter_labour = gutter_lf * 6.0 if gutters else 0.0
    flashing_labour = (drip_edge + valley + step_m + apron_m + counter_m) * 9.0
    labour_cost = round_to(tear_off_cost + install_cost + gutter_labour + flashing_labour, 2)
    total_cost = round_to(material_cost + labour_cost, 2)

    checks = []
    if geometry["pitch"] < covering["minPitch"]:
        checks.append(("pitch-covering", "error"))
    elif geometry["pitch"] > covering["maxPitch"]:
        checks.append(("pitch-max", "warn"))
    else:
        checks.append(("pitch-covering", "ok"))
    if geometry["pitch"] < definition["minPitch"]:
        checks.append(("pitch-style", "warn"))
    if geometry["pitch"] < 2.0:
        checks.append(("low-slope", "warn"))
    if geometry["pitch"] < 0.25:
        checks.append(("ponding", "error"))
    checks.append(("deck", "ok"))
    if covering["weight"] >= 40.0:
        checks.append(("dead-load", "warn" if covering["weight"] >= 55.0 else "info"))
    else:
        checks.append(("dead-load", "ok"))
    if spacing > 0.45 and covering["family"] == "tile":
        checks.append(("truss-spacing", "error"))
    else:
        checks.append(("truss-spacing", "info"))
    if climate == "cold" and not ice_shield:
        checks.append(("ice-dam", "error"))
    elif ice_shield:
        checks.append(("ice-dam", "ok"))
    else:
        checks.append(("ice-dam", "info"))
    if ridge_vent_m <= 0.0 and soffit_vent_m <= 0.0:
        checks.append(("ventilation", "warn"))
    elif ridge_vent_m <= 0.0 or soffit_vent_m <= 0.0:
        checks.append(("ventilation", "warn"))
    elif provided_nfva < required_nfva:
        checks.append(("ventilation", "warn"))
    else:
        checks.append(("ventilation", "ok"))
    if gutters:
        if downspouts > 0.0 and area / downspouts > gutter["maxArea"]:
            checks.append(("gutter-capacity", "warn"))
        elif downspouts > 0.0:
            checks.append(("gutter-capacity", "ok"))
        else:
            checks.append(("gutter-capacity", "warn"))
    else:
        checks.append(("gutter", "info"))
    if underlayment["minPitch"] > geometry["pitch"]:
        checks.append(("underlayment", "warn"))
    else:
        checks.append(("underlayment", "ok"))
    if valley > 0.0:
        checks.append(("valley", "info"))
    if chimney:
        checks.append(("chimney", "info"))
    if climate == "hail" and covering["family"] == "shingle":
        checks.append(("hail", "info"))
    if geometry["overhang"] > 0.9:
        checks.append(("overhang", "warn"))
    if waste < 0.05:
        checks.append(("waste", "warn"))
    elif waste > 0.25:
        checks.append(("waste", "warn"))
    checks.append(("warranty", "info"))

    row_json = []
    for row in rows:
        row_json.append(jobj([
            ("group", jstr(row["group"])),
            ("item", jstr(row["item"])),
            ("qty", f3(row["qty"])),
            ("unit", jstr(row["unit"])),
            ("unitCost", f3(row["unitCost"])),
            ("cost", f3(round_to(row["qty"] * row["unitCost"], 2))),
            ("note", jstr(row["note"])),
        ]))
    check_json = [jobj([("id", jstr(check_id)), ("severity", jstr(severity))]) for check_id, severity in checks]
    errors = sum(1 for _, severity in checks if severity == "error")
    warnings = sum(1 for _, severity in checks if severity == "warn")

    return jobj([
        ("style", jstr(definition["key"])),
        ("styleName", jstr(definition["name"])),
        ("family", jstr(definition["family"])),
        ("geometry", jobj([
            ("pitch", f3(round_to(geometry["pitch"], 2))),
            ("angle", f3(round_to(geometry["angle"], 1))),
            ("span", f3(geometry["span"])),
            ("length", f3(geometry["length"])),
            ("overhang", f3(geometry["overhang"])),
            ("rise", f3(round_to(geometry["rise"], 3))),
            ("crossRise", f3(round_to(geometry["crossRise"], 3))),
            ("ridgeLength", f3(round_to(geometry["ridgeLength"], 2))),
            ("hipLength", f3(round_to(geometry["hipLength"], 2))),
            ("valleyLength", f3(round_to(geometry["valleyLength"], 2))),
            ("eaveLength", f3(round_to(geometry["eaveLength"], 2))),
            ("rakeLength", f3(round_to(geometry["rakeLength"], 2))),
            ("roofArea", f3(round_to(area, 2))),
            ("planArea", f3(round_to(plan_area, 2))),
        ])),
        ("areas", jobj([
            ("roof", f3(round_to(area, 2))),
            ("plan", f3(round_to(plan_area, 2))),
            ("squares", f3(round_to(squares, 2))),
            ("squaresWithWaste", f3(round_to(squares_with_waste, 2))),
            ("iceShield", f3(round_to(ice_shield_m2, 2))),
            ("vents", f3(round_to(provided_nfva, 3))),
            ("requiredVents", f3(round_to(required_nfva, 3))),
        ])),
        ("layers", jobj([
            ("sheets", f3(sheets)),
            ("underlayRolls", f3(underlay_rolls)),
            ("iceShieldRolls", f3(ice_shield_rolls)),
            ("coveringUnits", f3(covering_units)),
            ("coveringUnit", jstr(covering_unit)),
            ("starterLf", f3(round_to(starter_lf, 1))),
            ("starterUnits", f3(starter_units)),
            ("ridgeCapLf", f3(round_to(ridge_cap_lf, 1))),
            ("ridgeCapUnits", f3(ridge_cap_units)),
            ("dripEdgeM", f3(round_to(drip_edge, 1))),
            ("valleyM", f3(round_to(valley, 1))),
            ("pipeBoots", f3(pipe_boots)),
            ("nailSpacingMm", f3(sheathing["nailMm"])),
        ])),
        ("gutterPackage", jobj([
            ("gutterLf", f3(round_to(gutter_lf, 1))),
            ("downspouts", f3(downspouts)),
            ("hangers", f3(hangers)),
            ("endCaps", f3(end_caps)),
            ("outlets", f3(outlets)),
            ("elbows", f3(elbows)),
            ("areaPerDownspout", f3(round_to(area / downspouts, 1) if downspouts > 0.0 else 0.0)),
        ])),
        ("ventilation", jobj([
            ("ridgeVentM", f3(round_to(ridge_vent_m, 1))),
            ("soffitVentM", f3(round_to(soffit_vent_m, 1))),
            ("providedNfvaM2", f3(round_to(provided_nfva, 3))),
            ("requiredNfvaM2", f3(round_to(required_nfva, 3))),
        ])),
        ("trusses", jobj([
            ("count", f3(truss_count)),
            ("lumberM", f3(round_to(truss_lumber_m, 1))),
            ("ceilingJoists", f3(ceiling_joists)),
            ("memberLength", f3(round_to(member_length, 3))),
        ])),
        ("costs", jobj([
            ("material", f3(material_cost)),
            ("labour", f3(labour_cost)),
            ("tearOff", f3(round_to(tear_off_cost, 2))),
            ("install", f3(round_to(install_cost, 2))),
            ("gutter", f3(round_to(gutter_labour, 2))),
            ("flashing", f3(round_to(flashing_labour, 2))),
            ("total", f3(total_cost)),
            ("perSquare", f3(round_to(total_cost / squares, 2) if squares > 0.0 else 0.0)),
            ("perM2", f3(round_to(total_cost / area, 2) if area > 0.0 else 0.0)),
            ("rows", jarr(row_json)),
        ])),
        ("checks", jarr(check_json)),
        ("errorCount", str(errors)),
        ("warningCount", str(warnings)),
    ])


# --- landscape -------------------------------------------------------------

GALLONS_PER_M3 = 264.172
SQFT = FT * FT

WATER_DEFAULTS = {
    "pool": {"shape": "rectangle", "width": 4.0, "length": 9.0, "shallow": 1.1, "deep": 1.9, "deck": 1.22, "turnover": 6.0, "head": 40.0},
    "spa": {"shape": "circular", "width": 2.4, "length": 2.4, "shallow": 0.9, "deep": 0.9, "deck": 1.0, "turnover": 0.5, "head": 50.0},
    "fountain": {"shape": "circular", "width": 2.4, "length": 2.4, "shallow": 0.35, "deep": 0.45, "deck": 0.6, "turnover": 1.0, "head": 20.0},
    "pond": {"shape": "kidney", "width": 3.5, "length": 5.0, "shallow": 0.45, "deep": 0.9, "deck": 0.0, "turnover": 4.0, "head": 10.0},
    "waterfall": {"shape": "rectangle", "width": 2.4, "length": 1.2, "shallow": 0.25, "deep": 0.4, "deck": 0.4, "turnover": 0.5, "head": 25.0},
    "water-wall": {"shape": "rectangle", "width": 3.0, "length": 0.5, "shallow": 0.2, "deep": 0.35, "deck": 0.4, "turnover": 0.5, "head": 30.0},
}

WATER_LABELS = {
    "pool": "Swimming pool",
    "spa": "Spa / hot tub",
    "fountain": "Fountain",
    "pond": "Ornamental pond",
    "waterfall": "Waterfall",
    "water-wall": "Water wall",
}

SHAPE_LABELS = {
    "rectangle": "Rectangle",
    "roman": "Roman (rounded ends)",
    "kidney": "Kidney",
    "lap": "Lap pool",
    "circular": "Circular",
}

WATER_FILTERS = [
    ("cartridge", 100.0, 25.0, 780.0),
    ("cartridge", 150.0, 37.0, 980.0),
    ("cartridge", 200.0, 50.0, 1180.0),
    ("cartridge", 300.0, 75.0, 1580.0),
    ("de", 36.0, 72.0, 1050.0),
    ("de", 48.0, 96.0, 1280.0),
    ("sand", 3.14, 47.0, 720.0),
    ("sand", 4.91, 73.0, 940.0),
]


def landscape_clamp(value, low, high):
    return min(max(value, low), high)


def round_half_up(value):
    return float(math.floor(value + 0.5)) if value >= 0 else float(math.ceil(value - 0.5))


def surface_area(shape, width, length):
    if shape == "circular":
        return math.pi * (width / 2.0) ** 2
    if shape == "roman":
        r = width * 0.12
        return width * length - 4.0 * (1.0 - math.pi / 4.0) * r * r
    if shape == "kidney":
        return width * length * 0.82
    return width * length


def plan_outline(shape, width, length, segments=48):
    hw = width / 2.0
    hl = length / 2.0
    if shape == "circular":
        return [(hw * math.cos((i / segments) * math.pi * 2.0), hw * math.sin((i / segments) * math.pi * 2.0)) for i in range(segments)]
    if shape == "roman":
        r = min(hw, hl) * 0.6
        points = []
        for cx, cz, start in [
            (hw - r, hl - r, 0.0),
            (-hw + r, hl - r, math.pi / 2.0),
            (-hw + r, -hl + r, math.pi),
            (hw - r, -hl + r, math.pi * 1.5),
        ]:
            for index in range(9):
                a = start + (index / 8.0) * (math.pi / 2.0)
                points.append((cx + r * math.cos(a), cz + r * math.sin(a)))
        return points
    if shape == "kidney":
        points = []
        for index in range(segments):
            t = (index / segments) * math.pi * 2.0
            wobble = 1.0 - 0.22 * math.cos(t) ** 2
            points.append((hw * math.cos(t) * wobble, hl * math.sin(t)))
        return points
    if shape == "lap":
        return [
            (-hw, -hl), (hw, -hl), (hw, -hl * 0.92), (hw * 0.92, 0.0), (hw, hl * 0.92),
            (hw, hl), (-hw, hl), (-hw, hl * 0.92), (-hw * 0.92, 0.0), (-hw, -hl * 0.92),
        ]
    return [(-hw, -hl), (hw, -hl), (hw, hl), (-hw, hl)]


def water_perimeter(shape, width, length):
    points = plan_outline(shape, width, length, 48)
    total = 0.0
    for index in range(len(points)):
        x1, z1 = points[index]
        x2, z2 = points[(index + 1) % len(points)]
        total += math.sqrt((x2 - x1) * (x2 - x1) + (z2 - z1) * (z2 - z1))
    return total


def weir_flow_gpm(length, head):
    length_ft = max(length / FT, 0.01)
    head_ft = max(head / FT, 0.001)
    cfs = 3.33 * length_ft * head_ft ** 1.5
    return cfs * 448.831


def pick_filter(media, flow):
    best = None
    for family, area, gpm, cost in WATER_FILTERS:
        if family != media:
            continue
        if gpm >= flow:
            if best is None or area < best[0]:
                best = (area, gpm, cost)
        elif best is None:
            best = (area, gpm, cost)
        elif best[1] < flow and area > best[0]:
            best = (area, gpm, cost)
    if best is None:
        return (100.0, 25.0, 780.0)
    return best


def landscape_json(plan):
    landscape = plan.get("landscape", {}) or {}
    feature = landscape.get("feature", {}) or {}
    other = landscape.get("site", {}) or {}
    kind = feature.get("type", "pool")
    if kind not in WATER_DEFAULTS:
        kind = "pool"
    defaults = WATER_DEFAULTS[kind]

    shape = feature.get("shape", defaults["shape"])
    if shape not in SHAPE_LABELS:
        shape = "rectangle"
    width = landscape_clamp(float(feature.get("width", defaults["width"])), 0.6, 50.0)
    length = landscape_clamp(float(feature.get("length", defaults["length"])), 0.6, 60.0)
    shallow = landscape_clamp(float(feature.get("shallow", defaults["shallow"])), 0.15, 6.0)
    deep = landscape_clamp(float(feature.get("deep", max(defaults["deep"], shallow + 0.1))), shallow, 6.0)
    deck = landscape_clamp(float(feature.get("deck", defaults["deck"])), 0.0, 6.0)

    area = surface_area(shape, width, length)
    avg_depth = (shallow + deep) / 2.0 if kind == "pool" else deep
    volume = area * avg_depth
    gallons = volume * GALLONS_PER_M3
    turnover = landscape_clamp(float(feature.get("turnoverHours", defaults["turnover"])), 0.25, 24.0)
    flow = gallons / (turnover * 60.0)
    head = float(feature.get("head", defaults["head"]))
    pump_hp = (flow * head) / (3960.0 * 0.65)
    bather_area = 20.0 * SQFT if avg_depth > 1.4 else 15.0 * SQFT
    bathers = math.floor(area / bather_area)
    if kind in ("waterfall", "water-wall"):
        weir_length = float(feature.get("weirLength", width))
        weir = weir_flow_gpm(weir_length, landscape_clamp(float(feature.get("weirHead", 0.006)), 0.003, 0.012))
    else:
        weir = 0.0

    suction = max(round_half_up(float(feature.get("suctionOutlets", 2.0))), 0.0)
    jet_default = 6.0 if kind == "spa" else (4.0 if kind == "fountain" else 0.0)
    jets = max(round_half_up(float(feature.get("jets", jet_default))), 0.0)
    jet_flow = jets * 12.0

    is_water_body = kind in ("pool", "spa")
    site_width = float(other.get("width", max(width + 4.0, 6.0)))
    site_depth = float(other.get("depth", max(length + 5.0, 8.0)))
    feature_x = landscape_clamp(float(other.get("featureX", site_width / 2.0)), width / 2.0, site_width - width / 2.0)
    feature_z = landscape_clamp(float(other.get("featureZ", site_depth / 2.0)), length / 2.0, site_depth - length / 2.0)
    left = feature_x - width / 2.0
    right = site_width - feature_x - width / 2.0
    front = feature_z - length / 2.0
    back = site_depth - feature_z - length / 2.0
    setback = min(left, right, front, back)

    deck_slope = float(other.get("deckSlopePercent", 2.0))
    overhead = float(other.get("overheadClearance", 7.62))
    receptacle = float(other.get("receptacleDistance", 3.0))
    equipment = float(other.get("equipmentClearance", 1.2))

    def flag_of(key, fallback):
        value = other.get(key)
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return float(value) != 0.0
        return fallback

    bonded = flag_of("bonded", True)
    gfci = flag_of("gfci", True)
    luminaires_listed = flag_of("luminairesListed", True)
    emergency_shutoff = flag_of("emergencyShutoff", True)
    signage = flag_of("signage", True)
    public_pool = flag_of("publicPool", False)
    accessible_entry = flag_of("accessibleEntry", False)
    freeze = flag_of("freezeClimate", False)
    winterized = flag_of("winterized", False)
    safety_cover = flag_of("safetyCover", False)
    heater = flag_of("heater", True)
    media_input = other.get("filterMedia", "cartridge")
    media = media_input if media_input in ("sand", "de") else "cartridge"
    media_rate = 15.0 if media == "sand" else (2.0 if media == "de" else 0.25)
    skimmers = float(other.get("skimmers", 1.0))
    ph = float(other.get("ph", 7.4))
    chlorine = float(other.get("freeChlorine", 2.0))
    alkalinity = float(other.get("alkalinity", 100.0))
    cya = float(other.get("cya", 40.0))
    calcium = float(other.get("calcium", 300.0))

    checks = []

    def push(check_id, severity):
        checks.append((check_id, severity))

    if kind == "pool" and shallow < 3.0 * FT - 1e-6:
        push("depth", "error")
    if kind == "pool" and deep > 8.0 * FT + 1e-6:
        push("depth-max", "warning")
    if kind == "pool" and turnover > 8.0:
        push("turnover", "warning")
    if kind == "spa" and float(feature.get("waterTempF", 102.0)) > 104.0 + 1e-6:
        push("spa-temp", "error")
    if kind == "spa" and deep > 3.0 * FT + 1e-6:
        push("spa-depth", "warning")
    if kind == "spa" and turnover > 1.0:
        push("spa-turnover", "warning")
    if kind == "pond" and deep < 24.0 * IN - 1e-6:
        push("pond-depth", "warning")
    if kind == "water-wall" and deep < 0.15:
        push("wall-basin", "warning")
    if kind in ("pool", "spa") and suction < 2.0:
        push("suction", "error")
    if jet_flow > 0.0 and jet_flow > flow * 1.5:
        push("jets", "info")
    if setback < 3.0 * FT - 1e-6:
        push("setback", "error")
    elif setback < 5.0 * FT - 1e-6:
        push("setback", "warning")
    deck_area = max((width + deck * 2.0) * (length + deck * 2.0) - area, 0.0)
    if is_water_body and deck < 4.0 * FT - 1e-6:
        push("deck-width", "error")
    if deck > 0.0 and deck_slope < 1.0:
        push("deck-slope", "error")
    elif deck > 0.0 and deck_slope < 2.0:
        push("deck-slope", "warning")
    if is_water_body and deck_slope < 2.0:
        push("site-drainage", "warning")
    if not bonded:
        push("bonding", "error")
    if not gfci:
        push("gfci", "error")
    if overhead < 25.0 * FT - 1e-6:
        push("overhead", "error")
    if receptacle < 6.0 * FT - 1e-6 or receptacle > 20.0 * FT + 1e-6:
        push("receptacle", "error")
    if not luminaires_listed:
        push("luminaire", "error")
    if equipment < 3.0 * FT - 1e-6:
        push("equipment-access", "warning")
    if public_pool and not accessible_entry:
        push("accessible", "error")
    if freeze and not winterized:
        push("freeze", "warning")
    if freeze and not safety_cover:
        push("cover", "info")
    if kind == "spa" and not emergency_shutoff:
        push("spa-shutoff", "error")
    if kind == "spa" and not signage:
        push("spa-signage", "error")

    required_filter = flow / media_rate
    filter_area, filter_gpm, filter_cost = pick_filter(media, flow)
    if filter_gpm < flow:
        push("filter", "warning")
    area_sqft = area / SQFT
    skimmers_required = max(math.ceil(area_sqft / 500.0), 1.0)
    if is_water_body and skimmers < skimmers_required:
        push("skimmers", "warning")
    drain_velocity = (flow * 0.002228) / (suction * 0.09) if suction > 0.0 else 0.0
    if is_water_body and drain_velocity > 1.5:
        push("drain-velocity", "warning")
    returns = max(math.ceil(area_sqft / 120.0), 2.0)
    lights = max(math.ceil(area_sqft / 100.0), 1.0) if is_water_body else 0.0
    standard_hp = 3.0
    for size in (0.75, 1.0, 1.5, 2.0, 2.5, 3.0):
        if size >= pump_hp:
            standard_hp = size
            break
    if heater:
        heater_btu = math.ceil((gallons * 8.34 * 20.0 / 24.0) / 10000.0) * 10000.0
    else:
        heater_btu = 0.0
    if ph < 7.2 - 1e-6 or ph > 7.8 + 1e-6:
        push("chemistry-ph", "warning")
    if chlorine < 1.0 - 1e-6 or chlorine > 5.0 + 1e-6:
        push("chemistry-chlorine", "warning")
    if alkalinity < 80.0 - 1e-6 or alkalinity > 120.0 + 1e-6:
        push("chemistry-alkalinity", "warning")
    if cya < 30.0 - 1e-6 or cya > 100.0 + 1e-6:
        push("chemistry-cya", "warning")
    if calcium < 200.0 - 1e-6 or calcium > 400.0 + 1e-6:
        push("chemistry-calcium", "warning")

    perimeter = water_perimeter(shape, width, length)
    deck_perimeter = perimeter + deck * 8.0
    barrier_perimeter = deck_perimeter + 3.0
    shell_area = area + perimeter * (avg_depth + 0.25)
    excavation = area * (avg_depth + 0.35)

    lines = [
        ("excavation", excavation, "m3", 65.0),
        ("shell", shell_area, "m2", 55.0 if kind == "pond" else 145.0),
        ("coping", perimeter, "m", 65.0),
        ("deck", deck_area, "m2", 120.0),
        ("water", volume, "m3", 4.5),
        ("pump", 1.0, "ea", 650.0 + standard_hp * 520.0),
        ("filter", 1.0, "ea", filter_cost),
        ("heater", 1.0 if heater else 0.0, "ea", 2200.0),
        ("skimmers", skimmers if is_water_body else 0.0, "ea", 360.0),
        ("covers", max(suction, 2.0) if is_water_body else 0.0, "ea", 95.0),
        ("returns", returns, "ea", 45.0),
        ("lights", lights, "ea", 650.0),
        ("barrier", barrier_perimeter, "m", 95.0),
        ("cover", 1.0 if safety_cover else 0.0, "ea", round_to((width + 0.6) * (length + 0.6) * 80.0, 0)),
        ("controls", 1.0, "lot", 900.0),
    ]

    bom_rows = []
    total = 0.0
    for line_id, qty, unit, unit_cost in lines:
        if not qty > 0.0:
            continue
        line_total = round_to(qty * unit_cost, 0)
        total += line_total
        bom_rows.append(jobj([
            ("id", jstr(line_id)),
            ("qty", f3(round_to(qty, 3))),
            ("unit", jstr(unit)),
            ("unitCost", f3(unit_cost)),
            ("total", f3(line_total)),
        ]))

    check_rows = [jobj([("id", jstr(check_id)), ("severity", jstr(severity))]) for check_id, severity in checks]
    errors = sum(1 for _, severity in checks if severity == "error")
    warnings = sum(1 for _, severity in checks if severity == "warning")

    return jobj([
        ("type", jstr(kind)),
        ("typeLabel", jstr(WATER_LABELS[kind])),
        ("shape", jstr(shape)),
        ("shapeLabel", jstr(SHAPE_LABELS[shape])),
        ("width", f3(width)),
        ("length", f3(length)),
        ("shallow", f3(shallow)),
        ("deep", f3(deep)),
        ("avgDepth", f3(avg_depth)),
        ("deck", f3(deck)),
        ("area", f3(round_to(area, 3))),
        ("areaSqFt", f3(round_to(area_sqft, 2))),
        ("volumeM3", f3(round_to(volume, 3))),
        ("gallons", f3(round_to(gallons, 1))),
        ("turnoverHours", f3(turnover)),
        ("flowGpm", f3(round_to(flow, 2))),
        ("pumpHp", f3(round_to(pump_hp, 2))),
        ("standardPumpHp", f3(standard_hp)),
        ("headFeet", f3(head)),
        ("bathers", f3(bathers)),
        ("suctionOutlets", f3(suction)),
        ("weirFlowGpm", f3(round_to(weir, 1))),
        ("clearances", jobj([
            ("left", f3(round_to(left, 2))),
            ("right", f3(round_to(right, 2))),
            ("front", f3(round_to(front, 2))),
            ("back", f3(round_to(back, 2))),
            ("minimum", f3(round_to(setback, 2))),
        ])),
        ("metrics", jobj([
            ("perimeter", f3(round_to(perimeter, 2))),
            ("deckArea", f3(round_to(deck_area, 2))),
            ("deckPerimeter", f3(round_to(deck_perimeter, 2))),
            ("barrierPerimeter", f3(round_to(barrier_perimeter, 2))),
            ("setback", f3(round_to(setback, 2))),
            ("filterArea", f3(filter_area)),
            ("filterRequired", f3(round_to(required_filter, 2))),
            ("skimmers", f3(skimmers if is_water_body else 0.0)),
            ("skimmersRequired", f3(skimmers_required)),
            ("returns", f3(returns)),
            ("lights", f3(lights)),
            ("drainVelocity", f3(round_to(drain_velocity, 2))),
            ("heaterBtu", f3(heater_btu)),
            ("shellArea", f3(round_to(shell_area, 2))),
            ("excavation", f3(round_to(excavation, 2))),
        ])),
        ("checks", jarr(check_rows)),
        ("errorCount", str(errors)),
        ("warningCount", str(warnings)),
        ("bom", jarr(bom_rows)),
        ("total", f3(total)),
    ])


# --- document --------------------------------------------------------------

def compute(plan):
    wall_height = float(plan.get("wallHeight", 2.7))
    metrics = [wall_metrics(w, wall_height) for w in plan.get("walls", [])]
    rooms = build_rooms(plan)
    finishes = build_finishes(rooms, metrics, plan)
    framing = build_framing(metrics, plan)
    sizing = build_sizing(plan)
    stairs = build_stairs(plan.get("stairs", {}))
    deck = build_deck(plan.get("deck", {}))
    roof = build_roof(plan.get("roof", {}))
    electrical = build_electrical(plan.get("electrical", {}))
    groups = build_cut_list(plan.get("fixtures", []))
    wireframe = build_wireframe(metrics, plan.get("walls", []), wall_height)
    plumbing = plumbing_json(plan)
    lighting = lighting_json(plan)
    landscape = landscape_json(plan)

    total_area = sum(r["area"] for r in rooms)
    total_volume = sum(r["volume"] for r in rooms)
    mean_height = (
        sum(w["height"] for w in metrics) / len(metrics) if metrics else wall_height
    )

    wall_rows = []
    for index, w in enumerate(metrics):
        wall_rows.append(jobj([
            ("index", str(index)),
            ("length", f3(w["length"])),
            ("angle", "%.2f" % w["angle"]),
            ("height", f3(w["height"])),
            ("gross", f3(w["gross"])),
            ("openings", f3(w["openings"])),
            ("net", f3(w["net"])),
        ]))

    room_rows = []
    for room in rooms:
        room_rows.append(jobj([
            ("name", jstr(room["name"])),
            ("area", f3(room["area"])),
            ("perimeter", f3(room["perimeter"])),
            ("centroid", jarr([f3(room["centroid"][0]), f3(room["centroid"][1])])),
            ("height", f3(room["height"])),
            ("volume", f3(room["volume"])),
        ]))

    group_rows = []
    for row in groups:
        group_rows.append(jobj([
            ("type", jstr(row["type"])),
            ("label", jstr(row["label"])),
            ("count", str(len(row["ids"]))),
            ("width", f3(row["width"])),
            ("depth", f3(row["depth"])),
            ("height", f3(row["height"])),
            ("ids", jarr([jstr(i) for i in row["ids"]])),
        ]))

    stairs_obj = jobj([
        ("risers", str(stairs["risers"])),
        ("riserHeight", f3(stairs["riserHeight"])),
        ("maxRiserMm", f3(MAX_RISER_MM)),
        ("treads", str(stairs["treads"])),
        ("tread", f3(stairs["tread"])),
        ("minTreadMm", f3(MIN_TREAD_MM)),
        ("run", f3(stairs["run"])),
        ("runAvailable", f3(stairs["runAvailable"])),
        ("totalRise", f3(stairs["totalRise"])),
        ("stringer", f3(stairs["stringer"])),
        ("width", f3(stairs["width"])),
        ("minWidthMm", f3(MIN_WIDTH_MM)),
        ("twoRPlusT", f3(stairs["twoRPlusT"])),
        ("checks", jobj([
            ("riser", flag(stairs["checks"]["riser"])),
            ("tread", flag(stairs["checks"]["tread"])),
            ("width", flag(stairs["checks"]["width"])),
            ("comfort", flag(stairs["checks"]["comfort"])),
        ])),
        ("pass", flag(stairs["pass"])),
    ])

    document = jobj([
        ("project", jstr(plan.get("project", ""))),
        ("units", jstr(plan.get("units", "m"))),
        ("walls", jarr(wall_rows)),
        ("rooms", jarr(room_rows)),
        ("totals", jobj([
            ("wallCount", str(len(metrics))),
            ("roomCount", str(len(rooms))),
            ("wallGrossArea", f3(sum(w["gross"] for w in metrics))),
            ("wallNetArea", f3(finishes["wallNetArea"])),
            ("openingArea", f3(sum(w["openings"] for w in metrics))),
            ("roomArea", f3(total_area)),
            ("roomVolume", f3(total_volume)),
            ("meanHeight", f3(mean_height)),
        ])),
        ("finishes", jobj([
            ("wallNetArea", f3(finishes["wallNetArea"])),
            ("ceilingArea", f3(finishes["ceilingArea"])),
            ("drywallSheets", str(finishes["drywallSheets"])),
            ("paintLitres", str(finishes["paintLitres"])),
            ("paintCoats", "2"),
            ("flooringM2", f3(finishes["flooringM2"])),
            ("baseboardM", f3(finishes["baseboardM"])),
        ])),
        ("framing", jobj([
            ("spacingMm", f3(framing["spacingMm"])),
            ("studs", str(framing["studs"])),
            ("studsByWall", jarr([str(n) for n in framing["studsByWall"]])),
            ("plates", f3(framing["plates"])),
            ("sheathingPanels", str(framing["sheathingPanels"])),
            ("sizing", sizing_json(sizing, "framing")),
        ])),
        ("stairs", stairs_obj),
        ("deck", jobj([
            ("joistSpan", f3(deck["joistSpan"])),
            ("joistSpacing", f3(deck["joistSpacing"])),
            ("joistCount", str(deck["joistCount"])),
            ("postSpacing", f3(deck["postSpacing"])),
            ("postLoadLb", f3(deck["postLoadLb"])),
            ("soil", jstr(deck["soil"])),
            ("soilPsf", f3(deck["soilPsf"])),
            ("footingDiameterIn", f3(deck["footingDiameterIn"])),
            ("footingVolume", f3(deck["footingVolume"])),
            ("concreteBags", str(deck["concreteBags"])),
            ("boards", str(deck["boards"])),
            ("sizing", sizing_json(sizing, "deck")),
        ])),
        ("roof", jobj([
            ("planArea", f3(roof["planArea"])),
            ("pitch", f3(roof["pitch"])),
            ("slopeFactor", f3(roof["slopeFactor"])),
            ("angle", f3(roof["angle"])),
            ("roofArea", f3(roof["roofArea"])),
            ("squares", f3(roof["squares"])),
            ("bundles", str(roof["bundles"])),
            ("design", roof_design_json(plan)),
        ])),
        ("electrical", jobj([
            ("areaM2", f3(electrical["areaM2"])),
            ("areaFt2", f3(electrical["areaFt2"])),
            ("generalVa", f3(electrical["generalVa"])),
            ("sabcVa", f3(electrical["sabcVa"])),
            ("laundryVa", f3(electrical["laundryVa"])),
            ("serviceDemandVa", f3(electrical["serviceDemandVa"])),
            ("applianceVa", f3(electrical["applianceVa"])),
            ("hvacVa", f3(electrical["hvacVa"])),
            ("totalVa", f3(electrical["totalVa"])),
            ("amps", f3(electrical["amps"])),
            ("serviceAmps", f3(electrical["serviceAmps"])),
            ("optionalVa", f3(electrical["optionalVa"])),
            ("optionalAmps", f3(electrical["optionalAmps"])),
        ])),
        ("cutList", jobj([
            ("groups", jarr(group_rows)),
            ("csv", jstr(cut_list_csv(groups))),
        ])),
        ("wireframe", jobj([
            ("vertices", str(wireframe["vertices"])),
            ("edges", str(wireframe["edges"])),
            ("objHash", jstr(wireframe["objHash"])),
        ])),
        ("plumbing", plumbing),
        ("lighting", lighting),
        ("landscape", landscape),
    ])
    return document


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(argv) < 2:
        print("usage: floorplan_core.py <plan.json>", file=sys.stderr)
        return 2
    with open(argv[1], "r", encoding="utf-8") as handle:
        plan = json.load(handle)
    sys.stdout.write(compute(plan))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
