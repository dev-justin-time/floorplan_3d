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
    Bool(bool),
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

    /// A flag reads from either a boolean or a number, so `true` and `1` are
    /// interchangeable and `false` is a value rather than a missing key.
    fn truthy(&self) -> Option<bool> {
        match self {
            Json::Bool(value) => Some(*value),
            Json::Num(value) => Some(*value != 0.0),
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
                Json::Bool(true)
            }
            Some(b'f') => {
                self.at += 5;
                Json::Bool(false)
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

// --- shared helpers --------------------------------------------------------

/// Round half up at `digits`, the way the suites' `round(value, digits)` does.
fn round_to(value: f64, digits: i32) -> f64 {
    let factor = 10f64.powi(digits);
    (value * factor + 0.5).floor() / factor
}

// --- plumbing ---------------------------------------------------------------

struct FixtureType {
    id: &'static str,
    group: &'static str,
    cold: f64,
    hot: f64,
    dfu: f64,
    drain: &'static str,
    trap_arm_max: f64,
    btu: f64,
    faucet: bool,
    rough: f64,
    base: f64,
    trim: f64,
    labour_rough: f64,
    labour_finish: f64,
}

/// One priced line in a takeoff.
struct CostRow {
    part: &'static str,
    group: &'static str,
    label: String,
    qty: f64,
    unit: &'static str,
    unit_cost: f64,
    total: f64,
    labour: bool,
    note: String,
}

impl CostRow {
    #[allow(clippy::too_many_arguments)]
    fn new(
        part: &'static str,
        group: &'static str,
        label: String,
        qty: f64,
        unit: &'static str,
        unit_cost: f64,
        labour: bool,
        note: &str,
    ) -> CostRow {
        let quantity = round_to(qty, 2);
        let cost = round_to(unit_cost, 2);
        CostRow {
            part,
            group,
            label,
            qty: quantity,
            unit,
            unit_cost: cost,
            total: round_to(quantity * cost, 2),
            labour,
            note: note.to_string(),
        }
    }
}

fn cost_rows_json(rows: &[CostRow]) -> String {
    let body: Vec<String> = rows
        .iter()
        .map(|row| {
            jobj(&[
                ("group", jstr(row.group)),
                ("label", jstr(&row.label)),
                ("qty", f3(row.qty)),
                ("unit", jstr(row.unit)),
                ("unitCost", f3(row.unit_cost)),
                ("total", f3(row.total)),
                ("labour", flag(row.labour)),
                ("note", jstr(&row.note)),
            ])
        })
        .collect();
    jarr(&body)
}

fn cost_totals(rows: &[CostRow], part: &str) -> (f64, f64, f64) {
    let mut materials = 0.0;
    let mut labour = 0.0;
    for row in rows.iter().filter(|row| row.part == part) {
        if row.labour {
            labour += row.total;
        } else {
            materials += row.total;
        }
    }
    (round_to(materials, 2), round_to(labour, 2), round_to(materials + labour, 2))
}

/// The shared cost table. These are the suite's planning allowances; a plan can
/// override any of them through `costs`, and all three ports read the same keys.
#[allow(dead_code)]
struct Costs {
    rough_labour_rate: f64,
    finish_labour_rate: f64,
    water_service_tap: f64,
    sewer_tap: f64,
    gas_meter_set: f64,
    hanger: f64,
    cleanout: f64,
    vent_flashing: f64,
    supply_stop: f64,
    trap_trim: f64,
    gas_sediment_trap: f64,
    gas_shutoff: f64,
    gas_connector: f64,
    prv: f64,
    expansion_tank: f64,
    heater_pan: f64,
    relief_pipe: f64,
    insulation_per_m: f64,
    main_shutoff: f64,
    backflow: f64,
    bib_vacuum_breaker: f64,
    air_gap: f64,
    washer_trim: f64,
    gas_vent_kit: f64,
    heater_blanket: f64,
    gas_support: f64,
    faucet_base: f64,
    gas_pipe_factor: f64,
    gas_fitting_factor: f64,
    electrical_labour_rate: f64,
    device_box: f64,
    cable_clamp: f64,
    wire_nut_pack: f64,
    labour_per_luminaire: f64,
    labour_per_switch: f64,
    labour_per_socket: f64,
    labour_per_circuit: f64,
    cable_coil_m: f64,
}

#[allow(dead_code)]
impl Costs {
    fn from_plan(plan: &Json) -> Costs {
        let source = field(plan, "costs");
        let mut costs = Costs {
            rough_labour_rate: 95.0,
            finish_labour_rate: 85.0,
            water_service_tap: 850.0,
            sewer_tap: 1200.0,
            gas_meter_set: 420.0,
            hanger: 2.4,
            cleanout: 42.0,
            vent_flashing: 38.0,
            supply_stop: 18.0,
            trap_trim: 26.0,
            gas_sediment_trap: 26.0,
            gas_shutoff: 28.0,
            gas_connector: 34.0,
            prv: 165.0,
            expansion_tank: 195.0,
            heater_pan: 65.0,
            relief_pipe: 85.0,
            insulation_per_m: 4.2,
            main_shutoff: 88.0,
            backflow: 165.0,
            bib_vacuum_breaker: 22.0,
            air_gap: 38.0,
            washer_trim: 58.0,
            gas_vent_kit: 260.0,
            heater_blanket: 55.0,
            gas_support: 5.5,
            faucet_base: 140.0,
            gas_pipe_factor: 1.0,
            gas_fitting_factor: 0.3,
            electrical_labour_rate: 65.0,
            device_box: 3.2,
            cable_clamp: 1.35,
            wire_nut_pack: 8.5,
            labour_per_luminaire: 0.75,
            labour_per_switch: 0.4,
            labour_per_socket: 0.5,
            labour_per_circuit: 0.9,
            cable_coil_m: 30.5,
        };
        let overrides: [(&str, &mut f64); 37] = [
            ("roughLabourRate", &mut costs.rough_labour_rate),
            ("finishLabourRate", &mut costs.finish_labour_rate),
            ("waterServiceTap", &mut costs.water_service_tap),
            ("sewerTap", &mut costs.sewer_tap),
            ("gasMeterSet", &mut costs.gas_meter_set),
            ("hanger", &mut costs.hanger),
            ("cleanout", &mut costs.cleanout),
            ("ventFlashing", &mut costs.vent_flashing),
            ("supplyStop", &mut costs.supply_stop),
            ("trapTrim", &mut costs.trap_trim),
            ("gasSedimentTrap", &mut costs.gas_sediment_trap),
            ("gasShutoff", &mut costs.gas_shutoff),
            ("gasConnector", &mut costs.gas_connector),
            ("prv", &mut costs.prv),
            ("expansionTank", &mut costs.expansion_tank),
            ("heaterPan", &mut costs.heater_pan),
            ("reliefPipe", &mut costs.relief_pipe),
            ("insulationPerM", &mut costs.insulation_per_m),
            ("mainShutoff", &mut costs.main_shutoff),
            ("backflow", &mut costs.backflow),
            ("bibVacuumBreaker", &mut costs.bib_vacuum_breaker),
            ("airGap", &mut costs.air_gap),
            ("washerTrim", &mut costs.washer_trim),
            ("gasVentKit", &mut costs.gas_vent_kit),
            ("heaterBlanket", &mut costs.heater_blanket),
            ("gasSupport", &mut costs.gas_support),
            ("faucetBase", &mut costs.faucet_base),
            ("gasPipeFactor", &mut costs.gas_pipe_factor),
            ("gasFittingFactor", &mut costs.gas_fitting_factor),
            ("electricalLabourRate", &mut costs.electrical_labour_rate),
            ("deviceBox", &mut costs.device_box),
            ("cableClamp", &mut costs.cable_clamp),
            ("wireNutPack", &mut costs.wire_nut_pack),
            ("labourPerLuminaire", &mut costs.labour_per_luminaire),
            ("labourPerSwitch", &mut costs.labour_per_switch),
            ("labourPerSocket", &mut costs.labour_per_socket),
            ("labourPerCircuit", &mut costs.labour_per_circuit),
        ];
        for (key, slot) in overrides {
            if let Some(value) = field(source, key).number() {
                *slot = value;
            }
        }
        if let Some(value) = field(source, "cableCoilM").number() {
            costs.cable_coil_m = value;
        }
        costs
    }
}

/// `features/plumbing/catalog.js`: supply fixture units, drainage fixture units,
/// fixture drain size, IPC trap-arm limit and connected gas input.
static FIXTURE_TYPES: [FixtureType; 19] = [
    FixtureType { id: "toilet", group: "bath", cold: 2.5, hot: 0.0, dfu: 3.0, drain: "3", trap_arm_max: 1.8, btu: 0.0, faucet: false, rough: 185.0, base: 320.0, trim: 55.0, labour_rough: 1.4, labour_finish: 1.2 },
    FixtureType { id: "lavatory", group: "bath", cold: 0.7, hot: 0.7, dfu: 1.0, drain: "1-1/4", trap_arm_max: 1.5, btu: 0.0, faucet: true, rough: 165.0, base: 240.0, trim: 110.0, labour_rough: 1.1, labour_finish: 1.0 },
    FixtureType { id: "bathtub", group: "bath", cold: 0.7, hot: 0.7, dfu: 2.0, drain: "2", trap_arm_max: 1.8, btu: 0.0, faucet: true, rough: 220.0, base: 650.0, trim: 190.0, labour_rough: 2.0, labour_finish: 2.2 },
    FixtureType { id: "shower", group: "bath", cold: 0.7, hot: 0.7, dfu: 2.0, drain: "2", trap_arm_max: 1.8, btu: 0.0, faucet: true, rough: 235.0, base: 850.0, trim: 260.0, labour_rough: 2.2, labour_finish: 2.0 },
    FixtureType { id: "bidet", group: "bath", cold: 0.7, hot: 0.7, dfu: 1.0, drain: "1-1/4", trap_arm_max: 1.5, btu: 0.0, faucet: true, rough: 170.0, base: 420.0, trim: 120.0, labour_rough: 1.1, labour_finish: 1.1 },
    FixtureType { id: "kitchen-sink", group: "kitchen", cold: 0.7, hot: 0.7, dfu: 2.0, drain: "2", trap_arm_max: 1.5, btu: 0.0, faucet: true, rough: 190.0, base: 380.0, trim: 180.0, labour_rough: 1.2, labour_finish: 1.0 },
    FixtureType { id: "dishwasher", group: "kitchen", cold: 0.0, hot: 1.0, dfu: 2.0, drain: "1-1/2", trap_arm_max: 1.5, btu: 0.0, faucet: false, rough: 150.0, base: 0.0, trim: 85.0, labour_rough: 1.0, labour_finish: 0.8 },
    FixtureType { id: "bar-sink", group: "kitchen", cold: 0.7, hot: 0.7, dfu: 1.0, drain: "1-1/4", trap_arm_max: 1.5, btu: 0.0, faucet: true, rough: 130.0, base: 180.0, trim: 90.0, labour_rough: 0.9, labour_finish: 0.8 },
    FixtureType { id: "washing-machine", group: "laundry", cold: 0.7, hot: 0.7, dfu: 2.0, drain: "2", trap_arm_max: 1.8, btu: 0.0, faucet: false, rough: 185.0, base: 0.0, trim: 95.0, labour_rough: 1.4, labour_finish: 1.0 },
    FixtureType { id: "laundry-sink", group: "laundry", cold: 0.7, hot: 0.7, dfu: 2.0, drain: "1-1/2", trap_arm_max: 1.5, btu: 0.0, faucet: true, rough: 155.0, base: 280.0, trim: 120.0, labour_rough: 1.1, labour_finish: 1.0 },
    FixtureType { id: "utility-sink", group: "utility", cold: 0.7, hot: 0.7, dfu: 2.0, drain: "1-1/2", trap_arm_max: 1.5, btu: 0.0, faucet: true, rough: 155.0, base: 260.0, trim: 110.0, labour_rough: 1.1, labour_finish: 0.9 },
    FixtureType { id: "floor-drain", group: "utility", cold: 0.0, hot: 0.0, dfu: 2.0, drain: "2", trap_arm_max: 2.0, btu: 0.0, faucet: false, rough: 110.0, base: 65.0, trim: 0.0, labour_rough: 1.0, labour_finish: 0.2 },
    FixtureType { id: "hose-bib", group: "outdoor", cold: 2.5, hot: 0.0, dfu: 0.0, drain: "", trap_arm_max: 0.0, btu: 0.0, faucet: false, rough: 95.0, base: 35.0, trim: 0.0, labour_rough: 0.8, labour_finish: 0.3 },
    FixtureType { id: "gas-range", group: "kitchen", cold: 0.0, hot: 0.0, dfu: 0.0, drain: "", trap_arm_max: 0.0, btu: 65000.0, faucet: false, rough: 150.0, base: 0.0, trim: 0.0, labour_rough: 1.0, labour_finish: 0.5 },
    FixtureType { id: "gas-dryer", group: "laundry", cold: 0.0, hot: 0.0, dfu: 0.0, drain: "", trap_arm_max: 0.0, btu: 22000.0, faucet: false, rough: 125.0, base: 0.0, trim: 0.0, labour_rough: 0.9, labour_finish: 0.4 },
    FixtureType { id: "gas-furnace", group: "utility", cold: 0.0, hot: 0.0, dfu: 0.0, drain: "", trap_arm_max: 0.0, btu: 100000.0, faucet: false, rough: 260.0, base: 0.0, trim: 0.0, labour_rough: 1.5, labour_finish: 0.5 },
    FixtureType { id: "gas-grill", group: "outdoor", cold: 0.0, hot: 0.0, dfu: 0.0, drain: "", trap_arm_max: 0.0, btu: 40000.0, faucet: false, rough: 145.0, base: 0.0, trim: 0.0, labour_rough: 1.0, labour_finish: 0.4 },
    FixtureType { id: "gas-fireplace", group: "utility", cold: 0.0, hot: 0.0, dfu: 0.0, drain: "", trap_arm_max: 0.0, btu: 45000.0, faucet: false, rough: 165.0, base: 0.0, trim: 0.0, labour_rough: 1.0, labour_finish: 0.5 },
    FixtureType { id: "water-heater", group: "utility", cold: 0.0, hot: 0.0, dfu: 0.0, drain: "", trap_arm_max: 0.0, btu: 0.0, faucet: false, rough: 150.0, base: 0.0, trim: 0.0, labour_rough: 1.2, labour_finish: 0.9 },
];

fn fixture_type(id: &str) -> &'static FixtureType {
    FIXTURE_TYPES.iter().find(|entry| entry.id == id).unwrap_or(&FIXTURE_TYPES[0])
}

struct WaterSize {
    id: &'static str,
    pex: f64,
    copper: f64,
    max_wsfu: f64,
    max_service: f64,
    cost: f64,
}

static WATER_SIZES: [WaterSize; 6] = [
    WaterSize { id: "1/2", pex: 0.475, copper: 0.545, max_wsfu: 6.0, max_service: 8.0, cost: 4.2 },
    WaterSize { id: "3/4", pex: 0.671, copper: 0.785, max_wsfu: 12.0, max_service: 18.0, cost: 6.4 },
    WaterSize { id: "1", pex: 0.863, copper: 0.995, max_wsfu: 25.0, max_service: 35.0, cost: 9.8 },
    WaterSize { id: "1-1/4", pex: 1.054, copper: 1.245, max_wsfu: 45.0, max_service: 60.0, cost: 14.5 },
    WaterSize { id: "1-1/2", pex: 1.244, copper: 1.481, max_wsfu: 75.0, max_service: 100.0, cost: 18.5 },
    WaterSize { id: "2", pex: 1.589, copper: 1.959, max_wsfu: 130.0, max_service: 180.0, cost: 26.0 },
];

struct DwvSize {
    id: &'static str,
    branch: f64,
    stack: f64,
    main: f64,
    min_slope: f64,
    cost: f64,
}

static DWV_SIZES: [DwvSize; 5] = [
    DwvSize { id: "1-1/4", branch: 1.0, stack: 2.0, main: 1.0, min_slope: 0.02, cost: 4.6 },
    DwvSize { id: "1-1/2", branch: 3.0, stack: 5.0, main: 3.0, min_slope: 0.02, cost: 5.8 },
    DwvSize { id: "2", branch: 6.0, stack: 10.0, main: 6.0, min_slope: 0.02, cost: 7.8 },
    DwvSize { id: "3", branch: 20.0, stack: 30.0, main: 42.0, min_slope: 0.02, cost: 12.5 },
    DwvSize { id: "4", branch: 100.0, stack: 160.0, main: 160.0, min_slope: 0.01, cost: 18.5 },
];

struct GasSize {
    id: &'static str,
    capacity10: f64,
    cost: f64,
}

static GAS_SIZES: [GasSize; 6] = [
    GasSize { id: "1/2", capacity10: 130.0, cost: 15.0 },
    GasSize { id: "3/4", capacity10: 280.0, cost: 21.0 },
    GasSize { id: "1", capacity10: 520.0, cost: 29.0 },
    GasSize { id: "1-1/4", capacity10: 1100.0, cost: 42.0 },
    GasSize { id: "1-1/2", capacity10: 1600.0, cost: 56.0 },
    GasSize { id: "2", capacity10: 3000.0, cost: 78.0 },
];

/// Finish grades and faucet finishes from the catalogue: the multiplier applies
/// to the fixture base cost, the faucet adder to the faucet allowance.
fn finish_grade(id: &str) -> (&'static str, f64) {
    match id {
        "premium" => ("Premium", 1.8),
        "luxury" => ("Luxury", 3.0),
        _ => ("Builder standard", 1.0),
    }
}

fn faucet_finish(id: &str) -> (&'static str, f64) {
    match id {
        "brushed-nickel" => ("Brushed nickel", 45.0),
        "matte-black" => ("Matte black", 85.0),
        "brass" => ("Unlacquered brass", 145.0),
        _ => ("Chrome", 0.0),
    }
}

fn water_material(id: &str) -> (&'static str, f64, f64) {
    match id {
        "copper" => ("Copper type L", 3.1, 0.38),
        "pex-alum" => ("PEX-AL-PEX", 1.8, 0.32),
        _ => ("PEX-A", 1.0, 0.28),
    }
}

struct HeaterType {
    id: &'static str,
    label: &'static str,
    tank_gal: f64,
    cost: f64,
    install_hours: f64,
}

static HEATER_TYPES: [HeaterType; 5] = [
    HeaterType { id: "tank-40-gas", label: "40 gal gas tank", tank_gal: 40.0, cost: 1050.0, install_hours: 3.5 },
    HeaterType { id: "tank-50-gas", label: "50 gal gas tank", tank_gal: 50.0, cost: 1280.0, install_hours: 4.0 },
    HeaterType { id: "tank-50-hp", label: "50 gal heat-pump tank", tank_gal: 50.0, cost: 2900.0, install_hours: 5.0 },
    HeaterType { id: "tankless-gas", label: "Tankless gas", tank_gal: 0.0, cost: 2450.0, install_hours: 5.5 },
    HeaterType { id: "tankless-electric", label: "Tankless electric", tank_gal: 0.0, cost: 1350.0, install_hours: 4.0 },
];

fn heater_type(id: &str) -> &'static HeaterType {
    HEATER_TYPES.iter().find(|entry| entry.id == id).unwrap_or(&HEATER_TYPES[1])
}

fn water_size(id: &str) -> &'static WaterSize {
    WATER_SIZES.iter().find(|entry| entry.id == id).unwrap_or(&WATER_SIZES[1])
}

fn dwv_size(id: &str) -> &'static DwvSize {
    DWV_SIZES.iter().find(|entry| entry.id == id).unwrap_or(&DWV_SIZES[2])
}

fn dwv_index(id: &str) -> i32 {
    DWV_SIZES.iter().position(|entry| entry.id == id).map(|i| i as i32).unwrap_or(-1)
}

fn gas_size(id: &str) -> &'static GasSize {
    GAS_SIZES.iter().find(|entry| entry.id == id).unwrap_or(&GAS_SIZES[0])
}

fn water_pipe_diameter(size_id: &str, material: &str) -> f64 {
    let size = water_size(size_id);
    if material == "copper" { size.copper } else { size.pex }
}

/// Hunter-style demand curve (gpm), linearly interpolated between published points.
fn demand_for_wsfu(wsfu: f64) -> f64 {
    const CURVE: [(f64, f64); 18] = [
        (1.0, 1.0), (2.0, 1.5), (3.0, 2.5), (4.0, 3.2), (5.0, 3.8), (6.0, 4.4),
        (8.0, 5.2), (10.0, 5.8), (15.0, 6.8), (20.0, 7.6), (25.0, 8.4), (30.0, 9.2),
        (40.0, 10.4), (50.0, 11.5), (75.0, 13.5), (100.0, 15.5), (150.0, 18.5),
        (200.0, 21.0),
    ];
    let value = wsfu.max(0.0);
    if value <= 0.0 {
        return 0.0;
    }
    if value <= CURVE[0].0 {
        return CURVE[0].1;
    }
    for index in 1..CURVE.len() {
        let (x1, y1) = CURVE[index - 1];
        let (x2, y2) = CURVE[index];
        if value <= x2 {
            return round_to(y1 + ((value - x1) / (x2 - x1)) * (y2 - y1), 2);
        }
    }
    CURVE[CURVE.len() - 1].1
}

fn velocity_fps(gpm: f64, diameter_in: f64) -> f64 {
    if !(gpm > 0.0) || !(diameter_in > 0.0) {
        return 0.0;
    }
    round_to(0.4085 * gpm / (diameter_in * diameter_in), 2)
}

/// Hazen-Williams friction loss in psi over a length in metres.
fn friction_psi(gpm: f64, diameter_in: f64, length_m: f64, c: f64) -> f64 {
    if !(gpm > 0.0) || !(diameter_in > 0.0) || !(length_m > 0.0) {
        return 0.0;
    }
    let length_ft = length_m / 0.3048;
    round_to(4.52 * gpm.powf(1.852) * length_ft / (c.powf(1.852) * diameter_in.powf(4.871)), 3)
}

fn meter_loss_psi(meter_size: &str, demand_gpm: f64) -> f64 {
    let at_ten = match meter_size {
        "5/8" => 4.5,
        "1" => 1.7,
        "1-1/4" => 1.0,
        _ => 2.7,
    };
    round_to(at_ten * (demand_gpm.max(0.0) / 10.0).powf(1.85), 2)
}

fn water_size_for_wsfu(wsfu: f64, service: bool) -> &'static str {
    WATER_SIZES
        .iter()
        .find(|entry| if service { entry.max_service } else { entry.max_wsfu } >= wsfu)
        .unwrap_or(&WATER_SIZES[WATER_SIZES.len() - 1])
        .id
}

fn dwv_size_for(dfu: f64, kind: &str) -> &'static str {
    DWV_SIZES
        .iter()
        .find(|entry| match kind {
            "main" => entry.main >= dfu,
            "stack" => entry.stack >= dfu,
            _ => entry.branch >= dfu,
        })
        .unwrap_or(&DWV_SIZES[DWV_SIZES.len() - 1])
        .id
}

/// Fuel-gas capacity derated from the 10 ft table by the square root of length.
fn gas_capacity(size_id: &str, length_m: f64, fuel: &str) -> f64 {
    let size = gas_size(size_id);
    let length_ft = (length_m / 0.3048).max(10.0);
    let derate = (10.0 / length_ft).sqrt();
    let fuel_factor = if fuel == "propane" { 0.94 } else { 1.0 };
    round_to(size.capacity10 * derate * fuel_factor, 1)
}

fn gas_size_for_load(cfh: f64, length_m: f64, fuel: &str) -> &'static str {
    GAS_SIZES
        .iter()
        .find(|entry| gas_capacity(entry.id, length_m, fuel) >= cfh)
        .unwrap_or(&GAS_SIZES[GAS_SIZES.len() - 1])
        .id
}

fn gas_cfh(btu: f64, fuel: &str) -> f64 {
    let factor = if fuel == "propane" { 2516.0 } else { 1030.0 };
    round_to(btu / factor, 2)
}

#[derive(Clone, Copy)]
struct Pt {
    x: f64,
    y: f64,
}

fn distance(a: Pt, b: Pt) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    (dx * dx + dy * dy).sqrt()
}

fn manhattan(a: Pt, b: Pt) -> f64 {
    (a.x - b.x).abs() + (a.y - b.y).abs()
}

fn path_length(points: &[Pt]) -> f64 {
    let mut total = 0.0;
    for index in 1..points.len() {
        total += distance(points[index - 1], points[index]);
    }
    total
}

/// One-bend orthogonal route, along the longer axis first.
fn orthogonal_route(a: Pt, b: Pt) -> Vec<Pt> {
    if (a.x - b.x).abs() < 1e-6 || (a.y - b.y).abs() < 1e-6 {
        return vec![a, b];
    }
    if (b.x - a.x).abs() >= (b.y - a.y).abs() {
        vec![a, Pt { x: round_to(b.x, 2), y: a.y }, b]
    } else {
        vec![a, Pt { x: a.x, y: round_to(b.y, 2) }, b]
    }
}

struct REdge {
    from: usize,
    to: usize,
    length: f64,
    load: f64,
    size: String,
    capacity: f64,
}

struct Tree {
    edges: Vec<REdge>,
    parents: Vec<Option<usize>>,
    node_of: Vec<usize>,
}

/// Nearest-node service tree: each target links to the closest node already placed,
/// in order of manhattan distance from the root.
fn build_tree(root: Pt, targets: &[(String, Pt, f64)]) -> Tree {
    let mut nodes: Vec<(String, Pt, f64)> = vec![("root".to_string(), root, 0.0)];
    let mut edges: Vec<REdge> = Vec::new();
    let mut parents: Vec<Option<usize>> = vec![None];
    let mut node_of = vec![0usize; targets.len()];

    let mut order: Vec<usize> = (0..targets.len()).collect();
    order.sort_by(|a, b| {
        manhattan(root, targets[*a].1)
            .partial_cmp(&manhattan(root, targets[*b].1))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    for index in order {
        let (ref id, point, weight) = targets[index];
        let mut best = 0usize;
        let mut best_score = f64::INFINITY;
        for (node_index, node) in nodes.iter().enumerate() {
            let score = manhattan(node.1, point);
            if score < best_score {
                best_score = score;
                best = node_index;
            }
        }
        let points = orthogonal_route(nodes[best].1, point);
        let length = round_to(path_length(&points), 3);
        let to = nodes.len();
        edges.push(REdge {
            from: best,
            to,
            length,
            load: 0.0,
            size: String::new(),
            capacity: 0.0,
        });
        parents.push(Some(edges.len() - 1));
        nodes.push((id.clone(), point, weight));
        node_of[index] = to;
    }

    let mut raw: Vec<f64> = nodes.iter().map(|node| node.2).collect();
    for index in (0..edges.len()).rev() {
        let (from, to) = (edges[index].from, edges[index].to);
        edges[index].load = round_to(raw[to], 3);
        raw[from] += raw[to];
    }

    Tree { edges, parents, node_of }
}

fn path_edges(tree: &Tree, node: usize) -> Vec<usize> {
    let mut out = Vec::new();
    let mut current = node;
    let mut guard = 0;
    while let Some(edge_index) = tree.parents[current] {
        if guard >= 200 {
            break;
        }
        out.insert(0, edge_index);
        current = tree.edges[edge_index].from;
        guard += 1;
    }
    out
}

struct PFix {
    id: String,
    tag: String,
    kind: &'static FixtureType,
    point: Pt,
}

/// Lengths grouped by pipe size, first-seen order kept so the rows read in the
/// order the routes were built.
fn grouped_lengths(pairs: &[(String, f64)]) -> Vec<(String, f64)> {
    let mut out: Vec<(String, f64)> = Vec::new();
    for (size, length) in pairs {
        match out.iter_mut().find(|(name, _)| name == size) {
            Some(entry) => entry.1 += *length,
            None => out.push((size.clone(), *length)),
        }
    }
    out
}

#[allow(dead_code)]
struct PlumbingGeometry {
    material: String,
    water_edges: Vec<(String, &'static str, f64)>,
    drain_edges: Vec<(String, f64)>,
    gas_edges: Vec<(String, f64)>,
    vents: Vec<(String, f64)>,
    cleanouts: usize,
    gas_appliances: usize,
    uses_gas: bool,
    hot_length: f64,
}

/// Two-part takeoff: rough-in, then fixtures and trim. Same formulas and the
/// same cost table as `buildTakeoff` in `features/plumbing/engine.js`.
#[allow(dead_code)]
fn plumbing_takeoff_json(
    plan: &Json,
    costs: &Costs,
    geometry: &PlumbingGeometry,
    wall_height: f64,
) -> (String, f64, f64, f64, f64, f64, f64, f64) {
    let plumbing = field(plan, "plumbing");
    let mut rows: Vec<CostRow> = Vec::new();
    let (material_label, material_factor, fitting_factor) = water_material(&geometry.material);
    let static_pressure = number_or(field(plumbing, "staticPressure"), 50.0);

    // Hookups.
    rows.push(CostRow::new("rough", "Hookups", "Water service connection and meter set".into(), 1.0, "ea", costs.water_service_tap, false, "Tap, meter and service valve; utility fees vary."));
    rows.push(CostRow::new("rough", "Hookups", "Sewer lateral connection".into(), 1.0, "ea", costs.sewer_tap, false, "Tap at the public sewer or septic inlet."));
    if geometry.uses_gas {
        rows.push(CostRow::new("rough", "Hookups", "Gas meter set and service connection".into(), 1.0, "ea", costs.gas_meter_set, false, "Meter, regulator and service valve."));
    }

    // Water piping, grouped by size and side.
    let mut water_groups: Vec<(String, &'static str, f64)> = Vec::new();
    for (size, kind, length) in &geometry.water_edges {
        match water_groups.iter_mut().find(|(name, side, _)| name == size && side == kind) {
            Some(entry) => entry.2 += *length,
            None => water_groups.push((size.clone(), kind, *length)),
        }
    }
    let mut water_length = 0.0;
    for (size, kind, length) in &water_groups {
        let size_data = water_size(size);
        let unit_cost = size_data.cost * material_factor;
        let buy = if geometry.material == "copper" {
            (length / 3.0).ceil() * 3.0
        } else {
            (length / 30.5).ceil() * 30.5
        };
        rows.push(CostRow::new("rough", "Water piping", format!("{material_label} {} · {kind}", size_data.id), buy, "m", unit_cost, false, &format!("{length:.1} m measured plus coil waste.")));
        rows.push(CostRow::new("rough", "Water piping", format!("Fittings allowance · {size} {kind}"), 1.0, "lot", unit_cost * length.max(1.0) * fitting_factor, false, "Elbows, tees, couplings and press/solder fittings."));
        water_length += length;
    }
    rows.push(CostRow::new("rough", "Water piping", "Pipe hangers and isolators".into(), (water_length / 1.2).ceil(), "ea", costs.hanger, false, "Support at the code interval and at changes of direction."));
    if field(plumbing, "insulation").number().unwrap_or(1.0) != 0.0 {
        rows.push(CostRow::new("rough", "Water piping", "Hot-water pipe insulation".into(), geometry.hot_length.ceil(), "m", costs.insulation_per_m, false, "Insulate the hot line; include the first 2 m of cold at the tank."));
    }
    rows.push(CostRow::new("rough", "Water piping", "Main shutoff and drain valve".into(), 1.0, "ea", costs.main_shutoff, false, "Full-port shutoff at the service entry."));
    if static_pressure > 80.0 {
        rows.push(CostRow::new("rough", "Water piping", "Pressure reducing valve".into(), 1.0, "ea", costs.prv, false, "Set to 50–60 psi; add a strainer and a test port."));
    }
    let backflow = field(plumbing, "backflow").text().unwrap_or("dual-check");
    if backflow != "none" {
        rows.push(CostRow::new(
            "rough",
            "Water piping",
            "Backflow preventer".into(),
            1.0,
            "ea",
            costs.backflow,
            false,
            if backflow == "rpz" {
                "RPZ assembly; annual testing is typical."
            } else {
                "Dual-check or vacuum-breaker assembly as selected."
            },
        ));
    }

    // Drainage and venting.
    let mut drain_length = 0.0;
    for (size, length) in grouped_lengths(&geometry.drain_edges) {
        let size_data = dwv_size(&size);
        rows.push(CostRow::new("rough", "DWV piping", format!("PVC Schedule 40 {}", size_data.id), (length / 3.0).ceil() * 3.0, "m", size_data.cost, false, &format!("{length:.1} m measured plus cut waste.")));
        rows.push(CostRow::new("rough", "DWV piping", format!("DWV fittings allowance · {size}"), 1.0, "lot", size_data.cost * length.max(1.0) * 0.32, false, "Sanitary tees, wyes, bends and couplings."));
        drain_length += length;
    }
    rows.push(CostRow::new("rough", "DWV piping", "Pipe hangers and strapping".into(), (drain_length / 1.5).ceil(), "ea", costs.hanger, false, "Support horizontal drain at the code interval."));
    rows.push(CostRow::new("rough", "DWV piping", "Cleanouts".into(), geometry.cleanouts as f64, "ea", costs.cleanout, false, "Stack base and sewer; add one at each long horizontal run."));
    for (size, length) in &geometry.vents {
        rows.push(CostRow::new("rough", "Venting", format!("Vent stack · {size}"), *length, "m", dwv_size(size).cost, false, "Stack vent through the roof; confirm the termination height."));
        rows.push(CostRow::new("rough", "Venting", "Vent flashing".into(), 1.0, "ea", costs.vent_flashing, false, "Listed roof flashing and cap."));
    }

    // Fuel gas.
    let mut gas_length = 0.0;
    if geometry.uses_gas {
        for (size, length) in grouped_lengths(&geometry.gas_edges) {
            let size_data = gas_size(&size);
            let unit_cost = size_data.cost * costs.gas_pipe_factor;
            rows.push(CostRow::new("rough", "Fuel gas", format!("Black iron {}", size_data.id), (length / 3.0).ceil() * 3.0, "m", unit_cost, false, &format!("{length:.1} m measured; gas pipe is bought in 3 m lengths.")));
            rows.push(CostRow::new("rough", "Fuel gas", format!("Gas fittings allowance · {size}"), 1.0, "lot", unit_cost * length.max(1.0) * costs.gas_fitting_factor, false, "Elbows, tees, couplings and reducers."));
            gas_length += length;
        }
        rows.push(CostRow::new("rough", "Fuel gas", "Gas pipe support and bonding".into(), (gas_length / 2.0).ceil(), "ea", costs.gas_support, false, "Support at the code interval; bond CSST per the manufacturer."));
        if field(plumbing, "sedimentTraps").number().unwrap_or(1.0) != 0.0 {
            rows.push(CostRow::new("rough", "Fuel gas", "Sediment trap".into(), geometry.gas_appliances as f64, "ea", costs.gas_sediment_trap, false, "Downstream of each appliance shutoff."));
        }
        if field(plumbing, "shutoffs").number().unwrap_or(1.0) != 0.0 {
            rows.push(CostRow::new("rough", "Fuel gas", "Appliance shutoff valve".into(), geometry.gas_appliances as f64, "ea", costs.gas_shutoff, false, "Same room, within reach of the appliance."));
        }
    }

    // Equipment.
    let heater = field(plumbing, "heater");
    let heater_kind = heater_type(field(heater, "type").text().unwrap_or("tank-50-gas"));
    let has_heater = !matches!(heater, Json::Null);
    let gas_heater = heater_kind.id != "tank-50-hp" && heater_kind.id != "tankless-electric";
    if has_heater {
        rows.push(CostRow::new("rough", "Equipment", format!("{} water heater", heater_kind.label), 1.0, "ea", heater_kind.cost, false, "Tank, controls and standard trim."));
        if heater_kind.tank_gal > 0.0 && number_or(field(heater, "pan"), 1.0) != 0.0 {
            rows.push(CostRow::new("rough", "Equipment", "Water-heater drain pan and drain".into(), 1.0, "ea", costs.heater_pan, false, "Pan with a drain to a safe location."));
        }
        if heater_kind.tank_gal > 0.0 && number_or(field(heater, "expansionTank"), 1.0) != 0.0 {
            rows.push(CostRow::new("rough", "Equipment", "Thermal expansion tank".into(), 1.0, "ea", costs.expansion_tank, false, "Required on a closed system with a check valve or PRV."));
        }
        if number_or(field(heater, "reliefPipe"), 1.0) != 0.0 {
            rows.push(CostRow::new("rough", "Equipment", "T&P relief discharge piping".into(), 1.0, "ea", costs.relief_pipe, false, "Full-size pipe to within 6 in of the floor or a safe receptor."));
        }
        if gas_heater {
            rows.push(CostRow::new("rough", "Equipment", "Vent and termination vent kit".into(), 1.0, "ea", costs.gas_vent_kit, false, "Vent, termination and combustion-air coordination."));
        }
        if heater_kind.tank_gal > 0.0 && number_or(field(heater, "insulated"), 0.0) != 0.0 {
            rows.push(CostRow::new("rough", "Equipment", "Heater blanket and pipe insulation".into(), 1.0, "ea", costs.heater_blanket, false, "Follow the manufacturer; do not cover the T&P or the flue."));
        }
    }

    // Rough-in kits, one per fixture.
    let mut rough_hours = 0.0;
    let mut kit_counts: Vec<(&'static str, &'static str, f64, f64, f64)> = Vec::new();
    for entry in field(plumbing, "fixtures").items() {
        let kind = fixture_type(field(entry, "type").text().unwrap_or(""));
        rough_hours += kind.labour_rough;
        match kit_counts.iter_mut().find(|(id, _, _, _, _)| *id == kind.id) {
            Some(kit) => kit.2 += 1.0,
            None => kit_counts.push((kind.id, kind.id, 1.0, kind.rough, kind.labour_rough)),
        }
    }
    for (id, _, count, rough, _) in &kit_counts {
        rows.push(CostRow::new("rough", "Fixture rough-in", format!("{id} rough-in kit"), *count, "ea", *rough, false, "Drain stub, supply stubs, valve box and mounting coordination."));
    }

    let water_length_total = water_groups.iter().map(|(_, _, length)| *length).sum::<f64>();
    let rough_hours = rough_hours
        + water_length_total * 0.12
        + drain_length * 0.18
        + gas_length * 0.12
        + if has_heater { heater_kind.install_hours } else { 0.0 }
        + 3.0;
    rows.push(CostRow::new("rough", "Labour", "Plumbing rough-in labour".into(), round_to(rough_hours, 1), "h", costs.rough_labour_rate, true, "Layout, drilling, piping, fitting and pressure testing."));

    // Finish fixtures and trim.
    let mut finish_hours = 0.0;
    let mut faucet_count = 0.0;
    let mut has_dishwasher = false;
    let mut has_washer = false;
    for entry in field(plumbing, "fixtures").items() {
        let kind = fixture_type(field(entry, "type").text().unwrap_or(""));
        let (grade_label, grade_multiplier) = finish_grade(field(entry, "finish").text().unwrap_or("standard"));
        let (faucet_label, faucet_cost) = faucet_finish(field(entry, "faucet").text().unwrap_or("chrome"));
        let tag = field(entry, "tag").text().unwrap_or("");
        finish_hours += kind.labour_finish;
        if kind.id == "dishwasher" {
            has_dishwasher = true;
        }
        if kind.id == "washing-machine" {
            has_washer = true;
        }
        let fixture_cost = if kind.base > 0.0 {
            kind.base * grade_multiplier + kind.trim
        } else {
            0.0
        };
        if fixture_cost > 0.0 {
            rows.push(CostRow::new("finish", "Fixtures", format!("{} · {grade_label}", kind.id), 1.0, "ea", fixture_cost, false, tag));
        } else if kind.trim > 0.0 {
            rows.push(CostRow::new("finish", "Fixtures", format!("{} connection trim", kind.id), 1.0, "ea", kind.trim, false, tag));
        }
        if kind.faucet {
            faucet_count += 1.0;
            rows.push(CostRow::new("finish", "Faucets & trim", format!("{} faucet · {faucet_label}", kind.id), 1.0, "ea", costs.faucet_base * grade_multiplier + faucet_cost, false, "Faucet, spout, handles and aerator."));
        }
        if kind.dfu > 0.0 {
            rows.push(CostRow::new("finish", "Faucets & trim", "Supply stops and escutcheons".into(), 2.0, "ea", costs.supply_stop, false, "One stop per supply; quarter-turn ball stops."));
            rows.push(CostRow::new("finish", "Faucets & trim", "Trap and drain trim".into(), 1.0, "ea", costs.trap_trim, false, "P-trap, tailpiece and escutcheon; trap arm is rough."));
        }
        if kind.id == "hose-bib" {
            rows.push(CostRow::new("finish", "Faucets & trim", "Hose-bib vacuum breaker".into(), 1.0, "ea", costs.bib_vacuum_breaker, false, "Backflow protection at the sillcock."));
        }
        if kind.btu > 0.0 {
            rows.push(CostRow::new("finish", "Fuel gas trim", "Appliance connector".into(), 1.0, "ea", costs.gas_connector, false, "Listed connector for the final connection."));
        }
    }
    if has_dishwasher && number_or(field(plumbing, "airGap"), 1.0) != 0.0 {
        rows.push(CostRow::new("finish", "Faucets & trim", "Dishwasher air gap".into(), 1.0, "ea", costs.air_gap, false, "Air gap or high loop for the drain."));
    }
    if has_washer {
        rows.push(CostRow::new("finish", "Faucets & trim", "Washing-machine hoses and standpipe trim".into(), 1.0, "set", costs.washer_trim, false, "Braided hoses, standpipe trim and drain hose."));
    }
    let finish_hours = finish_hours + faucet_count * 0.8 + 2.0;
    rows.push(CostRow::new("finish", "Labour", "Fixture and trim labour".into(), round_to(finish_hours, 1), "h", costs.finish_labour_rate, true, "Set fixtures, faucets, trim, drains and final connections."));

    let (rough_materials, rough_labour, rough_total) = cost_totals(&rows, "rough");
    let (finish_materials, finish_labour, finish_total) = cost_totals(&rows, "finish");
    let total = round_to(rough_total + finish_total, 2);

    let rough_rows: Vec<CostRow> = rows.iter().filter(|row| row.part == "rough").map(|row| CostRow { part: row.part, group: row.group, label: row.label.clone(), qty: row.qty, unit: row.unit, unit_cost: row.unit_cost, total: row.total, labour: row.labour, note: row.note.clone() }).collect();
    let finish_rows: Vec<CostRow> = rows.iter().filter(|row| row.part == "finish").map(|row| CostRow { part: row.part, group: row.group, label: row.label.clone(), qty: row.qty, unit: row.unit, unit_cost: row.unit_cost, total: row.total, labour: row.labour, note: row.note.clone() }).collect();

    let assumptions = [
        "Prices are planning allowances in US dollars, not quotes; supplier pricing, permits and utility fees vary.",
        "Pipe lengths are measured on orthogonal routes; fittings are an allowance, not a piece count.",
        "Labour rates come from the shared cost table; access, drywall repair and permits are excluded.",
        "Fixtures are priced at the selected grade; appliances such as a range or dryer are owner-supplied.",
        "The model is 2021 IPC / IRC and IFGC with US customary fixture units; local amendments win.",
    ];
    let assumption_json: Vec<String> = assumptions.iter().map(|text| jstr(text)).collect();

    let json = jobj(&[
        ("rows", cost_rows_json(&rows)),
        ("rough", jobj(&[
            ("rows", cost_rows_json(&rough_rows)),
            ("materials", f3(rough_materials)),
            ("labour", f3(rough_labour)),
            ("total", f3(rough_total)),
        ])),
        ("finish", jobj(&[
            ("rows", cost_rows_json(&finish_rows)),
            ("materials", f3(finish_materials)),
            ("labour", f3(finish_labour)),
            ("total", f3(finish_total)),
        ])),
        ("total", f3(total)),
        ("wallHeight", f3(wall_height)),
        ("assumptions", jarr(&assumption_json)),
    ]);

    (
        json,
        rough_materials,
        rough_labour,
        rough_total,
        finish_materials,
        finish_labour,
        finish_total,
        total,
    )
}

fn plumbing_json(plan: &Json) -> String {
    let plumbing = field(plan, "plumbing");
    let width = number_or(field(plumbing, "width"), 0.0);
    let depth = number_or(field(plumbing, "depth"), 0.0);
    let wall_height = number_or(field(plan, "wallHeight"), 2.7);

    let mut fixtures: Vec<PFix> = Vec::new();
    for entry in field(plumbing, "fixtures").items() {
        let id = field(entry, "id").text().unwrap_or("").to_string();
        fixtures.push(PFix {
            tag: field(entry, "tag").text().unwrap_or(&id).to_string(),
            id,
            kind: fixture_type(field(entry, "type").text().unwrap_or("")),
            point: Pt {
                x: number_or(field(entry, "x"), 0.0),
                y: number_or(field(entry, "y"), 0.0),
            },
        });
    }

    let heater = field(plumbing, "heater");
    let has_heater = matches!(heater, Json::Obj(_));
    let heater_btu = number_or(field(heater, "btu"), 0.0);
    let heater_point = Pt {
        x: number_or(field(heater, "x"), 0.0),
        y: number_or(field(heater, "y"), 0.0),
    };

    // --- water ------------------------------------------------------------
    let pressure = number_or(field(plumbing, "staticPressure"), 55.0);
    let meter_size = field(plumbing, "meterSize").text().unwrap_or("3/4");
    let material = field(plumbing, "serviceMaterial").text().unwrap_or("pex");

    let mut cold_wsfu = fixtures.iter().map(|f| f.kind.cold).sum::<f64>();
    if has_heater {
        cold_wsfu += 1.0;
    }
    let cold_wsfu = round_to(cold_wsfu, 2);
    let hot_wsfu = round_to(fixtures.iter().map(|f| f.kind.hot).sum::<f64>(), 2);
    let total_wsfu = round_to(cold_wsfu + hot_wsfu, 2);
    let demand = demand_for_wsfu(total_wsfu);

    let service_candidates: Vec<&WaterSize> = WATER_SIZES
        .iter()
        .filter(|entry| entry.max_service >= total_wsfu)
        .collect();
    let service_id = service_candidates
        .iter()
        .find(|entry| velocity_fps(demand, water_pipe_diameter(entry.id, material)) <= 8.0)
        .map(|entry| entry.id)
        .or_else(|| service_candidates.last().map(|entry| entry.id))
        .unwrap_or(WATER_SIZES[WATER_SIZES.len() - 1].id);
    let service_velocity = velocity_fps(demand, water_pipe_diameter(service_id, material));
    let main_length = number_or(field(plumbing, "mainLength"), 12.0).max(3.0);
    let main_friction = friction_psi(demand, water_pipe_diameter(service_id, material), main_length, 150.0);
    let meter_loss = meter_loss_psi(meter_size, demand);
    let static_at_fixture = round_to(pressure - 0.433 * 1.2, 2);

    let cold_fixtures: Vec<usize> = (0..fixtures.len())
        .filter(|index| fixtures[*index].kind.cold > 0.0 || fixtures[*index].kind.hot > 0.0)
        .collect();
    let hot_fixtures: Vec<usize> = (0..fixtures.len())
        .filter(|index| fixtures[*index].kind.hot > 0.0)
        .collect();

    let mut cold_targets: Vec<(String, Pt, f64)> = cold_fixtures
        .iter()
        .map(|index| (fixtures[*index].id.clone(), fixtures[*index].point, fixtures[*index].kind.cold))
        .collect();
    if has_heater {
        cold_targets.push(("heater_inlet".to_string(), heater_point, 1.0));
    }
    let water_hookup = Pt {
        x: number_or(field(plumbing, "waterHookupX"), width),
        y: number_or(field(plumbing, "waterHookupY"), 0.0),
    };
    let mut cold_tree = if cold_targets.is_empty() { None } else { Some(build_tree(water_hookup, &cold_targets)) };
    let hot_targets: Vec<(String, Pt, f64)> = hot_fixtures
        .iter()
        .map(|index| (fixtures[*index].id.clone(), fixtures[*index].point, fixtures[*index].kind.hot))
        .collect();
    let mut hot_tree = if has_heater && !hot_targets.is_empty() {
        Some(build_tree(heater_point, &hot_targets))
    } else {
        None
    };

    let sized_water = |tree: &mut Option<Tree>| -> f64 {
        match tree {
            Some(tree) => {
                let mut total = 0.0;
                for edge in tree.edges.iter_mut() {
                    edge.size = water_size_for_wsfu(edge.load.max(0.5), false).to_string();
                    total += edge.length;
                }
                round_to(total, 2)
            }
            None => 0.0,
        }
    };
    let cold_length = sized_water(&mut cold_tree);
    let hot_length = sized_water(&mut hot_tree);

    let edge_friction = |edge: &REdge| -> f64 {
        let flow = demand_for_wsfu(edge.load);
        friction_psi(flow, water_pipe_diameter(&edge.size, material), edge.length, 150.0)
    };

    // `node_of` is indexed by position in the tree's own target list, so a fixture
    // index has to be mapped through the trees that actually carry it.
    let branch_loss = |index: usize| -> f64 {
        let mut total = 0.0;
        if let (Some(tree), Some(position)) = (&cold_tree, cold_fixtures.iter().position(|i| *i == index)) {
            for edge_index in path_edges(tree, tree.node_of[position]) {
                total += edge_friction(&tree.edges[edge_index]);
            }
        }
        if fixtures[index].kind.hot > 0.0 {
            if let (Some(tree), Some(position)) = (&hot_tree, hot_fixtures.iter().position(|i| *i == index)) {
                for edge_index in path_edges(tree, tree.node_of[position]) {
                    total += edge_friction(&tree.edges[edge_index]);
                }
            }
        }
        total
    };

    let mut readings: Vec<(String, f64)> = Vec::new();
    for index in &cold_fixtures {
        readings.push((
            fixtures[*index].tag.clone(),
            round_to(static_at_fixture - meter_loss - main_friction - branch_loss(*index), 2),
        ));
    }
    if has_heater {
        readings.push((
            "Water heater".to_string(),
            round_to(static_at_fixture - meter_loss - main_friction, 2),
        ));
    }

    let mut worst: Option<(String, f64)> = None;
    for reading in &readings {
        match &worst {
            Some((_, value)) if *value <= reading.1 => {}
            _ => worst = Some(reading.clone()),
        }
    }

    // --- drainage ---------------------------------------------------------
    let drains: Vec<usize> = (0..fixtures.len()).filter(|index| fixtures[*index].kind.dfu > 0.0).collect();
    let total_dfu = round_to(drains.iter().map(|index| fixtures[*index].kind.dfu).sum::<f64>(), 2);
    let main_size = dwv_size_for(total_dfu, "main");
    let slope = number_or(field(plumbing, "sewerSlope"), 0.02);
    let minimum_slope = dwv_size(main_size).min_slope;
    let sewer_length = number_or(field(plumbing, "sewerMainLength"), 14.0).max(3.0);
    let required_invert = round_to(-(sewer_length * slope) - 0.3, 2);

    let mut groups: Vec<(&'static str, Vec<usize>)> = Vec::new();
    for index in &drains {
        let group = fixtures[*index].kind.group;
        match groups.iter_mut().find(|(key, _)| *key == group) {
            Some((_, list)) => list.push(*index),
            None => groups.push((group, vec![*index])),
        }
    }

    let main_y = round_to(depth - 0.22, 2);
    let mut stack_rows = Vec::new();
    let mut trap_rows = Vec::new();
    #[allow(unused_mut, unused_variables)]
    let mut drain_edges: Vec<(String, f64)> = Vec::new();
    #[allow(unused_mut, unused_variables)]
    let mut vents: Vec<(String, f64)> = Vec::new();
    for (group, members) in &groups {
        let mean_x = members.iter().map(|index| fixtures[*index].point.x).sum::<f64>()
            / members.len() as f64;
        let mean_y = members.iter().map(|index| fixtures[*index].point.y).sum::<f64>()
            / members.len() as f64;
        let stack = Pt {
            x: round_to(mean_x.max(0.45).min(width - 0.45), 2),
            y: round_to(if mean_y < depth / 2.0 { 0.48 } else { depth - 0.48 }, 2),
        };
        let stack_dfu = round_to(members.iter().map(|index| fixtures[*index].kind.dfu).sum::<f64>(), 2);
        let largest = members.iter().fold("1-1/2", |best, index| {
            if dwv_index(fixtures[*index].kind.drain) > dwv_index(best) {
                fixtures[*index].kind.drain
            } else {
                best
            }
        });
        let mut branch_size = dwv_size_for(stack_dfu, "branch");
        if dwv_index(largest) > dwv_index(branch_size) {
            branch_size = largest;
        }
        let stack_size = if dwv_index(dwv_size_for(stack_dfu, "stack")) > dwv_index(branch_size) {
            dwv_size_for(stack_dfu, "stack")
        } else {
            branch_size
        };
        stack_rows.push(jobj(&[
            ("id", jstr(&format!("stack_{group}"))),
            ("group", jstr(group)),
            ("x", f3(stack.x)),
            ("y", f3(stack.y)),
            ("dfu", f3(stack_dfu)),
            ("branchSize", jstr(branch_size)),
            ("size", jstr(stack_size)),
            ("ventSize", jstr(stack_size)),
            ("ventLength", f3(round_to(wall_height + 1.2, 2))),
        ]));
        vents.push((stack_size.to_string(), round_to(wall_height + 1.2, 2)));
        drain_edges.push((
            stack_size.to_string(),
            round_to(distance(stack, Pt { x: stack.x, y: main_y }), 2),
        ));

        for index in members {
            let points = orthogonal_route(stack, fixtures[*index].point);
            let length = round_to(path_length(&points), 2);
            trap_rows.push(jobj(&[
                ("fixtureId", jstr(&fixtures[*index].id)),
                ("tag", jstr(&fixtures[*index].tag)),
                ("length", f3(length)),
                ("limit", f3(fixtures[*index].kind.trap_arm_max)),
                ("pass", flag(length <= fixtures[*index].kind.trap_arm_max)),
            ]));
            drain_edges.push((branch_size.to_string(), length));
        }
    }

    let main_start = Pt { x: 0.28, y: main_y };
    let main_end = Pt { x: round_to(width - 0.28, 2), y: main_y };
    let sewer_point = Pt {
        x: number_or(field(plumbing, "sewerHookupX"), width),
        y: number_or(field(plumbing, "sewerHookupY"), depth),
    };
    let main_route_length = round_to(distance(main_start, main_end) + distance(main_end, sewer_point), 2);
    let sewer_size = field(plumbing, "sewerSize").text().unwrap_or("4");
    drain_edges.push((main_size.to_string(), round_to(distance(main_start, main_end), 2)));
    drain_edges.push((sewer_size.to_string(), round_to(distance(main_end, sewer_point), 2)));

    // --- fuel gas ---------------------------------------------------------
    let fuel = if field(plumbing, "gasType").text().unwrap_or("natural") == "propane" {
        "propane"
    } else {
        "natural"
    };
    let gas_length = number_or(field(plumbing, "gasMainLength"), 15.0).max(5.0);
    let gas_meter = number_or(field(plumbing, "gasMeterCapacity"), 0.0);

    let mut gas_targets: Vec<(String, Pt, f64)> = fixtures
        .iter()
        .filter(|entry| entry.kind.btu > 0.0)
        .map(|entry| (entry.id.clone(), entry.point, entry.kind.btu))
        .collect();
    if has_heater && heater_btu > 0.0 {
        gas_targets.push(("heater_gas".to_string(), heater_point, heater_btu));
    }
    let total_btu = round_to(gas_targets.iter().map(|target| target.2).sum::<f64>(), 0);
    let uses_gas = !gas_targets.is_empty();
    let total_cfh = gas_cfh(total_btu, fuel);
    let gas_hookup = Pt {
        x: number_or(field(plumbing, "gasHookupX"), 0.0),
        y: number_or(field(plumbing, "gasHookupY"), 0.0),
    };
    let mut gas_tree = if uses_gas { Some(build_tree(gas_hookup, &gas_targets)) } else { None };
    if let Some(tree) = &mut gas_tree {
        for edge in tree.edges.iter_mut() {
            edge.size = gas_size_for_load(edge.load, edge.length, fuel).to_string();
            edge.capacity = gas_capacity(&edge.size, edge.length, fuel);
        }
    }
    let gas_main_size = gas_size_for_load(total_cfh, gas_length, fuel);
    let gas_capacity_main = if uses_gas { gas_capacity(gas_main_size, gas_length, fuel) } else { 0.0 };
    let longest_run = round_to(
        gas_tree
            .as_ref()
            .map(|tree| tree.edges.iter().fold(0.0f64, |max, edge| max.max(edge.length)))
            .unwrap_or(0.0),
        2,
    );

    // --- checks -----------------------------------------------------------
    let residual = worst.as_ref().map(|(_, value)| *value).unwrap_or(0.0);
    let trap_ok = trap_rows.iter().all(|row| row.contains("\"pass\":true"));
    let checks = [
        ("water-hookup", pressure > 0.0),
        ("residual-pressure", worst.as_ref().map(|(_, value)| *value >= 8.0).unwrap_or(false)),
        ("service-velocity", service_velocity <= 8.0),
        ("meter", !(meter_size == "3/4" && demand > 14.0)),
        ("sewer-invert", number_or(field(plumbing, "sewerInvert"), -2.0) <= required_invert),
        ("sewer-slope", slope >= minimum_slope),
        (
            "sewer-size",
            dwv_index(field(plumbing, "sewerSize").text().unwrap_or("4")) >= dwv_index(main_size),
        ),
        ("trap-arms", trap_ok),
        ("gas-meter", !uses_gas || total_cfh <= gas_meter),
        ("gas-size", !uses_gas || total_cfh <= gas_capacity_main),
    ];
    let check_rows: Vec<String> = checks
        .iter()
        .map(|(id, pass)| jobj(&[("id", jstr(id)), ("pass", flag(*pass))]))
        .collect();

    let reading_rows: Vec<String> = readings
        .iter()
        .map(|(tag, value)| jobj(&[("tag", jstr(tag)), ("pressurePsi", f3(*value))]))
        .collect();


    jobj(&[
        (
            "water",
            jobj(&[
                ("coldWsfu", f3(cold_wsfu)),
                ("hotWsfu", f3(hot_wsfu)),
                ("totalWsfu", f3(total_wsfu)),
                ("demandGpm", f3(demand)),
                ("coldDemandGpm", f3(demand_for_wsfu(cold_wsfu))),
                ("hotDemandGpm", f3(demand_for_wsfu(hot_wsfu))),
                ("serviceSize", jstr(service_id)),
                ("serviceMaterial", jstr(material)),
                ("serviceVelocityFps", f3(service_velocity)),
                ("mainLength", f3(main_length)),
                ("mainFrictionPsi", f3(main_friction)),
                ("meterLossPsi", f3(meter_loss)),
                ("staticAtFixturePsi", f3(static_at_fixture)),
                ("residualPsi", f3(residual)),
                ("worstFixture", jstr(worst.as_ref().map(|(tag, _)| tag.as_str()).unwrap_or(""))),
                ("coldLength", f3(cold_length)),
                ("hotLength", f3(hot_length)),
                ("readings", jarr(&reading_rows)),
            ]),
        ),
        (
            "drain",
            jobj(&[
                ("totalDfu", f3(total_dfu)),
                ("mainSize", jstr(main_size)),
                ("slope", f3(slope)),
                ("minimumSlope", f3(minimum_slope)),
                ("requiredInvert", f3(required_invert)),
                ("sewerMainLength", f3(sewer_length)),
                ("mainY", f3(main_y)),
                ("mainRouteLength", f3(main_route_length)),
                ("ventCount", stack_rows.len().to_string()),
                ("cleanoutCount", (stack_rows.len() + 1).to_string()),
                ("stacks", jarr(&stack_rows)),
                ("trapArms", jarr(&trap_rows)),
            ]),
        ),
        (
            "gas",
            jobj(&[
                ("usesGas", flag(uses_gas)),
                ("fuel", jstr(fuel)),
                ("totalBtu", f3(total_btu)),
                ("totalCfh", f3(total_cfh)),
                ("mainSize", jstr(gas_main_size)),
                ("capacityCfh", f3(gas_capacity_main)),
                ("longestRun", f3(longest_run)),
                ("meterCapacityCfh", f3(gas_meter)),
                ("applianceCount", gas_targets.len().to_string()),
            ]),
        ),
        ("checks", jarr(&check_rows)),
    ])
}

// --- lighting ---------------------------------------------------------------

struct Lum {
    x: f64,
    y: f64,
    lumens: f64,
    watts: f64,
    mount: f64,
    dim: f64,
    on: bool,
    spacing_ratio: f64,
}

fn room_index(width: f64, depth: f64, mounting: f64) -> f64 {
    let w = width.max(0.1);
    let d = depth.max(0.1);
    let h = mounting.max(0.1);
    (w * d) / (h * (w + d))
}

fn coefficient_of_utilization(index: f64, ceiling: f64, wall: f64) -> f64 {
    let k = index.max(0.0);
    let mut cu = if k < 0.7 {
        0.44
    } else if k < 1.0 {
        0.52
    } else if k < 1.5 {
        0.60
    } else if k < 2.0 {
        0.66
    } else if k < 3.0 {
        0.72
    } else if k < 5.0 {
        0.77
    } else {
        0.80
    };
    cu += (ceiling - 0.7) * 0.08;
    cu += (wall - 0.5) * 0.06;
    cu.max(0.35).min(0.88)
}

fn illuminance_at(px: f64, py: f64, lights: &[Lum], work_plane: f64) -> f64 {
    let mut lux = 0.0;
    for light in lights {
        if !light.on {
            continue;
        }
        let dx = px - light.x;
        let dy = py - light.y;
        let h = (light.mount - work_plane).max(0.1);
        let distance_squared = dx * dx + dy * dy + h * h;
        let dist = distance_squared.sqrt();
        let cos = h / dist;
        let intensity = light.lumens / std::f64::consts::PI;
        lux += (intensity * cos) / distance_squared;
    }
    lux
}

fn lighting_json(plan: &Json) -> String {
    let lighting = field(plan, "lighting");
    let width = number_or(field(lighting, "width"), 5.0);
    let depth = number_or(field(lighting, "depth"), 4.0);
    let mounting = number_or(field(lighting, "mountingHeight"), 2.4);
    let work_plane = number_or(field(lighting, "workPlane"), 0.75);
    let target_lux = number_or(field(lighting, "targetLux"), 200.0);
    let llf = number_or(field(lighting, "llf"), 0.8);
    let reflectances = field(lighting, "reflectances");
    let ceiling = number_or(field(reflectances, "ceiling"), 0.8);
    let wall = number_or(field(reflectances, "wall"), 0.5);

    let mut lights: Vec<Lum> = Vec::new();
    for entry in field(lighting, "luminaires").items() {
        lights.push(Lum {
            x: number_or(field(entry, "x"), width / 2.0),
            y: number_or(field(entry, "y"), depth / 2.0),
            lumens: number_or(field(entry, "lumens"), 0.0),
            watts: number_or(field(entry, "watts"), 0.0),
            mount: number_or(field(entry, "mountHeight"), mounting),
            dim: number_or(field(entry, "dim"), 100.0),
            // The port takes `on` as 1/0: the minimal JSON reader discards boolean
            // values, so a literal false would otherwise read as on.
            on: field(entry, "on").truthy().unwrap_or(true),
            spacing_ratio: number_or(field(entry, "spacingRatio"), 1.1),
        });
    }

    let area = (width * depth).max(0.1);
    let total_lumens: f64 = lights.iter().map(|light| light.lumens).sum();
    let index = room_index(width, depth, mounting);
    let cu = coefficient_of_utilization(index, ceiling, wall);
    let average_lux = total_lumens * cu * llf / area;

    let steps = {
        let raw = round_to(number_or(field(lighting, "steps"), 16.0), 0);
        let value = if raw == 0.0 { 16.0 } else { raw };
        value.max(4.0).min(60.0) as usize
    };
    let grid_w = width.max(0.1);
    let grid_d = depth.max(0.1);
    let mut min = f64::INFINITY;
    let mut max = 0.0f64;
    let mut sum = 0.0;
    let mut count = 0usize;
    for row in 0..steps {
        let y = ((row as f64 + 0.5) / steps as f64) * grid_d;
        for col in 0..steps {
            let x = ((col as f64 + 0.5) / steps as f64) * grid_w;
            let lux = illuminance_at(x, y, &lights, work_plane);
            min = min.min(lux);
            max = max.max(lux);
            sum += lux;
            count += 1;
        }
    }
    let grid_average = if count > 0 { sum / count as f64 } else { 0.0 };
    let grid_min = if min.is_finite() { min } else { 0.0 };
    let uniformity = if max > 0.0 { grid_min / max } else { 0.0 };
    let average_to_min = if grid_average > 0.0 { grid_min / grid_average } else { 0.0 };

    let lit_lumens: f64 = lights
        .iter()
        .filter(|light| light.on)
        .map(|light| light.lumens * light.dim / 100.0)
        .sum();
    let connected_w: f64 = lights.iter().map(|light| light.watts).sum();
    let spacing = lights
        .first()
        .map(|light| (light.spacing_ratio * mounting.max(0.5)).max(0.6))
        .unwrap_or(0.0);
    let per_luminaire = lights.first().map(|light| light.lumens).unwrap_or(0.0);
    let required = if per_luminaire > 0.0 && cu * llf > 0.0 {
        (target_lux * area / (per_luminaire * cu * llf) - 1e-9).ceil()
    } else {
        0.0
    };

    let mut circuit_rows = Vec::new();
    for circuit in field(lighting, "circuits").items() {
        let voltage = number_or(field(circuit, "voltage"), 120.0);
        let breaker = number_or(field(circuit, "breakerA"), 15.0);
        let mut va = 0.0;
        for device in field(circuit, "devices").items() {
            let kind = field(device, "kind").text().unwrap_or("luminaire");
            if kind == "socket" {
                let dedicated = field(device, "dedicated").truthy().unwrap_or(false);
                if dedicated {
                    va += number_or(field(device, "ratingA"), 0.0)
                        * number_or(field(device, "voltage"), voltage);
                } else {
                    va += 180.0;
                }
            } else if kind == "luminaire" {
                va += number_or(field(device, "watts"), 0.0);
            }
        }
        let amps = if voltage > 0.0 { va / voltage } else { 0.0 };
        circuit_rows.push(jobj(&[
            ("id", jstr(field(circuit, "id").text().unwrap_or(""))),
            ("name", jstr(field(circuit, "name").text().unwrap_or(""))),
            ("va", f3(round_to(va, 1))),
            ("amps", f3(round_to(amps, 2))),
            ("breakerA", f3(breaker)),
            ("percent", f3(if breaker > 0.0 { round_to(amps / breaker * 100.0, 1) } else { 0.0 })),
            ("pass", flag(amps <= breaker + 1e-9)),
            ("continuousPass", flag(amps <= breaker * 0.8 + 1e-9)),
        ]));
    }

    jobj(&[
        (
            "photometry",
            jobj(&[
                ("area", f3(round_to(area, 2))),
                ("roomIndex", f3(round_to(index, 2))),
                ("cu", f3(round_to(cu, 2))),
                ("llf", f3(llf)),
                ("ceilingReflectance", f3(ceiling)),
                ("wallReflectance", f3(wall)),
                ("totalLumens", f3(round_to(total_lumens, 0))),
                ("litLumens", f3(round_to(lit_lumens, 0))),
                ("averageLux", f3(round_to(average_lux, 1))),
                ("targetLux", f3(target_lux)),
                (
                    "targetRatio",
                    f3(if target_lux > 0.0 { round_to(average_lux / target_lux, 2) } else { 0.0 }),
                ),
                ("meetsTarget", flag(target_lux <= 0.0 || average_lux >= target_lux - 1e-9)),
                ("spacing", f3(round_to(spacing, 2))),
                ("connectedW", f3(round_to(connected_w, 1))),
                ("wattsPerM2", f3(round_to(connected_w / area, 2))),
                (
                    "efficacy",
                    f3(if connected_w > 0.0 { round_to(total_lumens / connected_w, 1) } else { 0.0 }),
                ),
                ("requiredForTarget", f3(required)),
            ]),
        ),
        (
            "grid",
            jobj(&[
                ("steps", steps.to_string()),
                ("minLux", f3(round_to(grid_min, 1))),
                ("maxLux", f3(round_to(max, 1))),
                ("averageLux", f3(round_to(grid_average, 1))),
                ("uniformity", f3(round_to(uniformity, 2))),
                ("averageToMin", f3(round_to(average_to_min, 2))),
            ]),
        ),
        ("circuits", jarr(&circuit_rows)),
    ])
}

// --- roof suite ------------------------------------------------------------

struct RoofStyleDef {
    key: &'static str,
    name: &'static str,
    family: &'static str,
    truss: &'static str,
    min_pitch: f64,
}

static ROOF_STYLES: [RoofStyleDef; 10] = [
    RoofStyleDef { key: "gable-king", name: "Gable · king post", family: "gable", truss: "king-post", min_pitch: 3.0 },
    RoofStyleDef { key: "gable-fink", name: "Gable · Fink", family: "gable", truss: "fink", min_pitch: 3.0 },
    RoofStyleDef { key: "gable-howe", name: "Gable · Howe", family: "gable", truss: "howe", min_pitch: 3.0 },
    RoofStyleDef { key: "gable-scissor", name: "Gable · scissor", family: "gable", truss: "scissor", min_pitch: 4.0 },
    RoofStyleDef { key: "gable-attic", name: "Gable · attic (room in roof)", family: "gable", truss: "attic", min_pitch: 5.0 },
    RoofStyleDef { key: "gambrel", name: "Gambrel", family: "gambrel", truss: "gambrel", min_pitch: 5.0 },
    RoofStyleDef { key: "hip", name: "Hip", family: "hip", truss: "hip", min_pitch: 3.0 },
    RoofStyleDef { key: "cross-gable", name: "Cross gable", family: "cross", truss: "cross", min_pitch: 3.0 },
    RoofStyleDef { key: "shed", name: "Shed · mono-pitch", family: "shed", truss: "shed", min_pitch: 3.0 },
    RoofStyleDef { key: "saltbox", name: "Saltbox", family: "saltbox", truss: "saltbox", min_pitch: 3.0 },
];

fn roof_style(key: &str) -> &'static RoofStyleDef {
    ROOF_STYLES.iter().find(|entry| entry.key == key).unwrap_or(&ROOF_STYLES[0])
}

struct Sheathing { label: &'static str, nail_mm: f64, cost: f64 }
struct Underlayment { label: &'static str, coverage: f64, cost: f64, min_pitch: f64 }
struct Covering {
    label: &'static str,
    family: &'static str,
    min_pitch: f64,
    max_pitch: f64,
    unit: &'static str,
    units_per_square: f64,
    cost_per_square: f64,
    weight: f64,
    starter_lf_per_unit: f64,
    ridge_cap_lf_per_unit: f64,
    /// Kept for the contract's sake; the check text is not part of the JSON output.
    #[allow(dead_code)]
    warranty: &'static str,
}
struct GutterSystem { label: &'static str, max_area: f64, cost_per_lf: f64, downspout_cost: f64, hanger_spacing: f64, downspout: &'static str }

fn sheathing_by_id(id: &str) -> &'static Sheathing {
    const SHEATHING: [(&str, Sheathing); 3] = [
        ("osb-716", Sheathing { label: "7/16 in OSB", nail_mm: 150.0, cost: 21.0 }),
        ("ply-1532", Sheathing { label: "15/32 in plywood", nail_mm: 150.0, cost: 34.0 }),
        ("ply-1932", Sheathing { label: "19/32 in plywood", nail_mm: 100.0, cost: 46.0 }),
    ];
    &SHEATHING.iter().find(|(key, _)| *key == id).unwrap_or(&SHEATHING[0]).1
}

fn underlayment_by_id(id: &str) -> &'static Underlayment {
    const UNDERLAYMENT: [(&str, Underlayment); 4] = [
        ("felt-15", Underlayment { label: "15 lb felt", coverage: 92.9, cost: 38.0, min_pitch: 2.0 }),
        ("felt-30", Underlayment { label: "30 lb felt", coverage: 92.9, cost: 55.0, min_pitch: 1.0 }),
        ("synthetic", Underlayment { label: "Synthetic underlayment", coverage: 92.9, cost: 118.0, min_pitch: 1.0 }),
        ("peel-stick", Underlayment { label: "Peel-and-stick membrane", coverage: 18.6, cost: 145.0, min_pitch: 0.25 }),
    ];
    &UNDERLAYMENT.iter().find(|(key, _)| *key == id).unwrap_or(&UNDERLAYMENT[0]).1
}

fn covering_by_id(id: &str) -> &'static Covering {
    const COVERINGS: [(&str, Covering); 10] = [
        ("asphalt-3tab", Covering { label: "3-tab asphalt shingle", family: "shingle", min_pitch: 2.0, max_pitch: 20.0, unit: "bundle", units_per_square: 3.0, cost_per_square: 115.0, weight: 8.5, starter_lf_per_unit: 35.0, ridge_cap_lf_per_unit: 35.0, warranty: "25-year limited" }),
        ("asphalt-arch", Covering { label: "Architectural (dimensional) shingle", family: "shingle", min_pitch: 2.0, max_pitch: 20.0, unit: "bundle", units_per_square: 3.0, cost_per_square: 155.0, weight: 11.0, starter_lf_per_unit: 35.0, ridge_cap_lf_per_unit: 35.0, warranty: "30-year limited" }),
        ("metal-standing-seam", Covering { label: "Standing-seam metal", family: "metal", min_pitch: 3.0, max_pitch: 24.0, unit: "square", units_per_square: 1.0, cost_per_square: 520.0, weight: 6.5, starter_lf_per_unit: 0.0, ridge_cap_lf_per_unit: 0.0, warranty: "40-year finish / 50-year substrate" }),
        ("clay-tile", Covering { label: "Clay barrel tile", family: "tile", min_pitch: 4.0, max_pitch: 16.0, unit: "tile", units_per_square: 100.0, cost_per_square: 920.0, weight: 45.0, starter_lf_per_unit: 0.0, ridge_cap_lf_per_unit: 0.0, warranty: "50-year material" }),
        ("concrete-tile", Covering { label: "Concrete tile", family: "tile", min_pitch: 4.0, max_pitch: 16.0, unit: "tile", units_per_square: 95.0, cost_per_square: 690.0, weight: 50.0, starter_lf_per_unit: 0.0, ridge_cap_lf_per_unit: 0.0, warranty: "50-year material" }),
        ("slate", Covering { label: "Natural slate", family: "tile", min_pitch: 4.0, max_pitch: 24.0, unit: "slate", units_per_square: 220.0, cost_per_square: 1650.0, weight: 55.0, starter_lf_per_unit: 0.0, ridge_cap_lf_per_unit: 0.0, warranty: "75-year material" }),
        ("modified-bitumen", Covering { label: "Modified bitumen membrane", family: "low-slope", min_pitch: 1.0, max_pitch: 4.0, unit: "roll", units_per_square: 1.0, cost_per_square: 210.0, weight: 5.5, starter_lf_per_unit: 0.0, ridge_cap_lf_per_unit: 0.0, warranty: "15-year material" }),
        ("bur", Covering { label: "Built-up roof (3-ply BUR)", family: "low-slope", min_pitch: 0.25, max_pitch: 3.0, unit: "ply-square", units_per_square: 3.0, cost_per_square: 460.0, weight: 12.0, starter_lf_per_unit: 0.0, ridge_cap_lf_per_unit: 0.0, warranty: "20-year system" }),
        ("tpo", Covering { label: "Single-ply TPO / EPDM", family: "low-slope", min_pitch: 0.25, max_pitch: 3.0, unit: "square", units_per_square: 1.0, cost_per_square: 420.0, weight: 2.5, starter_lf_per_unit: 0.0, ridge_cap_lf_per_unit: 0.0, warranty: "20-year membrane" }),
        ("roll-roofing", Covering { label: "Roll roofing", family: "low-slope", min_pitch: 1.0, max_pitch: 4.0, unit: "roll", units_per_square: 1.0, cost_per_square: 130.0, weight: 4.5, starter_lf_per_unit: 0.0, ridge_cap_lf_per_unit: 0.0, warranty: "5-year material" }),
    ];
    &COVERINGS.iter().find(|(key, _)| *key == id).unwrap_or(&COVERINGS[1]).1
}

fn gutter_by_id(id: &str) -> &'static GutterSystem {
    const GUTTERS: [(&str, GutterSystem); 5] = [
        ("k5-alum", GutterSystem { label: "5 in K-style aluminium", max_area: 55.0, cost_per_lf: 9.0, downspout_cost: 14.0, hanger_spacing: 0.6, downspout: "2 x 3 in rectangular" }),
        ("k6-alum", GutterSystem { label: "6 in K-style aluminium", max_area: 95.0, cost_per_lf: 12.0, downspout_cost: 18.0, hanger_spacing: 0.6, downspout: "3 x 4 in rectangular" }),
        ("half-round-5", GutterSystem { label: "5 in half-round aluminium", max_area: 45.0, cost_per_lf: 14.0, downspout_cost: 16.0, hanger_spacing: 0.5, downspout: "3 in round" }),
        ("box-4", GutterSystem { label: "4 in box steel", max_area: 40.0, cost_per_lf: 16.0, downspout_cost: 18.0, hanger_spacing: 0.6, downspout: "3 in round" }),
        ("copper-k6", GutterSystem { label: "6 in K-style copper", max_area: 95.0, cost_per_lf: 42.0, downspout_cost: 65.0, hanger_spacing: 0.6, downspout: "3 x 4 in copper" }),
    ];
    &GUTTERS.iter().find(|(key, _)| *key == id).unwrap_or(&GUTTERS[0]).1
}

fn hypot2(a: f64, b: f64) -> f64 {
    (a * a + b * b).sqrt()
}

fn tri_area(a: (f64, f64, f64), b: (f64, f64, f64), c: (f64, f64, f64)) -> f64 {
    let ux = b.0 - a.0;
    let uy = b.1 - a.1;
    let uz = b.2 - a.2;
    let vx = c.0 - a.0;
    let vy = c.1 - a.1;
    let vz = c.2 - a.2;
    let cx = uy * vz - uz * vy;
    let cy = uz * vx - ux * vz;
    let cz = ux * vy - uy * vx;
    (cx * cx + cy * cy + cz * cz).sqrt() / 2.0
}

/// `quadArea`: fan triangulation, exactly as the suite measures a plane.
fn plane_area(points: &[(f64, f64, f64)]) -> f64 {
    let mut total = 0.0;
    let mut index = 1;
    while index + 1 < points.len() {
        total += tri_area(points[0], points[index], points[index + 1]);
        index += 1;
    }
    total
}

struct RoofGeom {
    pitch: f64,
    angle: f64,
    span: f64,
    length: f64,
    overhang: f64,
    half: f64,
    rise: f64,
    ridge_x: f64,
    cross_rise: f64,
    ridge_length: f64,
    hip_length: f64,
    valley_length: f64,
    eave_length: f64,
    rake_length: f64,
    roof_area: f64,
    footprint_area: f64,
    slope_length: f64,
}

fn roof_geometry(family: &str, span: f64, length: f64, pitch: f64, overhang: f64) -> RoofGeom {
    let safe_span = span.max(1.2);
    let safe_length = length.max(1.2);
    let safe_pitch = pitch.max(0.1);
    let run = safe_pitch / 12.0;
    let half = safe_span / 2.0;
    let over = overhang.max(0.0);
    let z1 = -safe_length / 2.0 - over;
    let z2 = safe_length / 2.0 + over;
    let eave_y = -over * run;
    let rise = if family == "shed" { safe_span * run } else { half * run };
    let mut ridge_x = 0.0;
    let mut cross_rise = 0.0;
    let mut ridge_length = safe_length;
    let mut valley_length = 0.0;
    let mut hip_length = 0.0;
    let mut planes: Vec<f64> = Vec::new();
    let gable_plane = |ridge_x: f64, ridge_y: f64, eave_x: f64, eave_y: f64, za: f64, zb: f64| -> f64 {
        plane_area(&[
            (ridge_x, ridge_y, za),
            (eave_x, eave_y, za),
            (eave_x, eave_y, zb),
            (ridge_x, ridge_y, zb),
        ])
    };

    if family == "gable" {
        planes.push(gable_plane(0.0, rise, half + over, eave_y, z1, z2));
        planes.push(gable_plane(0.0, rise, -half - over, eave_y, z1, z2));
        ridge_length = safe_length + 2.0 * over;
    } else if family == "saltbox" {
        let left_run = safe_span * 0.38;
        let right_run = safe_span * 0.62;
        ridge_x = -half + left_run;
        let left_slope = rise / left_run;
        let right_slope = rise / right_run;
        planes.push(gable_plane(ridge_x, rise, half + over, -over * right_slope, z1, z2));
        planes.push(gable_plane(ridge_x, rise, -half - over, -over * left_slope, z1, z2));
        ridge_length = safe_length + 2.0 * over;
    } else if family == "gambrel" {
        let break_x = half * 0.55;
        let lower_rise = rise * 0.45;
        let lower_slope = lower_rise / (half - break_x);
        let lower_eave_y = -over * lower_slope;
        for side in [1.0, -1.0] {
            let sign = side;
            planes.push(plane_area(&[
                (sign * break_x, lower_rise, z1),
                (sign * (half + over), lower_eave_y, z1),
                (sign * (half + over), lower_eave_y, z2),
                (sign * break_x, lower_rise, z2),
            ]));
            planes.push(plane_area(&[
                (0.0, rise, z1),
                (sign * break_x, lower_rise, z1),
                (sign * break_x, lower_rise, z2),
                (0.0, rise, z2),
            ]));
        }
        ridge_length = safe_length + 2.0 * over;
    } else if family == "hip" {
        ridge_length = (safe_length - safe_span).max(0.4);
        let ridge_z = ridge_length / 2.0;
        let eave_x = half + over;
        let eave_z = safe_length / 2.0 + over;
        hip_length = 4.0 * hypot2(hypot2(eave_x, eave_z - ridge_z), rise - eave_y);
        planes.push(gable_plane(0.0, rise, eave_x, eave_y, -ridge_z, ridge_z));
        planes.push(gable_plane(0.0, rise, -eave_x, eave_y, -ridge_z, ridge_z));
        planes.push(plane_area(&[(0.0, rise, -ridge_z), (-eave_x, eave_y, -eave_z), (eave_x, eave_y, -eave_z)]));
        planes.push(plane_area(&[(0.0, rise, ridge_z), (eave_x, eave_y, eave_z), (-eave_x, eave_y, eave_z)]));
    } else if family == "cross" {
        cross_rise = rise * 0.85;
        let cross_half = safe_length * 0.28;
        let cross_eave_y = -over * (cross_rise / cross_half);
        let x1 = -half - over;
        let x2 = half + over;
        planes.push(gable_plane(0.0, rise, half + over, eave_y, z1, z2));
        planes.push(gable_plane(0.0, rise, -half - over, eave_y, z1, z2));
        planes.push(plane_area(&[
            (x1, cross_rise, 0.0),
            (x2, cross_rise, 0.0),
            (x2, cross_eave_y, cross_half + over),
            (x1, cross_eave_y, cross_half + over),
        ]));
        planes.push(plane_area(&[
            (x2, cross_rise, 0.0),
            (x1, cross_rise, 0.0),
            (x1, cross_eave_y, -cross_half - over),
            (x2, cross_eave_y, -cross_half - over),
        ]));
        ridge_length = safe_length + safe_span * 0.9;
        valley_length = 4.0 * hypot2(safe_span * 0.22, rise * 0.35);
    } else if family == "shed" {
        let high = rise;
        let high_over = rise + over * run;
        let low_over = -over * run;
        planes.push(plane_area(&[
            (-half - over, high_over, z1),
            (half + over, low_over, z1),
            (half + over, low_over, z2),
            (-half - over, high_over, z2),
        ]));
        ridge_length = 0.0;
        let _ = high;
    }

    let roof_area: f64 = planes.iter().sum();
    let footprint_area = safe_span * safe_length;
    let slope_length_of = |run_x: f64, rise_y: f64, over_x: f64, over_y: f64| hypot2(run_x + over_x, rise_y + over_y);
    let rake_length = if family == "hip" {
        0.0
    } else if family == "shed" {
        2.0 * slope_length_of(safe_span, rise, over, over * run)
    } else if family == "gambrel" {
        let break_x = half * 0.55;
        let lower_rise = rise * 0.45;
        let lower_slope = lower_rise / (half - break_x);
        4.0 * hypot2(half - break_x + over, lower_rise + over * lower_slope) + 4.0 * hypot2(break_x, rise - lower_rise)
    } else if family == "saltbox" {
        let left_run = half + ridge_x;
        let right_run = half - ridge_x;
        2.0 * slope_length_of(left_run, rise, over, over * (rise / left_run))
            + 2.0 * slope_length_of(right_run, rise, over, over * (rise / right_run))
    } else if family == "cross" {
        let main_slope = slope_length_of(half, rise, over, over * run);
        let cross_half = safe_length * 0.28;
        let cross_slope = slope_length_of(cross_half, cross_rise, over, 0.0);
        4.0 * main_slope + 4.0 * cross_slope
    } else {
        4.0 * slope_length_of(half, rise, over, over * run)
    };
    let eave_length = if family == "hip" {
        2.0 * (safe_length + 2.0 * over) + 2.0 * (safe_span + 2.0 * over)
    } else if family == "shed" {
        safe_length + 2.0 * over
    } else if family == "cross" {
        2.0 * (safe_length + 2.0 * over) + 2.0 * (safe_span + 2.0 * over)
    } else {
        2.0 * (safe_length + 2.0 * over)
    };

    RoofGeom {
        pitch: safe_pitch,
        angle: (run.atan() * 180.0) / std::f64::consts::PI,
        span: safe_span,
        length: safe_length,
        overhang: over,
        half,
        rise,
        ridge_x,
        cross_rise,
        ridge_length,
        hip_length,
        valley_length,
        eave_length,
        rake_length,
        roof_area,
        footprint_area,
        slope_length: hypot2(half, rise),
    }
}

/// Total member length per truss, for the lumber takeoff.
fn truss_member_length(truss: &str, geometry: &RoofGeom) -> f64 {
    let half = geometry.half;
    let rise = geometry.rise;
    let mut members: Vec<(f64, f64, f64, f64)> = Vec::new();
    let mut add = |x1: f64, y1: f64, x2: f64, y2: f64| members.push((x1, y1, x2, y2));
    let bottom = |add: &mut dyn FnMut(f64, f64, f64, f64)| add(-half, 0.0, half, 0.0);
    let top_chords = |add: &mut dyn FnMut(f64, f64, f64, f64), ridge_y: f64, at_x: f64| {
        add(-half, 0.0, at_x, ridge_y);
        add(half, 0.0, at_x, ridge_y);
    };

    if truss == "king-post" {
        bottom(&mut add);
        top_chords(&mut add, rise, 0.0);
        add(0.0, 0.0, 0.0, rise);
        for fraction in [0.5, 0.75] {
            for side in [1.0, -1.0] {
                add(side * half * fraction, 0.0, (side * half * fraction) / 2.0, rise * (1.0 - fraction / 2.0));
            }
        }
    } else if truss == "fink" {
        bottom(&mut add);
        top_chords(&mut add, rise, 0.0);
        add(-half * 0.5, 0.0, -half * 0.25, rise * 0.5);
        add(-half * 0.25, rise * 0.5, 0.0, 0.0);
        add(half * 0.25, rise * 0.5, 0.0, 0.0);
        add(half * 0.5, 0.0, half * 0.25, rise * 0.5);
    } else if truss == "howe" {
        bottom(&mut add);
        top_chords(&mut add, rise, 0.0);
        for side in [1.0, -1.0] {
            add(side * half * 0.5, 0.0, side * half * 0.5, rise * 0.5);
            add(0.0, 0.0, side * half * 0.5, rise * 0.5);
        }
    } else if truss == "scissor" {
        top_chords(&mut add, rise, 0.0);
        add(-half, rise * 0.12, half * 0.55, rise * 0.82);
        add(half, rise * 0.12, -half * 0.55, rise * 0.82);
        add(0.0, rise * 0.28, 0.0, rise * 0.9);
    } else if truss == "attic" {
        bottom(&mut add);
        top_chords(&mut add, rise, 0.0);
        let tie = rise * 0.52;
        add(-half * 0.78, tie, half * 0.78, tie);
        for side in [1.0, -1.0] {
            add(side * half * 0.78, 0.0, side * half * 0.78, tie);
        }
        add(0.0, tie, 0.0, rise);
    } else if truss == "gambrel" {
        bottom(&mut add);
        let break_x = half * 0.55;
        let lower_rise = rise * 0.45;
        for side in [1.0, -1.0] {
            add(side * half, 0.0, side * break_x, lower_rise);
            add(side * break_x, lower_rise, 0.0, rise);
            add(side * break_x, 0.0, side * break_x, lower_rise);
        }
        add(0.0, 0.0, 0.0, rise);
    } else if truss == "saltbox" {
        bottom(&mut add);
        add(-half, 0.0, geometry.ridge_x, rise);
        add(half, 0.0, geometry.ridge_x, rise);
        add(geometry.ridge_x, 0.0, geometry.ridge_x, rise);
        for side in [1.0, -1.0] {
            add(side * half * 0.5, 0.0, side * half * 0.25, rise * 0.45);
        }
    } else if truss == "shed" {
        add(-half, 0.0, half, 0.0);
        add(-half, rise, half, 0.0);
        add(-half, 0.0, -half, rise);
        add(0.0, 0.0, 0.0, rise * 0.5);
    } else {
        bottom(&mut add);
        top_chords(&mut add, rise, 0.0);
        add(0.0, 0.0, 0.0, rise);
        for fraction in [0.5, 0.75] {
            for side in [1.0, -1.0] {
                add(side * half * fraction, 0.0, (side * half * fraction) / 2.0, rise * (1.0 - fraction / 2.0));
            }
        }
    }

    members
        .iter()
        .map(|(x1, y1, x2, y2)| hypot2(x2 - x1, y2 - y1))
        .sum()
}

fn roof_ceil(value: f64) -> f64 {
    (value.max(0.0) - 1e-9).ceil()
}

struct RoofRow {
    group: &'static str,
    item: String,
    qty: f64,
    unit: &'static str,
    unit_cost: f64,
    note: &'static str,
}

/// `computeRoofDesign`: geometry, every layer's takeoff, the gutter package, the
/// ventilation balance, a costed bill and the suite's checks.
fn roof_design_json(plan: &Json) -> String {
    let roof = field(plan, "roof");
    let style_key = roof.get("style").and_then(|v| v.text()).unwrap_or("gable-king");
    let definition = roof_style(style_key);
    let span = number_or(roof.get("span").unwrap_or(&Json::Null), 10.0);
    let length = number_or(roof.get("length").unwrap_or(&Json::Null), 14.0);
    let pitch = number_or(roof.get("pitch").unwrap_or(&Json::Null), 6.0);
    let overhang = number_or(roof.get("overhang").unwrap_or(&Json::Null), 0.5);
    let geometry = roof_geometry(definition.family, span, length, pitch, overhang);

    let sheathing = sheathing_by_id(roof.get("sheathing").and_then(|v| v.text()).unwrap_or("osb-716"));
    let underlayment = underlayment_by_id(roof.get("underlayment").and_then(|v| v.text()).unwrap_or("synthetic"));
    let covering = covering_by_id(roof.get("covering").and_then(|v| v.text()).unwrap_or("asphalt-arch"));
    let gutter = gutter_by_id(roof.get("gutter").and_then(|v| v.text()).unwrap_or("k5-alum"));
    let spacing = clamp(number_or(roof.get("spacing").unwrap_or(&Json::Null), 0.61), 0.3, 1.2);
    let waste = clamp(number_or(roof.get("waste").unwrap_or(&Json::Null), 0.1), 0.0, 0.4);
    let flag_of = |key: &str, fallback: bool| -> bool {
        roof.get(key).and_then(|value| value.truthy()).unwrap_or(fallback)
    };
    let gutters = flag_of("gutters", true);
    let ice_shield = flag_of("iceShield", true);
    let ridge_vent = flag_of("ridgeVent", true);
    let soffit_vent = flag_of("soffitVent", true);
    let chimney = flag_of("chimney", false);
    let tear_off = flag_of("tearOff", false);
    let climate = roof.get("climate").and_then(|v| v.text()).unwrap_or("moderate");
    let pipe_vents = roof.get("pipeVents").map(|v| number_or(v, 0.0)).unwrap_or(2.0).round();

    let area = geometry.roof_area;
    let squares = area / 9.2903;
    let squares_with_waste = squares * (1.0 + waste);
    let plan_area = geometry.footprint_area;

    let sheet_m2 = 1.22 * 2.44;
    let sheets = roof_ceil((area * (1.0 + waste)) / sheet_m2);
    let underlay_rolls = roof_ceil((area * 1.05) / underlayment.coverage);
    let ice_shield_m2 = if ice_shield { geometry.eave_length * geometry.slope_length.min(0.9) } else { 0.0 };
    let ice_shield_rolls = if ice_shield_m2 > 0.0 { roof_ceil(ice_shield_m2 / 18.6) } else { 0.0 };

    let covering_units = roof_ceil(squares_with_waste * covering.units_per_square);
    let covering_unit = if covering.family == "shingle" { "bundle" } else if covering.family == "metal" { "square" } else { covering.unit };
    let starter_lf = if covering.family == "shingle" { geometry.eave_length } else { 0.0 };
    let starter_units = if covering.starter_lf_per_unit > 0.0 { roof_ceil(starter_lf / covering.starter_lf_per_unit) } else { 0.0 };
    let ridge_cap_lf = geometry.ridge_length + geometry.hip_length;
    let mut ridge_cap_units = 0.0;
    let mut ridge_cap_unit = "";
    let mut ridge_cap_cost = 0.0;
    if covering.ridge_cap_lf_per_unit > 0.0 {
        ridge_cap_units = roof_ceil(ridge_cap_lf / covering.ridge_cap_lf_per_unit);
        ridge_cap_unit = "bundle";
        ridge_cap_cost = 58.0;
    } else if covering.family == "tile" {
        ridge_cap_units = roof_ceil(ridge_cap_lf / 0.45);
        ridge_cap_unit = "piece";
        ridge_cap_cost = 13.0;
    } else if covering.family == "metal" {
        ridge_cap_units = ridge_cap_lf;
        ridge_cap_unit = "m";
        ridge_cap_cost = 22.0;
    }

    let member_length = truss_member_length(definition.truss, &geometry);
    let main_trusses = roof_ceil(geometry.length / spacing) + 1.0;
    let cross_trusses = if definition.family == "cross" { roof_ceil((geometry.span * 0.9) / spacing) + 1.0 } else { 0.0 };
    let truss_count = main_trusses + cross_trusses;
    let truss_lumber_m = member_length * truss_count;
    let ceiling_joists = truss_count;
    let truss_unit_cost = round_to(38.0 + geometry.span * 9.5 + if definition.family == "hip" { 12.0 } else { 0.0 }, 2);

    let eave_runs = if definition.family == "hip" || definition.family == "cross" { 4.0 } else if definition.family == "shed" { 1.0 } else { 2.0 };
    let gutter_lf = if gutters { geometry.eave_length } else { 0.0 };
    let auto_downspouts = (gutter_lf / 12.0).ceil().max((area / gutter.max_area).ceil()).max(2.0);
    let downspouts = if gutters { auto_downspouts } else { 0.0 };
    let hangers = if gutters { roof_ceil(gutter_lf / gutter.hanger_spacing) } else { 0.0 };
    let end_caps = if gutters { if definition.family == "hip" { 0.0 } else { eave_runs * 2.0 } } else { 0.0 };
    let outlets = downspouts;
    let elbows = downspouts * 2.0;

    let drip_edge = geometry.eave_length + geometry.rake_length;
    let valley = geometry.valley_length;
    let step_m = if chimney { 4.0 } else { 0.0 };
    let apron_m = if chimney { 2.4 } else { 0.0 };
    let counter_m = if chimney { 2.4 } else { 0.0 };
    let kickouts = if definition.family == "cross" { 2.0 } else { 0.0 };
    let pipe_boots = pipe_vents.max(0.0);
    let gutter_apron = if gutters { geometry.eave_length } else { 0.0 };
    let ridge_vent_m = if ridge_vent { geometry.ridge_length } else { 0.0 };
    let soffit_vent_m = if soffit_vent { geometry.eave_length } else { 0.0 };
    let required_nfva = area / 300.0;
    let provided_nfva = ridge_vent_m * 0.025 + soffit_vent_m * 0.02;

    let mut rows: Vec<RoofRow> = Vec::new();
    let mut add = |group: &'static str, item: String, qty: f64, unit: &'static str, unit_cost: f64, note: &'static str| {
        if !(qty > 0.0) {
            return;
        }
        rows.push(RoofRow { group, item, qty: round_to(qty, 2), unit, unit_cost: round_to(unit_cost, 2), note });
    };

    add("Deck", format!("{} sheets", sheathing.label), sheets, "sheet", sheathing.cost, "");
    add("Deck", "Sheathing nails / clips".into(), sheets, "sheet", 3.2, "");
    add("Deck", format!("{} rolls", underlayment.label), underlay_rolls, "roll", underlayment.cost, "");
    add("Deck", "Ice & water shield".into(), ice_shield_m2, "m2", 14.0, "");
    add("Deck", "Ice & water shield rolls".into(), ice_shield_rolls, "roll", 145.0, "");

    add("Covering", covering.label.to_string(), covering_units, covering_unit, covering.cost_per_square / covering.units_per_square.max(1.0), "");
    if starter_units > 0.0 {
        add("Covering", "Starter strip".into(), starter_units, "bundle", 48.0, "");
    }
    if ridge_cap_units > 0.0 {
        add("Covering", "Ridge and hip cap".into(), ridge_cap_units, ridge_cap_unit, ridge_cap_cost, "");
    }
    if covering.family == "metal" {
        add("Covering", "Closures and fasteners".into(), area, "m2", 6.0, "");
    }
    if chimney {
        add("Covering", "Chimney cricket".into(), 1.0, "each", 180.0, "");
    }

    add("Flashing", "Drip edge (eave and rake)".into(), drip_edge, "m", 6.0, "");
    add("Flashing", "Valley metal".into(), valley, "m", 18.0, "");
    add("Flashing", "Step flashing".into(), step_m, "m", 12.0, "");
    add("Flashing", "Apron flashing".into(), apron_m, "m", 16.0, "");
    add("Flashing", "Counter flashing".into(), counter_m, "m", 16.0, "");
    add("Flashing", "Kickout flashing".into(), kickouts, "each", 14.0, "");
    add("Flashing", "Pipe vent boots".into(), pipe_boots, "each", 12.0, "");
    add("Flashing", "Gutter apron".into(), gutter_apron, "m", 7.0, "");

    if gutters {
        add("Gutter", format!("{} run", gutter.label), gutter_lf, "m", gutter.cost_per_lf, "");
        add("Gutter", format!("Downspouts ({})", gutter.downspout), downspouts, "each", gutter.downspout_cost, "");
        add("Gutter", "Hangers".into(), hangers, "each", 1.8, "");
        add("Gutter", "End caps".into(), end_caps, "each", 3.5, "");
        add("Gutter", "Outlets".into(), outlets, "each", 4.5, "");
        add("Gutter", "Downspout elbows".into(), elbows, "each", 5.0, "");
    }

    add("Structure", "Roof trusses".into(), truss_count, "truss", truss_unit_cost, "");
    add("Structure", "Truss lumber (2 x 4 equivalent)".into(), truss_lumber_m, "m", 4.6, "");
    add("Structure", "Ceiling joists".into(), ceiling_joists, "joist", 12.0, "");

    add("Ventilation", "Ridge vent".into(), ridge_vent_m, "m", 22.0, "");
    add("Ventilation", "Soffit vent strip".into(), soffit_vent_m, "m", 9.0, "");

    let mut material = 0.0;
    for row in &rows {
        material += row.qty * row.unit_cost;
    }
    let material_cost = round_to(material, 2);
    let tear_off_cost = if tear_off { squares * 90.0 } else { 0.0 };
    let install_cost = squares_with_waste * 140.0;
    let gutter_labour = if gutters { gutter_lf * 6.0 } else { 0.0 };
    let flashing_labour = (drip_edge + valley + step_m + apron_m + counter_m) * 9.0;
    let labour_cost = round_to(tear_off_cost + install_cost + gutter_labour + flashing_labour, 2);
    let total_cost = round_to(material_cost + labour_cost, 2);

    let mut checks: Vec<(&'static str, &'static str)> = Vec::new();
    if geometry.pitch < covering.min_pitch {
        checks.push(("pitch-covering", "error"));
    } else if geometry.pitch > covering.max_pitch {
        checks.push(("pitch-max", "warn"));
    } else {
        checks.push(("pitch-covering", "ok"));
    }
    if geometry.pitch < definition.min_pitch {
        checks.push(("pitch-style", "warn"));
    }
    if geometry.pitch < 2.0 {
        checks.push(("low-slope", "warn"));
    }
    if geometry.pitch < 0.25 {
        checks.push(("ponding", "error"));
    }
    checks.push(("deck", "ok"));
    if covering.weight >= 40.0 {
        checks.push(("dead-load", if covering.weight >= 55.0 { "warn" } else { "info" }));
    } else {
        checks.push(("dead-load", "ok"));
    }
    if spacing > 0.45 && covering.family == "tile" {
        checks.push(("truss-spacing", "error"));
    } else {
        checks.push(("truss-spacing", "info"));
    }
    if climate == "cold" && !ice_shield {
        checks.push(("ice-dam", "error"));
    } else if ice_shield {
        checks.push(("ice-dam", "ok"));
    } else {
        checks.push(("ice-dam", "info"));
    }
    if ridge_vent_m <= 0.0 && soffit_vent_m <= 0.0 {
        checks.push(("ventilation", "warn"));
    } else if ridge_vent_m <= 0.0 || soffit_vent_m <= 0.0 {
        checks.push(("ventilation", "warn"));
    } else if provided_nfva < required_nfva {
        checks.push(("ventilation", "warn"));
    } else {
        checks.push(("ventilation", "ok"));
    }
    if gutters {
        if downspouts > 0.0 && area / downspouts > gutter.max_area {
            checks.push(("gutter-capacity", "warn"));
        } else if downspouts > 0.0 {
            checks.push(("gutter-capacity", "ok"));
        } else {
            checks.push(("gutter-capacity", "warn"));
        }
    } else {
        checks.push(("gutter", "info"));
    }
    if underlayment.min_pitch > geometry.pitch {
        checks.push(("underlayment", "warn"));
    } else {
        checks.push(("underlayment", "ok"));
    }
    if valley > 0.0 {
        checks.push(("valley", "info"));
    }
    if chimney {
        checks.push(("chimney", "info"));
    }
    if climate == "hail" && covering.family == "shingle" {
        checks.push(("hail", "info"));
    }
    if geometry.overhang > 0.9 {
        checks.push(("overhang", "warn"));
    }
    if waste < 0.05 {
        checks.push(("waste", "warn"));
    } else if waste > 0.25 {
        checks.push(("waste", "warn"));
    }
    checks.push(("warranty", "info"));

    let row_json: Vec<String> = rows
        .iter()
        .map(|row| {
            jobj(&[
                ("group", jstr(row.group)),
                ("item", jstr(&row.item)),
                ("qty", f3(row.qty)),
                ("unit", jstr(row.unit)),
                ("unitCost", f3(row.unit_cost)),
                ("cost", f3(round_to(row.qty * row.unit_cost, 2))),
                ("note", jstr(row.note)),
            ])
        })
        .collect();
    let check_json: Vec<String> = checks
        .iter()
        .map(|(id, severity)| jobj(&[("id", jstr(id)), ("severity", jstr(severity))]))
        .collect();
    let errors = checks.iter().filter(|(_, severity)| *severity == "error").count();
    let warnings = checks.iter().filter(|(_, severity)| *severity == "warn").count();

    jobj(&[
        ("style", jstr(definition.key)),
        ("styleName", jstr(definition.name)),
        ("family", jstr(definition.family)),
        (
            "geometry",
            jobj(&[
                ("pitch", f3(round_to(geometry.pitch, 2))),
                ("angle", f3(round_to(geometry.angle, 1))),
                ("span", f3(geometry.span)),
                ("length", f3(geometry.length)),
                ("overhang", f3(geometry.overhang)),
                ("rise", f3(round_to(geometry.rise, 3))),
                ("crossRise", f3(round_to(geometry.cross_rise, 3))),
                ("ridgeLength", f3(round_to(geometry.ridge_length, 2))),
                ("hipLength", f3(round_to(geometry.hip_length, 2))),
                ("valleyLength", f3(round_to(geometry.valley_length, 2))),
                ("eaveLength", f3(round_to(geometry.eave_length, 2))),
                ("rakeLength", f3(round_to(geometry.rake_length, 2))),
                ("roofArea", f3(round_to(area, 2))),
                ("planArea", f3(round_to(plan_area, 2))),
            ]),
        ),
        (
            "areas",
            jobj(&[
                ("roof", f3(round_to(area, 2))),
                ("plan", f3(round_to(plan_area, 2))),
                ("squares", f3(round_to(squares, 2))),
                ("squaresWithWaste", f3(round_to(squares_with_waste, 2))),
                ("iceShield", f3(round_to(ice_shield_m2, 2))),
                ("vents", f3(round_to(provided_nfva, 3))),
                ("requiredVents", f3(round_to(required_nfva, 3))),
            ]),
        ),
        (
            "layers",
            jobj(&[
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
                ("nailSpacingMm", f3(sheathing.nail_mm)),
            ]),
        ),
        (
            "gutterPackage",
            jobj(&[
                ("gutterLf", f3(round_to(gutter_lf, 1))),
                ("downspouts", f3(downspouts)),
                ("hangers", f3(hangers)),
                ("endCaps", f3(end_caps)),
                ("outlets", f3(outlets)),
                ("elbows", f3(elbows)),
                ("areaPerDownspout", f3(if downspouts > 0.0 { round_to(area / downspouts, 1) } else { 0.0 })),
            ]),
        ),
        (
            "ventilation",
            jobj(&[
                ("ridgeVentM", f3(round_to(ridge_vent_m, 1))),
                ("soffitVentM", f3(round_to(soffit_vent_m, 1))),
                ("providedNfvaM2", f3(round_to(provided_nfva, 3))),
                ("requiredNfvaM2", f3(round_to(required_nfva, 3))),
            ]),
        ),
        (
            "trusses",
            jobj(&[
                ("count", f3(truss_count)),
                ("lumberM", f3(round_to(truss_lumber_m, 1))),
                ("ceilingJoists", f3(ceiling_joists)),
                ("memberLength", f3(round_to(member_length, 3))),
            ]),
        ),
        (
            "costs",
            jobj(&[
                ("material", f3(material_cost)),
                ("labour", f3(labour_cost)),
                ("tearOff", f3(round_to(tear_off_cost, 2))),
                ("install", f3(round_to(install_cost, 2))),
                ("gutter", f3(round_to(gutter_labour, 2))),
                ("flashing", f3(round_to(flashing_labour, 2))),
                ("total", f3(total_cost)),
                ("perSquare", f3(if squares > 0.0 { round_to(total_cost / squares, 2) } else { 0.0 })),
                ("perM2", f3(if area > 0.0 { round_to(total_cost / area, 2) } else { 0.0 })),
                ("rows", jarr(&row_json)),
            ]),
        ),
        ("checks", jarr(&check_json)),
        ("errorCount", errors.to_string()),
        ("warningCount", warnings.to_string()),
    ])
}

// --- landscape -------------------------------------------------------------

const GALLONS_PER_M3: f64 = 264.172;
const SQFT: f64 = FT * FT;

#[derive(Clone, Copy)]
struct WaterDefaults {
    shape: &'static str,
    width: f64,
    length: f64,
    shallow: f64,
    deep: f64,
    deck: f64,
    turnover: f64,
    head: f64,
}

/// `POOL_DEFAULTS` from `features/landscape/design.js`.
fn water_defaults(kind: &str) -> WaterDefaults {
    match kind {
        "spa" => WaterDefaults { shape: "circular", width: 2.4, length: 2.4, shallow: 0.9, deep: 0.9, deck: 1.0, turnover: 0.5, head: 50.0 },
        "fountain" => WaterDefaults { shape: "circular", width: 2.4, length: 2.4, shallow: 0.35, deep: 0.45, deck: 0.6, turnover: 1.0, head: 20.0 },
        "pond" => WaterDefaults { shape: "kidney", width: 3.5, length: 5.0, shallow: 0.45, deep: 0.9, deck: 0.0, turnover: 4.0, head: 10.0 },
        "waterfall" => WaterDefaults { shape: "rectangle", width: 2.4, length: 1.2, shallow: 0.25, deep: 0.4, deck: 0.4, turnover: 0.5, head: 25.0 },
        "water-wall" => WaterDefaults { shape: "rectangle", width: 3.0, length: 0.5, shallow: 0.2, deep: 0.35, deck: 0.4, turnover: 0.5, head: 30.0 },
        _ => WaterDefaults { shape: "rectangle", width: 4.0, length: 9.0, shallow: 1.1, deep: 1.9, deck: 1.22, turnover: 6.0, head: 40.0 },
    }
}

fn water_kind(id: &str) -> &'static str {
    match id {
        "spa" => "spa",
        "fountain" => "fountain",
        "pond" => "pond",
        "waterfall" => "waterfall",
        "water-wall" => "water-wall",
        _ => "pool",
    }
}

fn water_label(kind: &str) -> &'static str {
    match kind {
        "spa" => "Spa / hot tub",
        "fountain" => "Fountain",
        "pond" => "Ornamental pond",
        "waterfall" => "Waterfall",
        "water-wall" => "Water wall",
        _ => "Swimming pool",
    }
}

fn shape_label(shape: &str) -> &'static str {
    match shape {
        "roman" => "Roman (rounded ends)",
        "kidney" => "Kidney",
        "lap" => "Lap pool",
        "circular" => "Circular",
        _ => "Rectangle",
    }
}

/// `surfaceArea`: a circle, the rounded-end rectangle or the kidney's 0.82 factor.
fn surface_area(shape: &str, width: f64, length: f64) -> f64 {
    if shape == "circular" {
        return std::f64::consts::PI * (width / 2.0).powi(2);
    }
    if shape == "roman" {
        let r = width * 0.12;
        return width * length - 4.0 * (1.0 - std::f64::consts::PI / 4.0) * r * r;
    }
    if shape == "kidney" {
        return width * length * 0.82;
    }
    width * length
}

/// `planOutline`: the same polygon the canvas draws, so the perimeter matches.
fn plan_outline(shape: &str, width: f64, length: f64, segments: usize) -> Vec<(f64, f64)> {
    let hw = width / 2.0;
    let hl = length / 2.0;
    let mut points = Vec::new();
    if shape == "circular" {
        for index in 0..segments {
            let a = (index as f64 / segments as f64) * std::f64::consts::PI * 2.0;
            points.push((hw * a.cos(), hw * a.sin()));
        }
        return points;
    }
    if shape == "roman" {
        let r = hw.min(hl) * 0.6;
        let corner = |cx: f64, cz: f64, start: f64, points: &mut Vec<(f64, f64)>| {
            for index in 0..=8 {
                let a = start + (index as f64 / 8.0) * (std::f64::consts::PI / 2.0);
                points.push((cx + r * a.cos(), cz + r * a.sin()));
            }
        };
        corner(hw - r, hl - r, 0.0, &mut points);
        corner(-hw + r, hl - r, std::f64::consts::PI / 2.0, &mut points);
        corner(-hw + r, -hl + r, std::f64::consts::PI, &mut points);
        corner(hw - r, -hl + r, std::f64::consts::PI * 1.5, &mut points);
        return points;
    }
    if shape == "kidney" {
        for index in 0..segments {
            let t = (index as f64 / segments as f64) * std::f64::consts::PI * 2.0;
            let wobble = 1.0 - 0.22 * t.cos().powi(2);
            points.push((hw * t.cos() * wobble, hl * t.sin()));
        }
        return points;
    }
    if shape == "lap" {
        return vec![
            (-hw, -hl), (hw, -hl), (hw, -hl * 0.92), (hw * 0.92, 0.0), (hw, hl * 0.92),
            (hw, hl), (-hw, hl), (-hw, hl * 0.92), (-hw * 0.92, 0.0), (-hw, -hl * 0.92),
        ];
    }
    vec![(-hw, -hl), (hw, -hl), (hw, hl), (-hw, hl)]
}

fn water_perimeter(shape: &str, width: f64, length: f64) -> f64 {
    let points = plan_outline(shape, width, length, 48);
    let mut total = 0.0;
    for index in 0..points.len() {
        let (x1, z1) = points[index];
        let (x2, z2) = points[(index + 1) % points.len()];
        total += ((x2 - x1) * (x2 - x1) + (z2 - z1) * (z2 - z1)).sqrt();
    }
    total
}

/// Sharp-crested weir flow in US gpm.
fn weir_flow_gpm(length: f64, head: f64) -> f64 {
    let length_ft = (length / FT).max(0.01);
    let head_ft = (head / FT).max(0.001);
    let cfs = 3.33 * length_ft * head_ft.powf(1.5);
    cfs * 448.831
}

struct FilterPick {
    area_sqft: f64,
    gpm: f64,
    cost: f64,
}

/// Smallest filter of the chosen media that still covers the design flow.
fn pick_filter(media: &str, flow: f64) -> FilterPick {
    const FILTERS: [(&str, f64, f64, f64); 8] = [
        ("cartridge", 100.0, 25.0, 780.0),
        ("cartridge", 150.0, 37.0, 980.0),
        ("cartridge", 200.0, 50.0, 1180.0),
        ("cartridge", 300.0, 75.0, 1580.0),
        ("de", 36.0, 72.0, 1050.0),
        ("de", 48.0, 96.0, 1280.0),
        ("sand", 3.14, 47.0, 720.0),
        ("sand", 4.91, 73.0, 940.0),
    ];
    let mut best: Option<FilterPick> = None;
    for (family, area, gpm, cost) in FILTERS {
        if family != media {
            continue;
        }
        if gpm >= flow {
            if best.as_ref().map(|entry| area < entry.area_sqft).unwrap_or(true) {
                best = Some(FilterPick { area_sqft: area, gpm, cost });
            }
        } else if best.is_none() {
            best = Some(FilterPick { area_sqft: area, gpm, cost });
        } else if best.as_ref().map(|entry| entry.gpm < flow && area > entry.area_sqft).unwrap_or(false) {
            best = Some(FilterPick { area_sqft: area, gpm, cost });
        }
    }
    best.unwrap_or(FilterPick { area_sqft: 100.0, gpm: 25.0, cost: 780.0 })
}

fn landscape_json(plan: &Json) -> String {
    let landscape = field(plan, "landscape");
    let feature = field(landscape, "feature");
    let kind = water_kind(feature.get("type").and_then(|v| v.text()).unwrap_or("pool"));
    let defaults = water_defaults(kind);
    let other = field(landscape, "site");

    let shape_input = feature.get("shape").and_then(|v| v.text()).unwrap_or(defaults.shape);
    let shape: &'static str = match shape_input {
        "roman" => "roman",
        "kidney" => "kidney",
        "lap" => "lap",
        "circular" => "circular",
        _ => "rectangle",
    };
    let width = clamp(number_or(feature.get("width").unwrap_or(&Json::Null), defaults.width), 0.6, 50.0);
    let length = clamp(number_or(feature.get("length").unwrap_or(&Json::Null), defaults.length), 0.6, 60.0);
    let shallow = clamp(number_or(feature.get("shallow").unwrap_or(&Json::Null), defaults.shallow), 0.15, 6.0);
    let deep = clamp(
        number_or(feature.get("deep").unwrap_or(&Json::Null), defaults.deep.max(shallow + 0.1)),
        shallow,
        6.0,
    );
    let deck = clamp(number_or(feature.get("deck").unwrap_or(&Json::Null), defaults.deck), 0.0, 6.0);

    let area = surface_area(shape, width, length);
    let avg_depth = if kind == "pool" { (shallow + deep) / 2.0 } else { deep };
    let volume = area * avg_depth;
    let gallons = volume * GALLONS_PER_M3;
    let turnover = clamp(number_or(feature.get("turnoverHours").unwrap_or(&Json::Null), defaults.turnover), 0.25, 24.0);
    let flow = gallons / (turnover * 60.0);
    let head = number_or(feature.get("head").unwrap_or(&Json::Null), defaults.head);
    let pump_hp = (flow * head) / (3960.0 * 0.65);
    let bather_area = if avg_depth > 1.4 { 20.0 * SQFT } else { 15.0 * SQFT };
    let bathers = (area / bather_area).floor();
    let weir = if kind == "waterfall" || kind == "water-wall" {
        let weir_length = number_or(feature.get("weirLength").unwrap_or(&Json::Null), width);
        weir_flow_gpm(weir_length, clamp(number_or(feature.get("weirHead").unwrap_or(&Json::Null), 0.006), 0.003, 0.012))
    } else {
        0.0
    };

    let suction = number_or(feature.get("suctionOutlets").unwrap_or(&Json::Null), 2.0).round().max(0.0);
    let jets_default = if kind == "spa" { 6.0 } else if kind == "fountain" { 4.0 } else { 0.0 };
    let jets = number_or(feature.get("jets").unwrap_or(&Json::Null), jets_default).round().max(0.0);
    let jet_flow = jets * 12.0;

    let is_water_body = kind == "pool" || kind == "spa";
    let site_width = number_or(other.get("width").unwrap_or(&Json::Null), (width + 4.0).max(6.0));
    let site_depth = number_or(other.get("depth").unwrap_or(&Json::Null), (length + 5.0).max(8.0));
    let feature_x = clamp(
        number_or(other.get("featureX").unwrap_or(&Json::Null), site_width / 2.0),
        width / 2.0,
        site_width - width / 2.0,
    );
    let feature_z = clamp(
        number_or(other.get("featureZ").unwrap_or(&Json::Null), site_depth / 2.0),
        length / 2.0,
        site_depth - length / 2.0,
    );
    let left = feature_x - width / 2.0;
    let right = site_width - feature_x - width / 2.0;
    let front = feature_z - length / 2.0;
    let back = site_depth - feature_z - length / 2.0;
    let setback = left.min(right).min(front).min(back);

    let deck_slope = number_or(other.get("deckSlopePercent").unwrap_or(&Json::Null), 2.0);
    let overhead = number_or(other.get("overheadClearance").unwrap_or(&Json::Null), 7.62);
    let receptacle = number_or(other.get("receptacleDistance").unwrap_or(&Json::Null), 3.0);
    let equipment = number_or(other.get("equipmentClearance").unwrap_or(&Json::Null), 1.2);
    let flag_of = |key: &str, fallback: bool| -> bool {
        other.get(key).and_then(|value| value.truthy()).unwrap_or(fallback)
    };
    let bonded = flag_of("bonded", true);
    let gfci = flag_of("gfci", true);
    let luminaires_listed = flag_of("luminairesListed", true);
    let emergency_shutoff = flag_of("emergencyShutoff", true);
    let signage = flag_of("signage", true);
    let public_pool = flag_of("publicPool", false);
    let accessible_entry = flag_of("accessibleEntry", false);
    let freeze = flag_of("freezeClimate", false);
    let winterized = flag_of("winterized", false);
    let safety_cover = flag_of("safetyCover", false);
    let heater = flag_of("heater", true);
    let media_input = other.get("filterMedia").and_then(|v| v.text()).unwrap_or("cartridge");
    let media = if media_input == "sand" || media_input == "de" { media_input } else { "cartridge" };
    let media_rate = match media { "sand" => 15.0, "de" => 2.0, _ => 0.25 };
    let skimmers = number_or(other.get("skimmers").unwrap_or(&Json::Null), 1.0);
    let ph = number_or(other.get("ph").unwrap_or(&Json::Null), 7.4);
    let chlorine = number_or(other.get("freeChlorine").unwrap_or(&Json::Null), 2.0);
    let alkalinity = number_or(other.get("alkalinity").unwrap_or(&Json::Null), 100.0);
    let cya = number_or(other.get("cya").unwrap_or(&Json::Null), 40.0);
    let calcium = number_or(other.get("calcium").unwrap_or(&Json::Null), 300.0);

    let mut checks: Vec<(&'static str, &'static str)> = Vec::new();
    let mut push = |id: &'static str, severity: &'static str| checks.push((id, severity));

    if kind == "pool" && shallow < 3.0 * FT - 1e-6 {
        push("depth", "error");
    }
    if kind == "pool" && deep > 8.0 * FT + 1e-6 {
        push("depth-max", "warning");
    }
    if kind == "pool" && turnover > 8.0 {
        push("turnover", "warning");
    }
    if kind == "spa" && number_or(feature.get("waterTempF").unwrap_or(&Json::Null), 102.0) > 104.0 + 1e-6 {
        push("spa-temp", "error");
    }
    if kind == "spa" && deep > 3.0 * FT + 1e-6 {
        push("spa-depth", "warning");
    }
    if kind == "spa" && turnover > 1.0 {
        push("spa-turnover", "warning");
    }
    if kind == "pond" && deep < 24.0 * IN - 1e-6 {
        push("pond-depth", "warning");
    }
    if kind == "water-wall" && deep < 0.15 {
        push("wall-basin", "warning");
    }
    if (kind == "pool" || kind == "spa") && suction < 2.0 {
        push("suction", "error");
    }
    if jet_flow > 0.0 && jet_flow > flow * 1.5 {
        push("jets", "info");
    }
    if setback < 3.0 * FT - 1e-6 {
        push("setback", "error");
    } else if setback < 5.0 * FT - 1e-6 {
        push("setback", "warning");
    }
    let deck_area = ((width + deck * 2.0) * (length + deck * 2.0) - area).max(0.0);
    if is_water_body && deck < 4.0 * FT - 1e-6 {
        push("deck-width", "error");
    }
    if deck > 0.0 && deck_slope < 1.0 {
        push("deck-slope", "error");
    } else if deck > 0.0 && deck_slope < 2.0 {
        push("deck-slope", "warning");
    }
    if is_water_body && deck_slope < 2.0 {
        push("site-drainage", "warning");
    }
    if !bonded {
        push("bonding", "error");
    }
    if !gfci {
        push("gfci", "error");
    }
    if overhead < 25.0 * FT - 1e-6 {
        push("overhead", "error");
    }
    if receptacle < 6.0 * FT - 1e-6 || receptacle > 20.0 * FT + 1e-6 {
        push("receptacle", "error");
    }
    if !luminaires_listed {
        push("luminaire", "error");
    }
    if equipment < 3.0 * FT - 1e-6 {
        push("equipment-access", "warning");
    }
    if public_pool && !accessible_entry {
        push("accessible", "error");
    }
    if freeze && !winterized {
        push("freeze", "warning");
    }
    if freeze && !safety_cover {
        push("cover", "info");
    }
    if kind == "spa" && !emergency_shutoff {
        push("spa-shutoff", "error");
    }
    if kind == "spa" && !signage {
        push("spa-signage", "error");
    }

    let required_filter = flow / media_rate;
    let filter = pick_filter(media, flow);
    if filter.gpm < flow {
        push("filter", "warning");
    }
    let area_sqft = area / SQFT;
    let skimmers_required = (area_sqft / 500.0).ceil().max(1.0);
    if is_water_body && skimmers < skimmers_required {
        push("skimmers", "warning");
    }
    let drain_velocity = if suction > 0.0 { (flow * 0.002228) / (suction * 0.09) } else { 0.0 };
    if is_water_body && drain_velocity > 1.5 {
        push("drain-velocity", "warning");
    }
    let returns = (area_sqft / 120.0).ceil().max(2.0);
    let lights = if is_water_body { (area_sqft / 100.0).ceil().max(1.0) } else { 0.0 };
    let standard_hp = [0.75, 1.0, 1.5, 2.0, 2.5, 3.0]
        .iter()
        .copied()
        .find(|size| *size >= pump_hp)
        .unwrap_or(3.0);
    let heater_btu = if heater {
        (((gallons * 8.34 * 20.0 / 24.0) / 10000.0).ceil()) * 10000.0
    } else {
        0.0
    };
    if ph < 7.2 - 1e-6 || ph > 7.8 + 1e-6 {
        push("chemistry-ph", "warning");
    }
    if chlorine < 1.0 - 1e-6 || chlorine > 5.0 + 1e-6 {
        push("chemistry-chlorine", "warning");
    }
    if alkalinity < 80.0 - 1e-6 || alkalinity > 120.0 + 1e-6 {
        push("chemistry-alkalinity", "warning");
    }
    if cya < 30.0 - 1e-6 || cya > 100.0 + 1e-6 {
        push("chemistry-cya", "warning");
    }
    if calcium < 200.0 - 1e-6 || calcium > 400.0 + 1e-6 {
        push("chemistry-calcium", "warning");
    }

    let perimeter = water_perimeter(shape, width, length);
    let deck_perimeter = perimeter + deck * 8.0;
    let barrier_perimeter = deck_perimeter + 3.0;
    let shell_area = area + perimeter * (avg_depth + 0.25);
    let excavation = area * (avg_depth + 0.35);

    struct Line {
        id: &'static str,
        qty: f64,
        unit: &'static str,
        unit_cost: f64,
    }
    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line { id: "excavation", qty: excavation, unit: "m3", unit_cost: 65.0 });
    lines.push(Line { id: "shell", qty: shell_area, unit: "m2", unit_cost: if kind == "pond" { 55.0 } else { 145.0 } });
    lines.push(Line { id: "coping", qty: perimeter, unit: "m", unit_cost: 65.0 });
    lines.push(Line { id: "deck", qty: deck_area, unit: "m2", unit_cost: 120.0 });
    lines.push(Line { id: "water", qty: volume, unit: "m3", unit_cost: 4.5 });
    lines.push(Line { id: "pump", qty: 1.0, unit: "ea", unit_cost: 650.0 + standard_hp * 520.0 });
    lines.push(Line { id: "filter", qty: 1.0, unit: "ea", unit_cost: filter.cost });
    lines.push(Line { id: "heater", qty: if heater { 1.0 } else { 0.0 }, unit: "ea", unit_cost: 2200.0 });
    lines.push(Line { id: "skimmers", qty: if is_water_body { skimmers } else { 0.0 }, unit: "ea", unit_cost: 360.0 });
    lines.push(Line { id: "covers", qty: if is_water_body { suction.max(2.0) } else { 0.0 }, unit: "ea", unit_cost: 95.0 });
    lines.push(Line { id: "returns", qty: returns, unit: "ea", unit_cost: 45.0 });
    lines.push(Line { id: "lights", qty: lights, unit: "ea", unit_cost: 650.0 });
    lines.push(Line { id: "barrier", qty: barrier_perimeter, unit: "m", unit_cost: 95.0 });
    lines.push(Line { id: "cover", qty: if safety_cover { 1.0 } else { 0.0 }, unit: "ea", unit_cost: round_to((width + 0.6) * (length + 0.6) * 80.0, 0) });
    lines.push(Line { id: "controls", qty: 1.0, unit: "lot", unit_cost: 900.0 });

    let mut bom_rows = Vec::new();
    let mut total = 0.0;
    for line in &lines {
        if !(line.qty > 0.0) {
            continue;
        }
        let line_total = round_to(line.qty * line.unit_cost, 0);
        total += line_total;
        bom_rows.push(jobj(&[
            ("id", jstr(line.id)),
            ("qty", f3(round_to(line.qty, 3))),
            ("unit", jstr(line.unit)),
            ("unitCost", f3(line.unit_cost)),
            ("total", f3(line_total)),
        ]));
    }

    let check_rows: Vec<String> = checks
        .iter()
        .map(|(id, severity)| jobj(&[("id", jstr(id)), ("severity", jstr(severity))]))
        .collect();
    let errors = checks.iter().filter(|(_, severity)| *severity == "error").count();
    let warnings = checks.iter().filter(|(_, severity)| *severity == "warning").count();

    jobj(&[
        ("type", jstr(kind)),
        ("typeLabel", jstr(water_label(kind))),
        ("shape", jstr(shape)),
        ("shapeLabel", jstr(shape_label(shape))),
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
        (
            "clearances",
            jobj(&[
                ("left", f3(round_to(left, 2))),
                ("right", f3(round_to(right, 2))),
                ("front", f3(round_to(front, 2))),
                ("back", f3(round_to(back, 2))),
                ("minimum", f3(round_to(setback, 2))),
            ]),
        ),
        (
            "metrics",
            jobj(&[
                ("perimeter", f3(round_to(perimeter, 2))),
                ("deckArea", f3(round_to(deck_area, 2))),
                ("deckPerimeter", f3(round_to(deck_perimeter, 2))),
                ("barrierPerimeter", f3(round_to(barrier_perimeter, 2))),
                ("setback", f3(round_to(setback, 2))),
                ("filterArea", f3(filter.area_sqft)),
                ("filterRequired", f3(round_to(required_filter, 2))),
                ("skimmers", f3(if is_water_body { skimmers } else { 0.0 })),
                ("skimmersRequired", f3(skimmers_required)),
                ("returns", f3(returns)),
                ("lights", f3(lights)),
                ("drainVelocity", f3(round_to(drain_velocity, 2))),
                ("heaterBtu", f3(heater_btu)),
                ("shellArea", f3(round_to(shell_area, 2))),
                ("excavation", f3(round_to(excavation, 2))),
            ]),
        ),
        ("checks", jarr(&check_rows)),
        ("errorCount", errors.to_string()),
        ("warningCount", warnings.to_string()),
        ("bom", jarr(&bom_rows)),
        ("total", f3(total)),
    ])
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
    let plumbing = plumbing_json(plan);
    let lighting = lighting_json(plan);
    let landscape = landscape_json(plan);

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
                ("design", roof_design_json(plan)),
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
        ("plumbing", plumbing),
        ("lighting", lighting),
        ("landscape", landscape),
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
