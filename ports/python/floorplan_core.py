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
    ])
    return document


def main(argv):
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
