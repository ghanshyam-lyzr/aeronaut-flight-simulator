// The five airports of the outer regions: built on the surveyed sites, graded the
// same in the collider and the GLSL twin, flyable both ways, rated for every
// aircraft and wired into the selection, missions and the chart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groundHeight, groundShader, hash } from '../src/terrain.js';
import { AIRPORT_SITES, WATER_LEVEL, VILLAGES, regionAt } from '../src/regions.js';
import { runwayCoordinates, runwayPoint } from '../src/airfield.js';
import { AIRPORTS, GRADED_AIRPORTS, airportById, runwayDirection, footprint, inProtectedArea, suitability, aircraftFor } from '../src/airports.js';
import { AirportSelection, resolveAirport, missionAvailability, describeField } from '../src/airport-selection.js';
import { LandingMission, TOUCHDOWN_ZONE } from '../src/landing-mission.js';
import { navigationDestination, mapAirports } from '../src/navigation.js';
import { normalizeSettings, loadSettings, saveSettings } from '../src/settings.js';
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { outerTrees } from '../src/world.js';
import { WORLD } from '../src/regions.js';

const IDS = ['calmeterre-international', 'aurin-cote', 'port-aurin', 'sorre-meadow', 'vauclair-altiport'];
const OUTER = IDS.map(airportById);
const close = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;

function glslAsJs() {
  const body = groundShader.replace(/^float groundHash[^\n]*\n/m, '')
    .replace(/\bfloat (\w+)\(([^)]*)\)\s*\{/g, (_, name, args) => `function ${name}(${args.replace(/\bfloat /g, '')}) {`)
    .replace(/\bfloat /g, 'let ');
  const prelude = `const {abs,min,max,sin,exp,floor,sqrt}=Math; const clamp=(x,a,b)=>min(b,max(a,x)), mix=(a,b,t)=>a+(b-a)*t, vec2=(a,b)=>[a,b], length=v=>sqrt(v[0]*v[0]+v[1]*v[1]);`;
  return new Function('groundHash', `${prelude}\n${body}\nreturn groundHeight;`)(hash);
}

// The landing tests' deterministic feedback pilot: ordinary rate inputs only.
function fly(flight, mission) {
  const s = flight.state, p = mission.profile, f = mission.field, inputs = new FlightInputs(0);
  for (let frame = 1; frame < 90 * 60 && mission.active; frame++) {
    const height = s.position.y - f.elevation - p.clearance;
    const sink = height < 8 ? Math.min(1.8, p.maxSink * 0.65) : p.speed * p.slope;
    const idleSink = p.helicopter ? 0 : Math.max(0, 0.32 - s.spool) * (flight.type.flight.idleSink ?? 6);
    const desiredPitch = p.helicopter ? 0 : Math.asin((-sink + idleSink) / Math.max(s.speed, 1));
    inputs.set({ pitch: (desiredPitch - s.pitch) * 4, throttle: s.grounded || (p.helicopter && s.throttle > p.throttle - 0.03) ? -1 : 0 }, (frame - 1) / 60);
    inputs.advance(frame / 60, (step, c) => { if (!mission.active) return; flight.update(step, c); mission.update(step, s); });
  }
}

test('the five outer fields are the surveyed sites, with their own names, idents and runways', () => {
  assert.equal(AIRPORTS.length, 10);
  assert.deepEqual(OUTER.map(a => a.ident), ['QACI', 'QAAC', 'QAPA', 'QASM', 'QAPV']);
  for (const site of AIRPORT_SITES) {
    const a = airportById(site.id);
    for (const key of ['name', 'kind', 'region', 'x', 'z', 'elevation', 'runwayLength', 'runwayWidth', 'surface']) assert.equal(a[key], site[key], `${site.id}.${key}`);
    assert.ok(close(a.heading, site.heading, 1e-12), site.id);
    assert.deepEqual(a.apron, site.apron);
    assert.equal(regionAt(a.x, a.z).id, a.region);
    assert.ok(a.summary.length > 20 && a.caution.length > 10, `${a.id} describes itself`);
  }
  // The published designators and thresholds (docs/world-scale.md).
  const published = { 'calmeterre-international': ['01', '19', [57861, 6094], [58139, 2906]], 'aurin-cote': ['10', '28', [9523, 43740], [12477, 44260]],
    'port-aurin': ['09', '27', [-8397, 45578], [-6603, 45422]], 'sorre-meadow': ['02', '20', [-49154, 23423], [-48846, 22577]],
    'vauclair-altiport': ['10', '28', [-4598, -50052], [-3402, -49948]] };
  for (const [id, [rw, rec, t1, t2]] of Object.entries(published)) {
    const a = airportById(id);
    assert.deepEqual([a.runway, a.reciprocal], [rw, rec], id);
    for (const [r, [x, z]] of [[a.runways[0], t1], [a.runways[1], t2]]) assert.ok(Math.abs(r.threshold.x - x) < 1 && Math.abs(r.threshold.z - z) < 1, `${id} ${r.designator} threshold`);
  }
  // Every field is graded except Alpine Field's legacy ellipse; the long fields and the port are lit.
  assert.equal(GRADED_AIRPORTS.length, 9);
  assert.deepEqual(OUTER.filter(a => a.lit).map(a => a.id), ['calmeterre-international', 'aurin-cote', 'port-aurin', 'vauclair-altiport']);
});

test('the original five fields are untouched', () => {
  assert.deepEqual(AIRPORTS.slice(0, 5).map(a => [a.id, a.ident, a.x, a.z, a.elevation, a.runway, a.reciprocal, a.runwayLength, a.runwayWidth, a.surface, a.lit]), [
    ['alpine-field', 'QAAF', 900, -1800, 78, '36', '18', 1100, 53, 'asphalt', true],
    ['orvane-regional', 'QAOR', 21000, -2000, 1058, '14', '32', 2600, 45, 'asphalt', true],
    ['verdance-meadow', 'QAVM', -23900, -3100, 440, '35', '17', 900, 30, 'grass', false],
    ['serein-lakeside', 'QASL', 1390, 15540, 42, '16', '34', 1400, 30, 'asphalt', true],
    ['brume-col', 'QACB', -11350, 2350, 1142, '11', '29', 650, 18, 'asphalt', false]]);
});

test('grading: flat over runway, apron and margin; CPU and GLSL agree over the whole footprint and both approaches', () => {
  const shader = glslAsJs();
  for (const a of OUTER) {
    const g = GRADED_AIRPORTS.find(g => g.airport === a);
    let worst = 0;
    // The flat box (footprint + margin) is exactly at field elevation; the blend and its corners agree with the twin.
    for (let along = -g.halfAlong - g.blendAlong; along <= g.halfAlong + g.blendAlong; along += 45) for (let cross = -g.halfCross - g.blendCross; cross <= g.halfCross + g.blendCross; cross += 35) {
      const x = a.x + (along + g.along) * g.sin + (cross + g.cross) * g.cos, z = a.z - (along + g.along) * g.cos + (cross + g.cross) * g.sin, h = groundHeight(x, z);
      worst = Math.max(worst, Math.abs(shader(x, z) - h));
      if (Math.abs(along) <= g.halfAlong && Math.abs(cross) <= g.halfCross) assert.equal(h, a.elevation, `${a.id} flat at ${along}, ${cross}`);
    }
    // Both extended centrelines to 8 km, and 150 m either side.
    for (const end of [0, a.runwayLength]) for (let d = 0; d <= 8000; d += 50) for (const cross of [-150, 0, 150]) {
      const p = runwayPoint(end ? end + d : -d, cross, a);
      worst = Math.max(worst, Math.abs(shader(p.x, p.z) - groundHeight(p.x, p.z)));
    }
    assert.ok(worst < 1e-6, `${a.id}: GLSL differs by ${worst} m`);
    // Dry: the whole footprint is above the water plane.
    const f = footprint(a);
    for (let along = f.along[0]; along <= f.along[1]; along += 50) for (let cross = f.cross[0]; cross <= f.cross[1]; cross += 25) {
      const p = runwayPoint(along, cross, a); assert.ok(groundHeight(p.x, p.z) > WATER_LEVEL + 8, `${a.id} dry at ${along}, ${cross}`);
    }
  }
});

test('approaches: both directions keep a 3° path clear of the graded ground', () => {
  for (const a of OUTER) for (const rw of [a.runway, a.reciprocal]) {
    const d = runwayDirection(a, rw);
    for (let distance = 300; distance <= 8000; distance += 50) {
      const centre = runwayPoint(-distance, 0, d), path = d.elevation + Math.tan(3 * Math.PI / 180) * distance;
      // On the centreline: 30 m clear from 800 m out to 8 km, as surveyed, and 10 m clear closer in.
      assert.ok(path - groundHeight(centre.x, centre.z) > (distance >= 800 ? 30 : 10), `${a.id} ${rw}: centreline at ${distance} m`);
      // 75 m either side, out to 4 km (the original fields' test), stays 15 m below the path.
      if (distance <= 4000) for (const cross of [-75, 75]) { const p = runwayPoint(-distance, cross, d); assert.ok(path - groundHeight(p.x, p.z) > 15, `${a.id} ${rw}: ${cross} m at ${distance} m`); }
    }
  }
  // Aurin Côte 10 is the one final with high ground beside it beyond 4 km: the
  // Divide's flank reaches within 300 m of the centreline, and its caution says so.
  const aurin = airportById('aurin-cote'), flank = runwayPoint(-4500, -300, aurin);
  assert.ok(groundHeight(flank.x, flank.z) > aurin.elevation + Math.tan(3 * Math.PI / 180) * 4500);
  assert.match(aurin.caution, /runway 10/);
});

test('trees, houses and roads keep clear of the new fields', () => {
  const cell = (x, z) => [Math.floor((x - WORLD.minX) / WORLD.tileSize), Math.floor((z - WORLD.minZ) / WORLD.tileSize)];
  for (const a of OUTER) {
    const cells = new Set();
    for (const along of [-1500, 0, a.runwayLength / 2, a.runwayLength, a.runwayLength + 1500]) { const p = runwayPoint(along, 0, a); cells.add(cell(p.x, p.z).join()); }
    let checked = 0;
    for (const key of cells) {
      const [i, j] = key.split(',').map(Number);
      for (const [x, , z] of outerTrees(i, j)) { assert.ok(!inProtectedArea(a, x, z), `${a.id}: tree at ${x.toFixed(0)}, ${z.toFixed(0)}`); checked++; }
    }
    assert.ok(checked > 0, `${a.id}: the cells around it are planted`);
    for (const [x, z] of VILLAGES) assert.ok(!inProtectedArea(a, x, z), `${a.id} village at ${x}, ${z}`);
  }
});

test('suitability: the long fields take everything, the others refuse with a reason', () => {
  const rating = (id, aircraft) => suitability(airportById(id), aircraft).rating;
  for (const id of ['calmeterre-international', 'aurin-cote']) {
    assert.deepEqual(aircraftFor(airportById(id)).unsuitable, [], id);
    for (const jet of ['widebody', 'airliner', 'regional', 'fighter', 'cargo']) assert.equal(rating(id, jet), 'recommended', `${id} ${jet}`);
  }
  // Port d'Aurin: 1,800 × 30 m paved takes the 737 but is too narrow for the widebody.
  assert.equal(rating('port-aurin', 'airliner'), 'recommended');
  assert.equal(rating('port-aurin', 'widebody'), 'unsuitable');
  assert.match(suitability(airportById('port-aurin'), 'widebody').reason, /45 m wide/);
  // Sorre Meadow is grass: no paved-only aircraft, and too short for the cargo transport.
  for (const id of ['jet', 'airliner', 'widebody', 'cityliner', 'canard', 'regional', 'fighter']) assert.equal(rating('sorre-meadow', id), 'unsuitable', id);
  assert.match(suitability(airportById('sorre-meadow'), 'jet').reason, /paved/);
  assert.match(suitability(airportById('sorre-meadow'), 'cargo').reason, /1,000 m/);
  for (const id of ['trainer', 'bush', 'biplane', 'utility', 'motorglider', 'helicopter', 'transport']) assert.equal(rating('sorre-meadow', id), 'recommended', id);
  // Plan de Vauclair: light and short-field aircraft; the 737 only just fits; the widebody is refused.
  assert.equal(rating('vauclair-altiport', 'airliner'), 'suitable');
  assert.equal(rating('vauclair-altiport', 'widebody'), 'unsuitable');
  for (const id of ['trainer', 'bush', 'utility', 'commuter']) assert.equal(rating('vauclair-altiport', id), 'recommended', id);
  // Refused missions point to the nearest fields that suit the aircraft.
  const sorre = missionAvailability(airportById('sorre-meadow'), 'widebody');
  assert.equal(sorre.available, false);
  assert.ok(sorre.alternatives.length >= 4 && !sorre.alternatives.includes('sorre-meadow'));
  const from = airportById('sorre-meadow'), away = id => Math.hypot(airportById(id).x - from.x, airportById(id).z - from.z);
  for (let i = 1; i < sorre.alternatives.length; i++) assert.ok(away(sorre.alternatives[i - 1]) <= away(sorre.alternatives[i]));
});

test('representative landings in both directions, flown with ordinary controls', () => {
  const pairs = [['widebody', 'calmeterre-international'], ['airliner', 'aurin-cote'], ['regional', 'port-aurin'], ['biplane', 'sorre-meadow'], ['utility', 'vauclair-altiport'], ['helicopter', 'vauclair-altiport']];
  for (const [id, airport] of pairs) for (const rw of [airportById(airport).runway, airportById(airport).reciprocal]) {
    const f = resolveAirport(airport, rw).field, flight = new FlightController(groundHeight, id), mission = new LandingMission();
    assert.equal(missionAvailability(airportById(airport), id).available, true);
    mission.start(flight, f);
    assert.ok(flight.state.position.y > groundHeight(flight.state.position.x, flight.state.position.z) + 5, `${id} at ${airport} ${rw} starts clear`);
    fly(flight, mission);
    assert.equal(mission.status, 'success', `${id} at ${airport} ${rw}: ${JSON.stringify(mission.snapshot())}`);
    assert.equal(mission.snapshot().field, airport); assert.equal(mission.snapshot().runway, rw);
    if (!FLEET[id].flight.rotorcraft) assert.ok(mission.touchdown.along >= TOUCHDOWN_ZONE.start && mission.touchdown.along <= TOUCHDOWN_ZONE.end, `${id} ${rw} in the zone`);
    assert.ok(runwayCoordinates(flight.state.position, f).along < f.runwayLength);
  }
});

test('selection: every field and runway is selectable, persists and survives a mission retry and cancel', () => {
  const memory = new Map(), storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  for (const a of AIRPORTS) for (const rw of [a.runway, a.reciprocal]) {
    const selection = new AirportSelection();
    selection.select(a.id, rw);
    assert.equal(selection.id, a.id); assert.equal(selection.runway, rw);
    assert.ok(saveSettings({ ...normalizeSettings({}), airport: selection.id, runway: selection.runway }, storage));
    const saved = loadSettings(storage), again = new AirportSelection(saved.airport, saved.runway);
    assert.deepEqual(again.snapshot(), describeField(runwayDirection(a, rw)), `${a.id} ${rw} restored`);
    assert.ok(mapAirports(a.id).at(-1) === a, 'the chart draws the destination last');
  }
  // A mission at Aurin Côte 28 retries there after the selection moves; cancelling hands navigation back to the selection.
  const selection = new AirportSelection('aurin-cote', '28'), flight = new FlightController(groundHeight, 'airliner'), mission = new LandingMission();
  mission.start(flight, selection.field);
  selection.select('sorre-meadow', '20');
  mission.fail('Touchdown outside the runway');
  mission.start(flight);
  assert.equal(mission.field.id, 'aurin-cote'); assert.equal(mission.field.runway, '28');
  assert.equal(navigationDestination({ mission: mission.field, selected: selection.field }).id, 'aurin-cote');
  mission.cancel();
  const destination = navigationDestination({ mission: mission.status === 'idle' ? null : mission.field, selected: selection.field });
  assert.equal(destination.id, 'sorre-meadow'); assert.equal(destination.runway, '20'); assert.equal(destination.mission, false);
});
