import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController } from '../src/flight.js';
import { FLEET } from '../src/fleet.js';
import { LandingMission } from '../src/landing-mission.js';
import { CheckpointCourse } from '../src/checkpoint-course.js';
import { Activities } from '../src/activities.js';
import { AirportSelection } from '../src/airport-selection.js';
import { airportById, runwayDirection } from '../src/airports.js';
import { KNOT, WIND_PRESETS, normalizeWind } from '../src/wind.js';
import { CrosswindPractice, PRACTICE, crosswindAdvice, practiceAvailability, practiceBrief, practiceField } from '../src/crosswind-practice.js';
import { groundHeight } from '../src/world.js';
import { FlightInputs } from '../src/controls.js';
import { TerrainAlert } from '../src/terrain-alert.js';
import { flyApproach, setup } from './crosswind-pilot.js';

const DEG = Math.PI / 180, dt = 1 / 120;
const FIXED_WING = Object.keys(FLEET).filter(id => !FLEET[id].flight.rotorcraft);
const ROTORCRAFT = Object.keys(FLEET).filter(id => FLEET[id].flight.rotorcraft);
const windOf = flight => flight.windSnapshot().config;

test('one exercise: Alpine Field 36 in a modest, gently gusting crosswind from the right', () => {
  const field = practiceField();
  assert.equal(field.id, 'alpine-field'); assert.equal(field.runway, '36'); assert.equal(field.heading, 0);
  assert.equal(PRACTICE.recommended, 'trainer'); assert.equal(FLEET.trainer.name, 'Mira T2');
  assert.deepEqual(normalizeWind(PRACTICE.wind), PRACTICE.wind, 'already a bounded configuration');
  const trainer = practiceBrief(FLEET.trainer), jet = practiceBrief(FLEET.jet);
  assert.equal(trainer.report, '080° 9G12 kt'); assert.equal(trainer.side, 'right');
  assert.ok(trainer.crosswind / KNOT > 8.5 && trainer.crosswind / KNOT < 9.5, `${trainer.crosswind / KNOT} kt across`);
  assert.ok(trainer.gustCrosswind / KNOT < 12.5 && trainer.headwind / KNOT > 0 && trainer.headwind / KNOT < 3);
  // The crab the brief quotes: about 8° in the trainer, less in the faster jet.
  assert.ok(trainer.crab > 7 * DEG && trainer.crab < 9 * DEG); assert.ok(jet.crab > 4 * DEG && jet.crab < trainer.crab);
});

test('fixed-wing aircraft that suit the runway may fly it; rotorcraft and unsuitable pairings are refused by name', () => {
  for (const id of FIXED_WING) assert.equal(practiceAvailability(FLEET[id]).available, true, id);
  for (const id of ROTORCRAFT) {
    const fit = practiceAvailability(FLEET[id]);
    assert.equal(fit.available, false); assert.match(fit.reason, /fixed-wing/);
  }
  // The same rule the landing mission applies: a jet on the short Col de Brume strip is refused with the runway's reason.
  const brume = runwayDirection(airportById('brume-col'));
  const fit = practiceAvailability(FLEET.jet, brume);
  assert.equal(fit.available, false); assert.match(fit.reason, /Needs .* Col de Brume/);
  const { flight, practice } = setup('helicopter', 'breeze');
  const before = flight.state.position.toArray();
  assert.equal(practice.start(flight), null, 'a refused start changes nothing');
  assert.equal(windOf(flight), WIND_PRESETS.breeze); assert.deepEqual(flight.state.position.toArray(), before);
  assert.equal(practice.owning, false); assert.equal(practice.running, false);
});

test('an attempt owns the wind: retries keep it, ending restores the pilot selection exactly once', () => {
  const { flight, practice, landing } = setup('trainer', 'gusts');
  practice.start(flight);
  assert.equal(windOf(flight), PRACTICE.wind); assert.equal(practice.previous, WIND_PRESETS.gusts);
  for (let i = 0; i < 3; i++) { flight.update(0.5); practice.start(flight); }
  assert.equal(practice.previous, WIND_PRESETS.gusts, 'a retry never stores the practice wind as the pilot choice');
  assert.equal(windOf(flight), PRACTICE.wind); assert.equal(landing.status, 'flying');
  assert.equal(practice.end(), true);
  assert.equal(windOf(flight), WIND_PRESETS.gusts); assert.equal(landing.status, 'idle');
  // A later pilot choice is never overwritten by a second end.
  flight.setWind('breeze', { immediate: true });
  assert.equal(practice.end(), false); assert.equal(windOf(flight), WIND_PRESETS.breeze);
  // The pilot's choice made during the attempt is the one handed back.
  practice.start(flight); assert.equal(practice.holdPilotChoice('calm'), true);
  assert.equal(windOf(flight), PRACTICE.wind, 'the attempt keeps its own wind');
  assert.equal(practice.pilotWind(windOf(flight)), WIND_PRESETS.calm, 'runway advice reads the pilot wind, not the practice wind');
  practice.end(); assert.equal(windOf(flight), WIND_PRESETS.calm);
  assert.equal(practice.pilotWind(WIND_PRESETS.gusts), WIND_PRESETS.gusts, 'outside an attempt the live wind is the pilot wind');
  assert.equal(practice.holdPilotChoice('gusts'), false, 'outside an attempt the choice applies directly');
});

test('retry restores the same start and the same gust sequence, also after a crash', () => {
  const { flight, practice, activities, s } = setup('trainer', 'breeze');
  const run = () => {
    activities.startCrosswind(flight);
    const start = { position: s.position.toArray(), heading: s.heading, speed: s.speed, throttle: s.throttle, flaps: s.flaps, time: flight.windSnapshot().time };
    const trace = [];
    for (let i = 0; i < 6 / dt; i++) { flight.update(dt, { roll: i < 120 ? 0.3 : 0 }); activities.update(dt, s); if (i % 60 === 0) trace.push([s.windVelocity.x, s.windVelocity.z, s.position.x, s.position.z]); }
    return { start, trace };
  };
  const first = run(), second = run();
  assert.equal(first.start.time, 0);
  assert.deepEqual(second, first);
  // A crash ends the attempt with the landing mission's result; Retry flies the same approach in the same wind.
  Object.assign(s, { crashed: true }); activities.update(dt, s);
  assert.equal(practice.landing.status, 'failed'); assert.equal(activities.kind, 'crosswind'); assert.equal(activities.finished, true);
  assert.equal(windOf(flight), PRACTICE.wind, 'the result screen keeps the attempt wind');
  assert.deepEqual(run(), first);
  activities.cancel(); assert.equal(windOf(flight), WIND_PRESETS.breeze);
});

test('every way out hands the wind back once: free flight, other activities, aircraft change and external reset', () => {
  const exits = {
    'free flight': x => x.activities.cancel(),
    'landing mission': x => x.activities.startLanding(x.flight),
    'checkpoint course': x => x.activities.startCourse(x.flight),
    'aircraft change': x => { x.flight.setAircraft('jet'); x.flight.update(dt); x.activities.update(dt, x.s); },
    'external reset': x => { x.flight.update(1); x.activities.update(1, x.s); x.flight.reset(); x.flight.update(dt); x.activities.update(dt, x.s); },
  };
  for (const [label, exit] of Object.entries(exits)) {
    const x = setup('trainer', 'gusts'); let calls = 0;
    const setWind = x.flight.setWind.bind(x.flight); x.flight.setWind = (...a) => { calls++; return setWind(...a); };
    x.activities.startCrosswind(x.flight); assert.equal(x.activities.kind, 'crosswind', label);
    exit(x);
    assert.equal(windOf(x.flight), WIND_PRESETS.gusts, label); assert.equal(x.practice.owning, false, label);
    assert.notEqual(x.activities.kind, 'crosswind', label);
    // One call to take the wind, one to give it back; later exits never set it again.
    x.activities.cancel(); x.activities.update(dt, x.s);
    assert.equal(calls, 2, `${label}: ${calls} wind changes`);
  }
});

test('mutually exclusive with landing missions and the course; a refused start leaves the activity underway', () => {
  const x = setup('trainer');
  x.activities.startCourse(x.flight); assert.equal(x.activities.kind, 'course');
  x.activities.startCrosswind(x.flight);
  assert.equal(x.activities.kind, 'crosswind'); assert.equal(x.course.status, 'idle'); assert.equal(x.landing.status, 'flying');
  // The practice start is the landing mission's own start, at the practice runway, in the practice wind.
  const reference = new FlightController(groundHeight, 'trainer'); new LandingMission(practiceField()).start(reference);
  assert.deepEqual(x.s.position.toArray(), reference.state.position.toArray());
  x.activities.startLanding(x.flight, runwayDirection(airportById('serein-lakeside')));
  assert.equal(x.activities.kind, 'landing'); assert.equal(x.landing.field.id, 'serein-lakeside'); assert.equal(windOf(x.flight), WIND_PRESETS.calm);
  const h = setup('helicopter'); h.activities.startCourse(h.flight);
  h.activities.startLanding(h.flight); const before = h.landing.snapshot();
  assert.equal(h.activities.startCrosswind(h.flight), null);
  assert.equal(h.activities.kind, 'landing'); assert.deepEqual(h.landing.snapshot(), before);
  // A normal mission never touches the wind.
  const n = setup('trainer', 'breeze'); n.activities.startLanding(n.flight); assert.equal(windOf(n.flight), WIND_PRESETS.breeze);
});

test('the selected destination stays outside the attempt', () => {
  const selection = new AirportSelection('orvane-regional', '32'), x = setup('trainer');
  x.activities.startCrosswind(x.flight);
  assert.equal(x.landing.field.id, 'alpine-field'); assert.equal(selection.id, 'orvane-regional'); assert.equal(selection.runway, '32');
  x.activities.cancel(); assert.equal(selection.field.id, 'orvane-regional');
});

for (const id of ['trainer', 'jet']) {
  test(`${FLEET[id].name}: crab, straighten, flare and stop on the centreline with ordinary inputs; uncorrected drifts off`, () => {
    const x = setup(id); x.activities.startCrosswind(x.flight);
    const r = flyApproach(x);
    assert.equal(r.status, 'success', JSON.stringify({ reason: r.reason, td: r.touchdown }));
    assert.equal(x.s.crashed, false); assert.ok(x.s.speed < 3);
    const fb = r.feedback, td = r.touchdown;
    assert.ok(fb.crab > 4 * DEG && fb.crab < 11 * DEG, `crabbed right into the wind: ${fb.crab / DEG}°`);
    assert.ok(Math.abs(fb.thresholdCross) < 3, `on the centreline at the threshold: ${fb.thresholdCross} m`);
    assert.ok(Math.abs(fb.touchdownCrab) < 2 * DEG, 'straightened for touchdown');
    assert.ok(Math.abs(td.cross) < 8 && td.sink < x.landing.profile.maxSink && td.along > 150 && td.along < 400);
    assert.ok(r.maxOffset < 10, `held within ${r.maxOffset} m of the centreline`);
    assert.match(crosswindAdvice(fb, x.landing), /^Crabbed \d+° right to hold the centreline and straightened/);
    // The identical pitch, power and brake pilot with hands off the lateral controls is blown off the runway.
    const u = setup(id); u.activities.startCrosswind(u.flight);
    const off = flyApproach(u, { correct: false });
    assert.equal(off.status, 'failed'); assert.equal(off.reason, 'Touchdown outside the runway');
    assert.ok(off.feedback.thresholdCross < -80, `drifted left ${-off.feedback.thresholdCross} m by the threshold`);
    assert.ok(Math.abs(off.feedback.crab) < 0.1 * DEG && off.touchdown.cross < -100);
    assert.match(crosswindAdvice(off.feedback, u.landing), /^No crab into the wind on final · the wind carried you \d+ m left/);
  });
}

test('a crabbed touchdown is named in the feedback; the mission keeps its own 12° alignment rule', () => {
  const x = setup('trainer'); x.activities.startCrosswind(x.flight);
  const r = flyApproach(x, { straighten: null });
  assert.ok(r.feedback.touchdownCrab > 6 * DEG);
  assert.ok(r.touchdown.alignment < 12, 'within the landing mission rule, so it still counts');
  assert.match(crosswindAdvice(r.feedback, x.landing), /touched down still \d+° right: straighten with rudder in the flare/);
});

test('touch yoke alone (no rudder on fixed-wing phones): bank to crab, level wings, land with the crab in', () => {
  for (const id of ['trainer', 'jet']) {
    const x = setup(id); x.activities.startCrosswind(x.flight);
    const r = flyApproach(x, { rudder: false });
    assert.equal(r.status, 'success', `${id}: ${r.reason}`);
    assert.ok(r.feedback.crab > 3 * DEG && Math.abs(r.feedback.thresholdCross) < 8, `${id}: crab ${r.feedback.crab / DEG}°, ${r.feedback.thresholdCross} m`);
    assert.ok(Math.abs(r.touchdown.bank) < 0.05 && r.touchdown.alignment < 12);
  }
});

test('low frame rates fly the same approach: 30, 20 and 10 fps land within a few metres of 60 fps', () => {
  const at = rate => { const x = setup('trainer'); x.activities.startCrosswind(x.flight); return flyApproach(x, { rate }); };
  const ref = at(60);
  for (const rate of [30, 20, 10]) {
    const r = at(rate);
    assert.equal(r.status, 'success', `${rate} fps: ${r.reason}`);
    assert.ok(Math.hypot(r.touchdown.along - ref.touchdown.along, r.touchdown.cross - ref.touchdown.cross) < 3, `${rate} fps touchdown`);
    assert.ok(Math.abs(r.feedback.crab - ref.feedback.crab) < 0.5 * DEG, `${rate} fps crab`);
  }
});

test('pause and dialogs freeze wind and mission time: no-time updates change nothing', () => {
  const { flight, practice, activities, s } = setup('trainer');
  activities.startCrosswind(flight);
  for (let i = 0; i < 2 / dt; i++) { flight.update(dt); activities.update(dt, s); }
  const wind = flight.windSnapshot(), feedback = practice.feedback(), mission = practice.landing.snapshot(), position = s.position.toArray();
  // Paused, the simulator calls nothing; a stray zero, negative or NaN step is ignored by both.
  for (const noTime of [0, -1, NaN]) { flight.update(noTime); activities.update(noTime, s); }
  assert.deepEqual(flight.windSnapshot(), wind); assert.deepEqual(practice.feedback(), feedback);
  assert.deepEqual(practice.landing.snapshot(), mission); assert.deepEqual(s.position.toArray(), position);
  assert.equal(activities.kind, 'crosswind');
});

test('feedback words follow the correction: too little crab, too much, and a result outside the attempt', () => {
  const mission = { status: 'failed' };
  assert.match(crosswindAdvice({ crab: 5 * DEG, thresholdCross: -30, touchdownCrab: 0 }, mission), /crossed the threshold 30 m left of centre: turn further right sooner/);
  assert.match(crosswindAdvice({ crab: 14 * DEG, thresholdCross: 25, touchdownCrab: 0 }, mission), /25 m right of centre: ease the crab back toward left sooner/);
  assert.match(crosswindAdvice({ crab: null, thresholdCross: null, touchdownCrab: null }, mission), /^No crab into the wind on final\. Turn a few degrees right early/);
  const practice = new CrosswindPractice(new LandingMission());
  assert.equal(practice.snapshot().landing, 'idle'); assert.equal(practice.guidance({}), null);
});

test('at one frame a second the approach keeps a sane load factor: no float-remainder slivers reach the flight model', () => {
  const x = setup('jet'); x.activities.startCrosswind(x.flight);
  const inputs = new FlightInputs(1000.123); let now = 1000.123, worst = 0, shortest = Infinity;
  for (let frame = 0; frame < 40; frame++) {
    now += 0.9 + 0.37 * (frame % 3); inputs.set({ yaw: frame % 4 < 2 ? 1 : 0 }, now - 0.1);
    inputs.advance(now, (step, c) => { shortest = Math.min(shortest, step); x.flight.update(step, c); x.activities.update(step, x.s); });
    worst = Math.max(worst, Math.abs(x.s.gForce - 1));
  }
  assert.ok(shortest > 1e-6, `shortest slice ${shortest} s`); assert.ok(worst < 0.2, `load factor off by ${worst} g`);
});

test('terrain alerts: a crabbed approach on the centreline stays quiet; the uncorrected drift is warned', () => {
  const watch = (id, opts) => {
    const x = setup(id); x.activities.startCrosswind(x.flight);
    const alert = new TerrainAlert(groundHeight), update = x.activities.update.bind(x.activities), seen = { caution: 0, warning: 0, lastCaution: 0 };
    x.activities.update = (step, s) => { update(step, s); const { level } = alert.update(s, x.flight.type); if (level !== 'clear') { seen[level]++; seen.lastCaution = s.flightTime; } };
    return { ...flyApproach(x, opts), seen };
  };
  for (const id of ['trainer', 'jet']) {
    const flown = watch(id);
    assert.equal(flown.status, 'success');
    // The start is lined up with the runway, not crabbed: until the crab is set the drifting path may be cautioned,
    // but the alert's hysteresis never latches into a warning down a good final.
    assert.equal(flown.seen.warning, 0, `${id}: no terrain warning on a corrected approach`);
    assert.ok(flown.seen.lastCaution < 3, `${id}: caution clears once crabbed (last at ${flown.seen.lastCaution} s)`);
    assert.ok(watch(id, { correct: false }).seen.warning > 0, `${id}: the uncorrected drift is warned`);
  }
});
