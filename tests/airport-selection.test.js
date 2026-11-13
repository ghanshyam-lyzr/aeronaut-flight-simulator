import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { AIRFIELD, runwayCoordinates, runwayPoint } from '../src/airfield.js';
import { AIRPORTS, ALPINE_FIELD, airportById, runwayDirection, suitability } from '../src/airports.js';
import { AirportSelection, DEFAULT_AIRPORT, resolveAirport, missionAvailability, describeField, headingDegrees } from '../src/airport-selection.js';
import { LandingMission, TOUCHDOWN_ZONE } from '../src/landing-mission.js';
import { createLandingGuidance } from '../src/landing-guidance.js';
import { groundHeight } from '../src/world.js';

const dt = 1 / 120;
const field = (id, runway) => resolveAirport(id, runway).field;
const close = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;

// A safe touchdown at the aim point of any field, as the landing tests stage one.
function touchdown(flight, mission, overrides = {}) {
  const f = mission.field, s = flight.state, p = runwayPoint(TOUCHDOWN_ZONE.aim, 0, f);
  const telemetry = { position: { ...p, y: f.elevation + mission.profile.clearance }, speed: 50, sink: 1.5, heading: f.heading,
    bank: 0, pitch: 0, gearDown: true, flaps: mission.profile.flaps, stalled: false, time: 5, ...overrides };
  s.position.set(telemetry.position.x, telemetry.position.y, telemetry.position.z);
  Object.assign(s, { touchdown: telemetry, grounded: true, speed: telemetry.speed, heading: telemetry.heading, flightTime: 5 });
  mission.update(dt, s);
}
function settle(flight, mission, seconds = 2.1) {
  Object.assign(flight.state, { throttle: 0, speed: 0 });
  for (let i = 0; i < seconds / dt; i++) mission.update(dt, flight.state);
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

test('saved selections resolve to a registry field, falling back to Alpine Field 36', () => {
  assert.equal(DEFAULT_AIRPORT, 'alpine-field');
  for (const [id, runway] of [[undefined, undefined], ['', ''], ['heathrow', '27'], [42, null], [{}, '36'], ['alpine-field', '99']]) {
    const r = resolveAirport(id, runway);
    assert.equal(r.id, 'alpine-field'); assert.equal(r.runway, '36'); assert.equal(r.field, ALPINE_FIELD);
  }
  // A valid field keeps a valid runway; a runway it lacks means its primary runway.
  assert.equal(resolveAirport('orvane-regional', '32').field.heading, runwayDirection(airportById('orvane-regional'), '32').heading);
  assert.equal(resolveAirport('orvane-regional', '36').runway, '14');
  assert.equal(resolveAirport('alpine-field', '18').field.runway, '18');
  for (const a of AIRPORTS) for (const rw of [a.runway, a.reciprocal]) {
    const r = resolveAirport(a.id, rw);
    assert.equal(r.airport, a); assert.equal(r.field.runway, rw); assert.equal(r.field.id, a.id);
  }
});

test('the selection fires one change per real change, keeps the runway, and describes itself', () => {
  const selection = new AirportSelection('nowhere'), events = [];
  selection.addEventListener('change', () => events.push(`${selection.id} ${selection.runway}`));
  assert.equal(selection.id, 'alpine-field');
  assert.equal(selection.select('alpine-field'), false);
  assert.equal(selection.select('brume-col', '29'), true);
  assert.equal(selection.select('brume-col'), false, 're-selecting a field keeps its chosen runway');
  assert.equal(selection.runway, '29');
  assert.equal(selection.select('brume-col', '11'), true);
  assert.equal(selection.select('serein-lakeside'), true);
  assert.equal(selection.runway, '16', 'another field starts on its primary runway');
  assert.deepEqual(events, ['brume-col 29', 'brume-col 11', 'serein-lakeside 16']);
  const snap = selection.snapshot();
  assert.deepEqual([snap.id, snap.ident, snap.runway, snap.reciprocal, snap.regionName, snap.surface], ['serein-lakeside', 'QASL', '16', '34', 'Serein Basin', 'asphalt']);
  assert.ok(close(snap.threshold.x, runwayPoint(0, 0, selection.field).x) && close(snap.threshold.z, runwayPoint(0, 0, selection.field).z));
  snap.threshold.x = 0; assert.notEqual(selection.field.runways[0].threshold.x, 0, 'snapshots are copies');
  assert.equal(describeField(field('alpine-field', '18')).threshold.z, AIRFIELD.z - AIRFIELD.runwayLength / 2);
  assert.deepEqual([0, Math.PI, 138 * Math.PI / 180, 2 * Math.PI - 1e-9].map(headingDegrees), ['360', '180', '138', '360']);
});

test('scored missions need a suitable aircraft; unsuited pairings name the reason and the fields that work', () => {
  for (const a of AIRPORTS) for (const id of Object.keys(FLEET)) {
    const m = missionAvailability(a, id), fit = suitability(a, id);
    assert.equal(m.available, fit.rating !== 'unsuitable', `${a.id} ${id}`);
    assert.equal(m.reason, fit.reason);
    if (!m.available) {
      assert.ok(m.alternatives.length > 0, `${id} has somewhere to land`);
      assert.ok(!m.alternatives.includes(a.id));
      for (const alt of m.alternatives) assert.ok(missionAvailability(airportById(alt), id).available);
    } else assert.deepEqual(m.alternatives, []);
  }
  // Rotorcraft fly every field; the large jets keep Alpine Field (tight) but not the col or the meadow.
  for (const a of AIRPORTS) for (const id of ['helicopter', 'transport']) assert.equal(missionAvailability(a, id).rating, 'recommended');
  assert.equal(missionAvailability(ALPINE_FIELD, 'airliner').available, true);
  assert.equal(missionAvailability(ALPINE_FIELD, 'airliner').rating, 'suitable');
  assert.deepEqual(missionAvailability(airportById('brume-col'), 'jet').alternatives, ['alpine-field', 'orvane-regional', 'serein-lakeside']);
  assert.match(missionAvailability(airportById('verdance-meadow'), 'jet').reason, /paved/);
  assert.deepEqual(missionAvailability(airportById('serein-lakeside'), 'widebody').alternatives, ['alpine-field', 'orvane-regional']);
});

test('missions start on the selected field and runway: rotated headings, elevations and helicopters', () => {
  for (const a of AIRPORTS) for (const rw of [a.runway, a.reciprocal]) for (const id of ['trainer', 'helicopter']) {
    const f = field(a.id, rw), flight = new FlightController(groundHeight, id), mission = new LandingMission(), s = flight.state;
    mission.start(flight, f);
    assert.equal(mission.field, f); assert.equal(s.heading, f.heading);
    const at = runwayCoordinates(s.position, f);
    assert.ok(close(at.cross, 0), `${a.id} ${rw} centred`);
    assert.ok(close(at.along, mission.profile.helicopter ? TOUCHDOWN_ZONE.aim : -1100), `${a.id} ${rw} ${id} along ${at.along}`);
    assert.ok(s.position.y > groundHeight(s.position.x, s.position.z) + 5, `${a.id} ${rw} clear of the ground`);
    assert.ok(s.position.y > f.elevation + mission.profile.clearance + (mission.profile.helicopter ? 13 : 60), `${a.id} ${rw} starts above field elevation`);
    // The velocity follows the runway heading.
    assert.ok(close(Math.atan2(s.velocity.x, -s.velocity.z), Math.atan2(Math.sin(f.heading), Math.cos(f.heading)), 1e-9) || mission.profile.helicopter);
    assert.equal(mission.guidance(s).alignment < 1e-9, true);
  }
});

test('grading, rollout and messages use the mission field, not Alpine Field 36', () => {
  const orvane32 = field('orvane-regional', '32'), col = field('brume-col', '29');
  // A safe touchdown and stop at the rotated, high regional field succeeds.
  let flight = new FlightController(groundHeight, 'jet'), mission = new LandingMission(); mission.start(flight, orvane32);
  touchdown(flight, mission); assert.equal(mission.phase, 'rollout', JSON.stringify(mission.snapshot()));
  settle(flight, mission); assert.equal(mission.status, 'success');
  assert.equal(mission.snapshot().field, 'orvane-regional'); assert.equal(mission.snapshot().runway, '32');
  // Touching down on a north heading at Orvane is misaligned, and the reason names runway 32.
  mission.start(flight); touchdown(flight, mission, { heading: 0 });
  assert.equal(mission.status, 'failed'); assert.equal(mission.reason, 'Touch down level and aligned with runway 32');
  // The same point that is Alpine Field's touchdown zone is outside Orvane's runway.
  mission.start(flight); touchdown(flight, mission, { position: { ...runwayPoint(TOUCHDOWN_ZONE.aim), y: 1060 } });
  assert.equal(mission.status, 'failed'); assert.match(mission.reason, /outside the runway/);
  // On the short col, rolling past its 650 m end is an overrun even though Alpine Field is 1,100 m long.
  flight = new FlightController(groundHeight, 'trainer'); mission = new LandingMission(); mission.start(flight, col);
  touchdown(flight, mission, { speed: 30 }); assert.equal(mission.phase, 'rollout');
  Object.assign(flight.state.position, runwayPoint(col.runwayLength + 1, 0, col)); settle(flight, mission);
  assert.equal(mission.status, 'failed'); assert.match(mission.reason, /overrun/);
  // A miss passes the col's far threshold airborne.
  mission.start(flight); Object.assign(flight.state.position, runwayPoint(col.runwayLength + 10, 0, col)); mission.update(dt, flight.state);
  assert.match(mission.reason, /Runway passed/);
  // Helicopters must settle in the col's box, not Alpine Field's.
  flight = new FlightController(groundHeight, 'helicopter'); mission = new LandingMission(); mission.start(flight, col);
  touchdown(flight, mission, { speed: 0, sink: 1, position: { ...runwayPoint(TOUCHDOWN_ZONE.aim + 40, 0, col), y: col.elevation + 1 } });
  assert.equal(mission.status, 'failed'); assert.equal(mission.reason, 'Land the skids inside the target box');
});

test('retry keeps the mission field; cancel, reset and aircraft changes end it; a new start moves it', () => {
  const serein34 = field('serein-lakeside', '34'), alpine = field('alpine-field'), flight = new FlightController(groundHeight, 'trainer'), s = flight.state;
  const mission = new LandingMission(alpine);
  mission.start(flight, serein34); touchdown(flight, mission, { sink: 4 });
  assert.equal(mission.status, 'failed');
  mission.start(flight);
  assert.equal(mission.field, serein34, 'retry stays at the mission field'); assert.equal(mission.status, 'flying');
  assert.deepEqual(s.position.toArray(), runwayPointArray(serein34, s.position.y)); assert.equal(s.heading, serein34.heading);
  mission.cancel(); assert.equal(mission.status, 'idle'); assert.equal(mission.field, serein34);
  mission.start(flight); flight.setAircraft('biplane'); mission.update(dt, s); assert.equal(mission.status, 'idle', 'aircraft change cancels');
  mission.start(flight); flight.update(dt); mission.update(dt, s); flight.reset(); mission.update(dt, s); assert.equal(mission.status, 'idle', 'reset cancels');
  mission.start(flight, alpine); assert.equal(mission.field, alpine); assert.equal(s.heading, 0);
});
function runwayPointArray(f, y) { const p = runwayPoint(-1100, 0, f); return [p.x, y, p.z]; }

test('terrain-warning suppression follows the mission field on long, rotated finals', () => {
  const flight = new FlightController(groundHeight, 'jet'), s = flight.state, mission = new LandingMission();
  const orvane = field('orvane-regional'), at = (along, cross, f) => { const p = runwayPoint(along, cross, f); s.position.set(p.x, f.elevation + 20, p.z); return mission.onFinal(s); };
  assert.equal(mission.onFinal(s), false, 'no mission, no suppression');
  mission.start(flight, orvane);
  assert.equal(at(-1400, 0, orvane), true); assert.equal(at(2500, 10, orvane), true, 'the whole 2.6 km runway');
  assert.equal(at(-1600, 0, orvane), false); assert.equal(at(-500, 60, orvane), false);
  assert.equal(at(-500, 0, ALPINE_FIELD), false, "Alpine Field's final is not this mission's");
  s.gearDown = false; assert.equal(at(-500, 0, orvane), false, 'gear up keeps the warning');
});

test('guidance cues sit on the selected runway and are freed when replaced', () => {
  const scene = new THREE.Scene();
  for (const a of AIRPORTS) for (const rw of [a.runway, a.reciprocal]) {
    const f = field(a.id, rw), cues = createLandingGuidance(scene, f, '#cdf56b');
    assert.equal(cues.field, f); assert.equal(scene.children.includes(cues.group), true);
    cues.group.updateMatrixWorld(true);
    // The touchdown zone outline's first corner, in world space, is TOUCHDOWN_ZONE.start along the runway.
    const zone = cues.group.children[0], corner = new THREE.Vector3().fromBufferAttribute(zone.geometry.attributes.position, 0).applyMatrix4(zone.matrixWorld);
    const local = runwayCoordinates({ x: corner.x, z: corner.z }, f);
    assert.ok(close(local.along, TOUCHDOWN_ZONE.start, 1e-6), `${a.id} ${rw} zone along ${local.along}`);
    assert.ok(Math.abs(local.cross) <= f.runwayWidth / 2, `${a.id} ${rw} zone inside the runway`);
    assert.ok(close(corner.y, f.elevation + 1.5));
    // The helicopter box never reaches beyond the runway area the mission scores (3 m inside each edge).
    const box = cues.group.children[1].geometry.attributes.position;
    for (let i = 0; i < box.count; i++) assert.ok(Math.abs(box.getX(i)) <= Math.min(10, f.runwayWidth / 2 - 3) + 1e-9, `${a.id} skid box`);
    let disposed = 0; cues.group.traverse(o => o.geometry?.addEventListener('dispose', () => disposed++));
    cues.show(true); assert.equal(cues.group.visible, true);
    cues.dispose();
    assert.equal(scene.children.includes(cues.group), false); assert.ok(disposed >= 5, `${disposed} geometries freed`);
  }
  assert.equal(scene.children.length, 0);
});

test('full missions at non-default fields with normal controls: a jet on rotated Orvane 32, a helicopter on the col', () => {
  for (const [id, f] of [['jet', field('orvane-regional', '32')], ['transport', field('brume-col', '29')], ['utility', field('verdance-meadow', '17')]]) {
    const flight = new FlightController(groundHeight, id), mission = new LandingMission();
    mission.start(flight, f); fly(flight, mission);
    assert.equal(mission.status, 'success', `${id} at ${f.id} ${f.runway}: ${JSON.stringify(mission.snapshot())}`);
    assert.ok(mission.touchdown.alignment < 12);
    assert.ok(runwayCoordinates(flight.state.position, f).along < f.runwayLength);
  }
});
