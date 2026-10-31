//! floorplan3d core features: geometry, takeoffs, framing, stairs, deck, roof,
//! electrical, cut list and wireframe export.
//!
//! This is the Rust member of `ports/`. It reads the same plan JSON and prints the
//! same canonical result JSON as `ports/python` and `ports/lua`, so
//! `ports/run-parity.mjs` can diff them. No dependencies: the JSON reader and the
//! writer are here, which also keeps the numbers byte-identical to the other ports.
//!
//! Usage: floorplan_core <plan.json>

use std::process::exit;

const IN: f64 = 0.0254;
const FT: f64 = 12.0 * IN;
const M2_PER_SQFT: f64 = 0.09290304;
const DRYWALL_SHEET_M2: f64 = 2.4 * 1.2;
const SQFT_PER_SQUARE: f64 = 100.0;
const CONCRETE_BAG_M3: f64 = 0.017;
const FNV_OFFSET: u32 = 0x811C_9DC5;
const FNV_PRIME: u32 = 0x0100_0193;

const MAX_RISER_MM: f64 = 196.0;
const MIN_TREAD_MM: f64 = 254.0;
const MIN_WIDTH_MM: f64 = 914.0;
const COMFORT_TARGET: f64 = 25.0 * IN;
const COMFORT_MIN: f64 = 24.0 * IN;
const COMFORT_MAX: f64 = 25.0 * IN;
const MAX_TREAD: f64 = 0.36;

const DEFAULT_SOIL_PSF: f64 = 2000.0;
const DECK_LOAD_PSF: f64 = 50.0;
const SERVICE_SIZES: [f64; 7] = [100.0, 125.0, 150.0, 200.0, 225.0, 320.0, 400.0];

// --- JSON input ------------------------------------------------------------

#[derive(Clone, Debug)]
enum Json {
    Null,
    Bool,
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(pairs) => pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    fn number(&self) -> Option<f64> {
        match self {
            Json::Num(n) => Some(*n),
            Json::Str(s) => s.parse::<f64>().ok(),
            _ => None,
        }
    }

    fn text(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }

    fn items(&self) -> &[Json] {
        match self {
            Json::Arr(items) => items,
            _ => &[],
        }
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Parser<'a> {
    fn new(text: &'a str) -> Self {
        Parser { bytes: text.as_bytes(), at: 0 }
    }

    fn skip_ws(&mut self) {
        while self.at < self.bytes.len() && (self.bytes[self.at] as char).is_whitespace() {
            self.at += 1;
        }
    }

    fn value(&mut self) -> Json {
        self.skip_ws();
        match self.bytes.get(self.at).copied() {
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => Json::Str(self.string()),
            Some(b't') => {
                self.at += 4;
                Json::Bool
            }
            Some(b'f') => {
                self.at += 5;
                Json::Bool
            }
            Some(b'n') => {
                self.at += 4;
                Json::Null
            }
            _ => self.number(),
        }
    }

    fn object(&mut self) -> Json {
        self.at += 1; // {
        let mut pairs = Vec::new();
        loop {
            self.skip_ws();
            if self.bytes.get(self.at) == Some(&b'}') {
                self.at += 1;
                break;
            }
            let key = self.string();
            self.skip_ws();
            if self.bytes.get(self.at) == Some(&b':') {
                self.at += 1;
            }
            let value = self.value();
            pairs.push((key, value));
            self.skip_ws();
            if self.bytes.get(self.at) == Some(&b',') {
                self.at += 1;
            }
        }
        Json::Obj(pairs)
    }

    fn array(&mut self) -> Json {
        self.at += 1; // [
        let mut items = Vec::new();
        loop {
            self.skip_ws();
            if self.bytes.get(self.at) == Some(&b']') {
                self.at += 1;
                break;
            }
            items.push(self.value());
            self.skip_ws();
            if self.bytes.get(self.at) == Some(&b',') {
                self.at += 1;
            }
        }
        Json::Arr(items)
    }

    fn string(&mut self) -> String {
        self.skip_ws();
        if self.bytes.get(self.at) == Some(&b'"') {
            self.at += 1;
        }
        let mut out = String::new();
        while let Some(&byte) = self.bytes.get(self.at) {
            self.at += 1;
            match byte {
                b'"' => break,
                b'\\' => {
                    if let Some(&esc) = self.bytes.get(self.at) {
                        self.at += 1;
                        out.push(match esc {
                            b'n' => '\n',
                            b't' => '\t',
                            b'r' => '\r',
                            other => other as char,
                        });
                    }
                }
                other => out.push(other as char),
            }
        }
        out
    }

    fn number(&mut self) -> Json {
        let start = self.at;
        while let Some(&byte) = self.bytes.get(self.at) {
            let ch = byte as char;
            if ch.is_ascii_digit() || ch == '-' || ch == '+' || ch == '.' || ch == 'e' || ch == 'E' {
                self.at += 1;
            } else {
                break;
            }
        }
        let text = std::str::from_utf8(&self.bytes[start..self.at]).unwrap_or("0");
        Json::Num(text.parse().unwrap_or(0.0))
    }
}

fn field<'a>(value: &'a Json, key: &str) -> &'a Json {
    value.get(key).unwrap_or(&Json::Null)
}

fn number_or(value: &Json, default: f64) -> f64 {
    value.number().unwrap_or(default)
}

// --- canonical output helpers ---------------------------------------------

fn r3(value: f64) -> f64 {
    let scaled = value * 1000.0;
    let rounded = if scaled >= 0.0 {
        (scaled + 0.5).floor()
    } else {
        (scaled - 0.5).ceil()
    };
    rounded / 1000.0
}

fn clamp(value: f64, low: f64, high: f64) -> f64 {
    value.max(low).min(high)
}

fn f3(value: f64) -> String {
    let value = r3(value);
    if value == value.trunc() {
        format!("{}", value as i64)
    } else {
        format!("{:.3}", value)
    }
}

fn jstr(text: &str) -> String {
    let mut out = String::from("\"");
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

fn jobj(pairs: &[(&str, String)]) -> String {
    let body: Vec<String> = pairs
        .iter()
        .map(|(key, value)| format!("{}:{}", jstr(key), value))
        .collect();
    format!("{{{}}}", body.join(","))
}

fn jarr(items: &[String]) -> String {
    format!("[{}]", items.join(","))
}

fn flag(value: bool) -> String {
    if value { "true".to_string() } else { "false".to_string() }
}

// --- geometry --------------------------------------------------------------

fn polygon_area(points: &[(f64, f64)]) -> f64 {
    let mut total = 0.0;
    let count = points.len();
    for i in 0..count {
        let (x1, y1) = points[i];
        let (x2, y2) = points[(i + 1) % count];
        total += x1 * y2 - x2 * y1;
    }
    total.abs() / 2.0
}

fn polygon_perimeter(points: &[(f64, f64)]) -> f64 {
    let mut total = 0.0;
    let count = points.len();
    for i in 0..count {
        let (x1, y1) = points[i];
        let (x2, y2) = points[(i + 1) % count];
        let (dx, dy) = (x2 - x1, y2 - y1);
        total += (dx * dx + dy * dy).sqrt();
    }
    total
}

fn polygon_centroid(points: &[(f64, f64)]) -> (f64, f64) {
    let count = points.len();
    if count == 0 {
        return (0.0, 0.0);
    }
    let mut twice = 0.0;
    let mut cx = 0.0;
    let mut cy = 0.0;
    for i in 0..count {
        let (x1, y1) = points[i];
        let (x2, y2) = points[(i + 1) % count];
        let cross = x1 * y2 - x2 * y1;
        twice += cross;
        cx += (x1 + x2) * cross;
        cy += (y1 + y2) * cross;
    }
    if twice.abs() < 1e-12 {
        let sx: f64 = points.iter().map(|p| p.0).sum::<f64>() / count as f64;
        let sy: f64 = points.iter().map(|p| p.1).sum::<f64>() / count as f64;
        return (sx, sy);
    }
    (cx / (3.0 * twice), cy / (3.0 * twice))
}

struct WallMetrics {
    length: f64,
    angle: f64,
    height: f64,
    gross: f64,
    openings: f64,
    net: f64,
    opening_widths: f64,
    opening_count: usize,
}

fn wall_metrics(wall: &Json, default_height: f64) -> WallMetrics {
    let x1 = number_or(field(wall, "x1"), 0.0);
    let y1 = number_or(field(wall, "y1"), 0.0);
    let x2 = number_or(field(wall, "x2"), 0.0);
    let y2 = number_or(field(wall, "y2"), 0.0);
    let height = number_or(field(wall, "height"), default_height);
    let (dx, dy) = (x2 - x1, y2 - y1);
    let length = (dx * dx + dy * dy).sqrt();
    let mut angle = dy.atan2(dx) * (180.0 / std::f64::consts::PI);
    angle %= 360.0;
    if angle < 0.0 {
        angle += 360.0;
    }
    let gross = length * height;

    let openings = field(wall, "openings").items();
    let mut opening_area = 0.0;
    let mut opening_widths = 0.0;
    for opening in openings {
        let width = number_or(field(opening, "width"), 0.0);
        let open_height = number_or(field(opening, "height"), 0.0);
        opening_area += width * open_height;
        opening_widths += width;
    }
    opening_area = opening_area.min(gross);

    WallMetrics {
        length,
        angle,
        height,
        gross,
        openings: opening_area,
        net: gross - opening_area,
        opening_widths,
        opening_count: openings.len(),
    }
}

// --- feature sections ------------------------------------------------------

struct Room {
    name: String,
    area: f64,
    perimeter: f64,
    centroid: (f64, f64),
    height: f64,
    volume: f64,
}

fn build_rooms(plan: &Json) -> Vec<Room> {
    let default_height = number_or(field(plan, "wallHeight"), 2.7);
    let mut rooms = Vec::new();
    for room in field(plan, "rooms").items() {
        let points: Vec<(f64, f64)> = field(room, "polygon")
            .items()
            .iter()
            .map(|point| {
                let pair = point.items();
                let x = pair.first().map(|v| number_or(v, 0.0)).unwrap_or(0.0);
                let y = pair.get(1).map(|v| number_or(v, 0.0)).unwrap_or(0.0);
                (x, y)
            })
            .collect();
        let area = polygon_area(&points);
        let height = number_or(field(room, "height"), default_height);
        rooms.push(Room {
            name: field(room, "name").text().unwrap_or("Room").to_string(),
            area,
            perimeter: polygon_perimeter(&points),
            centroid: polygon_centroid(&points),
            height,
            volume: area * height,
        });
    }
    rooms
}

struct Finishes {
    wall_net_area: f64,
    ceiling_area: f64,
    drywall_sheets: i64,
    paint_litres: i64,
    flooring_m2: f64,
    baseboard_m: f64,
}

fn build_finishes(rooms: &[Room], walls: &[WallMetrics], plan: &Json) -> Finishes {
    let net_area: f64 = walls.iter().map(|w| w.net).sum();
    let ceiling: f64 = rooms.iter().map(|r| r.area).sum();
    let covered = net_area + ceiling;
    let drywall = if covered > 0.0 {
        ((covered / DRYWALL_SHEET_M2) - 1e-9).ceil() as i64
    } else {
        0
    };
    let paint = if covered > 0.0 {
        (((covered * 2.0) / 10.0) - 1e-9).ceil() as i64
    } else {
        0
    };
    let waste = number_or(field(plan, "wastePct"), 10.0) / 100.0;
    let flooring = ceiling * (1.0 + waste);
    let baseboard = rooms.iter().map(|r| r.perimeter).sum::<f64>()
        - walls.iter().map(|w| w.opening_widths).sum::<f64>();

    Finishes {
        wall_net_area: net_area,
        ceiling_area: ceiling,
        drywall_sheets: drywall,
        paint_litres: paint,
        flooring_m2: flooring.max(0.0),
        baseboard_m: baseboard.max(0.0),
    }
}

struct Framing {
    spacing_mm: f64,
    studs: i64,
    studs_by_wall: Vec<i64>,
    plates: f64,
    sheathing_panels: i64,
}

fn build_framing(walls: &[WallMetrics], plan: &Json) -> Framing {
    let spacing = number_or(field(plan, "studSpacingMm"), 406.0);
    let mut studs_by_wall = Vec::new();
    let mut studs = 0i64;
    for wall in walls {
        let mut run = ((wall.length * 1000.0 / spacing) + 1e-9).floor() as i64 + 1;
        run += 2 * wall.opening_count as i64;
        studs_by_wall.push(run);
        studs += run;
    }
    let plates = walls.iter().map(|w| w.length).sum::<f64>() * 3.0;
    let gross: f64 = walls.iter().map(|w| w.gross).sum();
    let panels = if gross > 0.0 {
        ((gross / DRYWALL_SHEET_M2) - 1e-9).ceil() as i64
    } else {
        0
    };

    Framing { spacing_mm: spacing, studs, studs_by_wall, plates, sheathing_panels: panels }
}

// --- NDS member sizing ------------------------------------------------------

/// NDS reference design values in psi: (Fb bending, Fv shear, E modulus).
///
/// The species keys match the list on the site's span calculator. The values are
/// NDS Supplement reference values for visually graded dimension lumber at 19%
/// moisture content and normal load duration. No adjustment factors (Cd, Cr, CM,
/// CL) are applied, so a span is a reference-case span, not a permitted design.
fn species_values(key: &str) -> (f64, f64, f64) {
    match key {
        "dfl-1" => (1000.0, 180.0, 1_700_000.0),
        "dfl-2" => (900.0, 180.0, 1_600_000.0),
        "sp-1" => (1150.0, 175.0, 1_600_000.0),
        "sp-2" => (850.0, 175.0, 1_400_000.0),
        "spf-1" => (875.0, 135.0, 1_400_000.0),
        _ => (775.0, 135.0, 1_300_000.0), // spf-2, the default
    }
}

/// Dressed width and depth in inches for a nominal lumber size.
fn section_inches(size: &str) -> Option<(f64, f64)> {
    Some(match size {
        "1x4" => (0.75, 3.5),
        "1x6" => (0.75, 5.5),
        "1x8" => (0.75, 7.25),
        "2x2" => (1.5, 1.5),
        "2x4" => (1.5, 3.5),
        "2x6" => (1.5, 5.5),
        "2x8" => (1.5, 7.25),
        "2x10" => (1.5, 9.25),
        "2x12" => (1.5, 11.25),
        "4x4" => (3.5, 3.5),
        "6x6" => (5.5, 5.5),
        "5/4x6" => (1.0, 5.5),
        _ => return None,
    })
}

/// One member checked as a simply supported, uniformly loaded beam.
struct Sized {
    id: String,
    group: String,
    size: String,
    species: String,
    b: f64,
    d: f64,
    area: f64,
    section_modulus: f64,
    inertia: f64,
    load: f64,
    spacing: f64,
    span: f64,
    limit: f64,
    plf: f64,
    bending: f64,
    shear: f64,
    deflection: f64,
    allowable: f64,
    governing: &'static str,
    pass: bool,
}

fn build_sizing(plan: &Json) -> Vec<Sized> {
    let sizing = field(plan, "sizing");
    let default_species = field(sizing, "species").text().unwrap_or("spf-2");
    let default_limit = number_or(field(sizing, "limit"), 360.0);
    let mut members = Vec::new();

    for member in field(sizing, "members").items() {
        let size = field(member, "size").text().unwrap_or("");
        let (b, d) = match section_inches(size) {
            Some(section) => section,
            None => continue, // unknown nominal size: nothing to size
        };
        let species = field(member, "species").text().unwrap_or(default_species);
        let (fb, fv, e) = species_values(species);
        let load = number_or(field(member, "load"), 0.0);
        let spacing = number_or(field(member, "spacing"), 0.0);
        let span = number_or(field(member, "span"), 0.0);
        let limit = number_or(field(member, "limit"), default_limit);

        let area = b * d;
        let section_modulus = b * d * d / 6.0;
        let inertia = b * d * d * d / 12.0;
        // Uniform load along the member, lb per inch of span.
        let distributed = load * (spacing / FT) / 12.0;

        let mut bending = 0.0;
        let mut shear = 0.0;
        let mut deflection = 0.0;
        let mut allowable = 0.0;
        let mut governing = "none";
        let mut pass = false;

        if distributed > 0.0 {
            // M = wL^2/8 and fb = M/S  =>  L = sqrt(8 Fb S / w).
            bending = (8.0 * fb * section_modulus / distributed).sqrt() * IN;
            // V = wL/2 and fv = 1.5 V/A  =>  L = 4 Fv A / (3 w).
            shear = 4.0 * fv * area / (3.0 * distributed) * IN;
            // delta = 5wL^4/(384EI) <= L/limit  =>  L = cbrt(384 E I / (5 limit w)).
            deflection = (384.0 * e * inertia / (5.0 * limit * distributed)).powf(1.0 / 3.0) * IN;

            allowable = bending;
            governing = "bending";
            if shear < allowable {
                allowable = shear;
                governing = "shear";
            }
            if deflection < allowable {
                allowable = deflection;
                governing = "deflection";
            }
            pass = span <= allowable + 1e-9;
        }

        members.push(Sized {
            id: field(member, "id").text().unwrap_or("").to_string(),
            group: field(member, "group").text().unwrap_or("framing").to_string(),
            size: size.to_string(),
            species: species.to_string(),
            b,
            d,
            area,
            section_modulus,
            inertia,
            load,
            spacing,
            span,
            limit,
            plf: distributed * 12.0,
            bending,
            shear,
            deflection,
            allowable,
            governing,
            pass,
        });
    }

    members
}

fn sized_json(member: &Sized) -> String {
    jobj(&[
        ("id", jstr(&member.id)),
        ("group", jstr(&member.group)),
        ("size", jstr(&member.size)),
        ("species", jstr(&member.species)),
        ("bIn", f3(member.b)),
        ("dIn", f3(member.d)),
        ("areaIn2", f3(member.area)),
        ("sectionModulusIn3", f3(member.section_modulus)),
        ("inertiaIn4", f3(member.inertia)),
        ("loadPsf", f3(member.load)),
        ("spacing", f3(member.spacing)),
        ("span", f3(member.span)),
        ("plf", f3(member.plf)),
        ("limit", f3(member.limit)),
        ("bendingSpan", f3(member.bending)),
        ("shearSpan", f3(member.shear)),
        ("deflectionSpan", f3(member.deflection)),
        ("allowableSpan", f3(member.allowable)),
        ("governing", jstr(member.governing)),
        ("pass", flag(member.pass)),
    ])
}

/// The sized members of one suite, in input order.
fn sizing_json(group: &str, members: &[Sized]) -> String {
    let chosen: Vec<&Sized> = members.iter().filter(|m| m.group == group).collect();
    let rows: Vec<String> = chosen.iter().map(|m| sized_json(m)).collect();
    jobj(&[
        ("count", chosen.len().to_string()),
        ("pass", flag(chosen.iter().all(|m| m.pass))),
        ("members", jarr(&rows)),
    ])
}

struct Stairs {
    risers: i64,
    riser_height: f64,
    treads: i64,
    tread: f64,
    run: f64,
    run_available: f64,
    total_rise: f64,
    stringer: f64,
    width: f64,
    two_r_plus_t: f64,
    checks: [bool; 4],
    pass: bool,
}

fn build_stairs(stairs: &Json) -> Stairs {
    let rise = number_or(field(stairs, "rise"), 0.0);
    let width = number_or(field(stairs, "width"), 0.0);
    let run_available = number_or(field(stairs, "runAvailable"), 0.0);

    let max_riser = MAX_RISER_MM / 1000.0;
    let min_tread = MIN_TREAD_MM / 1000.0;
    let risers = (3.0f64).max((rise / max_riser - 1e-9).ceil()) as i64;
    let riser_height = rise / risers as f64;
    let treads = risers - 1;
    let ideal = clamp(COMFORT_TARGET - 2.0 * riser_height, min_tread, MAX_TREAD);
    let mut tread = ideal;
    if run_available > 0.0 {
        tread = clamp(run_available / treads as f64, 0.0, MAX_TREAD);
    }
    let run = tread * treads as f64;
    let stringer = (rise * rise + run * run).sqrt();
    let two_r_plus_t = 2.0 * riser_height + tread;

    let checks = [
        riser_height <= max_riser + 1e-9,
        tread >= min_tread - 1e-9,
        width >= MIN_WIDTH_MM / 1000.0 - 1e-9,
        two_r_plus_t >= COMFORT_MIN - 1e-9 && two_r_plus_t <= COMFORT_MAX + 1e-9,
    ];

    Stairs {
        risers,
        riser_height,
        treads,
        tread,
        run,
        run_available,
        total_rise: rise,
        stringer,
        width,
        two_r_plus_t,
        checks,
        pass: checks.iter().all(|ok| *ok),
    }
}

struct Deck {
    joist_span: f64,
    joist_spacing: f64,
    joist_count: i64,
    post_spacing: f64,
    post_load_lb: i64,
    soil: String,
    soil_psf: f64,
    footing_diameter_in: f64,
    footing_volume: f64,
    concrete_bags: i64,
    boards: i64,
}

fn build_deck(deck: &Json) -> Deck {
    let joist_span = number_or(field(deck, "joistSpan"), 0.0);
    let joist_spacing = number_or(field(deck, "joistSpacing"), 0.406);
    let post_spacing = number_or(field(deck, "postSpacing"), 0.0);
    let soil = field(deck, "soil").text().unwrap_or("default").to_string();
    let soil_psf = match soil.as_str() {
        "clay" => 1500.0,
        "sand" => 3000.0,
        "gravel" => 3000.0,
        "silt" => 1500.0,
        _ => DEFAULT_SOIL_PSF,
    };
    let depth = number_or(field(deck, "depth"), 0.9);
    let width = number_or(field(deck, "width"), 0.0);

    let joist_count = (joist_span / joist_spacing + 1e-9).floor() as i64 + 1;
    let post_load_lb =
        (DECK_LOAD_PSF * (post_spacing / FT) * (joist_span / FT) / 2.0 + 0.5).floor() as i64;
    let footing_area_ft2 = post_load_lb as f64 / soil_psf;
    let required = 12.0 * (4.0 * footing_area_ft2 / std::f64::consts::PI).max(0.0).sqrt();
    let diameter_in = 12.0f64.max((required - 1e-9).ceil());
    let radius = diameter_in * IN;
    let volume = std::f64::consts::PI / 4.0 * (radius * radius) * depth;
    let bags = if volume > 0.0 {
        (volume / CONCRETE_BAG_M3 - 1e-9).ceil() as i64
    } else {
        0
    };
    let boards = if width > 0.0 {
        (width * 1000.0 / (140.0 + 5.0) - 1e-9).ceil() as i64
    } else {
        0
    };

    Deck {
        joist_span,
        joist_spacing,
        joist_count,
        post_spacing,
        post_load_lb,
        soil,
        soil_psf,
        footing_diameter_in: diameter_in,
        footing_volume: volume,
        concrete_bags: bags,
        boards,
    }
}

struct Roof {
    plan_area: f64,
    pitch: f64,
    slope_factor: f64,
    angle: f64,
    roof_area: f64,
    squares: f64,
    bundles: i64,
}

fn build_roof(roof: &Json) -> Roof {
    let plan_area = number_or(field(roof, "planArea"), 0.0);
    let pitch = number_or(field(roof, "pitch"), 0.0);
    let slope_factor = (1.0 + (pitch / 12.0) * (pitch / 12.0)).sqrt();
    let roof_area = plan_area * slope_factor;
    let squares = roof_area / (SQFT_PER_SQUARE * M2_PER_SQFT);
    let bundles = if squares > 0.0 {
        (squares * 3.0 - 1e-9).ceil() as i64
    } else {
        0
    };
    Roof {
        plan_area,
        pitch,
        slope_factor,
        angle: (pitch / 12.0).atan() * (180.0 / std::f64::consts::PI),
        roof_area,
        squares,
        bundles,
    }
}

struct Electrical {
    area_m2: f64,
    area_ft2: f64,
    general_va: f64,
    sabc_va: f64,
    laundry_va: f64,
    service_demand_va: f64,
    appliance_va: f64,
    hvac_va: f64,
    total_va: f64,
    amps: f64,
    service_amps: f64,
    optional_va: f64,
    optional_amps: f64,
}

fn build_electrical(electrical: &Json) -> Electrical {
    let area_m2 = number_or(field(electrical, "areaM2"), 0.0);
    let sabc = number_or(field(electrical, "smallApplianceCircuits"), 0.0);
    let laundry = number_or(field(electrical, "laundryCircuits"), 0.0);
    let appliances = number_or(field(electrical, "appliancesVa"), 0.0);
    let heating = number_or(field(electrical, "heatingVa"), 0.0);
    let cooling = number_or(field(electrical, "coolingVa"), 0.0);

    let area_ft2 = area_m2 / M2_PER_SQFT;
    let general = area_ft2 * 3.0;
    let sabc_va = sabc * 1500.0;
    let laundry_va = laundry * 1500.0;
    let subtotal = general + sabc_va + laundry_va;

    // NEC 220.42 tiers: first 3000 VA at 100%, to 120000 at 35%, over at 25%.
    let first = subtotal.min(3000.0);
    let second = clamp(subtotal, 3000.0, 120000.0) - 3000.0;
    let third = (subtotal - 120000.0).max(0.0);
    let demand = first + second * 0.35 + third * 0.25;

    let appliance_demand = appliances * 0.75;
    let hvac = heating.max(cooling);
    let total = demand + appliance_demand + hvac;
    let amps = if total > 0.0 { (total / 240.0 - 1e-9).ceil() } else { 0.0 };
    let service = SERVICE_SIZES
        .iter()
        .copied()
        .find(|size| *size >= amps)
        .unwrap_or(SERVICE_SIZES[SERVICE_SIZES.len() - 1]);

    let optional_base = general + sabc_va + laundry_va + appliances;
    let optional = optional_base.min(10000.0) + (optional_base - 10000.0).max(0.0) * 0.40 + hvac;
    let optional_amps = if optional > 0.0 {
        (optional / 240.0 - 1e-9).ceil()
    } else {
        0.0
    };

    Electrical {
        area_m2,
        area_ft2,
        general_va: general,
        sabc_va,
        laundry_va,
        service_demand_va: demand,
        appliance_va: appliance_demand,
        hvac_va: hvac,
        total_va: total,
        amps,
        service_amps: service,
        optional_va: optional,
        optional_amps,
    }
}

struct Group {
    kind: String,
    label: String,
    width: f64,
    depth: f64,
    height: f64,
    ids: Vec<String>,
}

fn build_cut_list(fixtures: &[Json]) -> Vec<Group> {
    let mut groups: Vec<Group> = Vec::new();
    for fixture in fixtures {
        let kind = field(fixture, "type").text().unwrap_or("item").to_string();
        let width = r3(number_or(field(fixture, "width"), 0.0));
        let depth = r3(number_or(field(fixture, "depth"), 0.0));
        let height = r3(number_or(field(fixture, "height"), 0.0));
        let label = field(fixture, "label")
            .text()
            .unwrap_or(&kind.replace('_', " "))
            .to_string();
        let id = field(fixture, "id").text().unwrap_or("").to_string();

        match groups
            .iter_mut()
            .find(|g| g.kind == kind && g.width == width && g.depth == depth && g.height == height)
        {
            Some(group) => group.ids.push(id),
            None => groups.push(Group { kind, label, width, depth, height, ids: vec![id] }),
        }
    }
    groups.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then(a.width.partial_cmp(&b.width).unwrap_or(std::cmp::Ordering::Equal))
            .then(a.depth.partial_cmp(&b.depth).unwrap_or(std::cmp::Ordering::Equal))
            .then(a.height.partial_cmp(&b.height).unwrap_or(std::cmp::Ordering::Equal))
    });
    groups
}

fn cut_list_csv(groups: &[Group]) -> String {
    let mut lines = vec!["type,label,count,width_m,depth_m,height_m".to_string()];
    for group in groups {
        lines.push(format!(
            "{},{},{},{:.3},{:.3},{:.3}",
            group.kind,
            group.label,
            group.ids.len(),
            group.width,
            group.depth,
            group.height
        ));
    }
    lines.join("\n")
}

/// FNV-1a 32-bit. Deliberately 32-bit: a Lua build may only have 32-bit integers
/// (fengari does), and all three ports must compute the same hash for the same OBJ.
fn fnv1a32(text: &str) -> u32 {
    let mut hash = FNV_OFFSET;
    for byte in text.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

fn build_wireframe(walls: &[Json], depth: f64) -> (i64, i64, String) {
    let mut lines = Vec::new();
    let mut vertices = 0i64;
    let mut edges = 0i64;
    for wall in walls {
        let x1 = number_or(field(wall, "x1"), 0.0);
        let y1 = number_or(field(wall, "y1"), 0.0);
        let x2 = number_or(field(wall, "x2"), 0.0);
        let y2 = number_or(field(wall, "y2"), 0.0);
        lines.push(format!("v {:.3} {:.3} {:.3}", x1, y1, 0.0));
        lines.push(format!("v {:.3} {:.3} {:.3}", x2, y2, 0.0));
        lines.push(format!("v {:.3} {:.3} {:.3}", x1, y1, depth));
        lines.push(format!("v {:.3} {:.3} {:.3}", x2, y2, depth));
        let base = vertices;
        lines.push(format!("l {} {}", base + 1, base + 2));
        lines.push(format!("l {} {}", base + 3, base + 4));
        lines.push(format!("l {} {}", base + 1, base + 3));
        lines.push(format!("l {} {}", base + 2, base + 4));
        vertices += 4;
        edges += 4;
    }
    let text = lines.join("\n");
    (vertices, edges, format!("{:08x}", fnv1a32(&text)))
}

// --- document --------------------------------------------------------------

fn compute(plan: &Json) -> String {
    let wall_height = number_or(field(plan, "wallHeight"), 2.7);
    let walls: Vec<WallMetrics> = field(plan, "walls")
        .items()
        .iter()
        .map(|w| wall_metrics(w, wall_height))
        .collect();
    let wall_json = field(plan, "walls").items();
    let rooms = build_rooms(plan);
    let finishes = build_finishes(&rooms, &walls, plan);
    let framing = build_framing(&walls, plan);
    let sizing = build_sizing(plan);
    let stairs = build_stairs(field(plan, "stairs"));
    let deck = build_deck(field(plan, "deck"));
    let roof = build_roof(field(plan, "roof"));
    let electrical = build_electrical(field(plan, "electrical"));
    let groups = build_cut_list(field(plan, "fixtures").items());
    let (vertices, edges, obj_hash) = build_wireframe(wall_json, wall_height);

    let total_area: f64 = rooms.iter().map(|r| r.area).sum();
    let total_volume: f64 = rooms.iter().map(|r| r.volume).sum();
    let mean_height = if walls.is_empty() {
        wall_height
    } else {
        walls.iter().map(|w| w.height).sum::<f64>() / walls.len() as f64
    };

    let wall_rows: Vec<String> = walls
        .iter()
        .enumerate()
        .map(|(index, w)| {
            jobj(&[
                ("index", index.to_string()),
                ("length", f3(w.length)),
                ("angle", format!("{:.2}", w.angle)),
                ("height", f3(w.height)),
                ("gross", f3(w.gross)),
                ("openings", f3(w.openings)),
                ("net", f3(w.net)),
            ])
        })
        .collect();

    let room_rows: Vec<String> = rooms
        .iter()
        .map(|room| {
            jobj(&[
                ("name", jstr(&room.name)),
                ("area", f3(room.area)),
                ("perimeter", f3(room.perimeter)),
                ("centroid", jarr(&[f3(room.centroid.0), f3(room.centroid.1)])),
                ("height", f3(room.height)),
                ("volume", f3(room.volume)),
            ])
        })
        .collect();

    let group_rows: Vec<String> = groups
        .iter()
        .map(|group| {
            jobj(&[
                ("type", jstr(&group.kind)),
                ("label", jstr(&group.label)),
                ("count", group.ids.len().to_string()),
                ("width", f3(group.width)),
                ("depth", f3(group.depth)),
                ("height", f3(group.height)),
                ("ids", jarr(&group.ids.iter().map(|id| jstr(id)).collect::<Vec<_>>())),
            ])
        })
        .collect();

    let stairs_obj = jobj(&[
        ("risers", stairs.risers.to_string()),
        ("riserHeight", f3(stairs.riser_height)),
        ("maxRiserMm", f3(MAX_RISER_MM)),
        ("treads", stairs.treads.to_string()),
        ("tread", f3(stairs.tread)),
        ("minTreadMm", f3(MIN_TREAD_MM)),
        ("run", f3(stairs.run)),
        ("runAvailable", f3(stairs.run_available)),
        ("totalRise", f3(stairs.total_rise)),
        ("stringer", f3(stairs.stringer)),
        ("width", f3(stairs.width)),
        ("minWidthMm", f3(MIN_WIDTH_MM)),
        ("twoRPlusT", f3(stairs.two_r_plus_t)),
        (
            "checks",
            jobj(&[
                ("riser", flag(stairs.checks[0])),
                ("tread", flag(stairs.checks[1])),
                ("width", flag(stairs.checks[2])),
                ("comfort", flag(stairs.checks[3])),
            ]),
        ),
        ("pass", flag(stairs.pass)),
    ]);

    jobj(&[
        ("project", jstr(field(plan, "project").text().unwrap_or(""))),
        ("units", jstr(field(plan, "units").text().unwrap_or("m"))),
        ("walls", jarr(&wall_rows)),
        ("rooms", jarr(&room_rows)),
        (
            "totals",
            jobj(&[
                ("wallCount", walls.len().to_string()),
                ("roomCount", rooms.len().to_string()),
                ("wallGrossArea", f3(walls.iter().map(|w| w.gross).sum())),
                ("wallNetArea", f3(finishes.wall_net_area)),
                ("openingArea", f3(walls.iter().map(|w| w.openings).sum())),
                ("roomArea", f3(total_area)),
                ("roomVolume", f3(total_volume)),
                ("meanHeight", f3(mean_height)),
            ]),
        ),
        (
            "finishes",
            jobj(&[
                ("wallNetArea", f3(finishes.wall_net_area)),
                ("ceilingArea", f3(finishes.ceiling_area)),
                ("drywallSheets", finishes.drywall_sheets.to_string()),
                ("paintLitres", finishes.paint_litres.to_string()),
                ("paintCoats", "2".to_string()),
                ("flooringM2", f3(finishes.flooring_m2)),
                ("baseboardM", f3(finishes.baseboard_m)),
            ]),
        ),
        (
            "framing",
            jobj(&[
                ("spacingMm", f3(framing.spacing_mm)),
                ("studs", framing.studs.to_string()),
                ("studsByWall", jarr(&framing.studs_by_wall.iter().map(|n| n.to_string()).collect::<Vec<_>>())),
                ("plates", f3(framing.plates)),
                ("sheathingPanels", framing.sheathing_panels.to_string()),
                ("sizing", sizing_json("framing", &sizing)),
            ]),
        ),
        ("stairs", stairs_obj),
        (
            "deck",
            jobj(&[
                ("joistSpan", f3(deck.joist_span)),
                ("joistSpacing", f3(deck.joist_spacing)),
                ("joistCount", deck.joist_count.to_string()),
                ("postSpacing", f3(deck.post_spacing)),
                ("postLoadLb", f3(deck.post_load_lb as f64)),
                ("soil", jstr(&deck.soil)),
                ("soilPsf", f3(deck.soil_psf)),
                ("footingDiameterIn", f3(deck.footing_diameter_in)),
                ("footingVolume", f3(deck.footing_volume)),
                ("concreteBags", deck.concrete_bags.to_string()),
                ("boards", deck.boards.to_string()),
                ("sizing", sizing_json("deck", &sizing)),
            ]),
        ),
        (
            "roof",
            jobj(&[
                ("planArea", f3(roof.plan_area)),
                ("pitch", f3(roof.pitch)),
                ("slopeFactor", f3(roof.slope_factor)),
                ("angle", f3(roof.angle)),
                ("roofArea", f3(roof.roof_area)),
                ("squares", f3(roof.squares)),
                ("bundles", roof.bundles.to_string()),
            ]),
        ),
        (
            "electrical",
            jobj(&[
                ("areaM2", f3(electrical.area_m2)),
                ("areaFt2", f3(electrical.area_ft2)),
                ("generalVa", f3(electrical.general_va)),
                ("sabcVa", f3(electrical.sabc_va)),
                ("laundryVa", f3(electrical.laundry_va)),
                ("serviceDemandVa", f3(electrical.service_demand_va)),
                ("applianceVa", f3(electrical.appliance_va)),
                ("hvacVa", f3(electrical.hvac_va)),
                ("totalVa", f3(electrical.total_va)),
                ("amps", f3(electrical.amps)),
                ("serviceAmps", f3(electrical.service_amps)),
                ("optionalVa", f3(electrical.optional_va)),
                ("optionalAmps", f3(electrical.optional_amps)),
            ]),
        ),
        (
            "cutList",
            jobj(&[("groups", jarr(&group_rows)), ("csv", jstr(&cut_list_csv(&groups)))]),
        ),
        (
            "wireframe",
            jobj(&[
                ("vertices", vertices.to_string()),
                ("edges", edges.to_string()),
                ("objHash", jstr(&obj_hash)),
            ]),
        ),
    ])
}

fn main() {
    let path = match std::env::args().nth(1) {
        Some(path) => path,
        None => {
            eprintln!("usage: floorplan_core <plan.json>");
            exit(2);
        }
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) => {
            eprintln!("cannot read {path}: {err}");
            exit(1);
        }
    };
    let plan = Parser::new(&text).value();
    println!("{}", compute(&plan));
}
