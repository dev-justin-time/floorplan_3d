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

-- A flag reads from either a boolean or a number, so `true` and `1` agree and
-- `false` is a value rather than a missing key.
local function truthy_or(value, default)
    if type(value) == "boolean" then return value end
    if type(value) == "number" then return value ~= 0 end
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

-- --- shared helpers --------------------------------------------------------

local function round_to(value, digits)
    local factor = 10 ^ digits
    return math.floor(value * factor + 0.5) / factor
end

-- --- plumbing ---------------------------------------------------------------

-- features/plumbing/catalog.js: supply fixture units, drainage fixture units,
-- fixture drain size, IPC trap-arm limit and connected gas input.
local FIXTURE_TYPES = {
    ["toilet"] = { group = "bath", cold = 2.5, hot = 0.0, dfu = 3.0, drain = "3", trapArmMax = 1.8, btu = 0.0 },
    ["lavatory"] = { group = "bath", cold = 0.7, hot = 0.7, dfu = 1.0, drain = "1-1/4", trapArmMax = 1.5, btu = 0.0 },
    ["bathtub"] = { group = "bath", cold = 0.7, hot = 0.7, dfu = 2.0, drain = "2", trapArmMax = 1.8, btu = 0.0 },
    ["shower"] = { group = "bath", cold = 0.7, hot = 0.7, dfu = 2.0, drain = "2", trapArmMax = 1.8, btu = 0.0 },
    ["bidet"] = { group = "bath", cold = 0.7, hot = 0.7, dfu = 1.0, drain = "1-1/4", trapArmMax = 1.5, btu = 0.0 },
    ["kitchen-sink"] = { group = "kitchen", cold = 0.7, hot = 0.7, dfu = 2.0, drain = "2", trapArmMax = 1.5, btu = 0.0 },
    ["dishwasher"] = { group = "kitchen", cold = 0.0, hot = 1.0, dfu = 2.0, drain = "1-1/2", trapArmMax = 1.5, btu = 0.0 },
    ["bar-sink"] = { group = "kitchen", cold = 0.7, hot = 0.7, dfu = 1.0, drain = "1-1/4", trapArmMax = 1.5, btu = 0.0 },
    ["washing-machine"] = { group = "laundry", cold = 0.7, hot = 0.7, dfu = 2.0, drain = "2", trapArmMax = 1.8, btu = 0.0 },
    ["laundry-sink"] = { group = "laundry", cold = 0.7, hot = 0.7, dfu = 2.0, drain = "1-1/2", trapArmMax = 1.5, btu = 0.0 },
    ["utility-sink"] = { group = "utility", cold = 0.7, hot = 0.7, dfu = 2.0, drain = "1-1/2", trapArmMax = 1.5, btu = 0.0 },
    ["floor-drain"] = { group = "utility", cold = 0.0, hot = 0.0, dfu = 2.0, drain = "2", trapArmMax = 2.0, btu = 0.0 },
    ["hose-bib"] = { group = "outdoor", cold = 2.5, hot = 0.0, dfu = 0.0, drain = "", trapArmMax = 0.0, btu = 0.0 },
    ["gas-range"] = { group = "kitchen", cold = 0.0, hot = 0.0, dfu = 0.0, drain = "", trapArmMax = 0.0, btu = 65000.0 },
    ["gas-dryer"] = { group = "laundry", cold = 0.0, hot = 0.0, dfu = 0.0, drain = "", trapArmMax = 0.0, btu = 22000.0 },
    ["gas-furnace"] = { group = "utility", cold = 0.0, hot = 0.0, dfu = 0.0, drain = "", trapArmMax = 0.0, btu = 100000.0 },
    ["gas-grill"] = { group = "outdoor", cold = 0.0, hot = 0.0, dfu = 0.0, drain = "", trapArmMax = 0.0, btu = 40000.0 },
    ["gas-fireplace"] = { group = "utility", cold = 0.0, hot = 0.0, dfu = 0.0, drain = "", trapArmMax = 0.0, btu = 45000.0 },
    ["water-heater"] = { group = "utility", cold = 0.0, hot = 0.0, dfu = 0.0, drain = "", trapArmMax = 0.0, btu = 0.0 },
}

local WATER_SIZES = {
    { id = "1/2", pex = 0.475, copper = 0.545, maxWsfu = 6.0, maxServiceWsfu = 8.0 },
    { id = "3/4", pex = 0.671, copper = 0.785, maxWsfu = 12.0, maxServiceWsfu = 18.0 },
    { id = "1", pex = 0.863, copper = 0.995, maxWsfu = 25.0, maxServiceWsfu = 35.0 },
    { id = "1-1/4", pex = 1.054, copper = 1.245, maxWsfu = 45.0, maxServiceWsfu = 60.0 },
    { id = "1-1/2", pex = 1.244, copper = 1.481, maxWsfu = 75.0, maxServiceWsfu = 100.0 },
    { id = "2", pex = 1.589, copper = 1.959, maxWsfu = 130.0, maxServiceWsfu = 180.0 },
}

local DWV_SIZES = {
    { id = "1-1/4", branchDfu = 1.0, stackDfu = 2.0, mainDfu = 1.0, minSlope = 0.02 },
    { id = "1-1/2", branchDfu = 3.0, stackDfu = 5.0, mainDfu = 3.0, minSlope = 0.02 },
    { id = "2", branchDfu = 6.0, stackDfu = 10.0, mainDfu = 6.0, minSlope = 0.02 },
    { id = "3", branchDfu = 20.0, stackDfu = 30.0, mainDfu = 42.0, minSlope = 0.02 },
    { id = "4", branchDfu = 100.0, stackDfu = 160.0, mainDfu = 160.0, minSlope = 0.01 },
}

local GAS_SIZES = {
    { id = "1/2", capacity10 = 130.0 },
    { id = "3/4", capacity10 = 280.0 },
    { id = "1", capacity10 = 520.0 },
    { id = "1-1/4", capacity10 = 1100.0 },
    { id = "1-1/2", capacity10 = 1600.0 },
    { id = "2", capacity10 = 3000.0 },
}

local DEMAND_CURVE = {
    { 1.0, 1.0 }, { 2.0, 1.5 }, { 3.0, 2.5 }, { 4.0, 3.2 }, { 5.0, 3.8 }, { 6.0, 4.4 },
    { 8.0, 5.2 }, { 10.0, 5.8 }, { 15.0, 6.8 }, { 20.0, 7.6 }, { 25.0, 8.4 }, { 30.0, 9.2 },
    { 40.0, 10.4 }, { 50.0, 11.5 }, { 75.0, 13.5 }, { 100.0, 15.5 }, { 150.0, 18.5 },
    { 200.0, 21.0 },
}

local function fixture_type(type_id)
    return FIXTURE_TYPES[type_id] or FIXTURE_TYPES["toilet"]
end

local function find_size(list, size_id, fallback)
    for i = 1, #list do
        if list[i].id == size_id then return list[i] end
    end
    return list[fallback]
end

local function water_size(size_id) return find_size(WATER_SIZES, size_id, 2) end
local function dwv_size(size_id) return find_size(DWV_SIZES, size_id, 3) end
local function gas_size(size_id) return find_size(GAS_SIZES, size_id, 1) end

local function dwv_index(size_id)
    for i = 1, #DWV_SIZES do
        if DWV_SIZES[i].id == size_id then return i - 1 end
    end
    return -1
end

local function water_pipe_diameter(size_id, material)
    local size = water_size(size_id)
    if material == "copper" then return size.copper end
    return size.pex
end

local function demand_for_wsfu(wsfu)
    local value = max_of(wsfu, 0.0)
    if value <= 0 then return 0.0 end
    if value <= DEMAND_CURVE[1][1] then return DEMAND_CURVE[1][2] end
    for index = 2, #DEMAND_CURVE do
        local x1, y1 = DEMAND_CURVE[index - 1][1], DEMAND_CURVE[index - 1][2]
        local x2, y2 = DEMAND_CURVE[index][1], DEMAND_CURVE[index][2]
        if value <= x2 then
            return round_to(y1 + ((value - x1) / (x2 - x1)) * (y2 - y1), 2)
        end
    end
    return DEMAND_CURVE[#DEMAND_CURVE][2]
end

local function velocity_fps(gpm, diameter_in)
    if not (gpm > 0) or not (diameter_in > 0) then return 0.0 end
    return round_to(0.4085 * gpm / (diameter_in * diameter_in), 2)
end

local function friction_psi(gpm, diameter_in, length_m, c)
    c = c or 150.0
    if not (gpm > 0) or not (diameter_in > 0) or not (length_m > 0) then return 0.0 end
    local length_ft = length_m / 0.3048
    return round_to(4.52 * gpm ^ 1.852 * length_ft / (c ^ 1.852 * diameter_in ^ 4.871), 3)
end

local function meter_loss_psi(meter_size, demand_gpm)
    local at_ten = 2.7
    if meter_size == "5/8" then at_ten = 4.5
    elseif meter_size == "1" then at_ten = 1.7
    elseif meter_size == "1-1/4" then at_ten = 1.0
    end
    return round_to(at_ten * (max_of(demand_gpm, 0.0) / 10.0) ^ 1.85, 2)
end

local function water_size_for_wsfu(wsfu, service)
    for i = 1, #WATER_SIZES do
        local limit = service and WATER_SIZES[i].maxServiceWsfu or WATER_SIZES[i].maxWsfu
        if limit >= wsfu then return WATER_SIZES[i].id end
    end
    return WATER_SIZES[#WATER_SIZES].id
end

local function dwv_size_for(dfu, kind)
    local key = "branchDfu"
    if kind == "main" then key = "mainDfu" elseif kind == "stack" then key = "stackDfu" end
    for i = 1, #DWV_SIZES do
        if DWV_SIZES[i][key] >= dfu then return DWV_SIZES[i].id end
    end
    return DWV_SIZES[#DWV_SIZES].id
end

local function gas_capacity(size_id, length_m, fuel)
    local size = gas_size(size_id)
    local length_ft = max_of(length_m / 0.3048, 10.0)
    local derate = math.sqrt(10.0 / length_ft)
    local fuel_factor = 1.0
    if fuel == "propane" then fuel_factor = 0.94 end
    return round_to(size.capacity10 * derate * fuel_factor, 1)
end

local function gas_size_for_load(cfh, length_m, fuel)
    for i = 1, #GAS_SIZES do
        if gas_capacity(GAS_SIZES[i].id, length_m, fuel) >= cfh then return GAS_SIZES[i].id end
    end
    return GAS_SIZES[#GAS_SIZES].id
end

local function gas_cfh(btu, fuel)
    local factor = 1030.0
    if fuel == "propane" then factor = 2516.0 end
    return round_to(btu / factor, 2)
end

local function distance(a, b)
    local dx, dy = b.x - a.x, b.y - a.y
    return math.sqrt(dx * dx + dy * dy)
end

local function manhattan(a, b)
    return math.abs(a.x - b.x) + math.abs(a.y - b.y)
end

local function path_length(points)
    local total = 0.0
    for i = 2, #points do
        total = total + distance(points[i - 1], points[i])
    end
    return total
end

local function orthogonal_route(a, b)
    if math.abs(a.x - b.x) < 1e-6 or math.abs(a.y - b.y) < 1e-6 then
        return { a, b }
    end
    if math.abs(b.x - a.x) >= math.abs(b.y - a.y) then
        return { a, { x = round_to(b.x, 2), y = a.y }, b }
    end
    return { a, { x = a.x, y = round_to(b.y, 2) }, b }
end

local function build_tree(root, targets)
    local nodes = { { id = "root", point = root, weight = 0.0 } }
    local edges = {}
    local parents = { false }
    local node_of = {}
    local order = {}
    for i = 1, #targets do order[i] = i end
    table.sort(order, function(a, b)
        local ra = manhattan(root, targets[a].point)
        local rb = manhattan(root, targets[b].point)
        if ra ~= rb then return ra < rb end
        return a < b
    end)
    for k = 1, #order do
        local index = order[k]
        local target = targets[index]
        local best, best_score = 1, math.huge
        for node_index = 1, #nodes do
            local score = manhattan(nodes[node_index].point, target.point)
            if score < best_score then
                best_score = score
                best = node_index
            end
        end
        local points = orthogonal_route(nodes[best].point, target.point)
        local length = round_to(path_length(points), 3)
        local to = #nodes + 1
        edges[#edges + 1] = {
            ["from"] = best,
            to = to,
            points = points,
            length = length,
            load = 0.0,
            size = "",
            capacity = 0.0,
        }
        parents[#parents + 1] = #edges
        nodes[#nodes + 1] = { id = target.id, point = target.point, weight = target.weight }
        node_of[index] = to
    end
    local raw = {}
    for i = 1, #nodes do raw[i] = nodes[i].weight end
    for i = #edges, 1, -1 do
        local edge = edges[i]
        edge.load = round_to(raw[edge.to], 3)
        raw[edge["from"]] = raw[edge["from"]] + raw[edge.to]
    end
    return { edges = edges, parents = parents, node_of = node_of }
end

local function path_edges(tree, node)
    local out = {}
    local current = node
    local guard = 0
    while tree.parents[current] and guard < 200 do
        local edge_index = tree.parents[current]
        table.insert(out, 1, edge_index)
        current = tree.edges[edge_index]["from"]
        guard = guard + 1
    end
    return out
end

local function build_plumbing(plan)
    local plumbing = field(plan, "plumbing") or {}
    local width = number_or(field(plumbing, "width"), 0.0)
    local depth = number_or(field(plumbing, "depth"), 0.0)
    local wall_height = number_or(field(plan, "wallHeight"), 2.7)

    local fixtures = {}
    local source = items(field(plumbing, "fixtures"))
    for i = 1, #source do
        local entry = source[i]
        local id = text_or(field(entry, "id"), "")
        fixtures[i] = {
            id = id,
            tag = text_or(field(entry, "tag"), id),
            kind = fixture_type(text_or(field(entry, "type"), "")),
            point = { x = number_or(field(entry, "x"), 0.0), y = number_or(field(entry, "y"), 0.0) },
        }
    end

    local heater = field(plumbing, "heater")
    local has_heater = type(heater) == "table"
    local heater_btu = 0.0
    local heater_point = { x = 0.0, y = 0.0 }
    if has_heater then
        heater_btu = number_or(field(heater, "btu"), 0.0)
        heater_point = {
            x = number_or(field(heater, "x"), 0.0),
            y = number_or(field(heater, "y"), 0.0),
        }
    end

    local pressure = number_or(field(plumbing, "staticPressure"), 55.0)
    local meter_size = text_or(field(plumbing, "meterSize"), "3/4")
    local material = text_or(field(plumbing, "serviceMaterial"), "pex")

    local cold_sum = 0.0
    local hot_sum = 0.0
    for i = 1, #fixtures do
        cold_sum = cold_sum + fixtures[i].kind.cold
        hot_sum = hot_sum + fixtures[i].kind.hot
    end
    if has_heater then cold_sum = cold_sum + 1.0 end
    local cold_wsfu = round_to(cold_sum, 2)
    local hot_wsfu = round_to(hot_sum, 2)
    local total_wsfu = round_to(cold_wsfu + hot_wsfu, 2)
    local demand = demand_for_wsfu(total_wsfu)

    local service_id = nil
    local last_candidate = nil
    for i = 1, #WATER_SIZES do
        if WATER_SIZES[i].maxServiceWsfu >= total_wsfu then
            last_candidate = WATER_SIZES[i]
            if not service_id and velocity_fps(demand, water_pipe_diameter(WATER_SIZES[i].id, material)) <= 8.0 then
                service_id = WATER_SIZES[i].id
            end
        end
    end
    if not service_id then
        service_id = last_candidate and last_candidate.id or WATER_SIZES[#WATER_SIZES].id
    end

    local service_velocity = velocity_fps(demand, water_pipe_diameter(service_id, material))
    local main_length = max_of(number_or(field(plumbing, "mainLength"), 12.0), 3.0)
    local main_friction = friction_psi(demand, water_pipe_diameter(service_id, material), main_length, 150.0)
    local meter_loss = meter_loss_psi(meter_size, demand)
    local static_at_fixture = round_to(pressure - 0.433 * 1.2, 2)

    local cold_fixtures, hot_fixtures = {}, {}
    for i = 1, #fixtures do
        if fixtures[i].kind.cold > 0 or fixtures[i].kind.hot > 0 then
            cold_fixtures[#cold_fixtures + 1] = i
        end
        if fixtures[i].kind.hot > 0 then hot_fixtures[#hot_fixtures + 1] = i end
    end

    local cold_targets = {}
    for i = 1, #cold_fixtures do
        local index = cold_fixtures[i]
        cold_targets[#cold_targets + 1] = {
            id = fixtures[index].id,
            point = fixtures[index].point,
            weight = fixtures[index].kind.cold,
        }
    end
    if has_heater then
        cold_targets[#cold_targets + 1] = { id = "heater_inlet", point = heater_point, weight = 1.0 }
    end
    local water_hookup = {
        x = number_or(field(plumbing, "waterHookupX"), width),
        y = number_or(field(plumbing, "waterHookupY"), 0.0),
    }
    local cold_tree = nil
    if #cold_targets > 0 then cold_tree = build_tree(water_hookup, cold_targets) end

    local hot_targets = {}
    for i = 1, #hot_fixtures do
        local index = hot_fixtures[i]
        hot_targets[#hot_targets + 1] = {
            id = fixtures[index].id,
            point = fixtures[index].point,
            weight = fixtures[index].kind.hot,
        }
    end
    local hot_tree = nil
    if has_heater and #hot_targets > 0 then hot_tree = build_tree(heater_point, hot_targets) end

    local function size_tree(tree)
        if not tree then return 0.0 end
        local total = 0.0
        for i = 1, #tree.edges do
            local edge = tree.edges[i]
            edge.size = water_size_for_wsfu(max_of(edge.load, 0.5), false)
            total = total + edge.length
        end
        return round_to(total, 2)
    end

    local cold_length = size_tree(cold_tree)
    local hot_length = size_tree(hot_tree)

    local function edge_friction(edge)
        local flow = demand_for_wsfu(edge.load)
        return friction_psi(flow, water_pipe_diameter(edge.size, material), edge.length, 150.0)
    end

    -- node_of is indexed by position in the tree's own target list, so a fixture
    -- index has to be mapped through the trees that actually carry it.
    local function position_of(list, value)
        for i = 1, #list do
            if list[i] == value then return i end
        end
        return nil
    end

    local function branch_loss(index)
        local total = 0.0
        local cold_position = position_of(cold_fixtures, index)
        if cold_tree and cold_position then
            local route = path_edges(cold_tree, cold_tree.node_of[cold_position])
            for i = 1, #route do
                total = total + edge_friction(cold_tree.edges[route[i]])
            end
        end
        local hot_position = position_of(hot_fixtures, index)
        if fixtures[index].kind.hot > 0 and hot_tree and hot_position then
            local route = path_edges(hot_tree, hot_tree.node_of[hot_position])
            for i = 1, #route do
                total = total + edge_friction(hot_tree.edges[route[i]])
            end
        end
        return total
    end

    local readings = {}
    for i = 1, #cold_fixtures do
        local index = cold_fixtures[i]
        readings[#readings + 1] = {
            tag = fixtures[index].tag,
            value = round_to(static_at_fixture - meter_loss - main_friction - branch_loss(index), 2),
        }
    end
    if has_heater then
        readings[#readings + 1] = {
            tag = "Water heater",
            value = round_to(static_at_fixture - meter_loss - main_friction, 2),
        }
    end

    local worst = nil
    for i = 1, #readings do
        if not worst or readings[i].value < worst.value then worst = readings[i] end
    end
    local residual = 0.0
    if worst then residual = worst.value end

    -- Drainage.
    local drains = {}
    for i = 1, #fixtures do
        if fixtures[i].kind.dfu > 0 then drains[#drains + 1] = i end
    end
    local dfu_sum = 0.0
    for i = 1, #drains do dfu_sum = dfu_sum + fixtures[drains[i]].kind.dfu end
    local total_dfu = round_to(dfu_sum, 2)
    local main_size = dwv_size_for(total_dfu, "main")
    local slope = number_or(field(plumbing, "sewerSlope"), 0.02)
    local minimum_slope = dwv_size(main_size).minSlope
    local sewer_length = max_of(number_or(field(plumbing, "sewerMainLength"), 14.0), 3.0)
    local required_invert = round_to(-(sewer_length * slope) - 0.3, 2)

    local groups = {}
    local group_order = {}
    for i = 1, #drains do
        local index = drains[i]
        local group = fixtures[index].kind.group
        if not groups[group] then
            groups[group] = {}
            group_order[#group_order + 1] = group
        end
        local list = groups[group]
        list[#list + 1] = index
    end

    local stacks, trap_arms = {}, {}
    for g = 1, #group_order do
        local group = group_order[g]
        local members = groups[group]
        local sum_x, sum_y, member_dfu = 0.0, 0.0, 0.0
        for i = 1, #members do
            sum_x = sum_x + fixtures[members[i]].point.x
            sum_y = sum_y + fixtures[members[i]].point.y
            member_dfu = member_dfu + fixtures[members[i]].kind.dfu
        end
        local mean_x = sum_x / #members
        local mean_y = sum_y / #members
        local stack = {
            x = round_to(clamp(mean_x, 0.45, width - 0.45), 2),
            y = round_to(mean_y < depth / 2 and 0.48 or depth - 0.48, 2),
        }
        local stack_dfu = round_to(member_dfu, 2)
        local largest = "1-1/2"
        for i = 1, #members do
            local drain = fixtures[members[i]].kind.drain
            if dwv_index(drain) > dwv_index(largest) then largest = drain end
        end
        local branch_size = dwv_size_for(stack_dfu, "branch")
        if dwv_index(largest) > dwv_index(branch_size) then branch_size = largest end
        local stack_size = dwv_size_for(stack_dfu, "stack")
        if dwv_index(stack_size) <= dwv_index(branch_size) then stack_size = branch_size end
        stacks[#stacks + 1] = {
            id = "stack_" .. group,
            group = group,
            x = stack.x,
            y = stack.y,
            dfu = stack_dfu,
            branchSize = branch_size,
            size = stack_size,
            ventSize = stack_size,
            ventLength = round_to(wall_height + 1.2, 2),
        }
        for i = 1, #members do
            local index = members[i]
            local points = orthogonal_route(stack, fixtures[index].point)
            local length = round_to(path_length(points), 2)
            local limit = fixtures[index].kind.trapArmMax
            trap_arms[#trap_arms + 1] = {
                fixtureId = fixtures[index].id,
                tag = fixtures[index].tag,
                length = length,
                limit = limit,
                pass = length <= limit,
            }
        end
    end

    local main_y = round_to(depth - 0.22, 2)
    local main_start = { x = 0.28, y = main_y }
    local main_end = { x = round_to(width - 0.28, 2), y = main_y }
    local sewer_point = {
        x = number_or(field(plumbing, "sewerHookupX"), width),
        y = number_or(field(plumbing, "sewerHookupY"), depth),
    }
    local main_route_length = round_to(distance(main_start, main_end) + distance(main_end, sewer_point), 2)

    -- Fuel gas.
    local fuel = "natural"
    if text_or(field(plumbing, "gasType"), "natural") == "propane" then fuel = "propane" end
    local gas_length = max_of(number_or(field(plumbing, "gasMainLength"), 15.0), 5.0)
    local gas_meter = number_or(field(plumbing, "gasMeterCapacity"), 0.0)
    local gas_targets = {}
    for i = 1, #fixtures do
        if fixtures[i].kind.btu > 0 then
            gas_targets[#gas_targets + 1] = {
                id = fixtures[i].id,
                point = fixtures[i].point,
                weight = fixtures[i].kind.btu,
            }
        end
    end
    if has_heater and heater_btu > 0 then
        gas_targets[#gas_targets + 1] = { id = "heater_gas", point = heater_point, weight = heater_btu }
    end
    local btu_sum = 0.0
    for i = 1, #gas_targets do btu_sum = btu_sum + gas_targets[i].weight end
    local total_btu = round_to(btu_sum, 0)
    local uses_gas = #gas_targets > 0
    local total_cfh = gas_cfh(total_btu, fuel)
    local gas_hookup = {
        x = number_or(field(plumbing, "gasHookupX"), 0.0),
        y = number_or(field(plumbing, "gasHookupY"), 0.0),
    }
    local gas_tree = nil
    if uses_gas then gas_tree = build_tree(gas_hookup, gas_targets) end
    if gas_tree then
        for i = 1, #gas_tree.edges do
            local edge = gas_tree.edges[i]
            edge.size = gas_size_for_load(edge.load, edge.length, fuel)
            edge.capacity = gas_capacity(edge.size, edge.length, fuel)
        end
    end
    local gas_main_size = gas_size_for_load(total_cfh, gas_length, fuel)
    local gas_capacity_main = 0.0
    if uses_gas then gas_capacity_main = gas_capacity(gas_main_size, gas_length, fuel) end
    local longest_run = 0.0
    if gas_tree then
        for i = 1, #gas_tree.edges do
            longest_run = max_of(longest_run, gas_tree.edges[i].length)
        end
    end
    longest_run = round_to(longest_run, 2)

    local traps_ok = true
    for i = 1, #trap_arms do
        if not trap_arms[i].pass then traps_ok = false end
    end

    local checks = {
        { "water-hookup", pressure > 0 },
        { "residual-pressure", worst ~= nil and residual >= 8.0 },
        { "service-velocity", service_velocity <= 8.0 },
        { "meter", not (meter_size == "3/4" and demand > 14.0) },
        { "sewer-invert", number_or(field(plumbing, "sewerInvert"), -2.0) <= required_invert },
        { "sewer-slope", slope >= minimum_slope },
        { "sewer-size", dwv_index(text_or(field(plumbing, "sewerSize"), "4")) >= dwv_index(main_size) },
        { "trap-arms", traps_ok },
        { "gas-meter", (not uses_gas) or total_cfh <= gas_meter },
        { "gas-size", (not uses_gas) or total_cfh <= gas_capacity_main },
    }

    return {
        cold_wsfu = cold_wsfu,
        hot_wsfu = hot_wsfu,
        total_wsfu = total_wsfu,
        demand = demand,
        cold_demand = demand_for_wsfu(cold_wsfu),
        hot_demand = demand_for_wsfu(hot_wsfu),
        service_id = service_id,
        material = material,
        service_velocity = service_velocity,
        main_length = main_length,
        main_friction = main_friction,
        meter_loss = meter_loss,
        static_at_fixture = static_at_fixture,
        residual = residual,
        worst_tag = worst and worst.tag or "",
        cold_length = cold_length,
        hot_length = hot_length,
        readings = readings,
        total_dfu = total_dfu,
        main_size = main_size,
        slope = slope,
        minimum_slope = minimum_slope,
        required_invert = required_invert,
        sewer_length = sewer_length,
        main_y = main_y,
        main_route_length = main_route_length,
        stacks = stacks,
        trap_arms = trap_arms,
        uses_gas = uses_gas,
        fuel = fuel,
        total_btu = total_btu,
        total_cfh = total_cfh,
        gas_main_size = gas_main_size,
        gas_capacity = gas_capacity_main,
        longest_run = longest_run,
        gas_meter = gas_meter,
        appliance_count = #gas_targets,
        checks = checks,
    }
end

local function plumbing_json(plan)
    local result = build_plumbing(plan)
    local reading_rows = {}
    for i = 1, #result.readings do
        reading_rows[i] = jobj({
            { "tag", jstr(result.readings[i].tag) },
            { "pressurePsi", f3(result.readings[i].value) },
        })
    end
    local stack_rows = {}
    for i = 1, #result.stacks do
        local stack = result.stacks[i]
        stack_rows[i] = jobj({
            { "id", jstr(stack.id) },
            { "group", jstr(stack.group) },
            { "x", f3(stack.x) },
            { "y", f3(stack.y) },
            { "dfu", f3(stack.dfu) },
            { "branchSize", jstr(stack.branchSize) },
            { "size", jstr(stack.size) },
            { "ventSize", jstr(stack.ventSize) },
            { "ventLength", f3(stack.ventLength) },
        })
    end
    local trap_rows = {}
    for i = 1, #result.trap_arms do
        local arm = result.trap_arms[i]
        trap_rows[i] = jobj({
            { "fixtureId", jstr(arm.fixtureId) },
            { "tag", jstr(arm.tag) },
            { "length", f3(arm.length) },
            { "limit", f3(arm.limit) },
            { "pass", flag(arm.pass) },
        })
    end
    local check_rows = {}
    for i = 1, #result.checks do
        check_rows[i] = jobj({
            { "id", jstr(result.checks[i][1]) },
            { "pass", flag(result.checks[i][2]) },
        })
    end

    return jobj({
        { "water", jobj({
            { "coldWsfu", f3(result.cold_wsfu) },
            { "hotWsfu", f3(result.hot_wsfu) },
            { "totalWsfu", f3(result.total_wsfu) },
            { "demandGpm", f3(result.demand) },
            { "coldDemandGpm", f3(result.cold_demand) },
            { "hotDemandGpm", f3(result.hot_demand) },
            { "serviceSize", jstr(result.service_id) },
            { "serviceMaterial", jstr(result.material) },
            { "serviceVelocityFps", f3(result.service_velocity) },
            { "mainLength", f3(result.main_length) },
            { "mainFrictionPsi", f3(result.main_friction) },
            { "meterLossPsi", f3(result.meter_loss) },
            { "staticAtFixturePsi", f3(result.static_at_fixture) },
            { "residualPsi", f3(result.residual) },
            { "worstFixture", jstr(result.worst_tag) },
            { "coldLength", f3(result.cold_length) },
            { "hotLength", f3(result.hot_length) },
            { "readings", jarr(reading_rows) },
        }) },
        { "drain", jobj({
            { "totalDfu", f3(result.total_dfu) },
            { "mainSize", jstr(result.main_size) },
            { "slope", f3(result.slope) },
            { "minimumSlope", f3(result.minimum_slope) },
            { "requiredInvert", f3(result.required_invert) },
            { "sewerMainLength", f3(result.sewer_length) },
            { "mainY", f3(result.main_y) },
            { "mainRouteLength", f3(result.main_route_length) },
            { "ventCount", tostring(#result.stacks) },
            { "cleanoutCount", tostring(#result.stacks + 1) },
            { "stacks", jarr(stack_rows) },
            { "trapArms", jarr(trap_rows) },
        }) },
        { "gas", jobj({
            { "usesGas", flag(result.uses_gas) },
            { "fuel", jstr(result.fuel) },
            { "totalBtu", f3(result.total_btu) },
            { "totalCfh", f3(result.total_cfh) },
            { "mainSize", jstr(result.gas_main_size) },
            { "capacityCfh", f3(result.gas_capacity) },
            { "longestRun", f3(result.longest_run) },
            { "meterCapacityCfh", f3(result.gas_meter) },
            { "applianceCount", tostring(result.appliance_count) },
        }) },
        { "checks", jarr(check_rows) },
    })
end

-- --- lighting ---------------------------------------------------------------

local function room_index(width, depth, mounting_height)
    local w = max_of(width, 0.1)
    local d = max_of(depth, 0.1)
    local h = max_of(mounting_height, 0.1)
    return (w * d) / (h * (w + d))
end

local function coefficient_of_utilization(index, ceiling, wall)
    local k = max_of(index, 0.0)
    local cu
    if k < 0.7 then cu = 0.44
    elseif k < 1.0 then cu = 0.52
    elseif k < 1.5 then cu = 0.60
    elseif k < 2.0 then cu = 0.66
    elseif k < 3.0 then cu = 0.72
    elseif k < 5.0 then cu = 0.77
    else cu = 0.80 end
    cu = cu + (ceiling - 0.7) * 0.08
    cu = cu + (wall - 0.5) * 0.06
    return math.min(math.max(cu, 0.35), 0.88)
end

local function illuminance_at(px, py, lights, work_plane)
    local lux = 0.0
    for i = 1, #lights do
        local light = lights[i]
        if light.on then
            local dx = px - light.x
            local dy = py - light.y
            local h = max_of(light.mount - work_plane, 0.1)
            local distance_squared = dx * dx + dy * dy + h * h
            local dist = math.sqrt(distance_squared)
            local cos = h / dist
            local intensity = light.lumens / math.pi
            lux = lux + (intensity * cos) / distance_squared
        end
    end
    return lux
end

local function build_lighting(plan)
    local lighting = field(plan, "lighting") or {}
    local width = number_or(field(lighting, "width"), 5.0)
    local depth = number_or(field(lighting, "depth"), 4.0)
    local mounting = number_or(field(lighting, "mountingHeight"), 2.4)
    local work_plane = number_or(field(lighting, "workPlane"), 0.75)
    local target_lux = number_or(field(lighting, "targetLux"), 200.0)
    local llf = number_or(field(lighting, "llf"), 0.8)
    local reflectances = field(lighting, "reflectances") or {}
    local ceiling = number_or(field(reflectances, "ceiling"), 0.8)
    local wall = number_or(field(reflectances, "wall"), 0.5)

    local lights = {}
    local source = items(field(lighting, "luminaires"))
    for i = 1, #source do
        local entry = source[i]
        lights[i] = {
            x = number_or(field(entry, "x"), width / 2),
            y = number_or(field(entry, "y"), depth / 2),
            lumens = number_or(field(entry, "lumens"), 0.0),
            watts = number_or(field(entry, "watts"), 0.0),
            mount = number_or(field(entry, "mountHeight"), mounting),
            dim = number_or(field(entry, "dim"), 100.0),
            on = truthy_or(field(entry, "on"), true),
            spacing_ratio = number_or(field(entry, "spacingRatio"), 1.1),
        }
    end

    local area = max_of(width * depth, 0.1)
    local total_lumens = 0.0
    local connected_w = 0.0
    for i = 1, #lights do
        total_lumens = total_lumens + lights[i].lumens
        connected_w = connected_w + lights[i].watts
    end
    local index = room_index(width, depth, mounting)
    local cu = coefficient_of_utilization(index, ceiling, wall)
    local average_lux = total_lumens * cu * llf / area

    local raw_steps = round_to(number_or(field(lighting, "steps"), 16.0), 0)
    if raw_steps == 0 then raw_steps = 16.0 end
    local steps = math.floor(math.min(math.max(raw_steps, 4.0), 60.0))
    local grid_w = max_of(width, 0.1)
    local grid_d = max_of(depth, 0.1)
    local grid_min = math.huge
    local grid_max = 0.0
    local grid_sum = 0.0
    for row = 0, steps - 1 do
        local y = ((row + 0.5) / steps) * grid_d
        for col = 0, steps - 1 do
            local x = ((col + 0.5) / steps) * grid_w
            local lux = illuminance_at(x, y, lights, work_plane)
            grid_min = math.min(grid_min, lux)
            grid_max = math.max(grid_max, lux)
            grid_sum = grid_sum + lux
        end
    end
    local grid_average = grid_sum / (steps * steps)
    if grid_min == math.huge then grid_min = 0.0 end
    local uniformity = 0.0
    if grid_max > 0 then uniformity = grid_min / grid_max end
    local average_to_min = 0.0
    if grid_average > 0 then average_to_min = grid_min / grid_average end

    local lit_lumens = 0.0
    for i = 1, #lights do
        if lights[i].on then
            lit_lumens = lit_lumens + lights[i].lumens * lights[i].dim / 100.0
        end
    end
    local spacing = 0.0
    local per_luminaire = 0.0
    if #lights > 0 then
        spacing = max_of(lights[1].spacing_ratio * max_of(mounting, 0.5), 0.6)
        per_luminaire = lights[1].lumens
    end
    local required = 0.0
    if per_luminaire > 0 and cu * llf > 0 then
        required = math.ceil(target_lux * area / (per_luminaire * cu * llf) - 1e-9)
    end

    local circuits = {}
    local circuit_source = items(field(lighting, "circuits"))
    for i = 1, #circuit_source do
        local circuit = circuit_source[i]
        local voltage = number_or(field(circuit, "voltage"), 120.0)
        local breaker = number_or(field(circuit, "breakerA"), 15.0)
        local va = 0.0
        local devices = items(field(circuit, "devices"))
        for j = 1, #devices do
            local device = devices[j]
            local kind = text_or(field(device, "kind"), "luminaire")
            if kind == "socket" then
                if truthy_or(field(device, "dedicated"), false) then
                    va = va + number_or(field(device, "ratingA"), 0.0) * number_or(field(device, "voltage"), voltage)
                else
                    va = va + 180.0
                end
            elseif kind == "luminaire" then
                va = va + number_or(field(device, "watts"), 0.0)
            end
        end
        local amps = 0.0
        if voltage > 0 then amps = va / voltage end
        circuits[i] = {
            id = text_or(field(circuit, "id"), ""),
            name = text_or(field(circuit, "name"), ""),
            va = round_to(va, 1),
            amps = round_to(amps, 2),
            breaker = breaker,
            percent = breaker > 0 and round_to(amps / breaker * 100.0, 1) or 0.0,
            pass = amps <= breaker + 1e-9,
            continuous = amps <= breaker * 0.8 + 1e-9,
        }
    end

    return {
        area = round_to(area, 2),
        index = round_to(index, 2),
        cu = round_to(cu, 2),
        llf = llf,
        ceiling = ceiling,
        wall = wall,
        total_lumens = round_to(total_lumens, 0),
        lit_lumens = round_to(lit_lumens, 0),
        average_lux = round_to(average_lux, 1),
        target_lux = target_lux,
        target_ratio = target_lux > 0 and round_to(average_lux / target_lux, 2) or 0.0,
        meets_target = target_lux <= 0 or average_lux >= target_lux - 1e-9,
        spacing = round_to(spacing, 2),
        connected_w = round_to(connected_w, 1),
        watts_per_m2 = round_to(connected_w / area, 2),
        efficacy = connected_w > 0 and round_to(total_lumens / connected_w, 1) or 0.0,
        required = required,
        steps = steps,
        grid_min = round_to(grid_min, 1),
        grid_max = round_to(grid_max, 1),
        grid_average = round_to(grid_average, 1),
        uniformity = round_to(uniformity, 2),
        average_to_min = round_to(average_to_min, 2),
        circuits = circuits,
    }
end

local function lighting_json(plan)
    local result = build_lighting(plan)
    local circuit_rows = {}
    for i = 1, #result.circuits do
        local circuit = result.circuits[i]
        circuit_rows[i] = jobj({
            { "id", jstr(circuit.id) },
            { "name", jstr(circuit.name) },
            { "va", f3(circuit.va) },
            { "amps", f3(circuit.amps) },
            { "breakerA", f3(circuit.breaker) },
            { "percent", f3(circuit.percent) },
            { "pass", flag(circuit.pass) },
            { "continuousPass", flag(circuit.continuous) },
        })
    end

    return jobj({
        { "photometry", jobj({
            { "area", f3(result.area) },
            { "roomIndex", f3(result.index) },
            { "cu", f3(result.cu) },
            { "llf", f3(result.llf) },
            { "ceilingReflectance", f3(result.ceiling) },
            { "wallReflectance", f3(result.wall) },
            { "totalLumens", f3(result.total_lumens) },
            { "litLumens", f3(result.lit_lumens) },
            { "averageLux", f3(result.average_lux) },
            { "targetLux", f3(result.target_lux) },
            { "targetRatio", f3(result.target_ratio) },
            { "meetsTarget", flag(result.meets_target) },
            { "spacing", f3(result.spacing) },
            { "connectedW", f3(result.connected_w) },
            { "wattsPerM2", f3(result.watts_per_m2) },
            { "efficacy", f3(result.efficacy) },
            { "requiredForTarget", f3(result.required) },
        }) },
        { "grid", jobj({
            { "steps", tostring(result.steps) },
            { "minLux", f3(result.grid_min) },
            { "maxLux", f3(result.grid_max) },
            { "averageLux", f3(result.grid_average) },
            { "uniformity", f3(result.uniformity) },
            { "averageToMin", f3(result.average_to_min) },
        }) },
        { "circuits", jarr(circuit_rows) },
    })
end

-- --- document --------------------------------------------------------------

-- Shared numeric helpers for the roof and landscape suites.
local function clamp_between(value, low, high)
    if value < low then return low end
    if value > high then return high end
    return value
end

local function round_half_up(value)
    if value >= 0 then return math.floor(value + 0.5) end
    return math.ceil(value - 0.5)
end

-- --- roof suite ------------------------------------------------------------

local ROOF_STYLES = {
    { key = "gable-king", name = "Gable · king post", family = "gable", truss = "king-post", minPitch = 3.0 },
    { key = "gable-fink", name = "Gable · Fink", family = "gable", truss = "fink", minPitch = 3.0 },
    { key = "gable-howe", name = "Gable · Howe", family = "gable", truss = "howe", minPitch = 3.0 },
    { key = "gable-scissor", name = "Gable · scissor", family = "gable", truss = "scissor", minPitch = 4.0 },
    { key = "gable-attic", name = "Gable · attic (room in roof)", family = "gable", truss = "attic", minPitch = 5.0 },
    { key = "gambrel", name = "Gambrel", family = "gambrel", truss = "gambrel", minPitch = 5.0 },
    { key = "hip", name = "Hip", family = "hip", truss = "hip", minPitch = 3.0 },
    { key = "cross-gable", name = "Cross gable", family = "cross", truss = "cross", minPitch = 3.0 },
    { key = "shed", name = "Shed · mono-pitch", family = "shed", truss = "shed", minPitch = 3.0 },
    { key = "saltbox", name = "Saltbox", family = "saltbox", truss = "saltbox", minPitch = 3.0 },
}

local SHEATHING = {
    ["osb-716"] = { label = "7/16 in OSB", nail_mm = 150.0, cost = 21.0 },
    ["ply-1532"] = { label = "15/32 in plywood", nail_mm = 150.0, cost = 34.0 },
    ["ply-1932"] = { label = "19/32 in plywood", nail_mm = 100.0, cost = 46.0 },
}

local UNDERLAYMENT = {
    ["felt-15"] = { label = "15 lb felt", coverage = 92.9, cost = 38.0, min_pitch = 2.0 },
    ["felt-30"] = { label = "30 lb felt", coverage = 92.9, cost = 55.0, min_pitch = 1.0 },
    ["synthetic"] = { label = "Synthetic underlayment", coverage = 92.9, cost = 118.0, min_pitch = 1.0 },
    ["peel-stick"] = { label = "Peel-and-stick membrane", coverage = 18.6, cost = 145.0, min_pitch = 0.25 },
}

local COVERINGS = {
    ["asphalt-3tab"] = { label = "3-tab asphalt shingle", family = "shingle", min_pitch = 2.0, max_pitch = 20.0, unit = "bundle", units_per_square = 3.0, cost_per_square = 115.0, weight = 8.5, starter_lf = 35.0, ridge_cap_lf = 35.0 },
    ["asphalt-arch"] = { label = "Architectural (dimensional) shingle", family = "shingle", min_pitch = 2.0, max_pitch = 20.0, unit = "bundle", units_per_square = 3.0, cost_per_square = 155.0, weight = 11.0, starter_lf = 35.0, ridge_cap_lf = 35.0 },
    ["metal-standing-seam"] = { label = "Standing-seam metal", family = "metal", min_pitch = 3.0, max_pitch = 24.0, unit = "square", units_per_square = 1.0, cost_per_square = 520.0, weight = 6.5, starter_lf = 0.0, ridge_cap_lf = 0.0 },
    ["clay-tile"] = { label = "Clay barrel tile", family = "tile", min_pitch = 4.0, max_pitch = 16.0, unit = "tile", units_per_square = 100.0, cost_per_square = 920.0, weight = 45.0, starter_lf = 0.0, ridge_cap_lf = 0.0 },
    ["concrete-tile"] = { label = "Concrete tile", family = "tile", min_pitch = 4.0, max_pitch = 16.0, unit = "tile", units_per_square = 95.0, cost_per_square = 690.0, weight = 50.0, starter_lf = 0.0, ridge_cap_lf = 0.0 },
    ["slate"] = { label = "Natural slate", family = "tile", min_pitch = 4.0, max_pitch = 24.0, unit = "slate", units_per_square = 220.0, cost_per_square = 1650.0, weight = 55.0, starter_lf = 0.0, ridge_cap_lf = 0.0 },
    ["modified-bitumen"] = { label = "Modified bitumen membrane", family = "low-slope", min_pitch = 1.0, max_pitch = 4.0, unit = "roll", units_per_square = 1.0, cost_per_square = 210.0, weight = 5.5, starter_lf = 0.0, ridge_cap_lf = 0.0 },
    ["bur"] = { label = "Built-up roof (3-ply BUR)", family = "low-slope", min_pitch = 0.25, max_pitch = 3.0, unit = "ply-square", units_per_square = 3.0, cost_per_square = 460.0, weight = 12.0, starter_lf = 0.0, ridge_cap_lf = 0.0 },
    ["tpo"] = { label = "Single-ply TPO / EPDM", family = "low-slope", min_pitch = 0.25, max_pitch = 3.0, unit = "square", units_per_square = 1.0, cost_per_square = 420.0, weight = 2.5, starter_lf = 0.0, ridge_cap_lf = 0.0 },
    ["roll-roofing"] = { label = "Roll roofing", family = "low-slope", min_pitch = 1.0, max_pitch = 4.0, unit = "roll", units_per_square = 1.0, cost_per_square = 130.0, weight = 4.5, starter_lf = 0.0, ridge_cap_lf = 0.0 },
}

local GUTTERS = {
    ["k5-alum"] = { label = "5 in K-style aluminium", max_area = 55.0, cost_per_lf = 9.0, downspout_cost = 14.0, hanger_spacing = 0.6, downspout = "2 x 3 in rectangular" },
    ["k6-alum"] = { label = "6 in K-style aluminium", max_area = 95.0, cost_per_lf = 12.0, downspout_cost = 18.0, hanger_spacing = 0.6, downspout = "3 x 4 in rectangular" },
    ["half-round-5"] = { label = "5 in half-round aluminium", max_area = 45.0, cost_per_lf = 14.0, downspout_cost = 16.0, hanger_spacing = 0.5, downspout = "3 in round" },
    ["box-4"] = { label = "4 in box steel", max_area = 40.0, cost_per_lf = 16.0, downspout_cost = 18.0, hanger_spacing = 0.6, downspout = "3 in round" },
    ["copper-k6"] = { label = "6 in K-style copper", max_area = 95.0, cost_per_lf = 42.0, downspout_cost = 65.0, hanger_spacing = 0.6, downspout = "3 x 4 in copper" },
}

local function roof_style(key)
    for index = 1, #ROOF_STYLES do
        if ROOF_STYLES[index].key == key then return ROOF_STYLES[index] end
    end
    return ROOF_STYLES[1]
end

local function roof_ceil(value)
    if value < 0 then value = 0 end
    return math.ceil(value - 1e-9)
end

local function hypot2(a, b)
    return math.sqrt(a * a + b * b)
end

local function tri_area(a, b, c)
    local ux, uy, uz = b[1] - a[1], b[2] - a[2], b[3] - a[3]
    local vx, vy, vz = c[1] - a[1], c[2] - a[2], c[3] - a[3]
    local cx = uy * vz - uz * vy
    local cy = uz * vx - ux * vz
    local cz = ux * vy - uy * vx
    return math.sqrt(cx * cx + cy * cy + cz * cz) / 2
end

local function plane_area(points)
    local total = 0.0
    local index = 2
    while index + 1 <= #points do
        total = total + tri_area(points[1], points[index], points[index + 1])
        index = index + 1
    end
    return total
end

local function roof_geometry(family, span, length, pitch, overhang)
    local safe_span = math.max(span, 1.2)
    local safe_length = math.max(length, 1.2)
    local safe_pitch = math.max(pitch, 0.1)
    local run = safe_pitch / 12
    local half = safe_span / 2
    local over = math.max(overhang, 0)
    local z1 = -safe_length / 2 - over
    local z2 = safe_length / 2 + over
    local eave_y = -over * run
    local rise = half * run
    if family == "shed" then rise = safe_span * run end
    local ridge_x, cross_rise, valley_length, hip_length = 0.0, 0.0, 0.0, 0.0
    local ridge_length = safe_length
    local planes = {}

    local function gable_plane(rx, ry, ex, ey, za, zb)
        return plane_area({ { rx, ry, za }, { ex, ey, za }, { ex, ey, zb }, { rx, ry, zb } })
    end

    if family == "gable" then
        planes[#planes + 1] = gable_plane(0, rise, half + over, eave_y, z1, z2)
        planes[#planes + 1] = gable_plane(0, rise, -half - over, eave_y, z1, z2)
        ridge_length = safe_length + 2 * over
    elseif family == "saltbox" then
        local left_run = safe_span * 0.38
        local right_run = safe_span * 0.62
        ridge_x = -half + left_run
        local left_slope = rise / left_run
        local right_slope = rise / right_run
        planes[#planes + 1] = gable_plane(ridge_x, rise, half + over, -over * right_slope, z1, z2)
        planes[#planes + 1] = gable_plane(ridge_x, rise, -half - over, -over * left_slope, z1, z2)
        ridge_length = safe_length + 2 * over
    elseif family == "gambrel" then
        local break_x = half * 0.55
        local lower_rise = rise * 0.45
        local lower_slope = lower_rise / (half - break_x)
        local lower_eave_y = -over * lower_slope
        for _, side in ipairs({ 1.0, -1.0 }) do
            planes[#planes + 1] = plane_area({
                { side * break_x, lower_rise, z1 },
                { side * (half + over), lower_eave_y, z1 },
                { side * (half + over), lower_eave_y, z2 },
                { side * break_x, lower_rise, z2 },
            })
            planes[#planes + 1] = plane_area({
                { 0.0, rise, z1 },
                { side * break_x, lower_rise, z1 },
                { side * break_x, lower_rise, z2 },
                { 0.0, rise, z2 },
            })
        end
        ridge_length = safe_length + 2 * over
    elseif family == "hip" then
        ridge_length = math.max(safe_length - safe_span, 0.4)
        local ridge_z = ridge_length / 2
        local eave_x = half + over
        local eave_z = safe_length / 2 + over
        hip_length = 4 * hypot2(hypot2(eave_x, eave_z - ridge_z), rise - eave_y)
        planes[#planes + 1] = gable_plane(0, rise, eave_x, eave_y, -ridge_z, ridge_z)
        planes[#planes + 1] = gable_plane(0, rise, -eave_x, eave_y, -ridge_z, ridge_z)
        planes[#planes + 1] = plane_area({ { 0.0, rise, -ridge_z }, { -eave_x, eave_y, -eave_z }, { eave_x, eave_y, -eave_z } })
        planes[#planes + 1] = plane_area({ { 0.0, rise, ridge_z }, { eave_x, eave_y, eave_z }, { -eave_x, eave_y, eave_z } })
    elseif family == "cross" then
        cross_rise = rise * 0.85
        local cross_half = safe_length * 0.28
        local cross_eave_y = -over * (cross_rise / cross_half)
        local x1 = -half - over
        local x2 = half + over
        planes[#planes + 1] = gable_plane(0, rise, half + over, eave_y, z1, z2)
        planes[#planes + 1] = gable_plane(0, rise, -half - over, eave_y, z1, z2)
        planes[#planes + 1] = plane_area({
            { x1, cross_rise, 0.0 },
            { x2, cross_rise, 0.0 },
            { x2, cross_eave_y, cross_half + over },
            { x1, cross_eave_y, cross_half + over },
        })
        planes[#planes + 1] = plane_area({
            { x2, cross_rise, 0.0 },
            { x1, cross_rise, 0.0 },
            { x1, cross_eave_y, -cross_half - over },
            { x2, cross_eave_y, -cross_half - over },
        })
        ridge_length = safe_length + safe_span * 0.9
        valley_length = 4 * hypot2(safe_span * 0.22, rise * 0.35)
    elseif family == "shed" then
        local high_over = rise + over * run
        local low_over = -over * run
        planes[#planes + 1] = plane_area({
            { -half - over, high_over, z1 },
            { half + over, low_over, z1 },
            { half + over, low_over, z2 },
            { -half - over, high_over, z2 },
        })
        ridge_length = 0.0
    end

    local roof_area = 0.0
    for index = 1, #planes do roof_area = roof_area + planes[index] end
    local footprint_area = safe_span * safe_length

    local function slope_length_of(run_x, rise_y, over_x, over_y)
        return hypot2(run_x + over_x, rise_y + over_y)
    end

    local rake_length
    if family == "hip" then
        rake_length = 0.0
    elseif family == "shed" then
        rake_length = 2 * slope_length_of(safe_span, rise, over, over * run)
    elseif family == "gambrel" then
        local break_x = half * 0.55
        local lower_rise = rise * 0.45
        local lower_slope = lower_rise / (half - break_x)
        rake_length = 4 * hypot2(half - break_x + over, lower_rise + over * lower_slope) + 4 * hypot2(break_x, rise - lower_rise)
    elseif family == "saltbox" then
        local left_run = half + ridge_x
        local right_run = half - ridge_x
        rake_length = 2 * slope_length_of(left_run, rise, over, over * (rise / left_run)) + 2 * slope_length_of(right_run, rise, over, over * (rise / right_run))
    elseif family == "cross" then
        local main_slope = slope_length_of(half, rise, over, over * run)
        local cross_half = safe_length * 0.28
        local cross_slope = slope_length_of(cross_half, cross_rise, over, 0.0)
        rake_length = 4 * main_slope + 4 * cross_slope
    else
        rake_length = 4 * slope_length_of(half, rise, over, over * run)
    end

    local eave_length
    if family == "hip" then
        eave_length = 2 * (safe_length + 2 * over) + 2 * (safe_span + 2 * over)
    elseif family == "shed" then
        eave_length = safe_length + 2 * over
    elseif family == "cross" then
        eave_length = 2 * (safe_length + 2 * over) + 2 * (safe_span + 2 * over)
    else
        eave_length = 2 * (safe_length + 2 * over)
    end

    return {
        pitch = safe_pitch,
        angle = (math.atan(run) * 180) / math.pi,
        span = safe_span,
        length = safe_length,
        overhang = over,
        half = half,
        rise = rise,
        ridge_x = ridge_x,
        cross_rise = cross_rise,
        ridge_length = ridge_length,
        hip_length = hip_length,
        valley_length = valley_length,
        eave_length = eave_length,
        rake_length = rake_length,
        roof_area = roof_area,
        footprint_area = footprint_area,
        slope_length = hypot2(half, rise),
    }
end

local function truss_member_length(truss, geometry)
    local half = geometry.half
    local rise = geometry.rise
    local members = {}
    local function add(x1, y1, x2, y2)
        members[#members + 1] = { x1, y1, x2, y2 }
    end
    local function bottom() add(-half, 0.0, half, 0.0) end
    local function top_chords(ridge_y, at_x)
        local value = ridge_y or rise
        local at = at_x or 0.0
        add(-half, 0.0, at, value)
        add(half, 0.0, at, value)
    end

    if truss == "king-post" then
        bottom()
        top_chords()
        add(0.0, 0.0, 0.0, rise)
        for _, fraction in ipairs({ 0.5, 0.75 }) do
            for _, side in ipairs({ 1.0, -1.0 }) do
                add(side * half * fraction, 0.0, (side * half * fraction) / 2, rise * (1.0 - fraction / 2))
            end
        end
    elseif truss == "fink" then
        bottom()
        top_chords()
        add(-half * 0.5, 0.0, -half * 0.25, rise * 0.5)
        add(-half * 0.25, rise * 0.5, 0.0, 0.0)
        add(half * 0.25, rise * 0.5, 0.0, 0.0)
        add(half * 0.5, 0.0, half * 0.25, rise * 0.5)
    elseif truss == "howe" then
        bottom()
        top_chords()
        for _, side in ipairs({ 1.0, -1.0 }) do
            add(side * half * 0.5, 0.0, side * half * 0.5, rise * 0.5)
            add(0.0, 0.0, side * half * 0.5, rise * 0.5)
        end
    elseif truss == "scissor" then
        top_chords()
        add(-half, rise * 0.12, half * 0.55, rise * 0.82)
        add(half, rise * 0.12, -half * 0.55, rise * 0.82)
        add(0.0, rise * 0.28, 0.0, rise * 0.9)
    elseif truss == "attic" then
        bottom()
        top_chords()
        local tie = rise * 0.52
        add(-half * 0.78, tie, half * 0.78, tie)
        for _, side in ipairs({ 1.0, -1.0 }) do
            add(side * half * 0.78, 0.0, side * half * 0.78, tie)
        end
        add(0.0, tie, 0.0, rise)
    elseif truss == "gambrel" then
        bottom()
        local break_x = half * 0.55
        local lower_rise = rise * 0.45
        for _, side in ipairs({ 1.0, -1.0 }) do
            add(side * half, 0.0, side * break_x, lower_rise)
            add(side * break_x, lower_rise, 0.0, rise)
            add(side * break_x, 0.0, side * break_x, lower_rise)
        end
        add(0.0, 0.0, 0.0, rise)
    elseif truss == "saltbox" then
        bottom()
        add(-half, 0.0, geometry.ridge_x, rise)
        add(half, 0.0, geometry.ridge_x, rise)
        add(geometry.ridge_x, 0.0, geometry.ridge_x, rise)
        for _, side in ipairs({ 1.0, -1.0 }) do
            add(side * half * 0.5, 0.0, side * half * 0.25, rise * 0.45)
        end
    elseif truss == "shed" then
        add(-half, 0.0, half, 0.0)
        add(-half, rise, half, 0.0)
        add(-half, 0.0, -half, rise)
        add(0.0, 0.0, 0.0, rise * 0.5)
    else
        bottom()
        top_chords()
        add(0.0, 0.0, 0.0, rise)
        for _, fraction in ipairs({ 0.5, 0.75 }) do
            for _, side in ipairs({ 1.0, -1.0 }) do
                add(side * half * fraction, 0.0, (side * half * fraction) / 2, rise * (1.0 - fraction / 2))
            end
        end
    end

    local total = 0.0
    for index = 1, #members do
        local m = members[index]
        total = total + hypot2(m[3] - m[1], m[4] - m[2])
    end
    return total
end

local function roof_design_json(plan)
    local roof = field(plan, "roof") or {}
    local definition = roof_style(text_or(field(roof, "style"), "gable-king"))
    local span = number_or(field(roof, "span"), 10.0)
    local length = number_or(field(roof, "length"), 14.0)
    local pitch = number_or(field(roof, "pitch"), 6.0)
    local overhang = number_or(field(roof, "overhang"), 0.5)
    local geometry = roof_geometry(definition.family, span, length, pitch, overhang)

    local sheathing = SHEATHING[text_or(field(roof, "sheathing"), "osb-716")] or SHEATHING["osb-716"]
    local underlayment = UNDERLAYMENT[text_or(field(roof, "underlayment"), "synthetic")] or UNDERLAYMENT["synthetic"]
    local covering = COVERINGS[text_or(field(roof, "covering"), "asphalt-arch")] or COVERINGS["asphalt-arch"]
    local gutter = GUTTERS[text_or(field(roof, "gutter"), "k5-alum")] or GUTTERS["k5-alum"]
    local spacing = clamp_between(number_or(field(roof, "spacing"), 0.61), 0.3, 1.2)
    local waste = clamp_between(number_or(field(roof, "waste"), 0.1), 0.0, 0.4)

    local function flag_of(key, fallback)
        return truthy_or(field(roof, key), fallback)
    end

    local gutters = flag_of("gutters", true)
    local ice_shield = flag_of("iceShield", true)
    local ridge_vent = flag_of("ridgeVent", true)
    local soffit_vent = flag_of("soffitVent", true)
    local chimney = flag_of("chimney", false)
    local tear_off = flag_of("tearOff", false)
    local climate = text_or(field(roof, "climate"), "moderate")
    local pipe_vents = round_half_up(number_or(field(roof, "pipeVents"), 2.0))

    local area = geometry.roof_area
    local squares = area / 9.2903
    local squares_with_waste = squares * (1 + waste)
    local plan_area = geometry.footprint_area

    local sheet_m2 = 1.22 * 2.44
    local sheets = roof_ceil((area * (1 + waste)) / sheet_m2)
    local underlay_rolls = roof_ceil((area * 1.05) / underlayment.coverage)
    local ice_shield_m2 = 0.0
    if ice_shield then ice_shield_m2 = geometry.eave_length * math.min(0.9, geometry.slope_length) end
    local ice_shield_rolls = 0.0
    if ice_shield_m2 > 0 then ice_shield_rolls = roof_ceil(ice_shield_m2 / 18.6) end

    local covering_units = roof_ceil(squares_with_waste * covering.units_per_square)
    local covering_unit = covering.unit
    if covering.family == "shingle" then
        covering_unit = "bundle"
    elseif covering.family == "metal" then
        covering_unit = "square"
    end
    local starter_lf = 0.0
    if covering.family == "shingle" then starter_lf = geometry.eave_length end
    local starter_units = 0.0
    if covering.starter_lf > 0 then starter_units = roof_ceil(starter_lf / covering.starter_lf) end
    local ridge_cap_lf = geometry.ridge_length + geometry.hip_length
    local ridge_cap_units, ridge_cap_cost = 0.0, 0.0
    local ridge_cap_unit = ""
    if covering.ridge_cap_lf > 0 then
        ridge_cap_units = roof_ceil(ridge_cap_lf / covering.ridge_cap_lf)
        ridge_cap_unit = "bundle"
        ridge_cap_cost = 58.0
    elseif covering.family == "tile" then
        ridge_cap_units = roof_ceil(ridge_cap_lf / 0.45)
        ridge_cap_unit = "piece"
        ridge_cap_cost = 13.0
    elseif covering.family == "metal" then
        ridge_cap_units = ridge_cap_lf
        ridge_cap_unit = "m"
        ridge_cap_cost = 22.0
    end

    local member_length = truss_member_length(definition.truss, geometry)
    local main_trusses = roof_ceil(geometry.length / spacing) + 1.0
    local cross_trusses = 0.0
    if definition.family == "cross" then cross_trusses = roof_ceil((geometry.span * 0.9) / spacing) + 1.0 end
    local truss_count = main_trusses + cross_trusses
    local truss_lumber_m = member_length * truss_count
    local ceiling_joists = truss_count
    local hip_extra = 0.0
    if definition.family == "hip" then hip_extra = 12.0 end
    local truss_unit_cost = round_to(38.0 + geometry.span * 9.5 + hip_extra, 2)

    local eave_runs = 2.0
    if definition.family == "hip" or definition.family == "cross" then
        eave_runs = 4.0
    elseif definition.family == "shed" then
        eave_runs = 1.0
    end
    local gutter_lf = 0.0
    if gutters then gutter_lf = geometry.eave_length end
    local auto_downspouts = math.max(roof_ceil(gutter_lf / 12), math.max(roof_ceil(area / gutter.max_area), 2.0))
    local downspouts = 0.0
    if gutters then downspouts = auto_downspouts end
    local hangers = 0.0
    if gutters then hangers = roof_ceil(gutter_lf / gutter.hanger_spacing) end
    local end_caps = 0.0
    if gutters and definition.family ~= "hip" then end_caps = eave_runs * 2.0 end
    local outlets = downspouts
    local elbows = downspouts * 2

    local drip_edge = geometry.eave_length + geometry.rake_length
    local valley = geometry.valley_length
    local step_m, apron_m, counter_m = 0.0, 0.0, 0.0
    if chimney then
        step_m, apron_m, counter_m = 4.0, 2.4, 2.4
    end
    local kickouts = 0.0
    if definition.family == "cross" then kickouts = 2.0 end
    local pipe_boots = math.max(pipe_vents, 0.0)
    local gutter_apron = 0.0
    if gutters then gutter_apron = geometry.eave_length end
    local ridge_vent_m = 0.0
    if ridge_vent then ridge_vent_m = geometry.ridge_length end
    local soffit_vent_m = 0.0
    if soffit_vent then soffit_vent_m = geometry.eave_length end
    local required_nfva = area / 300
    local provided_nfva = ridge_vent_m * 0.025 + soffit_vent_m * 0.02

    local rows = {}
    local function add(group, item, qty, unit, unit_cost, note)
        if qty > 0 then
            rows[#rows + 1] = {
                group = group,
                item = item,
                qty = round_to(qty, 2),
                unit = unit,
                unit_cost = round_to(unit_cost, 2),
                note = note or "",
            }
        end
    end

    add("Deck", sheathing.label .. " sheets", sheets, "sheet", sheathing.cost)
    add("Deck", "Sheathing nails / clips", sheets, "sheet", 3.2)
    add("Deck", underlayment.label .. " rolls", underlay_rolls, "roll", underlayment.cost)
    add("Deck", "Ice & water shield", ice_shield_m2, "m2", 14.0)
    add("Deck", "Ice & water shield rolls", ice_shield_rolls, "roll", 145.0)
    add("Covering", covering.label, covering_units, covering_unit, covering.cost_per_square / math.max(covering.units_per_square, 1))
    if starter_units > 0 then add("Covering", "Starter strip", starter_units, "bundle", 48.0) end
    if ridge_cap_units > 0 then add("Covering", "Ridge and hip cap", ridge_cap_units, ridge_cap_unit, ridge_cap_cost) end
    if covering.family == "metal" then add("Covering", "Closures and fasteners", area, "m2", 6.0) end
    if chimney then add("Covering", "Chimney cricket", 1.0, "each", 180.0) end
    add("Flashing", "Drip edge (eave and rake)", drip_edge, "m", 6.0)
    add("Flashing", "Valley metal", valley, "m", 18.0)
    add("Flashing", "Step flashing", step_m, "m", 12.0)
    add("Flashing", "Apron flashing", apron_m, "m", 16.0)
    add("Flashing", "Counter flashing", counter_m, "m", 16.0)
    add("Flashing", "Kickout flashing", kickouts, "each", 14.0)
    add("Flashing", "Pipe vent boots", pipe_boots, "each", 12.0)
    add("Flashing", "Gutter apron", gutter_apron, "m", 7.0)
    if gutters then
        add("Gutter", gutter.label .. " run", gutter_lf, "m", gutter.cost_per_lf)
        add("Gutter", "Downspouts (" .. gutter.downspout .. ")", downspouts, "each", gutter.downspout_cost)
        add("Gutter", "Hangers", hangers, "each", 1.8)
        add("Gutter", "End caps", end_caps, "each", 3.5)
        add("Gutter", "Outlets", outlets, "each", 4.5)
        add("Gutter", "Downspout elbows", elbows, "each", 5.0)
    end
    add("Structure", "Roof trusses", truss_count, "truss", truss_unit_cost)
    add("Structure", "Truss lumber (2 x 4 equivalent)", truss_lumber_m, "m", 4.6)
    add("Structure", "Ceiling joists", ceiling_joists, "joist", 12.0)
    add("Ventilation", "Ridge vent", ridge_vent_m, "m", 22.0)
    add("Ventilation", "Soffit vent strip", soffit_vent_m, "m", 9.0)

    local material = 0.0
    for index = 1, #rows do
        material = material + rows[index].qty * rows[index].unit_cost
    end
    local material_cost = round_to(material, 2)
    local tear_off_cost = 0.0
    if tear_off then tear_off_cost = squares * 90.0 end
    local install_cost = squares_with_waste * 140.0
    local gutter_labour = 0.0
    if gutters then gutter_labour = gutter_lf * 6.0 end
    local flashing_labour = (drip_edge + valley + step_m + apron_m + counter_m) * 9.0
    local labour_cost = round_to(tear_off_cost + install_cost + gutter_labour + flashing_labour, 2)
    local total_cost = round_to(material_cost + labour_cost, 2)

    local checks = {}
    local function push(check_id, severity) checks[#checks + 1] = { id = check_id, severity = severity } end

    if geometry.pitch < covering.min_pitch then
        push("pitch-covering", "error")
    elseif geometry.pitch > covering.max_pitch then
        push("pitch-max", "warn")
    else
        push("pitch-covering", "ok")
    end
    if geometry.pitch < definition.minPitch then push("pitch-style", "warn") end
    if geometry.pitch < 2 then push("low-slope", "warn") end
    if geometry.pitch < 0.25 then push("ponding", "error") end
    push("deck", "ok")
    if covering.weight >= 40 then
        if covering.weight >= 55 then push("dead-load", "warn") else push("dead-load", "info") end
    else
        push("dead-load", "ok")
    end
    if spacing > 0.45 and covering.family == "tile" then
        push("truss-spacing", "error")
    else
        push("truss-spacing", "info")
    end
    if climate == "cold" and not ice_shield then
        push("ice-dam", "error")
    elseif ice_shield then
        push("ice-dam", "ok")
    else
        push("ice-dam", "info")
    end
    if ridge_vent_m <= 0 and soffit_vent_m <= 0 then
        push("ventilation", "warn")
    elseif ridge_vent_m <= 0 or soffit_vent_m <= 0 then
        push("ventilation", "warn")
    elseif provided_nfva < required_nfva then
        push("ventilation", "warn")
    else
        push("ventilation", "ok")
    end
    if gutters then
        if downspouts > 0 and area / downspouts > gutter.max_area then
            push("gutter-capacity", "warn")
        elseif downspouts > 0 then
            push("gutter-capacity", "ok")
        else
            push("gutter-capacity", "warn")
        end
    else
        push("gutter", "info")
    end
    if underlayment.min_pitch > geometry.pitch then
        push("underlayment", "warn")
    else
        push("underlayment", "ok")
    end
    if valley > 0 then push("valley", "info") end
    if chimney then push("chimney", "info") end
    if climate == "hail" and covering.family == "shingle" then push("hail", "info") end
    if geometry.overhang > 0.9 then push("overhang", "warn") end
    if waste < 0.05 then push("waste", "warn") elseif waste > 0.25 then push("waste", "warn") end
    push("warranty", "info")

    local row_json = {}
    for index = 1, #rows do
        local row = rows[index]
        row_json[index] = jobj({
            { "group", jstr(row.group) },
            { "item", jstr(row.item) },
            { "qty", f3(row.qty) },
            { "unit", jstr(row.unit) },
            { "unitCost", f3(row.unit_cost) },
            { "cost", f3(round_to(row.qty * row.unit_cost, 2)) },
            { "note", jstr(row.note) },
        })
    end
    local check_json = {}
    local errors, warnings = 0, 0
    for index = 1, #checks do
        check_json[index] = jobj({ { "id", jstr(checks[index].id) }, { "severity", jstr(checks[index].severity) } })
        if checks[index].severity == "error" then errors = errors + 1 end
        if checks[index].severity == "warn" then warnings = warnings + 1 end
    end

    local area_per_downspout = 0.0
    if downspouts > 0 then area_per_downspout = round_to(area / downspouts, 1) end

    return jobj({
        { "style", jstr(definition.key) },
        { "styleName", jstr(definition.name) },
        { "family", jstr(definition.family) },
        { "geometry", jobj({
            { "pitch", f3(round_to(geometry.pitch, 2)) },
            { "angle", f3(round_to(geometry.angle, 1)) },
            { "span", f3(geometry.span) },
            { "length", f3(geometry.length) },
            { "overhang", f3(geometry.overhang) },
            { "rise", f3(round_to(geometry.rise, 3)) },
            { "crossRise", f3(round_to(geometry.cross_rise, 3)) },
            { "ridgeLength", f3(round_to(geometry.ridge_length, 2)) },
            { "hipLength", f3(round_to(geometry.hip_length, 2)) },
            { "valleyLength", f3(round_to(geometry.valley_length, 2)) },
            { "eaveLength", f3(round_to(geometry.eave_length, 2)) },
            { "rakeLength", f3(round_to(geometry.rake_length, 2)) },
            { "roofArea", f3(round_to(area, 2)) },
            { "planArea", f3(round_to(plan_area, 2)) },
        }) },
        { "areas", jobj({
            { "roof", f3(round_to(area, 2)) },
            { "plan", f3(round_to(plan_area, 2)) },
            { "squares", f3(round_to(squares, 2)) },
            { "squaresWithWaste", f3(round_to(squares_with_waste, 2)) },
            { "iceShield", f3(round_to(ice_shield_m2, 2)) },
            { "vents", f3(round_to(provided_nfva, 3)) },
            { "requiredVents", f3(round_to(required_nfva, 3)) },
        }) },
        { "layers", jobj({
            { "sheets", f3(sheets) },
            { "underlayRolls", f3(underlay_rolls) },
            { "iceShieldRolls", f3(ice_shield_rolls) },
            { "coveringUnits", f3(covering_units) },
            { "coveringUnit", jstr(covering_unit) },
            { "starterLf", f3(round_to(starter_lf, 1)) },
            { "starterUnits", f3(starter_units) },
            { "ridgeCapLf", f3(round_to(ridge_cap_lf, 1)) },
            { "ridgeCapUnits", f3(ridge_cap_units) },
            { "dripEdgeM", f3(round_to(drip_edge, 1)) },
            { "valleyM", f3(round_to(valley, 1)) },
            { "pipeBoots", f3(pipe_boots) },
            { "nailSpacingMm", f3(sheathing.nail_mm) },
        }) },
        { "gutterPackage", jobj({
            { "gutterLf", f3(round_to(gutter_lf, 1)) },
            { "downspouts", f3(downspouts) },
            { "hangers", f3(hangers) },
            { "endCaps", f3(end_caps) },
            { "outlets", f3(outlets) },
            { "elbows", f3(elbows) },
            { "areaPerDownspout", f3(area_per_downspout) },
        }) },
        { "ventilation", jobj({
            { "ridgeVentM", f3(round_to(ridge_vent_m, 1)) },
            { "soffitVentM", f3(round_to(soffit_vent_m, 1)) },
            { "providedNfvaM2", f3(round_to(provided_nfva, 3)) },
            { "requiredNfvaM2", f3(round_to(required_nfva, 3)) },
        }) },
        { "trusses", jobj({
            { "count", f3(truss_count) },
            { "lumberM", f3(round_to(truss_lumber_m, 1)) },
            { "ceilingJoists", f3(ceiling_joists) },
            { "memberLength", f3(round_to(member_length, 3)) },
        }) },
        { "costs", jobj({
            { "material", f3(material_cost) },
            { "labour", f3(labour_cost) },
            { "tearOff", f3(round_to(tear_off_cost, 2)) },
            { "install", f3(round_to(install_cost, 2)) },
            { "gutter", f3(round_to(gutter_labour, 2)) },
            { "flashing", f3(round_to(flashing_labour, 2)) },
            { "total", f3(total_cost) },
            { "perSquare", f3(squares > 0 and round_to(total_cost / squares, 2) or 0.0) },
            { "perM2", f3(area > 0 and round_to(total_cost / area, 2) or 0.0) },
            { "rows", jarr(row_json) },
        }) },
        { "checks", jarr(check_json) },
        { "errorCount", tostring(errors) },
        { "warningCount", tostring(warnings) },
    })
end

-- --- landscape -------------------------------------------------------------

local GALLONS_PER_M3 = 264.172
local SQFT = FT * FT

local WATER_DEFAULTS = {
    ["pool"] = { shape = "rectangle", width = 4.0, length = 9.0, shallow = 1.1, deep = 1.9, deck = 1.22, turnover = 6.0, head = 40.0 },
    ["spa"] = { shape = "circular", width = 2.4, length = 2.4, shallow = 0.9, deep = 0.9, deck = 1.0, turnover = 0.5, head = 50.0 },
    ["fountain"] = { shape = "circular", width = 2.4, length = 2.4, shallow = 0.35, deep = 0.45, deck = 0.6, turnover = 1.0, head = 20.0 },
    ["pond"] = { shape = "kidney", width = 3.5, length = 5.0, shallow = 0.45, deep = 0.9, deck = 0.0, turnover = 4.0, head = 10.0 },
    ["waterfall"] = { shape = "rectangle", width = 2.4, length = 1.2, shallow = 0.25, deep = 0.4, deck = 0.4, turnover = 0.5, head = 25.0 },
    ["water-wall"] = { shape = "rectangle", width = 3.0, length = 0.5, shallow = 0.2, deep = 0.35, deck = 0.4, turnover = 0.5, head = 30.0 },
}

local WATER_LABELS = {
    ["pool"] = "Swimming pool",
    ["spa"] = "Spa / hot tub",
    ["fountain"] = "Fountain",
    ["pond"] = "Ornamental pond",
    ["waterfall"] = "Waterfall",
    ["water-wall"] = "Water wall",
}

local SHAPE_LABELS = {
    ["rectangle"] = "Rectangle",
    ["roman"] = "Roman (rounded ends)",
    ["kidney"] = "Kidney",
    ["lap"] = "Lap pool",
    ["circular"] = "Circular",
}

local WATER_FILTERS = {
    { family = "cartridge", area = 100.0, gpm = 25.0, cost = 780.0 },
    { family = "cartridge", area = 150.0, gpm = 37.0, cost = 980.0 },
    { family = "cartridge", area = 200.0, gpm = 50.0, cost = 1180.0 },
    { family = "cartridge", area = 300.0, gpm = 75.0, cost = 1580.0 },
    { family = "de", area = 36.0, gpm = 72.0, cost = 1050.0 },
    { family = "de", area = 48.0, gpm = 96.0, cost = 1280.0 },
    { family = "sand", area = 3.14, gpm = 47.0, cost = 720.0 },
    { family = "sand", area = 4.91, gpm = 73.0, cost = 940.0 },
}

local function surface_area(shape, width, length)
    if shape == "circular" then return math.pi * (width / 2) ^ 2 end
    if shape == "roman" then
        local r = width * 0.12
        return width * length - 4 * (1 - math.pi / 4) * r * r
    end
    if shape == "kidney" then return width * length * 0.82 end
    return width * length
end

local function plan_outline(shape, width, length, segments)
    local hw = width / 2
    local hl = length / 2
    local points = {}
    if shape == "circular" then
        for i = 0, segments - 1 do
            local a = (i / segments) * math.pi * 2
            points[#points + 1] = { hw * math.cos(a), hw * math.sin(a) }
        end
        return points
    end
    if shape == "roman" then
        local r = math.min(hw, hl) * 0.6
        local corners = {
            { hw - r, hl - r, 0.0 },
            { -hw + r, hl - r, math.pi / 2 },
            { -hw + r, -hl + r, math.pi },
            { hw - r, -hl + r, math.pi * 1.5 },
        }
        for c = 1, #corners do
            local cx, cz, start = corners[c][1], corners[c][2], corners[c][3]
            for index = 0, 8 do
                local a = start + (index / 8) * (math.pi / 2)
                points[#points + 1] = { cx + r * math.cos(a), cz + r * math.sin(a) }
            end
        end
        return points
    end
    if shape == "kidney" then
        for i = 0, segments - 1 do
            local t = (i / segments) * math.pi * 2
            local wobble = 1 - 0.22 * math.cos(t) ^ 2
            points[#points + 1] = { hw * math.cos(t) * wobble, hl * math.sin(t) }
        end
        return points
    end
    if shape == "lap" then
        return {
            { -hw, -hl }, { hw, -hl }, { hw, -hl * 0.92 }, { hw * 0.92, 0.0 }, { hw, hl * 0.92 },
            { hw, hl }, { -hw, hl }, { -hw, hl * 0.92 }, { -hw * 0.92, 0.0 }, { -hw, -hl * 0.92 },
        }
    end
    return { { -hw, -hl }, { hw, -hl }, { hw, hl }, { -hw, hl } }
end

local function water_perimeter(shape, width, length)
    local points = plan_outline(shape, width, length, 48)
    local total = 0.0
    for index = 1, #points do
        local a = points[index]
        local b = points[(index % #points) + 1]
        local dx, dz = b[1] - a[1], b[2] - a[2]
        total = total + math.sqrt(dx * dx + dz * dz)
    end
    return total
end

local function weir_flow_gpm(length, head)
    local length_ft = math.max(length / FT, 0.01)
    local head_ft = math.max(head / FT, 0.001)
    local cfs = 3.33 * length_ft * head_ft ^ 1.5
    return cfs * 448.831
end

local function pick_filter(media, flow)
    local best = nil
    for index = 1, #WATER_FILTERS do
        local entry = WATER_FILTERS[index]
        if entry.family == media then
            if entry.gpm >= flow then
                if best == nil or entry.area < best.area then best = entry end
            elseif best == nil then
                best = entry
            elseif best.gpm < flow and entry.area > best.area then
                best = entry
            end
        end
    end
    if best == nil then
        return { area = 100.0, gpm = 25.0, cost = 780.0 }
    end
    return best
end

local function landscape_json(plan)
    local landscape = field(plan, "landscape") or {}
    local feature = field(landscape, "feature") or {}
    local other = field(landscape, "site") or {}
    local kind = text_or(field(feature, "type"), "pool")
    if WATER_DEFAULTS[kind] == nil then kind = "pool" end
    local defaults = WATER_DEFAULTS[kind]

    local shape = text_or(field(feature, "shape"), defaults.shape)
    if SHAPE_LABELS[shape] == nil then shape = "rectangle" end
    local width = clamp_between(number_or(field(feature, "width"), defaults.width), 0.6, 50.0)
    local length = clamp_between(number_or(field(feature, "length"), defaults.length), 0.6, 60.0)
    local shallow = clamp_between(number_or(field(feature, "shallow"), defaults.shallow), 0.15, 6.0)
    local deep = clamp_between(number_or(field(feature, "deep"), math.max(defaults.deep, shallow + 0.1)), shallow, 6.0)
    local deck = clamp_between(number_or(field(feature, "deck"), defaults.deck), 0.0, 6.0)

    local area = surface_area(shape, width, length)
    local avg_depth = deep
    if kind == "pool" then avg_depth = (shallow + deep) / 2 end
    local volume = area * avg_depth
    local gallons = volume * GALLONS_PER_M3
    local turnover = clamp_between(number_or(field(feature, "turnoverHours"), defaults.turnover), 0.25, 24.0)
    local flow = gallons / (turnover * 60)
    local head = number_or(field(feature, "head"), defaults.head)
    local pump_hp = (flow * head) / (3960 * 0.65)
    local bather_area = 15 * SQFT
    if avg_depth > 1.4 then bather_area = 20 * SQFT end
    local bathers = math.floor(area / bather_area)
    local weir = 0.0
    if kind == "waterfall" or kind == "water-wall" then
        local weir_length = number_or(field(feature, "weirLength"), width)
        weir = weir_flow_gpm(weir_length, clamp_between(number_or(field(feature, "weirHead"), 0.006), 0.003, 0.012))
    end

    local jet_default = 0.0
    if kind == "spa" then jet_default = 6.0 elseif kind == "fountain" then jet_default = 4.0 end
    local suction = math.max(round_half_up(number_or(field(feature, "suctionOutlets"), 2.0)), 0.0)
    local jets = math.max(round_half_up(number_or(field(feature, "jets"), jet_default)), 0.0)
    local jet_flow = jets * 12.0

    local is_water_body = kind == "pool" or kind == "spa"
    local site_width = number_or(field(other, "width"), math.max(width + 4, 6))
    local site_depth = number_or(field(other, "depth"), math.max(length + 5, 8))
    local feature_x = clamp_between(number_or(field(other, "featureX"), site_width / 2), width / 2, site_width - width / 2)
    local feature_z = clamp_between(number_or(field(other, "featureZ"), site_depth / 2), length / 2, site_depth - length / 2)
    local left = feature_x - width / 2
    local right = site_width - feature_x - width / 2
    local front = feature_z - length / 2
    local back = site_depth - feature_z - length / 2
    local setback = math.min(math.min(left, right), math.min(front, back))

    local deck_slope = number_or(field(other, "deckSlopePercent"), 2.0)
    local overhead = number_or(field(other, "overheadClearance"), 7.62)
    local receptacle = number_or(field(other, "receptacleDistance"), 3.0)
    local equipment = number_or(field(other, "equipmentClearance"), 1.2)

    local function flag_of(key, fallback)
        return truthy_or(field(other, key), fallback)
    end

    local bonded = flag_of("bonded", true)
    local gfci = flag_of("gfci", true)
    local luminaires_listed = flag_of("luminairesListed", true)
    local emergency_shutoff = flag_of("emergencyShutoff", true)
    local signage = flag_of("signage", true)
    local public_pool = flag_of("publicPool", false)
    local accessible_entry = flag_of("accessibleEntry", false)
    local freeze = flag_of("freezeClimate", false)
    local winterized = flag_of("winterized", false)
    local safety_cover = flag_of("safetyCover", false)
    local heater = flag_of("heater", true)
    local media_input = text_or(field(other, "filterMedia"), "cartridge")
    local media = "cartridge"
    if media_input == "sand" or media_input == "de" then media = media_input end
    local media_rate = 0.25
    if media == "sand" then media_rate = 15.0 elseif media == "de" then media_rate = 2.0 end
    local skimmers = number_or(field(other, "skimmers"), 1.0)
    local ph = number_or(field(other, "ph"), 7.4)
    local chlorine = number_or(field(other, "freeChlorine"), 2.0)
    local alkalinity = number_or(field(other, "alkalinity"), 100.0)
    local cya = number_or(field(other, "cya"), 40.0)
    local calcium = number_or(field(other, "calcium"), 300.0)

    local checks = {}
    local function push(check_id, severity)
        checks[#checks + 1] = { id = check_id, severity = severity }
    end

    if kind == "pool" and shallow < 3.0 * FT - 1e-6 then push("depth", "error") end
    if kind == "pool" and deep > 8.0 * FT + 1e-6 then push("depth-max", "warning") end
    if kind == "pool" and turnover > 8.0 then push("turnover", "warning") end
    if kind == "spa" and number_or(field(feature, "waterTempF"), 102.0) > 104.0 + 1e-6 then push("spa-temp", "error") end
    if kind == "spa" and deep > 3.0 * FT + 1e-6 then push("spa-depth", "warning") end
    if kind == "spa" and turnover > 1.0 then push("spa-turnover", "warning") end
    if kind == "pond" and deep < 24.0 * IN - 1e-6 then push("pond-depth", "warning") end
    if kind == "water-wall" and deep < 0.15 then push("wall-basin", "warning") end
    if (kind == "pool" or kind == "spa") and suction < 2.0 then push("suction", "error") end
    if jet_flow > 0 and jet_flow > flow * 1.5 then push("jets", "info") end
    if setback < 3.0 * FT - 1e-6 then
        push("setback", "error")
    elseif setback < 5.0 * FT - 1e-6 then
        push("setback", "warning")
    end
    local deck_area = math.max((width + deck * 2) * (length + deck * 2) - area, 0.0)
    if is_water_body and deck < 4.0 * FT - 1e-6 then push("deck-width", "error") end
    if deck > 0 and deck_slope < 1.0 then
        push("deck-slope", "error")
    elseif deck > 0 and deck_slope < 2.0 then
        push("deck-slope", "warning")
    end
    if is_water_body and deck_slope < 2.0 then push("site-drainage", "warning") end
    if not bonded then push("bonding", "error") end
    if not gfci then push("gfci", "error") end
    if overhead < 25.0 * FT - 1e-6 then push("overhead", "error") end
    if receptacle < 6.0 * FT - 1e-6 or receptacle > 20.0 * FT + 1e-6 then push("receptacle", "error") end
    if not luminaires_listed then push("luminaire", "error") end
    if equipment < 3.0 * FT - 1e-6 then push("equipment-access", "warning") end
    if public_pool and not accessible_entry then push("accessible", "error") end
    if freeze and not winterized then push("freeze", "warning") end
    if freeze and not safety_cover then push("cover", "info") end
    if kind == "spa" and not emergency_shutoff then push("spa-shutoff", "error") end
    if kind == "spa" and not signage then push("spa-signage", "error") end

    local required_filter = flow / media_rate
    local filter = pick_filter(media, flow)
    if filter.gpm < flow then push("filter", "warning") end
    local area_sqft = area / SQFT
    local skimmers_required = math.max(math.ceil(area_sqft / 500), 1.0)
    if is_water_body and skimmers < skimmers_required then push("skimmers", "warning") end
    local drain_velocity = 0.0
    if suction > 0 then drain_velocity = (flow * 0.002228) / (suction * 0.09) end
    if is_water_body and drain_velocity > 1.5 then push("drain-velocity", "warning") end
    local returns = math.max(math.ceil(area_sqft / 120), 2.0)
    local lights = 0.0
    if is_water_body then lights = math.max(math.ceil(area_sqft / 100), 1.0) end
    local standard_hp = 3.0
    local sizes = { 0.75, 1.0, 1.5, 2.0, 2.5, 3.0 }
    for index = 1, #sizes do
        if sizes[index] >= pump_hp then
            standard_hp = sizes[index]
            break
        end
    end
    local heater_btu = 0.0
    if heater then heater_btu = math.ceil((gallons * 8.34 * 20 / 24) / 10000) * 10000 end
    if ph < 7.2 - 1e-6 or ph > 7.8 + 1e-6 then push("chemistry-ph", "warning") end
    if chlorine < 1.0 - 1e-6 or chlorine > 5.0 + 1e-6 then push("chemistry-chlorine", "warning") end
    if alkalinity < 80.0 - 1e-6 or alkalinity > 120.0 + 1e-6 then push("chemistry-alkalinity", "warning") end
    if cya < 30.0 - 1e-6 or cya > 100.0 + 1e-6 then push("chemistry-cya", "warning") end
    if calcium < 200.0 - 1e-6 or calcium > 400.0 + 1e-6 then push("chemistry-calcium", "warning") end

    local perimeter = water_perimeter(shape, width, length)
    local deck_perimeter = perimeter + deck * 8
    local barrier_perimeter = deck_perimeter + 3
    local shell_area = area + perimeter * (avg_depth + 0.25)
    local excavation = area * (avg_depth + 0.35)

    local lines = {
        { "excavation", excavation, "m3", 65.0 },
        { "shell", shell_area, "m2", 145.0 },
        { "coping", perimeter, "m", 65.0 },
        { "deck", deck_area, "m2", 120.0 },
        { "water", volume, "m3", 4.5 },
        { "pump", 1.0, "ea", 650.0 + standard_hp * 520.0 },
        { "filter", 1.0, "ea", filter.cost },
        { "heater", 0.0, "ea", 2200.0 },
        { "skimmers", 0.0, "ea", 360.0 },
        { "covers", 0.0, "ea", 95.0 },
        { "returns", returns, "ea", 45.0 },
        { "lights", lights, "ea", 650.0 },
        { "barrier", barrier_perimeter, "m", 95.0 },
        { "cover", 0.0, "ea", round_to((width + 0.6) * (length + 0.6) * 80, 0) },
        { "controls", 1.0, "lot", 900.0 },
    }
    if kind == "pond" then lines[2][4] = 55.0 end
    if heater then lines[8][2] = 1.0 end
    if is_water_body then
        lines[9][2] = skimmers
        lines[10][2] = math.max(suction, 2.0)
    end
    if safety_cover then lines[14][2] = 1.0 end

    local bom_rows = {}
    local total = 0.0
    for index = 1, #lines do
        local line = lines[index]
        local qty, unit, unit_cost = line[2], line[3], line[4]
        if qty > 0 then
            local line_total = round_to(qty * unit_cost, 0)
            total = total + line_total
            bom_rows[#bom_rows + 1] = jobj({
                { "id", jstr(line[1]) },
                { "qty", f3(round_to(qty, 3)) },
                { "unit", jstr(unit) },
                { "unitCost", f3(unit_cost) },
                { "total", f3(line_total) },
            })
        end
    end

    local check_rows = {}
    local errors, warnings = 0, 0
    for index = 1, #checks do
        check_rows[index] = jobj({ { "id", jstr(checks[index].id) }, { "severity", jstr(checks[index].severity) } })
        if checks[index].severity == "error" then errors = errors + 1 end
        if checks[index].severity == "warning" then warnings = warnings + 1 end
    end

    return jobj({
        { "type", jstr(kind) },
        { "typeLabel", jstr(WATER_LABELS[kind]) },
        { "shape", jstr(shape) },
        { "shapeLabel", jstr(SHAPE_LABELS[shape]) },
        { "width", f3(width) },
        { "length", f3(length) },
        { "shallow", f3(shallow) },
        { "deep", f3(deep) },
        { "avgDepth", f3(avg_depth) },
        { "deck", f3(deck) },
        { "area", f3(round_to(area, 3)) },
        { "areaSqFt", f3(round_to(area_sqft, 2)) },
        { "volumeM3", f3(round_to(volume, 3)) },
        { "gallons", f3(round_to(gallons, 1)) },
        { "turnoverHours", f3(turnover) },
        { "flowGpm", f3(round_to(flow, 2)) },
        { "pumpHp", f3(round_to(pump_hp, 2)) },
        { "standardPumpHp", f3(standard_hp) },
        { "headFeet", f3(head) },
        { "bathers", f3(bathers) },
        { "suctionOutlets", f3(suction) },
        { "weirFlowGpm", f3(round_to(weir, 1)) },
        { "clearances", jobj({
            { "left", f3(round_to(left, 2)) },
            { "right", f3(round_to(right, 2)) },
            { "front", f3(round_to(front, 2)) },
            { "back", f3(round_to(back, 2)) },
            { "minimum", f3(round_to(setback, 2)) },
        }) },
        { "metrics", jobj({
            { "perimeter", f3(round_to(perimeter, 2)) },
            { "deckArea", f3(round_to(deck_area, 2)) },
            { "deckPerimeter", f3(round_to(deck_perimeter, 2)) },
            { "barrierPerimeter", f3(round_to(barrier_perimeter, 2)) },
            { "setback", f3(round_to(setback, 2)) },
            { "filterArea", f3(filter.area) },
            { "filterRequired", f3(round_to(required_filter, 2)) },
            { "skimmers", f3(is_water_body and skimmers or 0.0) },
            { "skimmersRequired", f3(skimmers_required) },
            { "returns", f3(returns) },
            { "lights", f3(lights) },
            { "drainVelocity", f3(round_to(drain_velocity, 2)) },
            { "heaterBtu", f3(heater_btu) },
            { "shellArea", f3(round_to(shell_area, 2)) },
            { "excavation", f3(round_to(excavation, 2)) },
        }) },
        { "checks", jarr(check_rows) },
        { "errorCount", tostring(errors) },
        { "warningCount", tostring(warnings) },
        { "bom", jarr(bom_rows) },
        { "total", f3(total) },
    })
end

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
    local plumbing = plumbing_json(plan)
    local lighting = lighting_json(plan)
    local landscape = landscape_json(plan)

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
            { "design", roof_design_json(plan) },
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
        { "plumbing", plumbing },
        { "lighting", lighting },
        { "landscape", landscape },
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
