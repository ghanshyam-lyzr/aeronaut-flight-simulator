import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, Euler, PerspectiveCamera } from 'three';
import { FlightController } from '../src/flight.js';
import { LandingMission } from '../src/landing-mission.js';
import { AirportSelection } from '../src/airport-selection.js';
import { flightPathVelocity, projectDirection, FlightPathMarker, FLIGHT_PATH } from '../src/flight-path.js';
import { SETTINGS_KEY, DISPLAY, CUSTOMIZATION_KEYS, defaultSettings, normalizeSettings, resetSettings, loadSettings, saveSettings, anyDisplayHidden, toggleDisplay, flightPathShown } from '../src/settings.js';

const W = 1600, H = 900;
const flat = () => 40;
function fly(f, seconds, controls = {}, rate = 120) {
  for (let i = 0; i < Math.round(seconds * rate); i++) f.update(1 / rate, controls);
  return f.state;
}
/** A camera at the aircraft looking along its nose, as the cockpit view sets it (fov 67). */
function cockpitCamera(state, aspect = W / H) {
  const c = new PerspectiveCamera(67, aspect, 1, 65000);
  c.quaternion.copy(state.quaternion); c.updateProjectionMatrix();
  return c;
}
/** A chase-style camera: level, looking along the heading (fov 53). */
function headingCamera(heading, aspect = W / H) {
  const c = new PerspectiveCamera(53, aspect, 1, 65000);
  c.quaternion.setFromEuler(new Euler(0, -heading, 0, 'YXZ')); c.updateProjectionMatrix();
  return c;
}
/** The displacement of the next frame divided by its time step: what the marker has to agree with. */
function measured(f, dt = 1 / 120, controls = {}) {
  const before = f.state.position.clone();
  f.update(dt, controls);
  return f.state.position.clone().sub(before).divideScalar(dt);
}
const near = (a, b, tolerance, message) => assert.ok(a.distanceTo(b) <= tolerance, `${message}: ${a.toArray().map(v => v.toFixed(3))} vs ${b.toArray().map(v => v.toFixed(3))}`);

test('the derived velocity equals the actual displacement for fixed-wing, aerobatic and helicopter flight', () => {
  const cases = [
    ['jet', 'level assisted cruise', f => { f.toggleAutopilot(); fly(f, 5); }, {}],
    ['jet', 'banked descending turn', f => fly(f, 4, { roll: 0.6, pitch: -0.3 }), { roll: 0.6, pitch: -0.3 }],
    ['widebody', 'idle descent', f => fly(f, 6, { throttle: -1 }), { throttle: -1 }],
    ['fighter', 'pulling through a loop', f => fly(f, 3, { pitch: 1 }), { pitch: 1 }],
    ['aerobatic', 'rolling inverted', f => fly(f, 1.6, { roll: 1 }), { roll: 1 }],
    ['helicopter', 'sideways and backwards', f => fly(f, 6, { pitch: 0.6, roll: 0.7 }), { pitch: 0.6, roll: 0.7 }],
    ['tandem', 'forward translation', f => fly(f, 6, { pitch: -0.8 }), { pitch: -0.8 }],
  ];
  for (const [id, name, setup, controls] of cases) {
    const f = new FlightController(flat, id);
    setup(f);
    const actual = measured(f, 1 / 120, controls);
    const derived = flightPathVelocity(f.state, f.type);
    assert.ok(derived, `${id} ${name}: a velocity`);
    near(derived, actual, 1e-6, `${id} ${name}`);
  }
});

test('fixed-wing state.velocity is stale in flight, so the marker does not use it', () => {
  const f = new FlightController(flat, 'jet');
  fly(f, 6, { roll: 0.8 });
  const actual = measured(f, 1 / 120, { roll: 0.8 });
  assert.ok(f.state.velocity.distanceTo(actual) > 20, 'state.velocity still holds the reset heading');
  near(flightPathVelocity(f.state, f.type), actual, 1e-6, 'derived velocity follows the turn');
});

test('level flight puts the marker on the nose in the cockpit and on the horizon in the chase view', () => {
  const f = new FlightController(flat, 'jet');
  f.toggleAutopilot(); fly(f, 20);
  const marker = new FlightPathMarker();
  const cockpit = marker.update(f.state, f.type, cockpitCamera(f.state), W, H);
  assert.equal(cockpit.visible, true);
  assert.ok(Math.abs(cockpit.x - W / 2) < 3 && Math.abs(cockpit.y - H / 2) < 6, `${cockpit.x}, ${cockpit.y}`);
  const chase = new FlightPathMarker().update(f.state, f.type, headingCamera(f.state.heading), W, H);
  assert.ok(Math.abs(chase.x - W / 2) < 3 && Math.abs(chase.y - H / 2) < 6, 'level travel sits on the horizon line');
});

test('a raised nose while still descending keeps the marker below the nose (vertical-speed lag)', () => {
  const f = new FlightController(flat, 'jet'), s = f.state;
  s.pitch = -0.08; f.setQuaternion(); fly(f, 4);
  assert.ok(s.verticalSpeed < -5, 'established in a descent');
  // Rotate to a nose-up attitude: the flight path lags behind the nose for a few seconds.
  s.pitch = 0.06; f.setQuaternion(); f.update(1 / 60, {});
  assert.ok(s.pitch > 0 && s.verticalSpeed < -3, 'nose above the horizon, still sinking');
  const camera = cockpitCamera(s), m = new FlightPathMarker().update(s, f.type, camera, W, H);
  assert.equal(m.visible, true);
  assert.ok(m.y > H / 2 + 40, `marker below the nose: ${m.y.toFixed(1)}`);
  const level = headingCamera(s.heading), chase = new FlightPathMarker().update(s, f.type, level, W, H);
  assert.ok(chase.y > H / 2, 'and below the horizon: the aircraft is still going down');
  fly(f, 6);
  const settled = new FlightPathMarker().update(s, f.type, cockpitCamera(s), W, H);
  assert.ok(settled.y < m.y - 30, 'it rises toward the nose as the climb develops');
});

test('inverted and vertical attitudes project through the full camera orientation', () => {
  const f = new FlightController(flat, 'fighter'), s = f.state;
  fly(f, 1, {});
  // Half a roll: inverted and level. In the cockpit (upside down) the path is still straight ahead.
  s.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), Math.PI)); f.readAttitude();
  f.update(1 / 120, {});
  const inverted = new FlightPathMarker().update(s, f.type, cockpitCamera(s), W, H);
  assert.equal(inverted.visible, true);
  assert.ok(Math.abs(inverted.x - W / 2) < 5, 'on the centreline inverted');
  // Inverted, a sink shows as up on the screen: the cockpit camera's up is the floor of the world.
  assert.ok(Math.abs(inverted.y - H / 2) < 3, 'level inverted flight sits on the nose');
  s.verticalSpeed = -25; // A sink the model is still lagging into after a push.
  const sinking = new FlightPathMarker().update(s, f.type, cockpitCamera(s), W, H);
  assert.ok(sinking.y < H / 2 - 40, `upside down, a sink reads toward the canopy roof: ${sinking.y.toFixed(1)}`);

  const g = new FlightController(flat, 'fighter'), v = g.state;
  v.pitch = Math.PI / 2 - 0.01; g.setQuaternion(); fly(g, 4, {});
  const velocity = flightPathVelocity(v, g.type);
  assert.ok(velocity.y > 0.9 * velocity.length(), 'climbing vertically');
  const up = new FlightPathMarker().update(v, g.type, cockpitCamera(v), W, H);
  assert.equal(up.visible, true, 'ahead of the nose in the cockpit');
  assert.ok(Math.hypot(up.x - W / 2, up.y - H / 2) < 60);
  const level = new FlightPathMarker().update(v, g.type, headingCamera(v.heading), W, H);
  assert.equal(level.visible, false, 'straight up is off a level chase screen, and is not clamped onto it');
  assert.equal(level.reason, 'behind or off screen');
});

test('helicopter translation: sideways, backwards and diagonal travel', () => {
  const sideways = new FlightController(flat, 'helicopter');
  fly(sideways, 8, { roll: 1 });
  const s = sideways.state, v = flightPathVelocity(s, sideways.type);
  const right = new Vector3(Math.cos(s.heading), 0, Math.sin(s.heading));
  assert.ok(v.dot(right) > 0.9 * Math.hypot(v.x, v.z), 'moving to the right of the nose');
  assert.equal(new FlightPathMarker().update(s, sideways.type, headingCamera(s.heading), W, H).visible, false, 'square to the view: hidden, not pinned to the edge');

  const back = new FlightController(flat, 'helicopter');
  fly(back, 8, { pitch: 1 });
  const b = flightPathVelocity(back.state, back.type), nose = new Vector3(Math.sin(back.state.heading), 0, -Math.cos(back.state.heading));
  assert.ok(b.dot(nose) < -2, 'moving tail first');
  const behind = new FlightPathMarker().update(back.state, back.type, headingCamera(back.state.heading), W, H);
  assert.equal(behind.visible, false); assert.equal(behind.reason, 'behind or off screen');

  const diagonal = new FlightController(flat, 'helicopter');
  fly(diagonal, 10, { pitch: -1, roll: 0.35 });
  const d = new FlightPathMarker().update(diagonal.state, diagonal.type, headingCamera(diagonal.state.heading), W, H);
  assert.equal(d.visible, true);
  assert.ok(d.x > W / 2 + 20, `forward and to the right: ${d.x.toFixed(1)}`);
});

test('near-zero motion hides the marker, with hysteresis so a hover does not flicker', () => {
  const f = new FlightController(flat, 'helicopter'), s = f.state, camera = headingCamera(0), m = new FlightPathMarker();
  assert.equal(m.update(s, f.type, camera, W, H).reason, 'slow', 'reset hover');
  s.velocity.set(0, 0, -1.5);
  assert.equal(m.update(s, f.type, camera, W, H).visible, false, 'not shown below 2 m/s');
  s.velocity.set(0, 0, -2.5);
  assert.equal(m.update(s, f.type, camera, W, H).visible, true);
  s.velocity.set(0, 0, -1.5);
  assert.equal(m.update(s, f.type, camera, W, H).visible, true, 'kept while slowing past 1.5 m/s');
  s.velocity.set(0, 0, -0.5);
  assert.equal(m.update(s, f.type, camera, W, H).visible, false);
  s.velocity.set(NaN, 0, -30);
  assert.equal(m.update(s, f.type, camera, W, H).reason, 'stopped', 'invalid state');
  s.crashed = true; s.velocity.set(0, 0, -30);
  assert.equal(m.update(s, f.type, camera, W, H).reason, 'stopped', 'crashed');
  assert.equal(new FlightPathMarker().update(new FlightController(flat, 'jet').state, f.type, camera, W, H, false).reason, 'off');
});

test('the marker position does not depend on the frame rate', () => {
  const run = rate => {
    const f = new FlightController(flat, 'jet'), m = new FlightPathMarker();
    let out;
    for (let i = 0; i < 6 * rate; i++) {
      const t = i / rate;
      f.update(1 / rate, t < 2 ? { pitch: -0.4 } : t < 4 ? { roll: 0.5 } : {});
      out = m.update(f.state, f.type, headingCamera(f.state.heading), W, H);
    }
    return out;
  };
  const a = run(30), b = run(60), c = run(144);
  for (const [name, other] of [['60 Hz', b], ['144 Hz', c]]) {
    assert.equal(other.visible, a.visible);
    assert.ok(Math.hypot(other.x - a.x, other.y - a.y) < 4, `${name} vs 30 Hz: ${other.x.toFixed(1)},${other.y.toFixed(1)} vs ${a.x.toFixed(1)},${a.y.toFixed(1)}`);
  }
});

test('resets, runway starts, missions and aircraft changes never carry the old path', () => {
  const f = new FlightController(flat, 'jet'), m = new FlightPathMarker();
  fly(f, 2.5, { pitch: -0.5 });
  const camera = () => headingCamera(f.state.heading);
  const diving = m.update(f.state, f.type, camera(), W, H);
  assert.ok(diving.visible && diving.y > H / 2 + 50, 'diving before the reset');
  f.reset();
  const fresh = m.update(f.state, f.type, camera(), W, H);
  assert.ok(fresh.visible && Math.abs(fresh.y - H / 2) < 2, 'the first frame after a reset shows the new, level path');

  fly(f, 3);
  f.runwayStart(0, 52, 0, 1.2);
  assert.equal(m.update(f.state, f.type, camera(), W, H).visible, false, 'parked on a runway: nothing to show');
  assert.equal(m.visible, false, 'and the hysteresis was forgotten');

  const field = new AirportSelection().field, mission = new LandingMission(field);
  fly(f, 2, { throttle: 1 });
  mission.start(f, field);
  const final = m.update(f.state, f.type, camera(), W, H), slope = Math.atan(mission.profile.slope);
  const below = Math.atan((final.y - H / 2) / (H / 2) * Math.tan(53 / 2 * Math.PI / 180));
  assert.ok(final.visible && Math.abs(below - slope) < 0.003, `on the glide path from the first frame: ${(below * 180 / Math.PI).toFixed(2)}°`);

  const h = new FlightController(flat, 'helicopter');
  fly(h, 8, { pitch: -1 });
  m.update(h.state, h.type, headingCamera(h.state.heading), W, H);
  assert.equal(m.visible, true);
  h.setAircraft('helicopter');
  h.state.velocity.set(0, 0, -1.5);
  assert.equal(m.update(h.state, h.type, headingCamera(0), W, H).visible, false, 'a fresh flight starts the hysteresis over');
});

test('projection is a point at infinity through any camera, never clamped into view', () => {
  const camera = new PerspectiveCamera(52, W / H, 1, 65000);
  camera.position.set(30, 9, -12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  for (const dir of [new Vector3(-30, -9, 12), new Vector3(-30, -4, 18), new Vector3(-20, -12, 6)]) {
    const p = projectDirection(dir, camera, W, H);
    const far = camera.position.clone().addScaledVector(dir.clone().normalize(), 1e6).project(camera);
    assert.ok(p, 'in view');
    assert.ok(Math.abs(p.x - (far.x + 1) / 2 * W) < 0.5 && Math.abs(p.y - (1 - far.y) / 2 * H) < 0.5, 'matches three.js projection');
  }
  const ahead = new Vector3(-30, -9, 12);
  assert.equal(projectDirection(ahead.clone().negate(), camera, W, H), null, 'behind');
  const level = headingCamera(0);
  assert.equal(projectDirection(new Vector3(Math.sin(0.8), 0, -Math.cos(0.8)), level, W, H), null, '46° to the side is past a 1600 × 900 frame');
  assert.ok(projectDirection(new Vector3(Math.sin(0.6), 0, -Math.cos(0.6)), level, W, H), '34° is inside it');
  const phone = headingCamera(0, 390 / 844);
  assert.equal(projectDirection(new Vector3(Math.sin(0.4), 0, -Math.cos(0.4)), phone, 390, 844), null, 'but off a portrait phone');
  assert.equal(projectDirection(new Vector3(0, 0, -1), level, 0, 0), null, 'no viewport');
  assert.equal(projectDirection(new Vector3(0, 0, 0), level, W, H), null, 'no direction');
});

class MemoryStorage {
  constructor(entries = {}) { this.data = new Map(Object.entries(entries)); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
}

test('the flight-path setting is saved, off by default, and not a hidden panel', () => {
  const d = defaultSettings();
  assert.equal(d.showFlightPath, false);
  assert.equal(DISPLAY.includes('showFlightPath'), false);
  assert.equal(anyDisplayHidden(d), false, 'leaving it off shows no restore button');
  assert.equal(normalizeSettings({ showFlightPath: 'yes' }).showFlightPath, false);
  assert.equal(normalizeSettings({ version: 1, quality: 'low' }).showFlightPath, false, 'older settings migrate with it off');
  const storage = new MemoryStorage();
  saveSettings({ ...d, showFlightPath: true }, storage);
  assert.equal(loadSettings(storage).showFlightPath, true, 'round-trips');
  assert.equal(loadSettings(new MemoryStorage({ [SETTINGS_KEY]: '{"showFlightPath":1}' })).showFlightPath, false);
  assert.ok(CUSTOMIZATION_KEYS.includes('showFlightPath'));
  assert.equal(resetSettings({ ...d, showFlightPath: true, aircraft: 'fighter' }).showFlightPath, false, 'restore defaults turns it off');
});

test('hiding the flight panels hides the marker; H and restore keep the pilot\'s choice', () => {
  let s = { ...defaultSettings(), showFlightPath: true };
  assert.equal(flightPathShown(s), true);
  s = { ...s, ...toggleDisplay(s) };
  assert.equal(s.showHud, false); assert.equal(flightPathShown(s), false, 'H hides it with the panels');
  s = { ...s, ...toggleDisplay(s) };
  assert.equal(flightPathShown(s), true, 'the next H brings it back');
  s = { ...s, showCrosshair: false, showMap: false };
  assert.equal(flightPathShown(s), true, 'independent of the crosshair');
  s = { ...s, ...toggleDisplay(s) };
  assert.equal(s.showFlightPath, true, 'Show hidden panels leaves it on');
  let off = { ...defaultSettings(), showHud: false, showMap: false };
  off = { ...off, ...toggleDisplay(off) };
  assert.equal(off.showFlightPath, false, 'and never turns it on');
  assert.equal(flightPathShown(off), false);
  assert.equal(FLIGHT_PATH.hideSpeed < FLIGHT_PATH.showSpeed, true);
});
