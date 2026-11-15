import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController } from '../src/flight.js';
import { FLEET } from '../src/fleet.js';
import { KNOTS, UPPER_LIMITS, LOW_MARGIN, HYSTERESIS, OVERSPEED_NOTICE, AIRSPEED_LABELS, stallSpeed, sustainedSpeed, diveCeiling,
  upperLimits, airspeedEnvelope, tapeLayout, AirspeedMonitor } from '../src/airspeed-envelope.js';

const flat = () => 40;
const FIXED_WING = Object.values(FLEET).filter(t => !t.flight.rotorcraft);
const ROTORCRAFT = Object.values(FLEET).filter(t => t.flight.rotorcraft);
const kt = v => v * KNOTS;

/** Flies with the monitor watching every 1/120 s step; returns every state it reported. */
function watch(f, monitor, seconds, controls = {}, each = () => {}) {
  const seen = new Set();
  for (let i = 0; i < seconds * 120; i++) {
    each(f);
    f.update(1 / 120, controls);
    seen.add(monitor.update(f.state, f.type));
  }
  return seen;
}
/** Holds a full-power dive at the type's pitch limit (60° nose down for free-attitude types) high above the valley. */
function dive(id) {
  const f = new FlightController(flat, id);
  f.state.position.y = 80000;
  f.state.throttle = f.state.spool = 1;
  if (f.type.flight.aerobatic) f.state.pitch = -Math.PI / 3;
  return f;
}
const at = (f, speedKt, extra = {}) => Object.assign(f.state, { speed: speedKt / KNOTS, ...extra });

test('every fixed-wing type has documented, ordered upper limits that its numbers support', () => {
  assert.deepEqual(Object.keys(UPPER_LIMITS).sort(), FIXED_WING.map(t => t.id).sort(), 'one tuned entry per fixed-wing type, none for rotorcraft');
  for (const t of FIXED_WING) {
    const { caution, overspeed } = upperLimits(t), e = airspeedEnvelope(t);
    assert.ok(kt(t.flight.cruiseSpeed) < caution - HYSTERESIS.upper - 10, `${t.id}: cruise is well clear of the caution band`);
    assert.ok(kt(sustainedSpeed(t)) < caution - HYSTERESIS.upper, `${t.id}: full-power level flight (burner lit) clears the caution band`);
    assert.ok(caution < overspeed, `${t.id}: caution below overspeed`);
    assert.ok(overspeed < kt(diveCeiling(t)) - 3, `${t.id}: overspeed below the dive ceiling, so it can be reached`);
    assert.ok(overspeed < kt(t.flight.maxSpeed), `${t.id}: overspeed below the hard max-speed clamp`);
    assert.ok(e.scale >= t.speedScale && e.scale >= overspeed + 10, `${t.id}: the red line fits on the tape`);
    // The derived placement for an untuned type lands near the tuned one.
    const derived = upperLimits({ ...t, id: 'untuned' });
    assert.ok(Math.abs(derived.overspeed - overspeed) <= 15, `${t.id}: derived overspeed ${derived.overspeed} vs tuned ${overspeed}`);
  }
  assert.equal(airspeedEnvelope(FLEET.jet).scale, 300, 'the Vela J8 tape grows past its 190 kt display scale');
  assert.equal(airspeedEnvelope(FLEET.fighter).scale, 560, 'a scale that already fits is kept');
});

test('the low-speed margin follows the flap stage and the model\'s own stall speed', () => {
  for (const t of FIXED_WING) {
    for (const flaps of t.noFlaps ? [0] : [0, 1, 2]) {
      const e = airspeedEnvelope(t, flaps);
      assert.equal(e.stall, (t.flight.stallSpeed - flaps * t.flight.flapStallGain) * KNOTS);
      assert.equal(e.low, e.stall * LOW_MARGIN);
      // The flight model stalls exactly below the marked stall speed.
      const f = new FlightController(flat, t.id);
      f.state.flaps = flaps;
      f.state.throttle = f.state.spool = 1;
      f.state.speed = stallSpeed(t, flaps) + 0.5; f.update(1 / 120);
      assert.equal(f.state.stalled, false, `${t.id} flaps ${flaps}: flying just above the stall mark`);
    }
    // The landing mission's target approach speed sits above the full-flap margin.
    assert.ok(kt(t.landing.speed) > airspeedEnvelope(t, t.noFlaps ? 0 : 2).low + HYSTERESIS.low, `${t.id}: approach speed is not "low"`);
  }
  const jet = [0, 1, 2].map(flaps => Math.round(airspeedEnvelope(FLEET.jet, flaps).stall));
  assert.deepEqual(jet, [82, 76, 70], 'Vela J8 stall: clean, 15° and 30° flaps (README: 82 and 70 kt)');
  assert.ok(airspeedEnvelope(FLEET.jet, 2).low < airspeedEnvelope(FLEET.jet, 0).low, 'flaps lower the margin');
  assert.equal(airspeedEnvelope(FLEET.aerobatic, 2).low, airspeedEnvelope(FLEET.aerobatic, 0).low, 'no flaps, no change');
});

test('state entry and exit use hysteresis, so a speed hovering on a threshold never flickers', () => {
  const f = new FlightController(flat, 'jet'), m = new AirspeedMonitor(), e = airspeedEnvelope(f.type);
  const read = speed => m.update(at(f, speed + 1e-9), f.type);
  assert.equal(read(200), 'normal');
  assert.equal(read(e.caution - 0.1), 'normal');
  assert.equal(read(e.caution), 'high');
  assert.equal(read(e.overspeed - 0.1), 'high');
  assert.equal(read(e.overspeed), 'overspeed');
  assert.equal(read(e.overspeed - HYSTERESIS.upper + 0.1), 'overspeed', 'stays latched inside the hysteresis');
  assert.equal(read(e.overspeed - HYSTERESIS.upper - 0.01), 'high', 'clears once back by the full hysteresis');
  assert.equal(read(e.caution - HYSTERESIS.upper + 0.1), 'high');
  assert.equal(read(e.caution - HYSTERESIS.upper - 0.01), 'normal');
  assert.equal(read(e.low + 0.1), 'normal');
  assert.equal(read(e.low - 0.1), 'low');
  assert.equal(read(e.low + HYSTERESIS.low - 0.1), 'low');
  assert.equal(read(e.low + HYSTERESIS.low + 0.01), 'normal');
  // ±1.5 kt of noise across each threshold changes the state once, not on every sample.
  for (const [threshold, below, above] of [[e.overspeed, 'high', 'overspeed'], [e.caution, 'normal', 'high'], [e.low, 'low', 'normal']]) {
    read(threshold - 10); read(threshold + 10);
    if (below === 'low') { read(threshold - 10); }
    let changes = 0, last = m.state;
    for (let i = 0; i < 200; i++) { const s = read(threshold + (i % 2 ? 1.5 : -1.5)); if (s !== last) changes++; last = s; }
    assert.ok(changes <= 1, `${above} threshold: ${changes} changes`);
    assert.ok([below, above].includes(last));
  }
});

test('an overspeed is reachable in a full-power dive below the max-speed clamp, and recovery clears it', () => {
  for (const t of FIXED_WING) {
    const f = dive(t.id), m = new AirspeedMonitor();
    let reached = null;
    for (let i = 0; i < 90 * 120 && reached === null; i++) {
      f.update(1 / 120, { pitch: t.flight.aerobatic ? 0 : -1 });
      if (m.update(f.state, f.type) === 'overspeed') reached = i / 120;
    }
    assert.ok(reached !== null, `${t.id}: overspeed reached in a dive`);
    assert.ok(reached < 60, `${t.id}: within a minute (${reached.toFixed(1)} s)`);
    assert.ok(f.state.speed < t.flight.maxSpeed, `${t.id}: before the hard clamp`);
    assert.equal(f.state.crashed, false);
    // Power back to idle and level: the warning clears through the caution band to normal.
    if (t.flight.aerobatic) f.state.pitch = 0;
    const order = [];
    for (let i = 0; i < 60 * 120 && m.state !== 'normal'; i++) {
      f.update(1 / 120, { throttle: -1, pitch: t.flight.aerobatic ? 0 : 0.4 });
      if (!t.flight.aerobatic) f.state.pitch = Math.min(f.state.pitch, 0);
      if (order.at(-1) !== m.update(f.state, f.type)) order.push(m.state);
    }
    assert.deepEqual(order, ['overspeed', 'high', 'normal'], `${t.id}: clears through the caution band after reducing power`);
  }
});

test('ordinary cruise and sustained full power, afterburner included, never warn', () => {
  for (const t of FIXED_WING) {
    for (const throttle of [0, 1]) {
      const f = new FlightController(flat, t.id), m = new AirspeedMonitor();
      f.state.position.y = 3000;
      f.toggleAutopilot();
      const seen = watch(f, m, 150, { throttle });
      assert.deepEqual([...seen], ['normal'], `${t.id} ${throttle ? 'full power' : 'cruise'} level flight`);
      if (throttle && t.flight.afterburnerFrom !== null) assert.equal(f.state.afterburner, true, `${t.id}: burner lit`);
    }
  }
});

test('representative light, jet, heavy and aerobatic types mark sensible bands', () => {
  const cases = { trainer: [49, 58, 132, 140], jet: [82, 98, 255, 270], widebody: [136, 163, 355, 365], aerobatic: [62, 75, 200, 225] };
  for (const [id, [stall, low, caution, overspeed]] of Object.entries(cases)) {
    const e = airspeedEnvelope(FLEET[id]);
    assert.deepEqual([Math.round(e.stall), Math.round(e.low), e.caution, e.overspeed], [stall, low, caution, overspeed], id);
    const t = tapeLayout(e, kt(FLEET[id].flight.cruiseSpeed));
    assert.ok(t.stall < t.low && t.low < t.marker && t.marker < t.caution && t.caution < t.overspeed && t.overspeed < 100, `${id}: cruise sits between the bands`);
  }
  assert.equal(tapeLayout(airspeedEnvelope(FLEET.jet), 900).marker, 96, 'the marker stays on the tape');
});

test('grounded, crashed, paused, dialog, finished-mission and rotorcraft states never warn', () => {
  const f = new FlightController(flat, 'jet'), m = new AirspeedMonitor(), e = airspeedEnvelope(f.type);
  assert.equal(m.update(at(f, e.overspeed + 5), f.type), 'overspeed');
  assert.equal(m.update(at(f, e.overspeed + 5), f.type, false), 'off', 'inactive: paused, a dialog or a finished mission');
  assert.equal(m.update(at(f, e.overspeed - 1), f.type), 'high', 'the latch does not survive an inactive frame');
  assert.equal(m.update(at(f, e.overspeed + 5, { grounded: true }), f.type), 'off');
  assert.equal(m.update(at(f, 10, { grounded: true }), f.type), 'off', 'a parked aircraft is not "low"');
  assert.equal(m.update(at(f, e.overspeed + 5, { grounded: false, crashed: true }), f.type), 'off');
  // A real ground start and rollout.
  const g = new FlightController(flat, 'jet'), n = new AirspeedMonitor();
  g.runwayStart(0, 43, 0);
  assert.deepEqual([...watch(g, n, 8, { throttle: 1 })], ['off']);
  for (const t of ROTORCRAFT) {
    const h = new FlightController(flat, t.id), r = new AirspeedMonitor();
    assert.equal(airspeedEnvelope(t), null, `${t.id}: no envelope`);
    h.state.speed = 500;
    assert.deepEqual([...watch(h, r, 2, { pitch: -1 })], ['off'], `${t.id}: rotorcraft keep their instrument`);
  }
  assert.equal(AIRSPEED_LABELS.off, 'Airspeed');
  assert.match(OVERSPEED_NOTICE, /^OVERSPEED · Reduce power/);
});

test('a restart, a new aircraft or a ground start clears the latch', () => {
  const f = new FlightController(flat, 'jet'), m = new AirspeedMonitor(), e = airspeedEnvelope(f.type);
  m.update(at(f, e.overspeed + 5), f.type);
  f.state.flightTime = 30;
  m.update(at(f, e.overspeed + 5), f.type);
  f.reset();
  assert.equal(m.update(at(f, e.overspeed - 1), f.type), 'high', 'restarted flight: not still in overspeed');
  f.reset();
  assert.equal(m.update(f.state, f.type), 'normal', 'restart at cruise');
  m.update(at(f, e.overspeed + 5, { flightTime: 40 }), f.type);
  f.setAircraft('airliner');
  assert.equal(m.update(f.state, f.type), 'normal', 'new aircraft at cruise');
  m.update(at(f, airspeedEnvelope(f.type).overspeed + 5, { flightTime: 12 }), f.type);
  m.reset();
  assert.equal(m.state, 'off');
  assert.equal(m.update(at(f, airspeedEnvelope(f.type).overspeed - 1), f.type), 'high', 'explicit reset');
});

test('the envelope is read-only: flight with the monitor is identical to flight without it', () => {
  const plain = dive('fighter'), watched = dive('fighter'), m = new AirspeedMonitor();
  for (let i = 0; i < 20 * 120; i++) {
    plain.update(1 / 120, { pitch: 0 });
    watched.update(1 / 120, { pitch: 0 });
    const before = JSON.stringify(watched.state);
    m.update(watched.state, watched.type);
    airspeedEnvelope(watched.type, watched.state.flaps);
    assert.equal(JSON.stringify(watched.state), before);
  }
  assert.equal(JSON.stringify(watched.state), JSON.stringify(plain.state));
  assert.equal(m.state, 'overspeed');
  assert.deepEqual(FLEET.jet.flight.stallSpeed, 42);
});
