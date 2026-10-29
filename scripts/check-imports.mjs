/**
 * Checks for the clean-room import and BIM modules:
 *   features/import/dxf.js   CAD linework -> plan walls
 *   features/import/geo.js   KML/KMZ/GeoJSON -> local metres
 *   features/bim/takeoff.js  IFC classes -> quantities and CSV
 *
 * Every fixture is generated here, so the checks run offline and pin the
 * parsing rules rather than a sample file's quirks.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
    dxfToPlan,
    dxfToSegments,
    readDxfRecords,
    segmentBounds,
    INS_UNITS
} from '../features/import/dxf.js';
import {
    fitFeaturesToSite,
    parseGeoFile,
    parseGeoJson,
    parseKml,
    projectFeatures,
    readKmzDocument
} from '../features/import/geo.js';
import {
    bimStudioPanel,
    bimTakeoff,
    bimTakeoffCsv,
    bimTakeoffSnapshot,
    fixtureAreaM2,
    ifcClassFor,
    openingsFromPlan,
    wallQuantities
} from '../features/bim/takeoff.js';

let pass = 0;
const failures = [];
const check = (name, condition, detail = '') => {
    if (condition) {
        pass += 1;
        console.log(`  ok  ${name}`);
    } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
};

const near = (a, b, tolerance = 1e-6) => Math.abs(Number(a) - Number(b)) <= tolerance;

// --- DXF fixtures ---------------------------------------------------------

const dxf = (body, { units = 4, measurement = 1, extraHeader = '' } = {}) => `0
SECTION
2
HEADER
9
$INSUNITS
70
${units}
9
$MEASUREMENT
70
${measurement}
${extraHeader}0
ENDSEC
0
SECTION
2
ENTITIES
${body}0
ENDSEC
0
EOF`;

const line = (x1, y1, x2, y2, layer = 'WALLS') => `0
LINE
8
${layer}
10
${x1}
20
${y1}
11
${x2}
21
${y2}
`;

const polyline = (points, closed = false) => `0
LWPOLYLINE
8
WALLS
90
${points.length}
70
${closed ? 1 : 0}
${points.map(([x, y]) => `10\n${x}\n20\n${y}`).join('\n')}
`;

const circle = (cx, cy, r) => `0
CIRCLE
8
WALLS
10
${cx}
20
${cy}
40
${r}
`;

const arc = (cx, cy, r, start, end) => `0
ARC
8
WALLS
10
${cx}
20
${cy}
40
${r}
50
${start}
51
${end}
`;

const ellipse = (cx, cy, majorX, majorY, ratio) => `0
ELLIPSE
8
WALLS
10
${cx}
20
${cy}
11
${majorX}
21
${majorY}
40
${ratio}
41
0
42
6.283185307
`;

console.log('\nDXF header and units');
check('the header exposes $INSUNITS', readDxfRecords(dxf(line(0, 0, 1000, 0))).header.insUnits === 4);
check('millimetres are 0.001 m', INS_UNITS[4].metres === 0.001);
const millimetre = dxfToSegments(dxf(line(0, 0, 5000, 0)));
check('a 5000 mm line is 5 m', near(millimetre.segments[0].b.x - millimetre.segments[0].a.x, 5, 1e-9), JSON.stringify(millimetre.segments[0]));
check('the unit label is reported', millimetre.units.label === 'mm', JSON.stringify(millimetre.units));

const imperial = dxfToSegments(dxf(line(0, 0, 120, 0), { units: 1 }));
check('a 120 in line is 3.048 m', near(imperial.segments[0].b.x - imperial.segments[0].a.x, 3.048, 1e-9));
const feet = dxfToSegments(dxf(line(0, 0, 10, 0), { units: 2 }));
check('a 10 ft line is 3.048 m', near(feet.segments[0].b.x - feet.segments[0].a.x, 3.048, 1e-9));

const unitless = dxfToSegments(dxf(line(0, 0, 5000, 0), { units: 0 }));
check('a unitless drawing is assumed to be metres', near(unitless.segments[0].b.x, 5000, 1e-9));
const overridden = dxfToSegments(dxf(line(0, 0, 5000, 0), { units: 0 }), { unitScale: 0.001 });
check('unitScale overrides a unitless header', near(overridden.segments[0].b.x, 5, 1e-9));
check('the override is labelled custom', overridden.units.label === 'custom');

console.log('\nDXF entities');
const closedPolyline = dxfToSegments(dxf(polyline([[0, 0], [4000, 0], [4000, 3000], [0, 3000]], true)));
check('a closed LWPOLYLINE becomes four segments', closedPolyline.segments.length === 4, `${closedPolyline.segments.length}`);
check('the closing segment goes back to the start',
    near(closedPolyline.segments[3].b.x, 0, 1e-9) && near(closedPolyline.segments[3].b.y, 0, 1e-9));

const openPolyline = dxfToSegments(dxf(polyline([[0, 0], [1000, 0], [1000, 1000]], false)));
check('an open LWPOLYLINE has one segment fewer', openPolyline.segments.length === 2, `${openPolyline.segments.length}`);

const heavyPolyline = `0
POLYLINE
8
WALLS
70
0
0
VERTEX
8
WALLS
10
0
20
0
0
VERTEX
8
WALLS
10
2000
20
0
0
VERTEX
8
WALLS
10
2000
20
2000
0
SEQEND
8
WALLS
`;
const oldPolyline = dxfToSegments(dxf(heavyPolyline));
check('a POLYLINE reads its VERTEX entities', oldPolyline.segments.length === 2, `${oldPolyline.segments.length}`);
check('vertices are not counted as separate entities', oldPolyline.stats.lines === 0 && oldPolyline.stats.polylines === 1, JSON.stringify(oldPolyline.stats));

const quarterArc = dxfToSegments(dxf(arc(0, 0, 1000, 0, 90)));
check('an arc is flattened into chords', quarterArc.segments.length >= 4, `${quarterArc.segments.length}`);
check('the arc starts at 0 degrees',
    near(quarterArc.segments[0].a.x, 1, 1e-3) && near(quarterArc.segments[0].a.y, 0, 1e-3),
    JSON.stringify(quarterArc.segments[0].a));
const arcEnd = quarterArc.segments[quarterArc.segments.length - 1].b;
check('the arc ends at 90 degrees', near(arcEnd.x, 0, 0.02) && near(arcEnd.y, 1, 0.02), JSON.stringify(arcEnd));

const fullCircle = dxfToSegments(dxf(circle(0, 0, 500)));
check('a circle comes in closed',
    near(fullCircle.segments[0].a.x, fullCircle.segments[fullCircle.segments.length - 1].b.x, 1e-6)
    && near(fullCircle.segments[0].a.y, fullCircle.segments[fullCircle.segments.length - 1].b.y, 1e-6));
check('the circle radius is preserved', near(Math.hypot(fullCircle.segments[0].a.x, fullCircle.segments[0].a.y), 0.5, 1e-6));

const fullEllipse = dxfToSegments(dxf(ellipse(0, 0, 2000, 0, 0.5)));
check('an ellipse is flattened', fullEllipse.segments.length >= 8, `${fullEllipse.segments.length}`);
check('the ellipse major axis is preserved',
    near(Math.max(...fullEllipse.segments.flatMap((s) => [Math.abs(s.a.x), Math.abs(s.b.x)])), 2, 1e-6));

console.log('\nDXF cleaning and placement');
const duplicate = dxfToSegments(dxf(line(0, 0, 2000, 0) + line(2000, 0, 0, 0)));
check('a reversed duplicate is dropped', duplicate.segments.length === 1, `${duplicate.segments.length}`);
const sliver = dxfToSegments(dxf(line(0, 0, 5, 0)));
check('a sub-threshold sliver is dropped', sliver.segments.length === 0, `${sliver.segments.length}`);

const plan = dxfToPlan(dxf(polyline([[0, 0], [4000, 0], [4000, 3000], [0, 3000]], true)), {
    view: { width: 1000, height: 800 }
});
check('the import produces walls', plan.walls.length === 4, `${plan.walls.length}`);
const planBounds = segmentBounds(plan.walls.map((wall) => ({ a: wall.start, b: wall.end })));
check('the drawing is centred in the view',
    near((planBounds.minX + planBounds.maxX) / 2, 500, 0.01) && near((planBounds.minY + planBounds.maxY) / 2, 400, 0.01),
    JSON.stringify(planBounds));
check('a drawing that fits is not scaled', plan.scale === 1, `${plan.scale}`);
const topWall = plan.walls[0];
check('CAD y-up is flipped to plan y-down',
    near(topWall.start.y, planBounds.maxY, 1e-6),
    JSON.stringify({ wall: topWall, bounds: planBounds }));

const oversized = dxfToPlan(dxf(line(0, 0, 100000, 0)), { view: { width: 900, height: 600 }, fit: 0.9 });
check('an oversized drawing is fitted to the view', oversized.scale < 1, `${oversized.scale}`);
const oversizedWidth = Math.hypot(oversized.walls[0].end.x - oversized.walls[0].start.x, oversized.walls[0].end.y - oversized.walls[0].start.y);
check('the fitted width stays inside the view', oversizedWidth <= 900 * 0.9 + 0.01, `${oversizedWidth}`);

const withInsert = dxfToPlan(dxf(`0
INSERT
8
SYMBOL
2
TREE
10
0
20
0
`));
check('INSERTs are counted, not guessed', withInsert.stats.inserts === 1 && withInsert.walls.length === 0, JSON.stringify(withInsert.stats));
check('a skipped block is explained', withInsert.warnings.some((warning) => /block insertion/.test(warning)), withInsert.warnings.join(' | '));

const withSpline = dxfToPlan(dxf(`0
SPLINE
8
CURVES
`));
check('an unsupported entity is reported', withSpline.stats.unsupported === 1, JSON.stringify(withSpline.stats));

const empty = dxfToPlan('');
check('an empty file yields no walls', empty.walls.length === 0 && empty.bounds === null);
check('an empty file explains itself', empty.warnings.some((warning) => /no lines/.test(warning)), empty.warnings.join(' | '));

// --- Geo fixtures ---------------------------------------------------------

const geojson = JSON.stringify({
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', properties: { name: 'Boundary' }, geometry: { type: 'Polygon', coordinates: [[[-77.0, -12.0], [-76.999, -12.0], [-76.999, -11.999], [-77.0, -12.0]]] } },
        { type: 'Feature', properties: { name: 'Drive' }, geometry: { type: 'LineString', coordinates: [[-77.0, -12.0], [-76.998, -12.0]] } },
        { type: 'Feature', properties: { name: 'Gate' }, geometry: { type: 'Point', coordinates: [-77.0, -12.0] } }
    ]
});

console.log('\nGeoJSON');
const geoFeatures = parseGeoJson(geojson);
check('every GeoJSON feature is read', geoFeatures.length === 3, `${geoFeatures.length}`);
check('the line keeps both ends', geoFeatures.find((entry) => entry.kind === 'line')?.rings[0].length === 2);
check('the polygon ring is read', geoFeatures.find((entry) => entry.kind === 'polygon')?.rings[0].length === 4);
check('a point is a one-point ring', geoFeatures.find((entry) => entry.kind === 'point')?.rings[0].length === 1);
check('names survive', geoFeatures.some((entry) => entry.name === 'Boundary'));
check('invalid JSON yields no features', parseGeoJson('{not json').length === 0);

const projected = projectFeatures([{ name: 'pair', kind: 'line', rings: [[{ lon: -77, lat: -12 }, { lon: -77, lat: -11.999 }]] }]);
const projectedLength = Math.hypot(
    projected.features[0].rings[0][1].x - projected.features[0].rings[0][0].x,
    projected.features[0].rings[0][1].y - projected.features[0].rings[0][0].y
);
check('0.001 degrees of latitude projects to ~110.5 m', near(projectedLength, 110.54, 0.1), `${projectedLength}`);

const site = fitFeaturesToSite([
    { name: 'site', kind: 'polygon', rings: [[{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }]] }
], { width: 20, depth: 20, margin: 1 });
check('an oversized site is scaled down', site.scale < 1, `${site.scale}`);
const sitePoints = site.features[0].rings[0];
check('the fitted site stays inside the rectangle',
    sitePoints.every((point) => point.x >= 0 && point.x <= 20 && point.z >= 0 && point.z <= 20),
    JSON.stringify(sitePoints));
check('north is up in site coordinates', sitePoints[0].z > sitePoints[2].z, JSON.stringify(sitePoints));

const trueSize = fitFeaturesToSite([
    { name: 'boundary', kind: 'polygon', rings: [[{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }]] }
], { width: 20, depth: 20, fit: false });
const trueRing = trueSize.features[0].rings[0];
check('fit:false keeps a surveyed boundary at its real size',
    trueSize.scale === 1 && Math.max(...trueRing.map((point) => point.x)) - Math.min(...trueRing.map((point) => point.x)) === 200,
    JSON.stringify({ scale: trueSize.scale, ring: trueRing }));
check('fit:false still centres the boundary',
    near((Math.min(...trueRing.map((point) => point.x)) + Math.max(...trueRing.map((point) => point.x))) / 2, 10),
    JSON.stringify(trueRing));

console.log('\nKML and KMZ');
const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>Alignment</name><LineString><coordinates>
    -77,-12,0 -76.999,-12,0 -76.999,-11.999,0
  </coordinates></LineString></Placemark>
  <Placemark><name>Site</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
    -77,-12 -76.999,-12 -76.999,-11.999 -77,-12
  </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  <Placemark><name>Gate</name><Point><coordinates>-77,-12,0</coordinates></Point></Placemark>
</Document></kml>`;
const kmlFeatures = parseKml(kml);
check('KML placemarks are read', kmlFeatures.length === 3, `${kmlFeatures.length}`);
check('KML altitutes are ignored', kmlFeatures.find((entry) => entry.kind === 'line')?.rings[0].length === 3);
check('the KML name is kept', kmlFeatures.some((entry) => entry.name === 'Alignment'));
check('a KML polygon reads its outer ring', kmlFeatures.find((entry) => entry.kind === 'polygon')?.rings[0].length === 4);

// A minimal ZIP writer: one stored entry and one deflated entry, enough for the
// reader (which does not verify CRCs).
function zipSingle(name, data, method = 0) {
    const nameBytes = new TextEncoder().encode(name);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, 0, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, 0, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, 0, true);
    central.set(nameBytes, 46);

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(8, 1, true);
    eocdView.setUint16(10, 1, true);
    eocdView.setUint32(12, central.length, true);
    eocdView.setUint32(16, local.length, true);

    const out = new Uint8Array(local.length + central.length + eocd.length);
    out.set(local, 0);
    out.set(central, local.length);
    out.set(eocd, local.length + central.length);
    return out;
}

const kmlBytes = new TextEncoder().encode(kml);
const storedKmz = await readKmzDocument(zipSingle('doc.kml', kmlBytes));
check('a stored KMZ entry is read', storedKmz.includes('<Placemark>'));
const deflated = zipSingle('doc.kml', new Uint8Array(deflateRawSync(Buffer.from(kmlBytes))), 8);
const inflatedKmz = await readKmzDocument(deflated, { inflate: (bytes) => new Uint8Array(inflateRawSync(Buffer.from(bytes))) });
check('a deflated KMZ entry is inflated', inflatedKmz.includes('Alignment'));

let kmzError = '';
try {
    await readKmzDocument(new Uint8Array([1, 2, 3, 4]));
} catch (error) {
    kmzError = error.message;
}
check('a non-ZIP is rejected with a reason', /ZIP archive/.test(kmzError), kmzError);

const byName = await parseGeoFile({ name: 'site.geojson', text: geojson });
check('parseGeoFile dispatches GeoJSON', byName.length === 3, `${byName.length}`);
const byKmlName = await parseGeoFile({ name: 'site.kml', text: '' });
check('an unknown KML payload yields no features', byKmlName.length === 0);

// --- BIM quantities -------------------------------------------------------

console.log('\nBIM quantities');
check('a wall maps to IfcWall', ifcClassFor('wall') === 'IfcWall');
check('a window maps to IfcWindow', ifcClassFor('window') === 'IfcWindow');
check('an unknown type is a proxy', ifcClassFor('mystery') === 'IfcBuildingElementProxy');

const wall = { id: 'w1', start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, thickness: 10 };
const wallQty = wallQuantities(wall);
check('a 300 px wall is 10 m', near(wallQty.lengthM, 10), `${wallQty.lengthM}`);
check('the default height is 2.7 m', near(wallQty.heightM, 2.7));
check('gross area is length x height', near(wallQty.grossAreaM2, 27));
check('volume uses the wall thickness', near(wallQty.volumeM3, 9, 1e-9), `${wallQty.volumeM3}`);
const tallWall = wallQuantities({ ...wall, height: 3.2 }, {});
check('a per-wall height wins over the storey height', near(tallWall.heightM, 3.2));

const cabinet = { type: 'kitchen_cabinet', metadata: { width: 0.6, depth: 0.6 } };
check('a cabinet footprint is measured', near(fixtureAreaM2(cabinet), 0.36, 1e-9), `${fixtureAreaM2(cabinet)}`);

const takeoff = bimTakeoff({
    walls: [
        { id: 'w1', start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, thickness: 10 },
        { id: 'w2', start: { x: 0, y: 300 }, end: { x: 0, y: 0 }, thickness: 10 }
    ],
    openings: [
        { id: 'o1', wallId: 'w1', areaM2: 2, type: 'window', name: 'Window 1' },
        { id: 'o2', wallId: 'w2', areaM2: 1.9, type: 'door', name: 'Door 1' }
    ],
    fixtures: [
        { type: 'kitchen_cabinet', metadata: { width: 0.6, depth: 0.6 } },
        { type: 'kitchen_cabinet', metadata: { width: 0.6, depth: 0.6 } },
        { type: 'ceiling_light', metadata: { width: 0.2, depth: 0.2 } }
    ]
});
check('the takeoff reports each wall', takeoff.rows.filter((row) => row.ifcClass === 'IfcWall').length === 2);
check('openings are deducted from their wall',
    takeoff.rows.find((row) => row.name === 'w1')?.areaM2 === 25,
    JSON.stringify(takeoff.rows.find((row) => row.name === 'w1')));
check('openings get their own IFC line', takeoff.rows.some((row) => row.ifcClass === 'IfcWindow'));
check('doors are classified', takeoff.rows.some((row) => row.ifcClass === 'IfcDoor'));
check('fixtures aggregate by class',
    takeoff.rows.find((row) => row.ifcClass === 'IfcFurniture')?.count === 2,
    JSON.stringify(takeoff.rows.find((row) => row.ifcClass === 'IfcFurniture')));
check('a light is an IfcLightFixture', takeoff.rows.some((row) => row.ifcClass === 'IfcLightFixture'));
check('totals sum the net wall area', near(takeoff.totals.netAreaM2, 50.1), `${takeoff.totals.netAreaM2}`);
check('totals count the openings', takeoff.totals.openings === 2);
check('totals count the fixtures', takeoff.totals.fixtures === 3);
check('byClass rolls up the classes', near(takeoff.byClass.IfcWall.areaM2, 50.1), JSON.stringify(takeoff.byClass.IfcWall));

const looseOpening = bimTakeoff({
    walls: [{ id: 'w1', start: { x: 0, y: 0 }, end: { x: 300, y: 0 } }],
    openings: [{ areaM2: 2, type: 'window' }]
});
check('an unattached opening is explained', looseOpening.warnings.some((warning) => /not attached/.test(warning)), looseOpening.warnings.join(' | '));

const overOpening = bimTakeoff({
    walls: [{ id: 'w1', start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, height: 1 }],
    openings: [{ wallId: 'w1', areaM2: 99, type: 'door' }]
});
check('openings larger than the wall are flagged', overOpening.warnings.some((warning) => /exceed/.test(warning)), overOpening.warnings.join(' | '));
check('the deducted area never goes negative', overOpening.rows.find((row) => row.name === 'w1')?.areaM2 === 0);

const csv = bimTakeoffCsv([{ ifcClass: 'IfcWall', name: 'Wall, "north"', count: 1, lengthM: 10, areaM2: 27, volumeM3: 9 }]);
check('the CSV has a header', csv.startsWith('IfcClass,Name,Count,LengthM,AreaM2,VolumeM3'));
check('the CSV quotes commas and quotes', csv.includes('"Wall, ""north"""'), csv);
check('the CSV ends with a newline', csv.endsWith('\n'));

const emptyTakeoff = bimTakeoff({});
check('an empty plan has no rows', emptyTakeoff.rows.length === 0 && emptyTakeoff.totals.walls === 0);

console.log('\nPlan-driven takeoff');
const boundFixture = (type, wallId, width, height) => ({
    type,
    boundToWallId: wallId,
    x: 50,
    y: 0,
    metadata: { width, height }
});
const planWalls = [{ id: 'w1', start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, thickness: 10 }];
const planFixtures = [boundFixture('door', 'w1', 0.9, 2.1), boundFixture('window', 'w1', 1.2, 1.0)];
const planOpenings = openingsFromPlan(planWalls, planFixtures);
check('a bound door becomes an opening', planOpenings.length === 2, `${planOpenings.length}`);
check('the door area is width x height', near(planOpenings[0].areaM2, 1.89, 1e-9), `${planOpenings[0].areaM2}`);
check('the opening keeps its wall', planOpenings.every((opening) => opening.wallId === 'w1'));
check('a loose fixture is not an opening', openingsFromPlan(planWalls, [{ type: 'door', x: 0, y: 0 }]).length === 0);

const planSnapshot = bimTakeoffSnapshot({ walls: planWalls, fixtures: planFixtures });
check('the plan takeoff derives its own openings', planSnapshot.openings.length === 2);
check('the bound openings are deducted', near(planSnapshot.takeoff.rows[0].areaM2, 27 - 1.89 - 1.2), `${planSnapshot.takeoff.rows[0].areaM2}`);
check('the storey height is passed through', near(bimTakeoffSnapshot({ walls: planWalls, storeyHeight: 3 }).takeoff.rows[0].areaM2, 30));

const emptyPanel = bimStudioPanel({});
check('an empty drawing reports an empty panel', emptyPanel.empty === true && emptyPanel.rows.length === 0);
check('the empty panel points at the drawing', /Draw walls/.test(emptyPanel.detail), emptyPanel.detail);
check('the panel exports and rebuilds', emptyPanel.actions.map((action) => action.id).join(',') === 'bim-refresh,bim-csv');

const panel = bimStudioPanel({ walls: planWalls, fixtures: planFixtures });
check('the panel is the BIM system', panel.id === 'bim' && panel.label === 'BIM');
check('the headline counts walls, area and volume', /^1 wall · 23\.91 m² · 7\.97 m³$/.test(panel.headline), panel.headline);
check('the panel carries the quantity rows', panel.rows.length === 6, `${panel.rows.length}`);
check('the panel is ready when every opening is bound', panel.ok === true, JSON.stringify(panel.checks));
check('the detail names the IFC classes', /IfcWall/.test(panel.detail), panel.detail);

const warnedPanel = bimStudioPanel({
    walls: planWalls,
    openings: [{ areaM2: 2, type: 'window' }]
});
check('an unattached opening makes the panel a warning', warnedPanel.ok === false && warnedPanel.warnings === 1);
check('the warning is in the checks', warnedPanel.checks[0].severity === 'warn');

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
