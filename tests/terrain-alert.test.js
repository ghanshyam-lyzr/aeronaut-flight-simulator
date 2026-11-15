import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { LandingMission } from '../src/landing-mission.js';
import { AIRFIELD } from '../src/airfield.js';
import { airportById, runwayDirection } from '../src/airports.js';
import { groundHeight } from '../src/world.js';
import { WATER_LEVEL } from '../src/regions.js';
import { TERRAIN_ALERT, TerrainAlert, sampleTerrain, landingRunway, terrainNotice } from '../src/terrain-alert.js';
import { ridgeRun } from '../scripts/measure-terrain-alert.js';

const worldHeight = (x, z) => Math.max(WATER_LEVEL, groundHeight(x, z));
const FLAT = 40;
const flat = () => FLAT;
/** Flat ground with a 400 m ridge 1.5–2 km west of the origin (x from -2000 to -1500). */
const ridge = (x) => x <= -1500 && x >= -2000 ? 440 : FLAT;
/** A field on flat synthetic ground, so tests never meet the real world's hills by accident. */
const FIELD = Object.freeze({ ...AIRFIELD, x: 0, z: 0, elevation: FLAT });
const LEVELS = { clear: 0, caution: 1, warning: 2 };

/** An airborne aircraft at (x, y, z), flying `heading` with flight assist holding height and heading. */
function cruise(id, heightAt, { x = 0, y = FLAT + 120, z = 0, heading = -Math.PI / 2, assist = true } = {}) {
  const f = new FlightController(heightAt, id), s = f.state;
  s.position.set(x, y, z); s.heading = heading; f.setQuaternion();
  if (assist) f.toggleAutopilot();
  f.update(1 / 120, {});
  return f;
}
/** Flies `seconds` at 120 Hz, updating the alert each step; returns the levels seen. */
function fly(f, alert, seconds, controls = {}) {
  const seen = new Set();
  for (let i = 0; i < Math.round(seconds * 120) && !f.state.crashed; i++) {
    f.update(1 / 120, controls);
    seen.add(alert.update(f.state, f.type).level);
  }
  return seen;
}

test('a ridge ahead warns long before the aircraft is low over it; the same ridge behind never does', () => {
  const ahead = cruise('jet', ridge, { x: -100 }), alert = new TerrainAlert(ridge, []);
  const first = alert.update(ahead.state, ahead.type);
  assert.equal(first.level, 'caution', 'the ridge is inside the look-ahead');
  assert.equal(first.cause, 'rising');
  const agl = ahead.state.position.y - FLAT;
  assert.ok(agl > 100, `still ${agl.toFixed(0)} m above the flat ground: the old 100 m rule was silent here`);
  let warnedAt = null;
  for (let i = 0; i < 120 * 30 && !ahead.state.crashed; i++) {
    ahead.update(1 / 120, {});
    if (alert.update(ahead.state, ahead.type).level === 'warning' && warnedAt === null) warnedAt = ahead.state.flightTime;
  }
  assert.ok(ahead.state.crashed, 'flown level, the jet hits the ridge');
  const lead = ahead.state.flightTime - warnedAt;
  assert.ok(lead > TERRAIN_ALERT.fixedWing.warnTime - 1 && lead <= TERRAIN_ALERT.fixedWing.warnTime + 0.5, `pull-up ${lead.toFixed(1)} s before impact`);

  const behind = cruise('jet', ridge, { x: -100, heading: Math.PI / 2 }), quiet = new TerrainAlert(ridge, []);
  assert.deepEqual([...fly(behind, quiet, 30)], ['clear'], 'flying away from the ridge');
});

test('the warning follows the real velocity, not the stale fixed-wing state.velocity', () => {
  // Turned to fly east (away from the ridge) while state.velocity still points west from the reset.
  const f = cruise('jet', ridge, { x: -100, heading: Math.PI / 2 }), s = f.state;
  s.velocity.set(-120, 0, 0);
  assert.equal(sampleTerrain(s, f.type, ridge, { airports: [] }).level, 'clear');
});

test('rising and falling paths: a climb that clears the ridge and a descent over falling ground stay quiet', () => {
  // Climbing steeply enough to stay well above the ridge top.
  const climb = cruise('jet', ridge, { x: -100, y: 440 + 60, assist: false }), s = climb.state;
  s.pitch = 0.2; climb.setQuaternion();
  climb.update(1 / 60, { throttle: 1 });
  for (let i = 0; i < 120 * 4; i++) climb.update(1 / 120, { throttle: 1 });
  assert.ok(s.verticalSpeed > 10, `climbing ${s.verticalSpeed.toFixed(1)} m/s`);
  const r = sampleTerrain(s, climb.type, ridge, { airports: [] });
  assert.equal(r.level, 'clear', `path clears the ridge by ${r.clearance.toFixed(0)} m`);

  // The same height without the climb is a conflict: the ridge top is under the margin.
  const level = cruise('jet', ridge, { x: -100, y: 440 + 20 });
  assert.notEqual(sampleTerrain(level.state, level.type, ridge, { airports: [] }).level, 'clear');

  // Descending at 4 m/s toward ground that falls away faster than the path: clearance grows.
  const falling = (x) => Math.max(10, 600 + x * 0.15); // west is downhill: 0.15 m per metre
  const down = cruise('jet', falling, { x: 0, y: 600 + 80, assist: false }), d = down.state;
  d.pitch = -0.035; down.setQuaternion(); for (let i = 0; i < 120 * 4; i++) down.update(1 / 120, {});
  assert.ok(d.verticalSpeed < -2, `descending ${d.verticalSpeed.toFixed(1)} m/s`);
  assert.equal(sampleTerrain(d, down.type, falling, { airports: [] }).level, 'clear');
});

test('level low flight over flat ground is harmless; a descent into it warns only close to impact', () => {
  const low = cruise('jet', flat, { y: FLAT + 25 }), alert = new TerrainAlert(flat, []);
  assert.deepEqual([...fly(low, alert, 40)], ['clear'], '25 m above flat ground for 40 s');

  const sink = cruise('jet', flat, { y: FLAT + 150, assist: false }), s = sink.state, a = new TerrainAlert(flat, []);
  s.pitch = -0.1; sink.setQuaternion();
  const gear = sink.type.groundClearance ?? 2.8;
  let first = null;
  for (let i = 0; i < 120 * 60 && !s.crashed; i++) {
    sink.update(1 / 120, {});
    const v = a.update(s, sink.type);
    if (v.level !== 'clear' && first === null) first = { ...v, clearance: s.position.y - FLAT - gear, sink: -s.verticalSpeed };
  }
  assert.ok(first, 'diving into flat ground warns');
  assert.equal(first.level, 'warning'); assert.equal(first.cause, 'descent');
  const impact = first.clearance / first.sink;
  assert.ok(impact <= TERRAIN_ALERT.fixedWing.sinkTime && impact > TERRAIN_ALERT.fixedWing.sinkTime - 1, `warned ${impact.toFixed(1)} s from impact`);
});

/** A jet 2 m above its wheels' ground (FLAT) at 100 m/s heading north, set directly as in the reproductions. */
function skimming(heightAt, { pitch = 0, verticalSpeed = 0 } = {}) {
  const f = new FlightController(heightAt, 'jet'), s = f.state, gear = f.type.flight.groundClearance ?? f.type.groundClearance ?? 2.8;
  s.position.set(0, FLAT + gear + 2, 0);
  Object.assign(s, { speed: 100, heading: 0, pitch, verticalSpeed, grounded: false, crashed: false });
  f.setQuaternion();
  return { f, s, gear };
}
/** Flies until contact with the alert at its own cadence; returns when (and how high) the warning first showed. */
function untilContact(f, heightAt, gear) {
  const s = f.state, alert = new TerrainAlert(heightAt, []);
  let warned = null;
  for (let i = 0; i < 120 * 10 && !s.crashed; i++) {
    f.update(1 / 120, {});
    if (s.crashed) break;
    if (alert.update(s, f.type).level === 'warning' && warned === null) warned = { at: s.flightTime, clearance: s.position.y - heightAt(s.position.x, s.position.z) - gear };
  }
  return { warned, crashed: s.crashed, contact: s.flightTime, samples: alert.samples };
}

test('an actual intersection with the path warns even when the clearance shrinks less than the closure', () => {
  // An 8 m rise 500 m ahead (5 s at 100 m/s): under the 15 m closure, but above the wheels' current height.
  const rise = (x, z) => z <= -500 ? FLAT + 8 : FLAT;
  const a = skimming(rise), r = sampleTerrain(a.s, a.f.type, rise, { airports: [] });
  assert.equal(r.level, 'warning'); assert.equal(r.cause, 'rising');
  assert.ok(r.time > 3.7 && r.time <= 5, `contact ${r.time.toFixed(2)} s ahead`);
  assert.ok(r.probes <= TERRAIN_ALERT.fixedWing.probes + 1);
  const flown = untilContact(skimming(rise).f, rise, a.gear);
  assert.ok(flown.crashed, 'flown on, the jet meets the rise');
  assert.ok(flown.warned && flown.warned.clearance > 0, 'warned while still airborne');
  assert.ok(flown.contact - flown.warned.at >= 4.5, `pull-up ${(flown.contact - flown.warned.at).toFixed(1)} s before contact`);

  // A shallow 0.5 m/s descent from 2 m over flat ground: contact in about 4 s, inside the 6 s descent window.
  const b = skimming(flat, { pitch: -0.005, verticalSpeed: -0.5 }), d = sampleTerrain(b.s, b.f.type, flat, { airports: [] });
  assert.equal(d.level, 'warning'); assert.equal(d.cause, 'descent');
  assert.ok(Math.abs(d.time - 4) < 0.3, `contact ${d.time.toFixed(2)} s ahead`);
  const sank = untilContact(skimming(flat, { pitch: -0.005, verticalSpeed: -0.5 }).f, flat, b.gear);
  assert.ok(sank.crashed, 'gear up, the shallow descent ends on the ground');
  assert.ok(sank.warned && sank.warned.clearance > 0, 'warned while still airborne');
  assert.ok(sank.contact - sank.warned.at >= 3.5, `warned ${(sank.contact - sank.warned.at).toFixed(1)} s before contact`);
  assert.ok(sank.samples <= Math.floor(sank.contact / TERRAIN_ALERT.fixedWing.interval) + 1, 'at the usual cadence');

  // The same skim with nothing rising and no sink stays quiet: clearance never reaches zero.
  const level = skimming(flat);
  assert.equal(sampleTerrain(level.s, level.f.type, flat, { airports: [] }).level, 'clear');
  // A rise smaller than the wheels' clearance is passed over, not an intersection.
  const bump = (x, z) => z <= -500 ? FLAT + 1.5 : FLAT, over = skimming(bump);
  assert.equal(sampleTerrain(over.s, over.f.type, bump, { airports: [] }).level, 'clear');
});

test('helicopters: translation into a cliff warns, hovering beside it or settling gently does not', () => {
  // A cliff 120 m east (sideways for a north-facing helicopter), 60 m tall; the helicopter is 15 m up.
  const cliff = (x) => x >= 120 ? FLAT + 60 : FLAT;
  const f = new FlightController(cliff, 'helicopter'), s = f.state;
  s.position.set(0, FLAT + 15, 0); s.heading = 0; f.setQuaternion();
  s.velocity.set(0, 0, 0); f.update(1 / 120, {});
  const hover = new TerrainAlert(cliff, []);
  assert.equal(hover.update(s, f.type).level, 'clear', 'hovering in front of the cliff');
  // Sideways at 15 m/s: the cliff is 8 s away along the actual travel, inside the 10 s horizon.
  s.velocity.set(15, 0, 0);
  const side = sampleTerrain(s, f.type, cliff, { airports: [] });
  assert.equal(side.cause, 'rising'); assert.ok(side.time > 7 && side.time <= 8.2, `${side.time}`);
  assert.equal(side.level, 'caution');
  s.position.x = 70;
  assert.equal(sampleTerrain(s, f.type, cliff, { airports: [] }).level, 'warning', '50 m from the cliff at 15 m/s');
  // Travelling away from it (west) is clear.
  s.position.x = 0; s.velocity.set(-15, 0, 0);
  assert.equal(sampleTerrain(s, f.type, cliff, { airports: [] }).level, 'clear');

  // Settling at 1.5 m/s onto flat ground (an ordinary off-field landing) never warns; dropping at 5 m/s does.
  s.position.set(0, FLAT + 10, 0); s.velocity.set(0, -1.5, 0);
  assert.equal(sampleTerrain(s, f.type, flat, { airports: [] }).level, 'clear');
  // Settling just as gently while drifting forward, so the path itself meets the ground, stays quiet too.
  s.position.set(0, FLAT + 3, 0); s.velocity.set(0, -1.5, -4);
  assert.equal(sampleTerrain(s, f.type, flat, { airports: [] }).level, 'clear');
  s.velocity.set(0, -5, 0);
  const drop = sampleTerrain(s, f.type, flat, { airports: [] });
  assert.equal(drop.level, 'warning'); assert.equal(drop.cause, 'descent');
});

/** The landing tests' feedback pilot on the real world, tracking the worst alert until touchdown. */
function approach(id, field) {
  const flight = new FlightController(groundHeight, id), mission = new LandingMission(field), s = flight.state;
  const alert = new TerrainAlert(worldHeight);
  mission.start(flight);
  const pilot = new FlightInputs(0), m = mission.profile;
  let worst = 'clear';
  for (let frame = 1; frame < 90 * 60 && mission.active; frame++) {
    const height = s.position.y - field.elevation - m.clearance;
    const sink = height < 8 ? Math.min(1.8, m.maxSink * 0.65) : m.speed * m.slope;
    const idleSink = Math.max(0, 0.32 - s.spool) * (flight.type.flight.idleSink ?? 6);
    const desiredPitch = Math.asin((-sink + idleSink) / Math.max(s.speed, 1));
    pilot.set({ pitch: m.helicopter ? 0 : (desiredPitch - s.pitch) * 4, throttle: s.grounded || (m.helicopter && s.throttle > m.throttle - 0.03) ? -1 : 0 }, (frame - 1) / 60);
    pilot.advance(frame / 60, (step, c) => {
      if (!mission.active) return;
      flight.update(step, c); mission.update(step, s);
      const level = alert.update(s, flight.type).level;
      if (!s.touchdown && LEVELS[level] > LEVELS[worst]) worst = level;
    });
  }
  return { mission, worst, touchdown: s.touchdown };
}

test('normal aligned approaches to real runways stay quiet all the way to touchdown', () => {
  const cases = [['trainer', 'alpine-field'], ['jet', 'alpine-field'], ['biplane', 'verdance-meadow'], ['widebody', 'orvane-regional'], ['airliner', 'orvane-regional'], ['helicopter', 'alpine-field'], ['tandem', 'serein-lakeside']];
  for (const [id, airport] of cases) {
    const a = airportById(airport);
    for (const rw of [a.runway, a.reciprocal]) {
      const r = approach(id, runwayDirection(a, rw));
      assert.ok(r.touchdown, `${id} ${a.ident} ${rw}: touched down`);
      assert.notEqual(r.mission.status, 'failed', `${id} ${a.ident} ${rw}: ${r.mission.reason}`);
      assert.equal(r.worst, 'clear', `${id} ${a.ident} ${rw}: no terrain alert on the approach`);
    }
  }
});

test('an active landing mission still warns of a ridge between the aircraft and the runway', () => {
  // A 120 m bank 700 m short of the threshold, across the extended centreline.
  const blocked = (x, z) => z > 1250 && z < 1350 ? FLAT + 120 : FLAT;
  const flight = new FlightController(blocked, 'jet'), mission = new LandingMission(FIELD);
  const s = mission.start(flight), alert = new TerrainAlert(blocked, [FIELD]);
  assert.equal(mission.active, true);
  const seen = new Set();
  for (let i = 0; i < 120 * 12 && !s.crashed; i++) { flight.update(1 / 120, {}); mission.update(1 / 120, s); seen.add(alert.update(s, flight.type).level); }
  assert.ok(seen.has('warning'), `warned: ${[...seen]}`);
  // Without the bank the same approach on the same field is quiet.
  const clearFlight = new FlightController(flat, 'jet'), clearMission = new LandingMission(FIELD);
  const c = clearMission.start(clearFlight), quiet = new TerrainAlert(flat, [FIELD]);
  assert.equal(sampleTerrain(c, clearFlight.type, flat, { airports: [FIELD] }).level, 'clear');
  assert.equal(quiet.update(c, clearFlight.type).level, 'clear');
});

test('landing runways: aligned either way counts, crossing a runway or landing beside it does not', () => {
  const on = { x: FIELD.x, z: FIELD.z };
  assert.equal(landingRunway(on, FIELD.heading, [FIELD]), FIELD);
  assert.equal(landingRunway(on, FIELD.heading + Math.PI, [FIELD]), FIELD, 'the reciprocal runway');
  assert.equal(landingRunway(on, FIELD.heading + Math.PI / 2, [FIELD]), null, 'crossing at right angles');
  assert.equal(landingRunway({ x: FIELD.x + 200, z: FIELD.z }, FIELD.heading, [FIELD]), null, 'parallel to it in the grass');
  assert.equal(landingRunway({ x: FIELD.x, z: FIELD.z + FIELD.runwayLength / 2 + 300 }, FIELD.heading, [FIELD]), null, '300 m short');
});

test('takeoff and climb-out from a runway stay quiet', () => {
  const f = new FlightController(flat, 'jet'), s = f.runwayStart(0, FLAT + (f.type.groundClearance ?? 2.8), 0, 0);
  const alert = new TerrainAlert(flat, [FIELD]), seen = new Set();
  for (let i = 0; i < 120 * 60; i++) { f.update(1 / 120, { throttle: 1, pitch: s.speed > f.type.flight.stallSpeed * 1.2 ? 0.5 : 0 }); seen.add(alert.update(s, f.type).level); }
  assert.equal(s.grounded, false, 'airborne'); assert.ok(s.position.y > FLAT + 100, 'climbing away');
  assert.deepEqual([...seen], ['clear']);
});

test('ground, crashed and suppressed (finished mission) states are quiet', () => {
  const f = cruise('jet', ridge, { x: -1300, y: 420 }), alert = new TerrainAlert(ridge, []);
  assert.equal(alert.update(f.state, f.type).level, 'warning');
  assert.equal(new TerrainAlert(ridge, []).update(f.state, f.type, true).level, 'clear', 'suppressed');
  f.state.crashed = true;
  assert.equal(sampleTerrain(f.state, f.type, ridge, { airports: [] }).level, 'clear', 'crashed');
  f.state.crashed = false; f.state.grounded = true;
  assert.equal(sampleTerrain(f.state, f.type, ridge, { airports: [] }).level, 'clear', 'grounded');
});

test('resets, aircraft changes and hysteresis', () => {
  const f = cruise('jet', ridge, { x: -1300, y: 420 }), alert = new TerrainAlert(ridge, []);
  f.state.flightTime = 30;
  assert.equal(alert.update(f.state, f.type).level, 'warning');
  // A reset: flight time runs backwards and the aircraft is somewhere safe. The alert clears at once.
  f.reset(); f.update(1 / 120, {});
  assert.equal(alert.update(f.state, f.type).level, 'clear');
  // An aircraft change forgets the previous alert too.
  const g = cruise('jet', ridge, { x: -1300, y: 420 }); g.state.flightTime = 5;
  alert.update(g.state, g.type);
  assert.equal(alert.level, 'warning');
  const h = cruise('trainer', flat); h.state.flightTime = 6;
  assert.equal(alert.update(h.state, h.type).level, 'clear');

  // Hysteresis: once raised, an alert holds for `hold` flight seconds even if the cause vanishes,
  // and the margin widens while it shows, so a path skimming the margin does not flicker.
  let ground = ridge;
  const shifting = (x, z) => ground(x, z), j = cruise('jet', shifting, { x: -100 }), hold = new TerrainAlert(shifting, []);
  assert.equal(hold.update(j.state, j.type).level, 'caution');
  ground = flat;
  const t0 = j.state.flightTime;
  let cleared = null;
  for (let i = 0; i < 120 * 3; i++) { j.update(1 / 120, {}); if (hold.update(j.state, j.type).level === 'clear' && cleared === null) cleared = j.state.flightTime - t0; }
  assert.ok(cleared >= TERRAIN_ALERT.fixedWing.hold && cleared < TERRAIN_ALERT.fixedWing.hold + 2 * TERRAIN_ALERT.fixedWing.interval, `cleared after ${cleared}`);

  // A ridge top exactly 50 m below the path: over the 45 m margin, but inside it plus hysteresis.
  const skim = (x) => x <= -1500 && x >= -2000 ? 110 : FLAT, k = cruise('jet', skim, { x: -100, y: 160 });
  const g2 = k.type.groundClearance ?? 2.8;
  k.state.position.y = 110 + g2 + 50; k.holdAltitude = k.state.position.y;
  assert.equal(sampleTerrain(k.state, k.type, skim, { airports: [] }).level, 'clear', 'outside the margin');
  assert.notEqual(sampleTerrain(k.state, k.type, skim, { airports: [], extra: TERRAIN_ALERT.fixedWing.hysteresis }).level, 'clear', 'inside it while alerting');
});

test('probes and cadence are strictly bounded', () => {
  for (const id of ['jet', 'fighter', 'airliner', 'helicopter', 'tandem']) {
    let calls = 0;
    const counted = (x, z) => { calls++; return worldHeight(x, z); };
    const f = new FlightController(counted, id), alert = new TerrainAlert(counted, []);
    f.update(1 / 120, {}); calls = 0;
    const c = f.type.flight.rotorcraft ? TERRAIN_ALERT.rotorcraft : TERRAIN_ALERT.fixedWing;
    const r = sampleTerrain(f.state, f.type, counted, { airports: [] });
    assert.ok(r.probes <= c.probes + 1 && calls === r.probes, `${id}: ${r.probes} lookups in one sample`);
    // 10 flight seconds of frames at 120 Hz: at most one sample per interval.
    let alertCalls = 0;
    const tallied = new TerrainAlert((x, z) => { alertCalls++; return worldHeight(x, z); }, []);
    for (let i = 0; i < 1200; i++) { f.update(1 / 120, {}); tallied.update(f.state, f.type); }
    const maxSamples = Math.floor(10 / c.interval) + 1;
    assert.ok(tallied.samples <= maxSamples, `${id}: ${tallied.samples} samples`);
    assert.ok(alertCalls <= maxSamples * (c.probes + 1), `${id}: ${alertCalls} lookups in 10 s`);
  }
  // A paused flight (flight time not advancing) is never resampled.
  const f = cruise('jet', flat), alert = new TerrainAlert(flat, []);
  alert.update(f.state, f.type); const n = alert.samples;
  for (let i = 0; i < 100; i++) alert.update(f.state, f.type);
  assert.equal(alert.samples, n);
  // The look-ahead never reaches beyond its distance cap, however fast the aircraft.
  const fast = cruise('fighter', flat); fast.state.speed = 600;
  let far = 0;
  sampleTerrain(fast.state, fast.type, (x, z) => { far = Math.max(far, Math.hypot(x - fast.state.position.x, z - fast.state.position.z)); return FLAT; }, { airports: [] });
  assert.ok(far <= TERRAIN_ALERT.fixedWing.maxDistance + 1, `${far.toFixed(0)} m`);
});

test('escalation text names terrain and the action, through the existing notice', () => {
  assert.equal(terrainNotice('warning'), 'TERRAIN · Pull up');
  assert.equal(terrainNotice('warning', true), 'TERRAIN · Raise collective');
  assert.match(terrainNotice('caution'), /^Terrain ahead · /);
  assert.equal(terrainNotice('clear'), '');
});

test('reproducible real-world ridge: the look-ahead warns about ten seconds ahead where the old rule gave about three', () => {
  const level = ridgeRun();
  assert.ok(level.crashed, 'flown level into the north-western range');
  const e = level.events;
  assert.ok(e.crash - e.before < 5, `old 100 m rule: ${(e.crash - e.before).toFixed(1)} s`);
  assert.ok(e.crash - e.caution > 15, `caution ${(e.crash - e.caution).toFixed(1)} s ahead`);
  assert.ok(e.crash - e.warning > 9, `warning ${(e.crash - e.warning).toFixed(1)} s ahead`);
  const climbed = ridgeRun({ respond: true, seconds: 40 });
  assert.equal(climbed.crashed, false, 'climbing at the caution clears the ridge');
  assert.ok(climbed.events.cleared !== null && climbed.events.warning === null, 'and the alert clears without escalating');
});
