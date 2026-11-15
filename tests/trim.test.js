import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController, TRIM_LIMIT, TRIM_RATE, hasPitchTrim } from '../src/flight.js';
import { FlightInputs, TRAVEL } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { LandingMission } from '../src/landing-mission.js';
import { AIRFIELD } from '../src/airfield.js';
import { groundHeight } from '../src/world.js';
import { holdAttitude, SCENARIOS } from '../scripts/measure-trim.js';

const DEG = Math.PI / 180;
const ALL = Object.keys(FLEET);
const TRIMMED = ALL.filter(id => hasPitchTrim(FLEET[id]));
const FREE = ALL.filter(id => FLEET[id].flight.aerobatic && !FLEET[id].flight.rotorcraft);
const ROTORCRAFT = ALL.filter(id => FLEET[id].flight.rotorcraft);
// Representative conventional types: light trainer, biplane, motorglider, jet, airliner, freighter.
const CONVENTIONAL = ['trainer', 'biplane', 'motorglider', 'jet', 'airliner', 'cargo'];
const rates = [10, 30, 60, 144];

function airborne(id, { assist = false } = {}) {
  const flight = new FlightController(() => 0, id);
  flight.state.position.y = 2400;
  if (assist) flight.toggleAutopilot();
  return flight;
}
function drive(flight, input, from, to, rate = 60, each = () => {}) {
  for (let t = from; t < to - 1e-9;) {
    t = Math.min(to, t + 1 / rate);
    input.advance(t, (dt, c) => { flight.update(dt, c); each(dt, c); });
  }
}
const snapshot = s => ({ position: s.position.toArray(), quaternion: s.quaternion.toArray(), speed: s.speed, heading: s.heading,
  pitch: s.pitch, bank: s.bank, verticalSpeed: s.verticalSpeed, grounded: s.grounded, crashed: s.crashed, autopilot: s.autopilot,
  velocity: s.velocity.toArray(), throttle: s.throttle });

test('only fixed-wing types that self-level have trim; it starts neutral and stays within ±8°', () => {
  assert.deepEqual(TRIMMED.length + FREE.length + ROTORCRAFT.length, ALL.length);
  assert.ok(TRIMMED.length >= 15, `${TRIMMED.length} trimmed types`);
  assert.deepEqual(FREE.sort(), ['aerobatic', 'fighter', 'interceptor']);
  for (const id of TRIMMED) for (const direction of [1, -1]) {
    const flight = airborne(id), input = new FlightInputs(0);
    assert.equal(flight.state.pitchTrim, 0, `${id} starts neutral`);
    input.set({ trim: direction }, 0);
    let previous = 0;
    drive(flight, input, 0, 10, 60, () => {
      const trim = flight.state.pitchTrim;
      assert.ok(Math.abs(trim) <= TRIM_LIMIT + 1e-12, `${id}: ${trim / DEG}°`);
      assert.ok(direction * (trim - previous) >= -1e-12, 'moves only the held way');
      previous = trim;
    });
    assert.equal(flight.state.pitchTrim, direction * TRIM_LIMIT, `${id} reaches its stop after 4 s and stays there`);
    // Out-of-range input is clamped to full rate, never faster.
    const fast = airborne(id), over = new FlightInputs(0);
    over.set({ trim: direction * 7 }, 0);
    drive(fast, over, 0, 1);
    assert.ok(Math.abs(fast.state.pitchTrim - direction * TRIM_RATE) < 1e-9);
  }
});

test('trim moves by exactly its rate times the held time, at any frame rate and between frames', () => {
  const held = 1.37;
  for (const id of ['trainer', 'airliner']) for (const rate of rates) {
    const flight = airborne(id), input = new FlightInputs(0);
    // Press and release fall between frames: the input pipeline splits the physics slices at the event times.
    input.set({ trim: 1 }, 0.213);
    input.set({ trim: 0 }, 0.213 + held);
    drive(flight, input, 0, 3, rate);
    assert.ok(Math.abs(flight.state.pitchTrim - held * TRIM_RATE) < 1e-9, `${id} at ${rate} Hz: ${flight.state.pitchTrim / DEG}°`);
  }
  // A 100 ms tap is a fine 0.2° step.
  const flight = airborne('trainer'), input = new FlightInputs(0);
  input.set({ trim: -1 }, 0.5);
  input.set({}, 0.6);
  drive(flight, input, 0, 1, 30);
  assert.ok(Math.abs(flight.state.pitchTrim / DEG + 0.2) < 1e-6);
  assert.equal(TRAVEL.trim, 0, 'the wheel has no ease-in: it turns at its rate the instant it is held');
});

test('released trim leaves a steady trimmed attitude, never a continuing rotation', () => {
  for (const id of CONVENTIONAL) for (const degrees of [5, -3]) {
    const flight = airborne(id), s = flight.state, input = new FlightInputs(0), held = Math.abs(degrees) * DEG / TRIM_RATE;
    input.set({ trim: Math.sign(degrees) }, 1);
    input.set({}, 1 + held);
    let beyond = 0;
    // While the wheel turns the nose follows it towards the new trim, never past it.
    const follow = () => { beyond = Math.max(beyond, Math.sign(degrees) * (s.pitch - s.pitchTrim)); };
    drive(flight, input, 0, 1.5 + held, 60, follow);
    const release = { trim: s.pitchTrim, pitch: s.pitch };
    drive(flight, input, 1.5 + held, 1.5 + held + 90, 60, follow);
    const target = degrees * DEG;
    assert.ok(beyond < 1e-9, `${id}: the nose overshot the trim by ${beyond / DEG}°`);
    assert.ok(Math.abs(release.trim - target) < 1e-9, `${id}: trim ${release.trim / DEG}°`);
    assert.equal(s.pitchTrim, release.trim, `${id}: trim stays where it was released`);
    assert.ok(Math.abs(s.pitch - target) < 0.02 * DEG, `${id}: ${s.pitch / DEG}° vs ${degrees}°`);
    // No residual rotation: one more minute hands-off moves the nose by less than a hundredth of a degree.
    const before = s.pitch;
    drive(flight, input, input.time, input.time + 60);
    assert.ok(Math.abs(s.pitch - before) < 0.01 * DEG, `${id}: drifted ${(s.pitch - before) / DEG}°`);
    assert.ok(!s.crashed && !s.stalled);
  }
});

test('an established attitude holds hands-off with trim, where neutral trim needs repeated corrections', () => {
  for (const id of ['trainer', 'jet', 'airliner', 'cargo', 'motorglider']) for (const scenario of SCENARIOS) {
    const options = { pitch: scenario.pitch, spool: scenario.spool ?? FLEET[id].flight.cruiseThrottle };
    const free = holdAttitude(id, options), trimmed = holdAttitude(id, { ...options, trim: true });
    assert.equal(trimmed.trims, 1);
    assert.equal(trimmed.taps, 0, `${id} ${scenario.name}: ${trimmed.taps} corrections with trim`);
    assert.ok(free.inputs >= 8, `${id} ${scenario.name}: ${free.inputs} corrections without trim`);
    assert.ok(trimmed.worst < 0.2, `${id} ${scenario.name}: ${trimmed.worst}° off`);
    assert.ok(!free.crashed && !trimmed.crashed);
  }
  // Free-attitude aerobatic types already hold any attitude without corrections, which is why they have no trim.
  for (const id of FREE) for (const scenario of SCENARIOS) {
    const hold = holdAttitude(id, { pitch: scenario.pitch, spool: scenario.spool ?? FLEET[id].flight.cruiseThrottle });
    assert.equal(hold.taps, 0, `${id} ${scenario.name}`);
  }
});

test('neutral trim leaves every type, manoeuvre and ground roll exactly as before', () => {
  const script = [[0, {}], [1, { pitch: 1 }], [2.2, {}], [4, { roll: 1, pitch: 0.5 }], [5, { yaw: -1 }], [6, { throttle: -1 }], [9, {}], [12, { pitch: -1 }], [13, {}]];
  for (const id of ALL) for (const ground of [false, true]) {
    const runs = [undefined, 0].map(trim => {
      const flight = new FlightController(() => 300, id), input = new FlightInputs(0), states = [];
      if (ground) Object.assign(flight.runwayStart(0, 300 + (FLEET[id].groundClearance ?? 2.8), 0), { throttle: 1 });
      for (const [t, c] of script) input.set(trim === undefined ? c : { ...c, trim }, t);
      drive(flight, input, 0, 20, 60, () => states.push(snapshot(flight.state)));
      return states;
    });
    assert.deepEqual(runs[1], runs[0], `${id}${ground ? ' on the runway' : ''}`);
  }
  // The neutral stick-free return keeps its original pace: a released nose at 5° relaxes at 0.045 s⁻¹ towards level.
  const flight = airborne('trainer'), input = new FlightInputs(0);
  flight.state.pitch = 5 * DEG;
  drive(flight, input, 0, 10);
  assert.ok(Math.abs(flight.state.pitch - 5 * DEG * Math.exp(-0.45)) < 1e-6);
});

test('trim on the runway changes nothing until the wheels leave it', () => {
  for (const id of CONVENTIONAL) {
    const states = [-1, 0, 1].map(direction => {
      const flight = new FlightController(() => 300, id), s = flight.runwayStart(0, 300 + (FLEET[id].groundClearance ?? 2.8), 0), input = new FlightInputs(0), log = [];
      Object.assign(s, { throttle: 1 });
      input.set({ trim: direction }, 0);
      input.set({ pitch: 1 }, 60);
      drive(flight, input, 0, 90, 60, () => { if (s.grounded) log.push(snapshot(s)); });
      return { log, trim: s.pitchTrim, grounded: s.grounded };
    });
    assert.deepEqual(states[0].log, states[1].log, `${id}: nose-down trim changes the roll or rotation`);
    assert.deepEqual(states[2].log, states[1].log, `${id}: nose-up trim changes the roll or rotation`);
    assert.equal(states[2].trim, TRIM_LIMIT, 'the wheel still turns on the ground');
    assert.ok(!states[1].grounded, `${id} still takes off`);
  }
});

test('flight assist stays in charge while trim is set, and hands over without a jump', () => {
  for (const id of CONVENTIONAL) {
    const plain = airborne(id, { assist: true }), trimmed = airborne(id, { assist: true });
    const a = new FlightInputs(0), b = new FlightInputs(0);
    b.set({ trim: 1 }, 1);
    b.set({}, 4);
    drive(plain, a, 0, 20);
    drive(trimmed, b, 0, 20);
    assert.ok(trimmed.state.autopilot, `${id}: trimming does not disengage assist`);
    assert.ok(Math.abs(trimmed.state.pitchTrim - 6 * DEG) < 1e-9);
    const { pitchTrim, ...rest } = trimmed.state;
    // The trim key's press and release split the physics slices there, so allow last-bit rounding differences.
    const got = Object.values(snapshot(rest)).flat(), want = Object.values(snapshot(plain.state)).flat();
    got.forEach((value, i) => assert.ok(value === want[i] || Math.abs(value - want[i]) <= 1e-9 * Math.max(1, Math.abs(want[i])), `${id}: assist flies as untrimmed`));
    assert.ok(Math.abs(pitchTrim - 6 * DEG) < 1e-9);

    // Disengaging assist: the nose eases from where assist left it to the trimmed attitude, at most 0.6°/s.
    trimmed.toggleAutopilot();
    assert.equal(trimmed.state.autopilot, false);
    const s = trimmed.state;
    let last = s.pitch, fastest = 0;
    drive(trimmed, b, 20, 120, 60, dt => { fastest = Math.max(fastest, Math.abs(s.pitch - last) / dt); last = s.pitch; });
    assert.ok(fastest < 0.6 * DEG, `${id}: ${fastest / DEG}°/s`);
    assert.ok(Math.abs(s.pitch - 6 * DEG) < 0.2 * DEG, `${id}: settled at ${s.pitch / DEG}°`);
  }
});

test('restart, aircraft changes and every fresh start return trim to neutral', () => {
  const set = flight => { flight.state.pitchTrim = 5 * DEG; return flight; };
  let flight = set(airborne('trainer'));
  flight.reset();
  assert.equal(flight.state.pitchTrim, 0, 'restart');
  set(flight).setAircraft('airliner');
  assert.equal(flight.state.pitchTrim, 0, 'aircraft change');
  set(flight).runwayStart(0, 80, 0);
  assert.equal(flight.state.pitchTrim, 0, 'runway start');
  flight = set(new FlightController(groundHeight, 'trainer'));
  new LandingMission(AIRFIELD).start(flight);
  assert.equal(flight.state.pitchTrim, 0, 'landing mission and approach starts');
});

test('releasing the controls (pause, blur, dialogs, lost pointers) stops the wheel and keeps the chosen trim', () => {
  const flight = airborne('trainer'), input = new FlightInputs(0);
  input.set({ trim: 1 }, 0);
  drive(flight, input, 0, 1.5);
  // clearControls() resets the input pipeline; the physical key or finger is still down, but no longer counts.
  input.reset(1.5);
  drive(flight, input, 1.5, 6);
  assert.ok(Math.abs(flight.state.pitchTrim - 3 * DEG) < 1e-9);
});

test('trim is independent of the four saved response settings', () => {
  const results = [0.5, 1, 2].map(response => {
    const flight = airborne('airliner'), input = new FlightInputs(0, { pitch: response, roll: response, yaw: response, throttle: response });
    input.set({ trim: 1 }, 0);
    input.set({}, 2);
    drive(flight, input, 0, 3);
    return { trim: flight.state.pitchTrim, travel: input.travel.trim };
  });
  for (const r of results) {
    assert.equal(r.travel, 0);
    assert.ok(Math.abs(r.trim - 2 * TRIM_RATE) < 1e-9);
  }
});

test('helicopters and free-attitude aerobatic types ignore trim input entirely', () => {
  for (const id of [...ROTORCRAFT, ...FREE]) {
    const runs = [0, 1].map(trim => {
      const flight = airborne(id), input = new FlightInputs(0), states = [];
      input.set({ trim, pitch: 0.4 }, 0);
      input.set({ trim, roll: -0.6 }, 2);
      input.set({ trim }, 3);
      drive(flight, input, 0, 15, 60, () => states.push(snapshot(flight.state)));
      return { states, trim: flight.state.pitchTrim };
    });
    assert.deepEqual(runs[1].states, runs[0].states, id);
    assert.equal(runs[1].trim, 0, id);
  }
});
