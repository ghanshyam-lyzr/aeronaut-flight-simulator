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
import { CrosswindPractice, FLARE_HEIGHT, PRACTICE, STRAIGHTEN_HEIGHT, crosswindAdvice, practiceAvailability, practiceBrief, practiceCue, practiceField } from '../src/crosswind-practice.js';
import { groundHeight } from '../src/world.js';
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
  assert.match(crosswindAdvice(r.feedback, x.landing), /touched down still \d+° right: straighten with rudder at about 10 ft/);
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

for (const id of ['trainer', 'jet']) {
  test(`${FLEET[id].name}: the pilot who does what the live cue says lands near the centreline, with rudder and with the yoke alone`, () => {
    for (const rudder of [true, false]) {
      const x = setup(id); x.activities.startCrosswind(x.flight);
      const r = flyApproach(x, { followCue: true, rudder });
      assert.equal(r.status, 'success', `${id} rudder=${rudder}: ${r.reason}`);
      assert.ok(Math.abs(r.touchdown.cross) < 6, `${id} rudder=${rudder}: touchdown ${r.touchdown.cross} m off centre`);
      // The flare cue keeps the crab; "Straighten" never shows above 10 ft, and the yoke is never told to straighten.
      const keep = r.cues.find(c => c.cue.startsWith('Keep the crab')), straighten = r.cues.filter(c => c.cue.startsWith('Straighten'));
      assert.ok(keep && keep.height <= FLARE_HEIGHT && keep.height >= STRAIGHTEN_HEIGHT, JSON.stringify(r.cues.slice(-4)));
      if (rudder) {
        assert.ok(straighten.length && straighten.every(c => c.height <= STRAIGHTEN_HEIGHT), JSON.stringify(r.cues.slice(-4)));
        assert.ok(Math.abs(r.feedback.touchdownCrab) < 2 * DEG, 'straightened when told');
      } else {
        assert.equal(straighten.length, 0); assert.ok(r.cues.some(c => /^Wings level/.test(c.cue)));
        assert.ok(r.feedback.touchdownCrab > 3 * DEG && Math.abs(r.touchdown.bank) < 0.05, 'landed level with the crab in');
      }
    }
  });
}

test('the live cue: drift, offset, crab, flare and straighten in order of height; the mission cue past 12°', () => {
  const at = o => practiceCue({ height: 40, alignment: 5 * DEG, crab: 5 * DEG, drift: 0, cross: 0, ...o });
  assert.equal(at({ alignment: 13 * DEG }), null, 'far off the runway the landing mission keeps its align cue');
  assert.equal(at({ drift: -3 }), 'Drifting left · turn into the wind with E');
  assert.equal(at({ drift: 3 }), 'Drifting right · ease the crab back with Q');
  assert.equal(at({ cross: -12 }), '12 m left of centre · steer gently back');
  assert.equal(at({ crab: 8 * DEG }), 'Crabbed 8° right · tracking the centreline');
  assert.equal(at({ crab: 0 }), 'Crab right into the wind with E');
  assert.equal(at({ drift: -3, rudder: false }), 'Drifting left · turn into the wind with a gentle right bank');
  // Between 8 m and 10 ft: flare and keep the crab, even if drifting; below 10 ft: straighten (rudder) or stay level (yoke).
  assert.equal(at({ height: 6, drift: -3 }), 'Keep the crab · flare gently with S · straighten at 10 ft with Q');
  assert.equal(at({ height: 6, rudder: false }), 'Keep the crab · level the wings and flare gently');
  assert.equal(at({ height: 2 }), 'Straighten now with Q · hold the flare');
  assert.equal(at({ height: 2, crab: 0.5 * DEG }), 'Nose lined up · hold the flare and let it settle');
  assert.equal(at({ height: 2, rudder: false }), 'Wings level · let it settle, the crab can stay in');
  assert.ok(STRAIGHTEN_HEIGHT * 3.28084 > 9 && STRAIGHTEN_HEIGHT * 3.28084 < 11, 'the brief says about 10 ft');
});

test('result advice names only what was measured, and only controls the pilot has', () => {
  const ok = { status: 'success' }, failed = { status: 'failed' };
  // A phone pilot lands level with the crab in, as the brief and cue tell them: no rudder advice.
  const phone = crosswindAdvice({ crab: 9 * DEG, thresholdCross: 0.5, touchdownCrab: 9 * DEG }, ok, 'right', { rudder: false });
  assert.doesNotMatch(phone, /rudder/); assert.match(phone, /touched down wings level with 9° of crab, within the 12° the landing accepts/);
  assert.match(crosswindAdvice({ crab: 9 * DEG, thresholdCross: 0.5, touchdownCrab: 9 * DEG }, ok), /straighten with rudder at about 10 ft/);
  // Ended before the threshold: no centreline or straightening claim.
  const early = crosswindAdvice({ crab: 7 * DEG, thresholdCross: null, touchdownCrab: null }, failed);
  assert.equal(early, 'Crabbed 7° right on final; the attempt ended before the threshold.');
  assert.doesNotMatch(early, /centreline|straighten/);
  // Over the threshold on centre but no touchdown recorded (runway passed in the air): no straightening claim.
  const noTouch = crosswindAdvice({ crab: 7 * DEG, thresholdCross: 1, touchdownCrab: null }, failed);
  assert.equal(noTouch, 'Crabbed 7° right and crossed the threshold on the centreline.');
  assert.match(crosswindAdvice({ crab: 8 * DEG, thresholdCross: 0, touchdownCrab: 0.01 }, ok), /^Crabbed 8° right to hold the centreline and straightened to 1° for touchdown\.$/);
  // A real attempt that ends before the threshold reports it that way.
  const x = setup('trainer'); x.activities.startCrosswind(x.flight);
  for (let i = 0; i < 12 / dt; i++) { x.flight.update(dt, { yaw: i < 60 ? 1 : 0 }); x.activities.update(dt, x.s); }
  Object.assign(x.s, { crashed: true }); x.activities.update(dt, x.s);
  const fb = x.practice.feedback();
  assert.equal(fb.thresholdCross, null); assert.ok(fb.crab > 1 * DEG);
  assert.match(crosswindAdvice(fb, x.landing), /the attempt ended before the threshold\.$/);
});

