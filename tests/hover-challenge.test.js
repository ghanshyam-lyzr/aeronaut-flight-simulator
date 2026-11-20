import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { FLEET } from '../src/fleet.js';
import { HOVER, hoverAvailability } from '../src/hover-challenge.js';
import { createHoverTarget } from '../src/hover-target.js';
import { CALM, normalizeWind, WIND_PRESETS } from '../src/wind.js';
import { setup, flyHover } from './hover-pilot.js';

const dt = 1 / 120, wind = x => x.flight.windSnapshot().config;
function step(x, seconds = 1, controls = {}) {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    if (x.activities.beforeStep(x.s)) continue;
    x.flight.update(dt, controls); x.activities.update(dt, x.s);
  }
}
// Scoring-only observations: these test boundaries, never claim physical flight performance.
function observe(x, changes = {}, slice = 0.25) {
  const t = x.hover.target;
  const s = { ...x.s, position: x.s.position.clone().set(t.x, t.y, t.z), heading: t.heading,
    flightTime: x.hover.lastTime + slice, ...changes };
  x.hover.update(slice, s); return s;
}
function start(options) { const x = setup(options); x.activities.startHover(x.flight); return x; }
function hold(x, seconds) { for (let i = 0; i < seconds * 4; i++) observe(x); }

test('only an explicitly selected Laret H4 can start; refusal preserves flight and any running activity', () => {
  for (const type of Object.values(FLEET)) {
    assert.equal(hoverAvailability(type).available, type.id === HOVER.aircraft, type.id);
    if (type.id === HOVER.aircraft) continue;
    const x = setup({ type: type.id }); x.activities.startLanding(x.flight);
    const before = x.landing.snapshot(), position = x.s.position.toArray();
    assert.equal(x.activities.startHover(x.flight), null);
    assert.deepEqual(x.landing.snapshot(), before); assert.deepEqual(x.s.position.toArray(), position);
    assert.match(hoverAvailability(type).reason, /Laret H4 only/); assert.equal(wind(x), WIND_PRESETS.gusts);
  }
});

test('the repeatable airborne start is calm and manual, outside ALL scoring limits', () => {
  const x = start(), a = x.hover.snapshot(), s = x.s;
  assert.equal(s.aircraft, 'helicopter'); assert.equal(s.autopilot, false); assert.equal(s.throttle, 0.58);
  assert.equal(s.spool, 0.58); assert.equal(s.rotorSpeed, 1); assert.equal(s.bank, 0); assert.equal(s.pitch, 0);
  assert.equal(s.velocity.length(), 0); assert.equal(s.grounded, false); assert.equal(s.crashed, false);
  assert.equal(s.flightTime, 0); assert.equal(s.touchdown, null); assert.equal(s.headingHold, false);
  assert.equal(wind(x), CALM); assert.equal(a.target.y - x.flight.groundAt(a.target.x, a.target.z), HOVER.clearance);
  assert.ok(a.errors.position > HOVER.radius && Math.abs(a.errors.height) > HOVER.height && Math.abs(a.errors.heading) > HOVER.headingLimit);
  assert.equal(a.holdTime, 0); assert.equal(a.inside, false);
  const before = s.position.toArray(); step(x, 2, { roll: 1, throttle: 1, yaw: 1 });
  x.activities.startHover(x.flight); assert.deepEqual(s.position.toArray(), before); assert.deepEqual(x.hover.snapshot(), a);
});

for (const mode of ['touch', 'keys']) for (const rate of [30, 60, 144]) test(`${mode} at ${rate} fps: real input ramps acquire and hold the target manually`, () => {
  const x = start(), r = flyHover(x, { rate, mode });
  assert.equal(r.status, 'success', r.reason); assert.equal(r.holdTime, 10); assert.equal(r.result.bestHold, 10);
  assert.ok(r.elapsed > 15 && r.elapsed < 17, `${r.elapsed} s`); assert.ok(r.travel > 3);
  assert.ok(r.errors.position < 0.3); assert.ok(Math.abs(r.errors.height) < 0.1); assert.ok(Math.abs(r.errors.heading) < 0.02);
  assert.ok(r.minClearance >= 18); assert.equal(x.s.autopilot, false); assert.equal(x.s.crashed, false);
  assert.equal(x.activities.finished, true); assert.equal(x.activities.kind, 'hover');
});

test('waiting at the start cannot complete the challenge', () => {
  const x = start(), r = flyHover(x, { mode: 'wait', seconds: 60 });
  assert.equal(r.status, 'flying'); assert.equal(r.holdTime, 0); assert.equal(r.bestHold, 0); assert.equal(r.travel, 0);
});

test('entry earns no time, 9.75 seconds is incomplete, exactly 10 seconds succeeds and freezes the result', () => {
  const x = start(); observe(x); assert.equal(x.hover.holdTime, 0);
  hold(x, 9.75); assert.equal(x.hover.status, 'flying'); assert.equal(x.hover.holdTime, 9.75);
  observe(x); assert.equal(x.hover.status, 'success'); assert.equal(x.hover.holdTime, 10);
  assert.equal(x.hover.result.elapsed, 10.25);
  const before = x.hover.snapshot(); observe(x, { crashed: true });
  assert.deepEqual(x.hover.snapshot(), before);
});

test('all three limits are inclusive, use horizontal distance and wrap heading through north', () => {
  for (const heading of [HOVER.headingLimit, -HOVER.headingLimit, Math.PI * 2 - HOVER.headingLimit]) {
    const x = start(), t = x.hover.target;
    for (let i = 0; i < 42; i++) observe(x, { position: x.s.position.clone().set(t.x + 4, t.y + 2, t.z), heading });
    assert.equal(x.hover.status, 'success', `${heading} rad`);
  }
});

test('an excursion on any axis resets the whole continuous timer; partial holds never add together', () => {
  for (const axis of ['position', 'height', 'heading']) {
    const x = start(), t = x.hover.target;
    const outside = { position: { position: x.s.position.clone().set(t.x + HOVER.radius + 0.00001, t.y, t.z) },
      height: { position: x.s.position.clone().set(t.x, t.y - HOVER.height - 0.00001, t.z) }, heading: { heading: HOVER.headingLimit + 0.00001 } }[axis];
    for (let cycle = 0; cycle < 3; cycle++) {
      observe(x); hold(x, 9.75); assert.equal(x.hover.holdTime, 9.75);
      observe(x, outside); assert.equal(x.hover.holdTime, 0); assert.equal(x.hover.bestHold, 9.75);
      assert.equal(x.hover.excursions, cycle + 1); assert.equal(x.hover.status, 'flying');
    }
    observe(x); hold(x, 10); assert.equal(x.hover.status, 'success');
  }
});

test('zero flight time, invalid dt, duplicate observations, pauses and wall-clock jumps cannot earn a hold', () => {
  const x = start(); observe(x); hold(x, 2);
  const snapshot = x.hover.snapshot();
  const frozen = { ...x.s, position: x.s.position.clone().set(x.hover.target.x, x.hover.target.y, x.hover.target.z), heading: 0,
    flightTime: x.hover.lastTime };
  for (let i = 0; i < 100; i++) x.hover.update(dt, frozen);
  for (const invalid of [0, -1, NaN, Infinity]) x.hover.update(invalid, frozen);
  assert.deepEqual(x.hover.snapshot(), snapshot);
  // No update at all while a UI is paused/dialog/hidden: clocks and measurements remain unchanged.
  assert.equal(x.hover.holdTime, 2);
  x.hover.update(100, { ...frozen, flightTime: 100 });
  assert.equal(x.hover.holdTime, 2.25, 'even a fabricated large clock increment is capped at one physics slice');
});

test('assist is rejected before physics can disengage it, as well as on a normal observation', () => {
  for (const preStep of [true, false]) {
    const x = start(); observe(x); hold(x, 3);
    x.flight.toggleAutopilot();
    if (preStep) assert.equal(x.activities.beforeStep(x.s), true);
    else observe(x, { autopilot: true });
    assert.equal(x.hover.status, 'failed'); assert.match(x.hover.reason, /Hover hold \/ assist was used/);
    const before = x.hover.snapshot(); x.flight.toggleAutopilot(); step(x, 20, { roll: 1 });
    assert.deepEqual(x.hover.snapshot(), before);
  }
});

test('a real collective descent and ground contact end safely with measured failure results', () => {
  const x = start();
  for (let i = 0; i < 3600 && x.hover.active; i++) step(x, dt, { throttle: -1 });
  assert.equal(x.s.crashed, true); assert.equal(x.hover.status, 'failed'); assert.match(x.hover.reason, /landing/);
  assert.equal(x.hover.result.bestHold, 0); assert.ok(x.hover.result.elapsed > 0);
  const y = start(); observe(y, { grounded: true });
  assert.equal(y.hover.status, 'failed'); assert.match(y.hover.reason, /Ground contact/);
});

test('normal-input retry gives the same result and leaves the original pilot wind intact', () => {
  const x = start(); const r = flyHover(x, { mode: 'keys' });
  x.activities.startHover(x.flight); assert.deepEqual(flyHover(x, { mode: 'keys' }), r);
  assert.equal(x.hover.previous, WIND_PRESETS.gusts); x.activities.cancel(); assert.equal(wind(x), WIND_PRESETS.gusts);
});

test('custom pilot wind and changed Weather choices restore exactly once on every exit, including a result or time-zero reset', () => {
  const custom = normalizeWind({ id: 'pilot', direction: 1.8, speed: 4, gust: 1, veer: 0.1, seed: 38 });
  const exits = {
    cancel: x => x.activities.cancel(), landing: x => x.activities.startLanding(x.flight),
    course: x => x.activities.startCourse(x.flight),
    crosswind: x => { x.flight.setAircraft('trainer'); x.activities.startCrosswind(x.flight); },
    recovery: x => { x.flight.setAircraft('trainer'); x.activities.startRecovery(x.flight); },
    aircraft: x => { x.flight.setAircraft('jet'); x.activities.update(dt, x.s); },
    reset: x => { x.flight.reset(); x.activities.update(dt, x.s); },
  };
  for (const phase of ['zero', 'flying', 'finished']) for (const [name, exit] of Object.entries(exits)) {
    const x = setup({ wind: custom }), changes = [], setWind = x.flight.setWind.bind(x.flight);
    x.flight.setWind = (config, options) => { changes.push(normalizeWind(config)); return setWind(config, options); };
    x.activities.startHover(x.flight);
    if (phase === 'flying') step(x); else if (phase === 'finished') flyHover(x);
    exit(x); assert.equal(x.hover.status, 'idle', `${name}/${phase}`); assert.equal(x.hover.owning, false);
    assert.equal(changes.filter(c => c === custom).length, 1, `${name}/${phase} restore exactly once`);
    if (['crosswind', 'recovery'].includes(name)) {
      assert.equal(x.activities.pilotWind(wind(x)), custom); x.activities.cancel();
    }
    assert.equal(wind(x), custom); x.activities.cancel(); x.activities.update(dt, x.s);
    assert.equal(wind(x), custom);
  }
  const x = start({ wind: custom }); assert.equal(x.activities.pilotWind(wind(x)), custom);
  assert.equal(x.activities.holdPilotChoice('breeze'), true); assert.equal(wind(x), CALM);
  x.activities.startHover(x.flight); assert.equal(x.activities.pilotWind(wind(x)), WIND_PRESETS.breeze);
  x.activities.cancel(); assert.equal(wind(x), WIND_PRESETS.breeze); assert.equal(x.activities.holdPilotChoice('gusts'), false);
});

test('starting hover ends each other activity before borrowing its calm wind', () => {
  for (const activity of ['startLanding', 'startCourse', 'startCrosswind', 'startRecovery']) {
    const x = setup({ type: 'trainer' }); x.activities[activity](x.flight);
    x.flight.setAircraft('helicopter'); x.activities.startHover(x.flight);
    assert.equal(x.activities.kind, 'hover'); assert.equal(x.landing.status, 'idle'); assert.equal(x.course.status, 'idle');
    assert.equal(x.recovery.status, 'idle'); assert.equal(x.practice.running, false);
    assert.equal(x.hover.previous, WIND_PRESETS.gusts); assert.equal(wind(x), CALM);
  }
});

test('lightweight target shows only for an active attempt, stays fixed and disposes its resources', () => {
  const scene = new Scene(), target = createHoverTarget(scene, 'hsl(77, 88%, 67%)');
  const x = start(); assert.equal(target.group.visible, false);
  target.update(true, x.hover.target, false); assert.equal(target.group.visible, true);
  assert.deepEqual(target.group.position.toArray(), [HOVER.x, x.hover.target.y, HOVER.z]);
  assert.equal(target.group.children.length, 2);
  const geometry = target.group.children[0].geometry; let disposed = false;
  geometry.addEventListener('dispose', () => { disposed = true; });
  target.update(false, null, false); assert.equal(target.group.visible, false);
  target.dispose(); assert.equal(disposed, true); assert.equal(scene.children.length, 0);
});
