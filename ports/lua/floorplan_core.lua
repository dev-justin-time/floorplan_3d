-- floorplan3d core features: geometry, takeoffs, framing, stairs, deck, roof,
-- electrical, cut list and wireframe export.
--
-- This is the Lua member of `ports/`. It reads the same plan JSON and prints the
-- same canonical result JSON as `ports/python` and `ports/rust`, so
-- `ports/run-parity.mjs` can diff them. Plain Lua 5.3, no modules.
--
-- Usage: lua floorplan_core.lua <plan.json>

local IN = 0.0254
local FT = 12 * IN
local M2_PER_SQFT = 0.09290304
local DRYWALL_SHEET_M2 = 2.4 * 1.2
local SQFT_PER_SQUARE = 100.0
local CONCRETE_BAG_M3 = 0.017
-- FNV-1a 32-bit, and the offset basis written as a signed 32-bit value so a Lua
-- build with 32-bit integers (fengari) reads it as the same bit pattern.
local FNV_OFFSET = -2128831035 -- 0x811C9DC5
local FNV_PRIME = 16777619 -- 0x01000193
local MASK32 = 0xFFFFFFFF

local MAX_RISER_MM = 196.0
local MIN_TREAD_MM = 254.0
local MIN_WIDTH_MM = 914.0
local COMFORT_TARGET = 25 * IN
local COMFORT_MIN = 24 * IN
local COMFORT_MAX = 25 * IN
local MAX_TREAD = 0.36

-- NDS reference design values in psi: Fb bending, Fv shear, E modulus. The keys
-- match the species list on the site's span calculator; values are NDS Supplement
-- reference values for visually graded dimension lumber at 19% moisture content and
-- normal load duration. No adjustment factors (Cd, Cr, CM, CL) are applied.
local SPECIES = {
    ["dfl-1"] = { 1000.0, 180.0, 1700000.0 },
    ["dfl-2"] = { 900.0, 180.0, 1600000.0 },
    ["sp-1"] = { 1150.0, 175.0, 1600000.0 },
    ["sp-2"] = { 850.0, 175.0, 1400000.0 },
    ["spf-1"] = { 875.0, 135.0, 1400000.0 },
    ["spf-2"] = { 775.0, 135.0, 1300000.0 },
}

-- Dressed width and depth in inches for a nominal lumber size.
local SECTIONS = {
    ["1x4"] = { 0.75, 3.5 },
    ["1x6"] = { 0.75, 5.5 },
    ["1x8"] = { 0.75, 7.25 },
    ["2x2"] = { 1.5, 1.5 },
    ["2x4"] = { 1.5, 3.5 },
    ["2x6"] = { 1.5, 5.5 },
    ["2x8"] = { 1.5, 7.25 },
    ["2x10"] = { 1.5, 9.25 },
    ["2x12"] = { 1.5, 11.25 },
    ["4x4"] = { 3.5, 3.5 },
    ["6x6"] = { 5.5, 5.5 },
    ["5/4x6"] = { 1.0, 5.5 },
}

local SOIL_PSF = { clay = 1500, sand = 3000, gravel = 3000, silt = 1500 }
local DEFAULT_SOIL_PSF = 2000
local DECK_LOAD_PSF = 50.0
local SERVICE_SIZES = { 100, 125, 150, 200, 225, 320, 400 }

-- --- helpers ---------------------------------------------------------------

local function r3(value)
    local scaled = value * 1000.0
    local rounded
    if scaled >= 0 then
        rounded = math.floor(scaled + 0.5)
    else
        rounded = math.ceil(scaled - 0.5)
    end
    return rounded / 1000.0
end

local function clamp(value, low, high)
    if value < low then return low end
    if value > high then return high end
    return value
end

local function f3(value)
    value = r3(value)
    if value == math.floor(value) then
        return string.format("%d", math.floor(value))
    end
    return string.format("%.3f", value)
end

local function jstr(text)
    text = tostring(text)
    local out = text:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n")
    return '"' .. out .. '"'
end

local function jobj(pairs)
    local parts = {}
    for i = 1, #pairs do
        parts[i] = jstr(pairs[i][1]) .. ":" .. pairs[i][2]
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

local function jarr(items)
    return "[" .. table.concat(items, ",") .. "]"
end

local function flag(value)
    if value then return "true" end
    return "false"
end

local function max_of(a, b)
    if a > b then return a end
    return b
end

-- --- JSON reader -----------------------------------------------------------

local function skip_ws(text, at)
    while at <= #text do
        local ch = text:sub(at, at)
        if ch == " " or ch == "\t" or ch == "\r" or ch == "\n" then
            at = at + 1
        else
            break
        end
    end
    return at
end

local parse_value

local function parse_string(text, at)
    at = at + 1 -- opening quote
    local parts = {}
    while at <= #text do
        local ch = text:sub(at, at)
        if ch == '"' then
            at = at + 1
            return table.concat(parts), at
        elseif ch == "\\" then
            local esc = text:sub(at + 1, at + 1)
            if esc == "n" then
                parts[#parts + 1] = "\n"
            elseif esc == "t" then
                parts[#parts + 1] = "\t"
            else
                parts[#parts + 1] = esc
            end
            at = at + 2
        else
            parts[#parts + 1] = ch
            at = at + 1
        end
    end
    return table.concat(parts), at
end

local function parse_number(text, at)
    local rest = text:sub(at)
    local token = rest:match("^-?%d+%.?%d*[eE]?[-+]?%d*")
    if not token or token == "" then
        return 0, at + 1
    end
    return tonumber(token) or 0, at + #token
end

local function parse_object(text, at)
    at = at + 1 -- {
    local obj = { __object = true }
    while true do
        at = skip_ws(text, at)
        if text:sub(at, at) == "}" then
            return obj, at + 1
        end
        local key
        key, at = parse_string(text, at)
        at = skip_ws(text, at)
        if text:sub(at, at) == ":" then
            at = at + 1
        end
        local value
        value, at = parse_value(text, at)
        obj[key] = value
        at = skip_ws(text, at)
        if text:sub(at, at) == "," then
            at = at + 1
        end
    end
end

local function parse_array(text, at)
    at = at + 1 -- [
    local list = { __array = true }
    while true do
        at = skip_ws(text, at)
        if text:sub(at, at) == "]" then
            return list, at + 1
        end
        local value
        value, at = parse_value(text, at)
        list[#list + 1] = value
        at = skip_ws(text, at)
        if text:sub(at, at) == "," then
            at = at + 1
        end
    end
end

parse_value = function(text, at)
    at = skip_ws(text, at)
    local ch = text:sub(at, at)
    if ch == "{" then
        return parse_object(text, at)
    elseif ch == "[" then
        return parse_array(text, at)
    elseif ch == '"' then
        return parse_string(text, at)
    elseif ch == "t" then
        return true, at + 4
    elseif ch == "f" then
        return false, at + 5
    elseif ch == "n" then
        return nil, at + 4
    end
    return parse_number(text, at)
end

local function parse_json(text)
    local value = parse_value(text, 1)
    return value
end

local function field(obj, key)
    if type(obj) == "table" then
        return obj[key]
    end
    return nil
end

local function number_or(value, default)
    if type(value) == "number" then return value end
    if type(value) == "string" then return tonumber(value) or default end
    return default
end

local function text_or(value, default)
    if type(value) == "string" then return value end
    return default
end

local function items(value)
    if type(value) == "table" then return value end
    return { __array = true }
end

-- --- geometry --------------------------------------------------------------

local function polygon_area(points)
    local total = 0.0
    local count = #points
    for i = 1, count do
        local first = points[i]
        local second = points[(i % count) + 1]
        total = total + first[1] * second[2] - second[1] * first[2]
    end
    return math.abs(total) / 2.0
end

local function polygon_perimeter(points)
    local total = 0.0
    local count = #points
    for i = 1, count do
        local first = points[i]
        local second = points[(i % count) + 1]
        local dx = second[1] - first[1]
        local dy = second[2] - first[2]
        total = total + math.sqrt(dx * dx + dy * dy)
    end
    return total
end

local function polygon_centroid(points)
    local count = #points
    if count == 0 then return 0.0, 0.0 end
    local twice, cx, cy = 0.0, 0.0, 0.0
    for i = 1, count do
        local first = points[i]
        local second = points[(i % count) + 1]
        local cross = first[1] * second[2] - second[1] * first[2]
        twice = twice + cross
        cx = cx + (first[1] + second[1]) * cross
        cy = cy + (first[2] + second[2]) * cross
    end
    if math.abs(twice) < 1e-12 then
        local sx, sy = 0.0, 0.0
        for i = 1, count do
            sx = sx + points[i][1]
            sy = sy + points[i][2]
        end
        return sx / count, sy / count
    end
    return cx / (3.0 * twice), cy / (3.0 * twice)
end

local function wall_metrics(wall, default_height)
    local x1 = number_or(field(wall, "x1"), 0.0)
    local y1 = number_or(field(wall, "y1"), 0.0)
    local x2 = number_or(field(wall, "x2"), 0.0)
    local y2 = number_or(field(wall, "y2"), 0.0)
    local height = number_or(field(wall, "height"), default_height)
    local dx, dy = x2 - x1, y2 - y1
    local length = math.sqrt(dx * dx + dy * dy)
    local angle = math.deg(math.atan(dy, dx)) % 360.0
    local gross = length * height

    local openings = items(field(wall, "openings"))
    local opening_area, opening_widths = 0.0, 0.0
    for i = 1, #openings do
        local opening = openings[i]
        local width = number_or(field(opening, "width"), 0.0)
        local open_height = number_or(field(opening, "height"), 0.0)
        opening_area = opening_area + width * open_height
        opening_widths = opening_widths + width
    end
    if opening_area > gross then opening_area = gross end

    return {
        length = length,
        angle = angle,
        height = height,
        gross = gross,
        openings = opening_area,
        net = gross - opening_area,
        opening_widths = opening_widths,
        opening_count = #openings,
    }
end

-- --- feature sections ------------------------------------------------------

local function build_rooms(plan)
    local default_height = number_or(field(plan, "wallHeight"), 2.7)
    local rooms = {}
    local source = items(field(plan, "rooms"))
    for i = 1, #source do
        local room = source[i]
        local points = {}
        local polygon = items(field(room, "polygon"))
        for j = 1, #polygon do
            local point = polygon[j]
            points[j] = { number_or(point[1], 0.0), number_or(point[2], 0.0) }
        end
        local area = polygon_area(points)
        local height = number_or(field(room, "height"), default_height)
        local cx, cy = polygon_centroid(points)
        rooms[i] = {
            name = text_or(field(room, "name"), "Room"),
            area = area,
            perimeter = polygon_perimeter(points),
            centroid_x = cx,
            centroid_y = cy,
            height = height,
            volume = area * height,
        }
    end
    return rooms
end

local function build_finishes(rooms, walls, plan)
    local net_area = 0.0
    for i = 1, #walls do net_area = net_area + walls[i].net end
    local ceiling = 0.0
    for i = 1, #rooms do ceiling = ceiling + rooms[i].area end

    local covered = net_area + ceiling
    local drywall = 0
    local paint = 0
    if covered > 0 then
        drywall = math.ceil(covered / DRYWALL_SHEET_M2 - 1e-9)
        paint = math.ceil((covered * 2.0) / 10.0 - 1e-9)
    end

    local waste = number_or(field(plan, "wastePct"), 10.0) / 100.0
    local flooring = ceiling * (1.0 + waste)
    local baseboard = 0.0
    for i = 1, #rooms do baseboard = baseboard + rooms[i].perimeter end
    for i = 1, #walls do baseboard = baseboard - walls[i].opening_widths end

    return {
        wall_net_area = net_area,
        ceiling_area = ceiling,
        drywall_sheets = drywall,
        paint_litres = paint,
        flooring_m2 = max_of(flooring, 0.0),
        baseboard_m = max_of(baseboard, 0.0),
    }
end

local function build_framing(walls, plan)
    local spacing = number_or(field(plan, "studSpacingMm"), 406.0)
    local studs_by_wall = {}
    local studs = 0
    for i = 1, #walls do
        local wall = walls[i]
        local run = math.floor(wall.length * 1000.0 / spacing + 1e-9) + 1
        run = run + 2 * wall.opening_count
        studs_by_wall[i] = run
        studs = studs + run
    end
    local length_sum = 0.0
    local gross = 0.0
    for i = 1, #walls do
        length_sum = length_sum + walls[i].length
        gross = gross + walls[i].gross
    end
    local panels = 0
    if gross > 0 then
        panels = math.ceil(gross / DRYWALL_SHEET_M2 - 1e-9)
    end
    return {
        spacing_mm = spacing,
        studs = studs,
        studs_by_wall = studs_by_wall,
        plates = length_sum * 3.0,
        sheathing_panels = panels,
    }
end

-- --- NDS member sizing ------------------------------------------------------

-- One member checked as a simply supported, uniformly loaded beam.
local function build_sizing(plan)
    local sizing = field(plan, "sizing") or {}
    local default_species = text_or(field(sizing, "species"), "spf-2")
    local default_limit = number_or(field(sizing, "limit"), 360.0)
    local members = {}
    local source = items(field(sizing, "members"))

    for i = 1, #source do
        local member = source[i]
        local size = text_or(field(member, "size"), "")
        local section = SECTIONS[size]
        if section then -- unknown nominal size: nothing to size
            local b, d = section[1], section[2]
            local species = text_or(field(member, "species"), default_species)
            local values = SPECIES[species] or SPECIES["spf-2"]
            if not SPECIES[species] then species = "spf-2" end
            local fb, fv, e = values[1], values[2], values[3]
            local load = number_or(field(member, "load"), 0.0)
            local spacing = number_or(field(member, "spacing"), 0.0)
            local span = number_or(field(member, "span"), 0.0)
            local limit = number_or(field(member, "limit"), default_limit)

            local area = b * d
            local section_modulus = b * d * d / 6.0
            local inertia = b * d * d * d / 12.0
            -- Uniform load along the member, lb per inch of span.
            local distributed = load * (spacing / FT) / 12.0

            local bending, shear, deflection = 0.0, 0.0, 0.0
            local allowable = 0.0
            local governing = "none"
            local passed = false

            if distributed > 0 then
                -- M = wL^2/8 and fb = M/S  =>  L = sqrt(8 Fb S / w).
                bending = math.sqrt(8.0 * fb * section_modulus / distributed) * IN
                -- V = wL/2 and fv = 1.5 V/A  =>  L = 4 Fv A / (3 w).
                shear = 4.0 * fv * area / (3.0 * distributed) * IN
                -- delta = 5wL^4/(384EI) <= L/limit  =>  L = cbrt(384 E I / (5 limit w)).
                deflection = (384.0 * e * inertia / (5.0 * limit * distributed)) ^ (1.0 / 3.0) * IN

                allowable = bending
                governing = "bending"
                if shear < allowable then
                    allowable = shear
                    governing = "shear"
                end
                if deflection < allowable then
                    allowable = deflection
                    governing = "deflection"
                end
                passed = span <= allowable + 1e-9
            end

            members[#members + 1] = {
                id = text_or(field(member, "id"), ""),
                group = text_or(field(member, "group"), "framing"),
                size = size,
                species = species,
                b = b,
                d = d,
                area = area,
                section_modulus = section_modulus,
                inertia = inertia,
                load = load,
                spacing = spacing,
                span = span,
                limit = limit,
                plf = distributed * 12.0,
                bending = bending,
                shear = shear,
                deflection = deflection,
                allowable = allowable,
                governing = governing,
                pass = passed,
            }
        end
    end
    return members
end

local function sized_json(member)
    return jobj({
        { "id", jstr(member.id) },
        { "group", jstr(member.group) },
        { "size", jstr(member.size) },
        { "species", jstr(member.species) },
        { "bIn", f3(member.b) },
        { "dIn", f3(member.d) },
        { "areaIn2", f3(member.area) },
        { "sectionModulusIn3", f3(member.section_modulus) },
        { "inertiaIn4", f3(member.inertia) },
        { "loadPsf", f3(member.load) },
        { "spacing", f3(member.spacing) },
        { "span", f3(member.span) },
        { "plf", f3(member.plf) },
        { "limit", f3(member.limit) },
        { "bendingSpan", f3(member.bending) },
        { "shearSpan", f3(member.shear) },
        { "deflectionSpan", f3(member.deflection) },
        { "allowableSpan", f3(member.allowable) },
        { "governing", jstr(member.governing) },
        { "pass", flag(member.pass) },
    })
end

-- The sized members of one suite, in input order.
local function sizing_json(members, group)
    local rows = {}
    local count = 0
    local passed = true
    for i = 1, #members do
        local member = members[i]
        if member.group == group then
            count = count + 1
            if not member.pass then passed = false end
            rows[#rows + 1] = sized_json(member)
        end
    end
    return jobj({
        { "count", tostring(count) },
        { "pass", flag(passed) },
        { "members", jarr(rows) },
    })
end

local function build_stairs(stairs)
    local rise = number_or(field(stairs, "rise"), 0.0)
    local width = number_or(field(stairs, "width"), 0.0)
    local run_available = number_or(field(stairs, "runAvailable"), 0.0)

    local max_riser = MAX_RISER_MM / 1000.0
    local min_tread = MIN_TREAD_MM / 1000.0
    local risers = max_of(3, math.ceil(rise / max_riser - 1e-9))
    local riser_height = rise / risers
    local treads = risers - 1
    local tread = clamp(COMFORT_TARGET - 2.0 * riser_height, min_tread, MAX_TREAD)
    if run_available > 0 then
        tread = clamp(run_available / treads, 0.0, MAX_TREAD)
    end
    local run = tread * treads
    local stringer = math.sqrt(rise * rise + run * run)
    local two_r_plus_t = 2.0 * riser_height + tread

    local checks = {
        riser = riser_height <= max_riser + 1e-9,
        tread = tread >= min_tread - 1e-9,
        width = width >= MIN_WIDTH_MM / 1000.0 - 1e-9,
        comfort = two_r_plus_t >= COMFORT_MIN - 1e-9 and two_r_plus_t <= COMFORT_MAX + 1e-9,
    }

    return {
        risers = risers,
        riser_height = riser_height,
        treads = treads,
        tread = tread,
        run = run,
        run_available = run_available,
        total_rise = rise,
        stringer = stringer,
        width = width,
        two_r_plus_t = two_r_plus_t,
        checks = checks,
        pass = checks.riser and checks.tread and checks.width and checks.comfort,
    }
end

local function build_deck(deck)
    local joist_span = number_or(field(deck, "joistSpan"), 0.0)
    local joist_spacing = number_or(field(deck, "joistSpacing"), 0.406)
    local post_spacing = number_or(field(deck, "postSpacing"), 0.0)
    local soil = text_or(field(deck, "soil"), "default")
    local soil_psf = SOIL_PSF[soil] or DEFAULT_SOIL_PSF
    local depth = number_or(field(deck, "depth"), 0.9)
    local width = number_or(field(deck, "width"), 0.0)

    local joist_count = math.floor(joist_span / joist_spacing + 1e-9) + 1
    local post_load_lb = math.floor(DECK_LOAD_PSF * (post_spacing / FT) * (joist_span / FT) / 2.0 + 0.5)
    local footing_area_ft2 = post_load_lb / soil_psf
    local required = 12.0 * math.sqrt(max_of(0.0, 4.0 * footing_area_ft2 / math.pi))
    local diameter_in = max_of(12.0, math.ceil(required - 1e-9))
    local radius = diameter_in * IN
    local volume = math.pi / 4.0 * (radius * radius) * depth
    local bags = 0
    if volume > 0 then bags = math.ceil(volume / CONCRETE_BAG_M3 - 1e-9) end
    local boards = 0
    if width > 0 then boards = math.ceil(width * 1000.0 / (140.0 + 5.0) - 1e-9) end

    return {
        joist_span = joist_span,
        joist_spacing = joist_spacing,
        joist_count = joist_count,
        post_spacing = post_spacing,
        post_load_lb = post_load_lb,
        soil = soil,
        soil_psf = soil_psf,
        footing_diameter_in = diameter_in,
        footing_volume = volume,
        concrete_bags = bags,
        boards = boards,
    }
end

local function build_roof(roof)
    local plan_area = number_or(field(roof, "planArea"), 0.0)
    local pitch = number_or(field(roof, "pitch"), 0.0)
    local slope_factor = math.sqrt(1.0 + (pitch / 12.0) * (pitch / 12.0))
    local roof_area = plan_area * slope_factor
    local squares = roof_area / (SQFT_PER_SQUARE * M2_PER_SQFT)
    local bundles = 0
    if squares > 0 then bundles = math.ceil(squares * 3.0 - 1e-9) end
    return {
        plan_area = plan_area,
        pitch = pitch,
        slope_factor = slope_factor,
        angle = math.deg(math.atan(pitch / 12.0)),
        roof_area = roof_area,
        squares = squares,
        bundles = bundles,
    }
end

local function build_electrical(electrical)
    local area_m2 = number_or(field(electrical, "areaM2"), 0.0)
    local sabc = number_or(field(electrical, "smallApplianceCircuits"), 0.0)
    local laundry = number_or(field(electrical, "laundryCircuits"), 0.0)
    local appliances = number_or(field(electrical, "appliancesVa"), 0.0)
    local heating = number_or(field(electrical, "heatingVa"), 0.0)
    local cooling = number_or(field(electrical, "coolingVa"), 0.0)

    local area_ft2 = area_m2 / M2_PER_SQFT
    local general = area_ft2 * 3.0
    local sabc_va = sabc * 1500.0
    local laundry_va = laundry * 1500.0
    local subtotal = general + sabc_va + laundry_va

    local first = math.min(subtotal, 3000.0)
    local second = clamp(subtotal, 3000.0, 120000.0) - 3000.0
    local third = max_of(0.0, subtotal - 120000.0)
    local demand = first + second * 0.35 + third * 0.25

    local appliance_demand = appliances * 0.75
    local hvac = max_of(heating, cooling)
    local total = demand + appliance_demand + hvac
    local amps = 0.0
    if total > 0 then amps = math.ceil(total / 240.0 - 1e-9) end
    local service = SERVICE_SIZES[#SERVICE_SIZES]
    for i = 1, #SERVICE_SIZES do
        if SERVICE_SIZES[i] >= amps then
            service = SERVICE_SIZES[i]
            break
        end
    end

    local optional_base = general + sabc_va + laundry_va + appliances
    local optional = math.min(optional_base, 10000.0) + max_of(0.0, optional_base - 10000.0) * 0.40 + hvac
    local optional_amps = 0.0
    if optional > 0 then optional_amps = math.ceil(optional / 240.0 - 1e-9) end

    return {
        area_m2 = area_m2,
        area_ft2 = area_ft2,
        general_va = general,
        sabc_va = sabc_va,
        laundry_va = laundry_va,
        service_demand_va = demand,
        appliance_va = appliance_demand,
        hvac_va = hvac,
        total_va = total,
        amps = amps,
        service_amps = service,
        optional_va = optional,
        optional_amps = optional_amps,
    }
end

local function build_cut_list(fixtures)
    local groups = {}
    local order = {}
    for i = 1, #fixtures do
        local fixture = fixtures[i]
        local kind = text_or(field(fixture, "type"), "item")
        local width = r3(number_or(field(fixture, "width"), 0.0))
        local depth = r3(number_or(field(fixture, "depth"), 0.0))
        local height = r3(number_or(field(fixture, "height"), 0.0))
        local key = kind .. "|" .. tostring(width) .. "|" .. tostring(depth) .. "|" .. tostring(height)
        if not groups[key] then
            groups[key] = {
                kind = kind,
                label = text_or(field(fixture, "label"), kind:gsub("_", " ")),
                width = width,
                depth = depth,
                height = height,
                ids = {},
            }
            order[#order + 1] = key
        end
        local group = groups[key]
        group.ids[#group.ids + 1] = text_or(field(fixture, "id"), "")
    end

    local rows = {}
    for i = 1, #order do rows[i] = groups[order[i]] end
    table.sort(rows, function(a, b)
        if a.kind ~= b.kind then return a.kind < b.kind end
        if a.width ~= b.width then return a.width < b.width end
        if a.depth ~= b.depth then return a.depth < b.depth end
        return a.height < b.height
    end)
    return rows
end

local function cut_list_csv(groups)
    local lines = { "type,label,count,width_m,depth_m,height_m" }
    for i = 1, #groups do
        local group = groups[i]
        lines[#lines + 1] = string.format(
            "%s,%s,%d,%.3f,%.3f,%.3f",
            group.kind,
            group.label,
            #group.ids,
            group.width,
            group.depth,
            group.height
        )
    end
    return table.concat(lines, "\n")
end

local function fnv1a32(text)
    local hash = FNV_OFFSET
    for i = 1, #text do
        hash = hash ~ string.byte(text, i)
        hash = hash * FNV_PRIME
        hash = hash & MASK32
    end
    return hash
end

local function build_wireframe(walls, depth)
    local lines = {}
    local vertices, edges = 0, 0
    for i = 1, #walls do
        local wall = walls[i]
        local x1 = number_or(field(wall, "x1"), 0.0)
        local y1 = number_or(field(wall, "y1"), 0.0)
        local x2 = number_or(field(wall, "x2"), 0.0)
        local y2 = number_or(field(wall, "y2"), 0.0)
        lines[#lines + 1] = string.format("v %.3f %.3f %.3f", x1, y1, 0.0)
        lines[#lines + 1] = string.format("v %.3f %.3f %.3f", x2, y2, 0.0)
        lines[#lines + 1] = string.format("v %.3f %.3f %.3f", x1, y1, depth)
        lines[#lines + 1] = string.format("v %.3f %.3f %.3f", x2, y2, depth)
        lines[#lines + 1] = string.format("l %d %d", vertices + 1, vertices + 2)
        lines[#lines + 1] = string.format("l %d %d", vertices + 3, vertices + 4)
        lines[#lines + 1] = string.format("l %d %d", vertices + 1, vertices + 3)
        lines[#lines + 1] = string.format("l %d %d", vertices + 2, vertices + 4)
        vertices = vertices + 4
        edges = edges + 4
    end
    local text = table.concat(lines, "\n")
    return vertices, edges, string.format("%08x", fnv1a32(text))
end

-- --- document --------------------------------------------------------------

local function compute(plan)
    local wall_height = number_or(field(plan, "wallHeight"), 2.7)
    local wall_source = items(field(plan, "walls"))
    local walls = {}
    for i = 1, #wall_source do
        walls[i] = wall_metrics(wall_source[i], wall_height)
    end
    local rooms = build_rooms(plan)
    local finishes = build_finishes(rooms, walls, plan)
    local framing = build_framing(walls, plan)
    local sizing = build_sizing(plan)
    local stairs = build_stairs(field(plan, "stairs") or {})
    local deck = build_deck(field(plan, "deck") or {})
    local roof = build_roof(field(plan, "roof") or {})
    local electrical = build_electrical(field(plan, "electrical") or {})
    local groups = build_cut_list(items(field(plan, "fixtures")))
    local vertices, edges, obj_hash = build_wireframe(wall_source, wall_height)

    local total_area, total_volume = 0.0, 0.0
    for i = 1, #rooms do
        total_area = total_area + rooms[i].area
        total_volume = total_volume + rooms[i].volume
    end
    local mean_height = wall_height
    if #walls > 0 then
        local sum = 0.0
        for i = 1, #walls do sum = sum + walls[i].height end
        mean_height = sum / #walls
    end

    local gross_sum, opening_sum = 0.0, 0.0
    for i = 1, #walls do
        gross_sum = gross_sum + walls[i].gross
        opening_sum = opening_sum + walls[i].openings
    end

    local wall_rows = {}
    for i = 1, #walls do
        local wall = walls[i]
        wall_rows[i] = jobj({
            { "index", tostring(i - 1) },
            { "length", f3(wall.length) },
            { "angle", string.format("%.2f", wall.angle) },
            { "height", f3(wall.height) },
            { "gross", f3(wall.gross) },
            { "openings", f3(wall.openings) },
            { "net", f3(wall.net) },
        })
    end

    local room_rows = {}
    for i = 1, #rooms do
        local room = rooms[i]
        room_rows[i] = jobj({
            { "name", jstr(room.name) },
            { "area", f3(room.area) },
            { "perimeter", f3(room.perimeter) },
            { "centroid", jarr({ f3(room.centroid_x), f3(room.centroid_y) }) },
            { "height", f3(room.height) },
            { "volume", f3(room.volume) },
        })
    end

    local group_rows = {}
    for i = 1, #groups do
        local group = groups[i]
        local ids = {}
        for j = 1, #group.ids do ids[j] = jstr(group.ids[j]) end
        group_rows[i] = jobj({
            { "type", jstr(group.kind) },
            { "label", jstr(group.label) },
            { "count", tostring(#group.ids) },
            { "width", f3(group.width) },
            { "depth", f3(group.depth) },
            { "height", f3(group.height) },
            { "ids", jarr(ids) },
        })
    end

    local studs_by_wall = {}
    for i = 1, #framing.studs_by_wall do
        studs_by_wall[i] = tostring(framing.studs_by_wall[i])
    end

    local stairs_obj = jobj({
        { "risers", tostring(stairs.risers) },
        { "riserHeight", f3(stairs.riser_height) },
        { "maxRiserMm", f3(MAX_RISER_MM) },
        { "treads", tostring(stairs.treads) },
        { "tread", f3(stairs.tread) },
        { "minTreadMm", f3(MIN_TREAD_MM) },
        { "run", f3(stairs.run) },
        { "runAvailable", f3(stairs.run_available) },
        { "totalRise", f3(stairs.total_rise) },
        { "stringer", f3(stairs.stringer) },
        { "width", f3(stairs.width) },
        { "minWidthMm", f3(MIN_WIDTH_MM) },
        { "twoRPlusT", f3(stairs.two_r_plus_t) },
        { "checks", jobj({
            { "riser", flag(stairs.checks.riser) },
            { "tread", flag(stairs.checks.tread) },
            { "width", flag(stairs.checks.width) },
            { "comfort", flag(stairs.checks.comfort) },
        }) },
        { "pass", flag(stairs.pass) },
    })

    return jobj({
        { "project", jstr(text_or(field(plan, "project"), "")) },
        { "units", jstr(text_or(field(plan, "units"), "m")) },
        { "walls", jarr(wall_rows) },
        { "rooms", jarr(room_rows) },
        { "totals", jobj({
            { "wallCount", tostring(#walls) },
            { "roomCount", tostring(#rooms) },
            { "wallGrossArea", f3(gross_sum) },
            { "wallNetArea", f3(finishes.wall_net_area) },
            { "openingArea", f3(opening_sum) },
            { "roomArea", f3(total_area) },
            { "roomVolume", f3(total_volume) },
            { "meanHeight", f3(mean_height) },
        }) },
        { "finishes", jobj({
            { "wallNetArea", f3(finishes.wall_net_area) },
            { "ceilingArea", f3(finishes.ceiling_area) },
            { "drywallSheets", tostring(finishes.drywall_sheets) },
            { "paintLitres", tostring(finishes.paint_litres) },
            { "paintCoats", "2" },
            { "flooringM2", f3(finishes.flooring_m2) },
            { "baseboardM", f3(finishes.baseboard_m) },
        }) },
        { "framing", jobj({
            { "spacingMm", f3(framing.spacing_mm) },
            { "studs", tostring(framing.studs) },
            { "studsByWall", jarr(studs_by_wall) },
            { "plates", f3(framing.plates) },
            { "sheathingPanels", tostring(framing.sheathing_panels) },
            { "sizing", sizing_json(sizing, "framing") },
        }) },
        { "stairs", stairs_obj },
        { "deck", jobj({
            { "joistSpan", f3(deck.joist_span) },
            { "joistSpacing", f3(deck.joist_spacing) },
            { "joistCount", tostring(deck.joist_count) },
            { "postSpacing", f3(deck.post_spacing) },
            { "postLoadLb", f3(deck.post_load_lb) },
            { "soil", jstr(deck.soil) },
            { "soilPsf", f3(deck.soil_psf) },
            { "footingDiameterIn", f3(deck.footing_diameter_in) },
            { "footingVolume", f3(deck.footing_volume) },
            { "concreteBags", tostring(deck.concrete_bags) },
            { "boards", tostring(deck.boards) },
            { "sizing", sizing_json(sizing, "deck") },
        }) },
        { "roof", jobj({
            { "planArea", f3(roof.plan_area) },
            { "pitch", f3(roof.pitch) },
            { "slopeFactor", f3(roof.slope_factor) },
            { "angle", f3(roof.angle) },
            { "roofArea", f3(roof.roof_area) },
            { "squares", f3(roof.squares) },
            { "bundles", tostring(roof.bundles) },
        }) },
        { "electrical", jobj({
            { "areaM2", f3(electrical.area_m2) },
            { "areaFt2", f3(electrical.area_ft2) },
            { "generalVa", f3(electrical.general_va) },
            { "sabcVa", f3(electrical.sabc_va) },
            { "laundryVa", f3(electrical.laundry_va) },
            { "serviceDemandVa", f3(electrical.service_demand_va) },
            { "applianceVa", f3(electrical.appliance_va) },
            { "hvacVa", f3(electrical.hvac_va) },
            { "totalVa", f3(electrical.total_va) },
            { "amps", f3(electrical.amps) },
            { "serviceAmps", f3(electrical.service_amps) },
            { "optionalVa", f3(electrical.optional_va) },
            { "optionalAmps", f3(electrical.optional_amps) },
        }) },
        { "cutList", jobj({
            { "groups", jarr(group_rows) },
            { "csv", jstr(cut_list_csv(groups)) },
        }) },
        { "wireframe", jobj({
            { "vertices", tostring(vertices) },
            { "edges", tostring(edges) },
            { "objHash", jstr(obj_hash) },
        }) },
    })
end

-- --- entry point -----------------------------------------------------------

-- A minimal Lua build (fengari under node) ships io.write but not io.open, so the
-- plan can arrive as a path, as `--inline <json>`, or on stdin. Same result either
-- way; run-parity.mjs picks the form the interpreter supports.

local function warn(message)
    if io and io.stderr then
        io.stderr:write(message .. "\n")
    else
        print(message)
    end
end

local BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

-- Decode without io: used when the interpreter has no file access (fengari).
local function b64decode(text)
    local out = {}
    local buffer, bits = 0, 0
    for i = 1, #text do
        local ch = text:sub(i, i)
        if ch ~= "=" then
            local index = BASE64:find(ch, 1, true)
            if index then
                buffer = buffer * 64 + (index - 1)
                bits = bits + 6
                while bits >= 8 do
                    bits = bits - 8
                    out[#out + 1] = string.char(math.floor(buffer / (2 ^ bits)) % 256)
                end
                if bits > 0 then
                    buffer = buffer % (2 ^ bits)
                else
                    buffer = 0
                end
            end
        end
    end
    return table.concat(out)
end

local function read_plan(argv)
    local first = argv and argv[1]
    if first == "--inline" then
        return argv[2]
    end
    if first == "--b64" then
        return b64decode(argv[2] or "")
    end
    if first and io and io.open then
        local handle = io.open(first, "r")
        if not handle then return nil end
        local text = handle:read("*a")
        handle:close()
        return text
    end
    if io and io.read then
        return io.read("*a")
    end
    return nil
end

local text = read_plan(arg)
if not text then
    warn("usage: floorplan_core.lua <plan.json>  |  --inline <json>  |  --b64 <base64>")
    if os and os.exit then os.exit(2) end
    return
end

local document = compute(parse_json(text))
if io and io.write then
    io.write(document, "\n")
else
    print(document)
end
