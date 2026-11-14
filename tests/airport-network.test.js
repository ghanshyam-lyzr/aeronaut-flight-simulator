import test from 'node:test';
import assert from 'node:assert/strict';
import { groundHeight, groundShader, hash } from '../src/terrain.js';
import { WORLD, WATER_LEVEL, VILLAGES, regionAt, inWorld } from '../src/regions.js';
import { AIRFIELD, runwayCoordinates, runwayPoint } from '../src/airfield.js';
import { AIRPORTS, ALPINE_FIELD, GRADED_AIRPORTS, RUNWAY_NEEDS, airportById, runwayDirection, footprint, localCoordinates,
  designator, inProtectedArea, suitability, aircraftFor } from '../src/airports.js';
import { FLEET } from '../src/fleet.js';
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { LandingMission, TOUCHDOWN_ZONE } from '../src/landing-mission.js';

const NEW = AIRPORTS.filter(a => a !== ALPINE_FIELD);
const tenths = heading => ((heading * 180 / Math.PI) % 360 + 360) % 360;
const close = (a, b, tolerance = 1e-9) => Math.abs(a - b) < tolerance;

// The rendered terrain between its vertices, as world.js triangulates it at an
// index step: vertices on one world grid, quads split along the (i+1, j)-(i, j+1) diagonal.
const SPACING = WORLD.tileSize / 104;
function meshHeight(x, z, step) {
  const size = SPACING * step, fi = (x - WORLD.minX) / size, fj = (z - WORLD.minZ) / size, i = Math.floor(fi), j = Math.floor(fj), fx = fi - i, fz = fj - j;
  const at = (a, b) => groundHeight(WORLD.minX + a * size, WORLD.minZ + b * size);
  const ha = at(i, j), hb = at(i + 1, j), hc = at(i, j + 1), hd = at(i + 1, j + 1);
  return fx + fz <= 1 ? ha + fx * (hb - ha) + fz * (hc - ha) : hd + (1 - fx) * (hc - hd) + (1 - fz) * (hb - hd);
}
function glslAsJs() {
  const body = groundShader.replace(/^float groundHash[^\n]*\n/m, '')
    .replace(/\bfloat (\w+)\(([^)]*)\)\s*\{/g, (_, name, args) => `function ${name}(${args.replace(/\bfloat /g, '')}) {`)
    .replace(/\bfloat /g, 'let ');
  const prelude = `const {abs,min,max,sin,exp,floor,sqrt}=Math; const clamp=(x,a,b)=>min(b,max(a,x)), mix=(a,b,t)=>a+(b-a)*t, vec2=(a,b)=>[a,b], length=v=>sqrt(v[0]*v[0]+v[1]*v[1]);`;
  return new Function('groundHash', `${prelude}\n${body}\nreturn groundHeight;`)(hash);
}
const each = (field, step, fn) => { const f = footprint(field); for (let a = f.along[0]; a <= f.along[1]; a += step) for (let c = f.cross[0]; c <= f.cross[1]; c += step) fn(runwayPoint(a, c, field), a, c); };

test('the registry: ten distinct fields with stable ids, truthful runway numbers and complete metadata', () => {
  assert.equal(AIRPORTS.length, 10);
  assert.deepEqual(AIRPORTS.map(a => a.id), ['alpine-field', 'orvane-regional', 'verdance-meadow', 'serein-lakeside', 'brume-col',
    'calmeterre-international', 'aurin-cote', 'port-aurin', 'sorre-meadow', 'vauclair-altiport']);
  for (const key of ['id', 'ident', 'name']) assert.equal(new Set(AIRPORTS.map(a => a[key])).size, AIRPORTS.length, key);
  assert.deepEqual(new Set(NEW.map(a => a.kind)), new Set(['regional', 'grass', 'lakeside', 'mountain', 'commercial']));
  for (const a of AIRPORTS) {
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.runways), a.id);
    assert.match(a.ident, /^QA[A-Z]{2}$/);
    for (const key of ['name', 'kind', 'region', 'surface', 'summary']) assert.equal(typeof a[key], 'string', `${a.id}.${key}`);
    assert.ok(['asphalt', 'grass'].includes(a.surface));
    assert.ok(inWorld(a.x, a.z, 3000), a.id);
    assert.equal(regionAt(a.x, a.z).id, a.region, a.id);
    assert.equal(airportById(a.id), a);
    // Runway numbers are the headings in tens of degrees; the two ends are 180° apart.
    assert.equal(a.runway, String(Math.round(tenths(a.heading) / 10) % 36 || 36).padStart(2, '0'), a.id);
    assert.equal(Math.abs(Number(a.runway) - Number(a.reciprocal)), 18, a.id);
    assert.deepEqual(a.runways.map(r => r.designator), [a.runway, a.reciprocal]);
    assert.ok(close(tenths(a.runways[1].heading), (tenths(a.heading) + 180) % 360, 1e-9));
    // Dry: the original fields stand 25 m above the water, the shore fields of the Aurin coast at least 8 m.
    assert.ok(a.runwayLength >= 600 && a.runwayWidth >= 18 && a.elevation > WATER_LEVEL + (a.region === 'southern-coast' ? 8 : 25), a.id);
  }
  assert.equal(designator(0), '36'); assert.equal(designator(Math.PI), '18'); assert.equal(designator(Math.PI / 180 * 4), '36'); assert.equal(designator(Math.PI / 180 * 106), '11');
  // Two or more runways cross the valley grain rather than running north/south.
  assert.ok(NEW.filter(a => Math.abs(Math.sin(a.heading)) > Math.sin(Math.PI / 180 * 30)).length >= 2);
  // Spread out: every pair of fields at least 9 km apart, across four regions.
  for (const a of AIRPORTS) for (const b of AIRPORTS) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 9000, `${a.id}–${b.id}`);
  assert.ok(new Set(AIRPORTS.map(a => a.region)).size >= 4);
  // The long paved field takes the big jets; the mountain strip is short and narrow.
  const regional = airportById('orvane-regional'), col = airportById('brume-col');
  assert.ok(regional.runwayLength >= 2400 && regional.runwayWidth >= 45 && regional.surface === 'asphalt');
  assert.equal(airportById('verdance-meadow').surface, 'grass');
  assert.ok(col.runwayLength < 700 && col.runwayWidth < 23 && col.elevation > 1100);
});

test('Alpine Field keeps its numbers, AIRFIELD and its default runway behaviour', () => {
  assert.deepEqual(AIRFIELD, { x: 900, z: -1800, elevation: 78, runwayLength: 1100, runwayWidth: 53, heading: 0, name: 'Alpine Field', runway: '36' });
  assert.equal(AIRPORTS[0], ALPINE_FIELD);
  for (const [key, value] of Object.entries(AIRFIELD)) assert.equal(ALPINE_FIELD[key], value, key);
  assert.equal(ALPINE_FIELD.reciprocal, '18');
  assert.equal(ALPINE_FIELD.grading, 'legacy');
  assert.ok(!GRADED_AIRPORTS.some(g => g.airport === ALPINE_FIELD), 'Alpine Field keeps its original elliptical apron');
  // Default arguments still mean Alpine Field, so existing callers behave as before.
  assert.deepEqual(runwayPoint(100), runwayPoint(100, 0, ALPINE_FIELD));
  assert.equal(runwayDirection(ALPINE_FIELD), ALPINE_FIELD);
  for (let along = 0; along <= AIRFIELD.runwayLength; along += 50) { const p = runwayPoint(along); assert.equal(groundHeight(p.x, p.z), 78); }
  assert.equal(new LandingMission().field, AIRFIELD);
});

test('rotated runway coordinates: every field, both directions', () => {
  for (const a of AIRPORTS) for (const rw of [a.runway, a.reciprocal]) {
    const d = runwayDirection(a, rw);
    assert.equal(d.runway, rw); assert.ok(close(Math.cos(runwayDirection(d, a.runway).heading - a.heading), 1));
    assert.equal(d.x, a.x); assert.equal(d.runwayLength, a.runwayLength);
    // Threshold, far end and centre, and the published thresholds.
    const t = runwayPoint(0, 0, d), end = runwayPoint(d.runwayLength, 0, d);
    assert.ok(close(t.x, d.runways[0].threshold.x, 1e-6) && close(t.z, d.runways[0].threshold.z, 1e-6), `${a.id} ${rw} threshold`);
    assert.ok(close(end.x, d.runways[1].threshold.x, 1e-6) && close(end.z, d.runways[1].threshold.z, 1e-6));
    // Rolling down the runway moves along its heading (+x east, +z south).
    const ahead = runwayPoint(101, 0, d), rolled = runwayPoint(100, 0, d);
    assert.ok(close(ahead.x - rolled.x, Math.sin(d.heading), 1e-6) && close(ahead.z - rolled.z, -Math.cos(d.heading), 1e-6));
    // Right of the centreline is 90° clockwise from the heading.
    const right = runwayPoint(100, 1, d);
    assert.ok(close(right.x - rolled.x, Math.cos(d.heading), 1e-6) && close(right.z - rolled.z, Math.sin(d.heading), 1e-6));
    for (const [along, cross] of [[0, 0], [320, 9], [-1500, -40], [d.runwayLength + 200, 12]]) {
      const p = runwayPoint(along, cross, d), back = runwayCoordinates(p, d), other = runwayCoordinates(p, runwayDirection(a, rw === a.runway ? a.reciprocal : a.runway));
      assert.ok(close(back.along, along, 1e-6) && close(back.cross, cross, 1e-6), `${a.id} ${rw} ${along},${cross}`);
      assert.ok(close(other.along, d.runwayLength - along, 1e-6) && close(other.cross, -cross, 1e-6), 'the reciprocal measures from the other end');
      if (rw === a.runway) { const local = localCoordinates(a, p.x, p.z); assert.ok(close(local.along, along, 1e-6) && close(local.cross, cross, 1e-6)); }
    }
  }
  assert.throws(() => runwayDirection(ALPINE_FIELD, '09'), /no runway 09/);
});

test('each new field is graded flat in runway-local coordinates, in the collider, the GLSL twin and the rendered mesh', () => {
  const shader = glslAsJs();
  for (const a of NEW) {
    let shaderError = 0, steps = { 1: 0, 2: 0, 4: 0 };
    each(a, 10, p => {
      assert.equal(groundHeight(p.x, p.z), a.elevation, `${a.id} at ${p.x}, ${p.z}`);
      shaderError = Math.max(shaderError, Math.abs(shader(p.x, p.z) - a.elevation));
      for (const step of [1, 2, 4]) steps[step] = Math.max(steps[step], Math.abs(meshHeight(p.x, p.z, step) - a.elevation));
    });
    assert.ok(shaderError < 1e-6, `${a.id}: GLSL off by ${shaderError}`);
    // The pavement's underside is 0.48 m above the graded ground and its top 0.93 m:
    // the terrain mesh lies flat under it at the near steps (84.6 and 169 m), and
    // within a metre and a half at the farthest step, beyond 7.5–22 km.
    assert.ok(steps[1] < 1e-3 && steps[2] < 1e-3, `${a.id}: mesh ${steps[1]} / ${steps[2]} m off at steps 1 / 2`);
    assert.ok(steps[4] < 1.5, `${a.id}: mesh ${steps[4]} m off at step 4`);
    // Dry with a margin, and the lake shader sees the same land.
    each(a, 40, (p, along, cross) => assert.ok(Math.max(WATER_LEVEL, groundHeight(p.x, p.z)) > WATER_LEVEL + Math.min(25, a.elevation - WATER_LEVEL - 2), `${a.id} ${along}, ${cross}`));
  }
});

test('approaches: open finals on both runways, without artificial walls', () => {
  for (const a of AIRPORTS) for (const rw of [a.runway, a.reciprocal]) {
    const d = runwayDirection(a, rw);
    let previous = null;
    for (let distance = 0; distance <= 4000; distance += 25) {
      let highest = -Infinity;
      for (const cross of [-75, 0, 75]) { const p = runwayPoint(-distance, cross, d); highest = Math.max(highest, groundHeight(p.x, p.z)); }
      // Ground stays under a 3° glide path to the threshold, 15 m clear from 300 m out.
      if (distance >= 300) assert.ok(highest < d.elevation + Math.tan(Math.PI / 60) * distance - 15, `${a.id} ${rw}: ${highest.toFixed(1)} m at ${distance} m`);
      // Nothing rises toward the runway faster than 1 in 4 within 2 km of the threshold.
      if (previous !== null && distance <= 2000) assert.ok(previous - highest < 25 * .27 || highest < d.elevation - 20, `${a.id} ${rw}: step at ${distance} m`);
      previous = highest;
    }
  }
  // Beside the new runways the grading never cuts a bank steeper than 40° (where it
  // reaches: the box's corners beyond the blend are natural ground, like Val Vauclair's glacial step).
  for (const g of GRADED_AIRPORTS) {
    const a = g.airport;
    for (let along = -g.halfAlong - g.blendAlong; along <= g.halfAlong + g.blendAlong; along += 60) for (let cross = -g.halfCross - g.blendCross; cross <= g.halfCross + g.blendCross; cross += 30) {
      if (Math.hypot(Math.max(Math.abs(along) - g.halfAlong, 0) / g.blendAlong, Math.max(Math.abs(cross) - g.halfCross, 0) / g.blendCross) >= 1) continue;
      const x = a.x + (along + g.along) * g.sin + (cross + g.cross) * g.cos, z = a.z - (along + g.along) * g.cos + (cross + g.cross) * g.sin, h = groundHeight(x, z);
      const slope = Math.hypot(groundHeight(x + 10, z) - h, groundHeight(x, z + 10) - h) / 10;
      assert.ok(slope < Math.tan(40 * Math.PI / 180), `${a.id}: slope ${slope.toFixed(2)} at ${along}, ${cross}`);
    }
  }
});

test('trees, houses and approaches keep clear of the fields', () => {
  for (const a of NEW) {
    const f = footprint(a);
    assert.ok(inProtectedArea(a, a.x, a.z));
    for (const [along, cross] of [[f.along[0], f.cross[0]], [f.along[1], f.cross[1]], [-1400, 0], [a.runwayLength + 1400, 100]]) { const p = runwayPoint(along, cross, a); assert.ok(inProtectedArea(a, p.x, p.z), `${a.id} ${along}, ${cross}`); }
    const outside = runwayPoint(a.runwayLength / 2, f.cross[1] + 400, a);
    assert.ok(!inProtectedArea(a, outside.x, outside.z));
    for (const [x, z, spread] of VILLAGES) assert.ok(Math.hypot(x - a.x, z - a.z) > a.runwayLength / 2 + spread + 1500, `${a.id} near village ${x}, ${z}`);
  }
});

test('aircraft suitability is grounded in the flight model', () => {
  assert.deepEqual(Object.keys(RUNWAY_NEEDS).sort(), Object.keys(FLEET).sort());
  for (const [id, type] of Object.entries(FLEET)) {
    if (type.flight.rotorcraft) { assert.equal(RUNWAY_NEEDS[id].length, 0); continue; }
    // A full-power takeoff (15° flaps where fitted) on a flat runway: its ground roll is under 2/3 of the stated need.
    const flight = new FlightController(() => 500, id), s = flight.state, input = new FlightInputs();
    flight.runwayStart(0, 500 + type.groundClearance, 0);
    if (!type.noFlaps) flight.cycleFlaps();
    for (let frame = 1; frame < 90 * 60 && s.grounded; frame++) {
      input.set({ throttle: 1, pitch: s.speed > type.flight.rotateSpeed - 3 ? 1 : 0 }, (frame - 1) / 60);
      input.advance(frame / 60, (dt, c) => flight.update(dt, c));
    }
    assert.equal(s.grounded, false, id);
    assert.ok(s.distance * 1.5 <= RUNWAY_NEEDS[id].length, `${id}: roll ${s.distance.toFixed(0)} m for ${RUNWAY_NEEDS[id].length} m`);
  }
  const ratings = id => Object.fromEntries(Object.keys(FLEET).map(k => [k, suitability(airportById(id), k).rating]));
  // Every field suits several aircraft; the regional field suits all of them.
  for (const a of AIRPORTS) assert.ok(aircraftFor(a).recommended.length >= 6, a.id);
  assert.deepEqual(aircraftFor(airportById('orvane-regional')).unsuitable, []);
  assert.equal(ratings('orvane-regional').widebody, 'recommended'); assert.equal(ratings('orvane-regional').airliner, 'recommended');
  // Alpine Field still takes the 737 and the widebody, without the regional field's margin.
  assert.equal(ratings('alpine-field').airliner, 'suitable'); assert.equal(ratings('alpine-field').widebody, 'suitable');
  // The short mountain strip is for light and short-field aircraft only.
  const col = ratings('brume-col');
  for (const id of ['airliner', 'widebody', 'regional', 'cargo', 'jet', 'fighter', 'cityliner', 'commuter']) assert.equal(col[id], 'unsuitable', id);
  for (const id of ['bush', 'biplane', 'helicopter', 'transport']) assert.equal(col[id], 'recommended', id);
  assert.match(suitability(airportById('brume-col'), 'airliner').reason, /runway/);
  // Grass rules out the paved-only aircraft; the lakeside strip is too narrow for the widebody.
  for (const id of ['jet', 'airliner', 'widebody', 'cityliner', 'canard']) assert.equal(ratings('verdance-meadow')[id], 'unsuitable', id);
  assert.equal(ratings('serein-lakeside').widebody, 'unsuitable'); assert.equal(ratings('serein-lakeside').airliner, 'suitable');
});

test('every new field is flyable: runway departures and full landings on both runways', () => {
  for (const a of NEW) {
    const ids = aircraftFor(a).recommended.filter(id => !FLEET[id].flight.rotorcraft);
    const id = ids.includes('trainer') ? 'trainer' : ids[0];
    for (const rw of [a.runway, a.reciprocal]) {
      const field = runwayDirection(a, rw);
      // Departure from 100 m past the threshold, as the Runway start places aircraft.
      const flight = new FlightController(groundHeight, id), s = flight.state, input = new FlightInputs(), type = FLEET[id];
      const p = runwayPoint(100, 0, field);
      flight.runwayStart(p.x, groundHeight(p.x, p.z) + type.groundClearance, p.z, field.heading);
      assert.equal(s.grounded, true);
      if (!type.noFlaps) flight.cycleFlaps();
      for (let frame = 1; frame < 60 * 60 && s.position.y < field.elevation + 60 && !s.crashed; frame++) {
        input.set({ throttle: 1, pitch: s.speed > type.flight.rotateSpeed - 3 ? 1 : 0 }, (frame - 1) / 60);
        input.advance(frame / 60, (step, c) => flight.update(step, c));
        if (s.grounded) assert.ok(runwayCoordinates(s.position, field).along < field.runwayLength, `${a.id} ${rw}: ran off the end`);
      }
      assert.equal(s.crashed, false, `${a.id} ${rw}: ${s.crashReason}`);
      assert.ok(s.position.y > field.elevation + 60, `${a.id} ${rw} climbs away`);
      // A landing from the mission's 1.1 km final with the landing tests' feedback pilot.
      const landing = new FlightController(groundHeight, id), mission = new LandingMission(field), ls = landing.state;
      mission.start(landing);
      assert.ok(ls.position.y > groundHeight(ls.position.x, ls.position.z) + 5);
      const pilot = new FlightInputs(0), m = mission.profile;
      for (let frame = 1; frame < 90 * 60 && mission.active; frame++) {
        const height = ls.position.y - field.elevation - m.clearance;
        const sink = height < 8 ? Math.min(1.8, m.maxSink * .65) : m.speed * m.slope;
        const idleSink = Math.max(0, .32 - ls.spool) * (landing.type.flight.idleSink ?? 6);
        const desiredPitch = Math.asin((-sink + idleSink) / Math.max(ls.speed, 1));
        pilot.set({ pitch: (desiredPitch - ls.pitch) * 4, throttle: ls.grounded ? -1 : 0 }, (frame - 1) / 60);
        pilot.advance(frame / 60, (step, c) => { if (!mission.active) return; landing.update(step, c); mission.update(step, ls); });
      }
      assert.equal(mission.status, 'success', `${a.id} ${rw}: ${JSON.stringify(mission.snapshot())}`);
      assert.ok(mission.touchdown.along >= TOUCHDOWN_ZONE.start && mission.touchdown.along <= TOUCHDOWN_ZONE.end);
    }
  }
  // The large jets depart the regional field's long runway with room to spare.
  for (const id of ['airliner', 'widebody']) {
    const field = airportById('orvane-regional'), flight = new FlightController(groundHeight, id), s = flight.state, input = new FlightInputs(), p = runwayPoint(100, 0, field);
    flight.runwayStart(p.x, field.elevation + FLEET[id].groundClearance, p.z, field.heading); flight.cycleFlaps();
    for (let frame = 1; frame < 90 * 60 && s.grounded; frame++) { input.set({ throttle: 1, pitch: s.speed > FLEET[id].flight.rotateSpeed - 3 ? 1 : 0 }, (frame - 1) / 60); input.advance(frame / 60, (step, c) => flight.update(step, c)); }
    assert.equal(s.crashed, false); assert.ok(runwayCoordinates(s.position, field).along < field.runwayLength / 2, `${id} airborne in the first half`);
  }
});
