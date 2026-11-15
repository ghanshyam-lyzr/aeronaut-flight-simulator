import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Group, Object3D } from 'three';
import { FlightController } from '../src/flight.js';
import { FLEET } from '../src/fleet.js';
import { groundVelocity, flightPathVelocity, groundTrack } from '../src/flight-path.js';
import { sampleTerrain } from '../src/terrain-alert.js';
import { navigationReadout } from '../src/navigation.js';
import { normalizeSettings, defaultSettings, resetSettings } from '../src/settings.js';
import { Wind, WIND_PRESETS, WIND_LIMITS, WINDS, CALM, KNOT, normalizeWind, sampleWind, windVector, windComponents,
  windText, sampleText, windsockYaw, windsockDroop, WINDSOCK, wrapAngle } from '../src/wind.js';

const deg = d => d * Math.PI / 180;
const flat = () => 40;
function fly(f, seconds, controls = {}, rate = 120) {
  for (let i = 0; i < Math.round(seconds * rate); i++) f.update(1 / rate, controls);
  return f.state;
}
const steady = (direction, speed) => ({ direction: deg(direction), speed });
const close = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);

test('signs: a wind blows FROM its direction, +x east and +z south', () => {
  const v = (d, s = 10) => windVector(deg(d), s);
  close(v(270).x, 10, 1e-9, 'a westerly blows east'); close(v(270).z, 0, 1e-9, 'westerly has no north-south part');
  close(v(90).x, -10, 1e-9, 'an easterly blows west');
  close(v(360).z, 10, 1e-9, 'a northerly blows south (+z)'); close(v(0).z, 10, 1e-9, '0° is the same as 360°');
  close(v(180).z, -10, 1e-9, 'a southerly blows north (-z)');
  // Components for a runway heading: headwind into the nose, crosswind positive from the right.
  const north = windComponents(v(360), 0), fromEast = windComponents(v(90), 0), fromWest = windComponents(v(270), 0), tail = windComponents(v(180), 0);
  close(north.headwind, 10, 1e-9, 'northerly is a headwind heading north'); close(north.crosswind, 0, 1e-9, 'no crosswind');
  close(fromEast.crosswind, 10, 1e-9, 'easterly is from the right heading north');
  close(fromWest.crosswind, -10, 1e-9, 'westerly is from the left');
  close(tail.headwind, -10, 1e-9, 'southerly is a tailwind');
  const east = windComponents(v(180), deg(90));
  close(east.crosswind, 10, 1e-9, 'heading east, a southerly comes from the right');
});

test('heading wrap: directions normalise into [0, 360°) and reports read 360 for north', () => {
  close(wrapAngle(deg(370)), deg(10), 1e-12, '370° wraps'); close(wrapAngle(deg(-90)), deg(270), 1e-12, '−90° wraps');
  assert.equal(normalizeWind({ direction: deg(-10), speed: 5 }).direction, wrapAngle(deg(350)));
  assert.equal(windText({ direction: 0, speed: 10 * KNOT }), '360° at 10 kt');
  assert.equal(windText({ direction: deg(359.8), speed: 10 * KNOT }), '360° at 10 kt');
  assert.equal(windText(WIND_PRESETS.breeze), '240° at 8 kt');
  assert.equal(windText(WIND_PRESETS.gusts), '260° 14G24 kt');
  assert.equal(windText('calm'), 'Calm');
  assert.equal(sampleText({ speed: 0 }), 'Now calm');
  // A gusting wind veering across north always reports a wrapped direction.
  const north = { direction: deg(3), speed: 6, gust: 2, veer: deg(15), seed: 4 };
  for (let t = 0; t < 120; t += 0.37) {
    const s = sampleWind(north, t);
    assert.ok(s.direction >= 0 && s.direction < 2 * Math.PI, `wrapped at ${t}`);
    const off = Math.abs(Math.atan2(Math.sin(s.direction - north.direction), Math.cos(s.direction - north.direction)));
    assert.ok(off <= north.veer + 1e-9, `within the veer at ${t}`);
    close(Math.hypot(s.x, s.z), s.speed, 1e-9, 'vector and speed agree');
  }
});

test('gusts are deterministic, bounded and seeded; invalid configurations are calm or clamped', () => {
  const g = WIND_PRESETS.gusts;
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < 600; t += 0.05) {
    const a = sampleWind(g, t), b = sampleWind(g, t);
    assert.deepEqual(a, b, 'the same time gives the same wind');
    assert.ok(a.speed >= g.speed - 1e-9 && a.speed <= g.speed + g.gust + 1e-9, `speed in bounds at ${t}`);
    lo = Math.min(lo, a.speed); hi = Math.max(hi, a.speed);
  }
  assert.ok(hi - lo > 0.8 * g.gust, `the gusts use most of their range (${(lo / KNOT).toFixed(1)}–${(hi / KNOT).toFixed(1)} kt)`);
  assert.notDeepEqual(sampleWind({ ...g, seed: 2 }, 10), sampleWind(g, 10), 'another seed is another rhythm');
  // Steady winds never vary.
  for (const t of [0, 3.3, 77]) assert.equal(sampleWind(WIND_PRESETS.breeze, t).speed, WIND_PRESETS.breeze.speed);
  for (const raw of [undefined, null, 'storm', 42, {}, { speed: NaN, direction: 'x' }]) {
    const c = normalizeWind(raw);
    assert.equal(c.speed, 0); assert.equal(c.gust, 0);
    assert.equal(sampleWind(raw, 12).speed, 0, 'calm air');
  }
  const huge = normalizeWind({ direction: deg(90), speed: 400, gust: 80, veer: 9, seed: -3 });
  assert.equal(huge.speed, WIND_LIMITS.speed); assert.equal(huge.gust, WIND_LIMITS.gust); assert.equal(huge.veer, WIND_LIMITS.veer); assert.equal(huge.seed, 0);
  assert.deepEqual(WINDS, ['calm', 'breeze', 'gusts']);
  for (const id of WINDS) assert.equal(normalizeWind(id), WIND_PRESETS[id]);
  for (const p of Object.values(WIND_PRESETS)) assert.ok(p.speed + p.gust <= WIND_LIMITS.speed + WIND_LIMITS.gust);
});

test('a wind change blends smoothly within its bound, freezes with the clock and replays after reset', () => {
  const w = new Wind();
  w.advance(4);
  const previous = w.set('gusts');
  assert.equal(previous, CALM, 'set returns the previous configuration for restoring');
  let last = w.sample(), maxStep = 0;
  for (let i = 0; i < WIND_LIMITS.transition * 120 + 10; i++) {
    w.advance(1 / 120);
    const s = w.sample();
    maxStep = Math.max(maxStep, Math.hypot(s.x - last.x, s.z - last.z));
    last = s;
  }
  assert.equal(w.blend(), 1, 'the blend finishes');
  // From calm to 14G24 kt over six seconds: never more than a few cm/s per 1/120 s step.
  assert.ok(maxStep < 0.05, `continuous (${maxStep.toFixed(4)} m/s per step)`);
  const frozen = w.sample(); assert.deepEqual(w.sample(), frozen, 'no clock, no change: paused wind is frozen');
  w.advance(13.7); const at = w.time, later = w.sample();
  w.reset(); w.advance(at);
  assert.deepEqual(w.sample(), later, 'a reset replays the same gusts');
  w.set('breeze', { immediate: true });
  assert.equal(w.blend(), 1); assert.equal(w.sample().speed, WIND_PRESETS.breeze.speed, 'immediate skips the blend');
  const snap = w.snapshot();
  assert.ok(Object.isFrozen(snap)); assert.equal(snap.config, WIND_PRESETS.breeze); assert.equal(snap.transitioning, false);
});

test('still air is unchanged for all 21 aircraft: explicit calm flies exactly as before', () => {
  assert.equal(Object.keys(FLEET).length, 21);
  for (const id of Object.keys(FLEET)) {
    const a = new FlightController(flat, id), b = new FlightController(flat, id);
    b.setWind('breeze', { immediate: true }); b.setWind('calm', { immediate: true });
    a.toggleAutopilot(); b.toggleAutopilot();
    for (const f of [a, b]) { fly(f, 3); fly(f, 2, { roll: 0.5, pitch: -0.2 }); fly(f, 2, { throttle: 1 }); }
    assert.deepEqual(b.state.position.toArray(), a.state.position.toArray(), `${id}: position`);
    assert.equal(b.state.speed, a.state.speed, `${id}: speed`);
    assert.equal(b.state.distance, a.state.distance, `${id}: distance`);
    assert.equal(b.state.gForce, a.state.gForce, `${id}: load factor`);
    assert.deepEqual(a.state.windVelocity.toArray(), [0, 0, 0]);
    assert.equal(a.state.airspeed, a.state.speed, `${id}: airborne airspeed is speed`);
  }
  // A legacy state without windVelocity reconstructs the still-air path, as the marker always did.
  const f = new FlightController(flat, 'jet'); fly(f, 2, { roll: 0.4 });
  const { windVelocity, ...legacy } = f.state;
  assert.deepEqual(groundVelocity(legacy, f.type).toArray(), groundVelocity(f.state, f.type).toArray());
  assert.equal(flightPathVelocity, groundVelocity, 'the marker reads the same helper');
});

test('a crosswind drifts an airborne aircraft; airspeed, attitude and load factor stay those of still air', () => {
  const calm = new FlightController(flat, 'jet'), windy = new FlightController(flat, 'jet');
  windy.setWind(steady(270, 10), { immediate: true });
  calm.toggleAutopilot(); windy.toggleAutopilot();
  const start = windy.state.position.clone();
  let maxG = 0;
  for (let i = 0; i < 20 * 120; i++) {
    calm.update(1 / 120); windy.update(1 / 120);
    maxG = Math.max(maxG, Math.abs(windy.state.gForce - calm.state.gForce));
  }
  const c = calm.state, w = windy.state;
  close(w.position.x - start.x, 200, 0.5, 'drifted 10 m/s east for 20 s');
  close(w.position.z, c.position.z, 1e-6, 'north-south travel is the calm one');
  assert.equal(w.speed, c.speed, 'airspeed is untouched by a constant wind');
  assert.equal(w.heading, c.heading, 'the nose keeps its heading (it crabs)'); assert.equal(w.pitch, c.pitch); assert.equal(w.bank, c.bank);
  assert.ok(maxG < 1e-9, `no artificial load factor from a constant wind (${maxG})`);
  close(w.distance, Math.hypot(w.position.x - start.x, w.position.z - start.z), 1, 'distance flown is ground distance');
  const track = groundTrack(w, windy.type);
  assert.ok(track.track > 0 && track.track < deg(10), `track drifts right of north (${(track.track * 180 / Math.PI).toFixed(1)}°)`);
});

test('a headwind slows ground travel and a tailwind speeds it, at the same airspeed', () => {
  const run = direction => {
    const f = new FlightController(flat, 'trainer');
    if (direction !== null) f.setWind(steady(direction, 12), { immediate: true });
    f.toggleAutopilot(); const z = f.state.position.z; fly(f, 30);
    return { travel: z - f.state.position.z, distance: f.state.distance, speed: f.state.speed };
  };
  const calm = run(null), head = run(360), tail = run(180);
  close(calm.travel - head.travel, 360, 1, 'headwind costs 12 m/s × 30 s'); close(tail.travel - calm.travel, 360, 1, 'tailwind gains the same');
  close(head.distance, head.travel, 1, 'distance flown follows the ground'); close(tail.distance, tail.travel, 1, 'and with a tailwind');
  assert.equal(head.speed, calm.speed); assert.equal(tail.speed, calm.speed);
  // Navigation time en route is distance over ground speed.
  const destination = { x: 0, z: -60000, name: 'North' };
  const eta = dir => { const f = new FlightController(flat, 'trainer'); if (dir !== null) f.setWind(steady(dir, 12), { immediate: true }); f.toggleAutopilot(); fly(f, 1);
    return navigationReadout({ position: f.state.position, heading: f.state.heading, speed: groundTrack(f.state, f.type).speed }, destination).ete; };
  assert.ok(parseInt(eta(360)) > parseInt(eta(null)) && parseInt(eta(null)) > parseInt(eta(180)), `ETE headwind ${eta(360)} > calm ${eta(null)} > tailwind ${eta(180)}`);
});

test('ground velocity agrees with the displacement in wind for fixed-wing, aerobatic and helicopter flight', () => {
  const cases = [['jet', { roll: 0.5, pitch: -0.2 }], ['aerobatic', { pitch: -0.6, roll: 0.3 }], ['widebody', { throttle: -1 }], ['helicopter', { pitch: -0.4, roll: 0.3 }]];
  for (const [id, input] of cases) {
    const f = new FlightController(flat, id);
    f.setWind('gusts', { immediate: true });
    fly(f, 3, input);
    for (let i = 0; i < 5; i++) {
      const before = f.state.position.clone(); f.update(1 / 120, input);
      const moved = f.state.position.clone().sub(before).multiplyScalar(120), v = groundVelocity(f.state, f.type);
      assert.ok(v.distanceTo(moved) < 0.05, `${id}: ${v.toArray().map(n => n.toFixed(2))} vs ${moved.toArray().map(n => n.toFixed(2))}`);
    }
  }
});

test('the terrain look-ahead follows the wind-drifted path, not the nose', () => {
  // A ridge from 250 m east of the track: the still-air path runs beside it, a drifting one meets it.
  const ridge = (x, z) => x > 250 ? 700 : 40;
  const f = new FlightController(ridge, 'jet'); const s = f.state;
  s.position.set(0, 660, 0);
  s.speed = 30; s.heading = 0; s.pitch = 0; s.verticalSpeed = 0; f.setQuaternion();
  assert.equal(sampleTerrain(s, f.type, ridge).level, 'clear', 'still air: flying north along the ridge');
  f.setWind(steady(270, 20), { immediate: true });
  assert.notEqual(sampleTerrain(s, f.type, ridge).level, 'clear', 'a strong westerly carries the path into the ridge');
});

test('frame rate does not change a gusting flight: 30, 60 and 144 fps end in nearly the same place', () => {
  const at = rate => { const f = new FlightController(flat, 'trainer'); f.setWind('gusts', { immediate: true }); f.toggleAutopilot(); fly(f, 40, {}, rate); return f.state; };
  const ref = at(144);
  for (const rate of [30, 60]) {
    const s = at(rate);
    assert.ok(s.position.distanceTo(ref.position) < 3, `${rate} fps within 3 m after 40 s (${s.position.distanceTo(ref.position).toFixed(2)})`);
    close(s.speed, ref.speed, 0.2, `${rate} fps airspeed`);
  }
});

test('gusts move airspeed by inertia but keep the load factor modest and the flight reproducible', () => {
  const f = new FlightController(flat, 'trainer'); f.setWind('gusts', { immediate: true }); f.toggleAutopilot();
  let lo = Infinity, hi = -Infinity, gmin = Infinity, gmax = -Infinity;
  for (let i = 0; i < 60 * 120; i++) { f.update(1 / 120); const s = f.state; if (i > 600) { lo = Math.min(lo, s.speed); hi = Math.max(hi, s.speed); gmin = Math.min(gmin, s.gForce); gmax = Math.max(gmax, s.gForce); } }
  assert.ok(hi - lo > 1, `airspeed varies with the gusts (${lo.toFixed(1)}–${hi.toFixed(1)} m/s)`);
  assert.ok(gmin > 0.6 && gmax < 1.4, `load factor stays gentle (${gmin.toFixed(2)}–${gmax.toFixed(2)} g)`);
  // Reset replays the same flight.
  const replay = () => { f.reset(); f.toggleAutopilot(); fly(f, 25); return f.state.position.toArray(); };
  assert.deepEqual(replay(), replay());
});

test('selecting a wind in flight blends in without a velocity or attitude jump', () => {
  const f = new FlightController(flat, 'jet'); f.toggleAutopilot(); fly(f, 2);
  f.setWind('gusts');
  let previous = groundVelocity(f.state, f.type).clone(), maxJump = 0, maxBankStep = 0, bank = f.state.bank;
  for (let i = 0; i < 10 * 120; i++) {
    f.update(1 / 120);
    const v = groundVelocity(f.state, f.type);
    maxJump = Math.max(maxJump, v.distanceTo(previous)); previous.copy(v);
    maxBankStep = Math.max(maxBankStep, Math.abs(f.state.bank - bank)); bank = f.state.bank;
  }
  assert.ok(maxJump < 0.1, `ground velocity changes by under 0.1 m/s per 1/120 s (${maxJump.toFixed(3)})`);
  assert.ok(maxBankStep < 0.01, 'attitude moves smoothly');
  assert.equal(f.windSnapshot().transitioning, false);
  // An activity can apply its own wind at once and restore the pilot's afterwards.
  const pilot = f.setWind(steady(90, 8), { immediate: true });
  assert.equal(pilot, WIND_PRESETS.gusts);
  assert.deepEqual(f.state.windVelocity.toArray().map(n => Math.round(n * 1e6) / 1e6), [-8, 0, 0]);
  f.setWind(pilot, { immediate: true });
  assert.equal(f.windSnapshot().config, WIND_PRESETS.gusts);
});

test('wind time freezes when the flight is not updated (pause, dialogs) and restarts with reset', () => {
  const f = new FlightController(flat, 'jet'); f.setWind('gusts', { immediate: true });
  fly(f, 5);
  const t = f.windSnapshot().time, sample = f.sampleWind();
  close(t, 5, 1e-9, 'the wind clock is flight time');
  assert.deepEqual(f.sampleWind(), sample, 'paused: nothing advances');
  f.update(0); f.update(NaN); f.update(-1);
  assert.equal(f.windSnapshot().time, t, 'non-steps do not move it');
  f.reset();
  assert.equal(f.windSnapshot().time, 0); assert.equal(f.windSnapshot().config, WIND_PRESETS.gusts, 'reset keeps the selection');
  f.setAircraft('helicopter');
  assert.equal(f.windSnapshot().config, WIND_PRESETS.gusts, 'and so does a new aircraft');
});

test('grounded aircraft never drift; rotation is by airspeed and touchdown keeps the wheel model', () => {
  for (const id of Object.keys(FLEET)) {
    const f = new FlightController(flat, id);
    f.setWind(steady(90, 18), { immediate: true });
    const s = f.runwayStart(0, 40 + (f.type.flight.rotorcraft ? 0 : f.type.groundClearance ?? 2.8), 0, 0);
    fly(f, 10, { brake: 1 });
    assert.equal(s.position.x, 0, `${id}: no sideways slide in an 18 m/s crosswind`); assert.equal(s.position.z, 0, `${id}: parked`);
    assert.ok(s.grounded, `${id}: still on the ground`);
    if (!f.type.flight.rotorcraft) close(s.airspeed, 0, 1e-9, `${id}: a pure crosswind gives no airspeed along the nose`);
  }
  // A headwind shortens the takeoff roll; the roll itself (wheel speed, brakes) is the existing model.
  const roll = direction => {
    const f = new FlightController(flat, 'trainer'); if (direction !== null) f.setWind(steady(direction, 8), { immediate: true });
    const s = f.runwayStart(0, 42.8, 0, 0); s.throttle = 1;
    let t = 0; while (s.grounded && t < 90) { f.update(1 / 120, { pitch: 1 }); t += 1 / 120; }
    return { distance: -s.position.z, x: s.position.x, speed: s.speed, airborne: !s.grounded };
  };
  const calm = roll(null), head = roll(360), cross = roll(90);
  assert.ok(calm.airborne && head.airborne && cross.airborne);
  assert.ok(head.distance < 0.8 * calm.distance, `headwind roll ${head.distance.toFixed(0)} m vs calm ${calm.distance.toFixed(0)} m`);
  close(cross.distance, calm.distance, 2, 'a pure crosswind does not change the roll'); assert.ok(Math.abs(cross.x) < 0.1, 'and does not push it sideways');
  // Brakes stop a rolling aircraft as before, whatever the wind.
  const stop = direction => { const f = new FlightController(flat, 'trainer'); if (direction !== null) f.setWind(steady(direction, 10), { immediate: true });
    const s = f.runwayStart(0, 42.8, 0, 0); s.speed = 25; fly(f, 15, { brake: 1 }); return { speed: s.speed, z: s.position.z }; };
  const a = stop(null), b = stop(180);
  assert.equal(a.speed, 0); assert.equal(b.speed, 0); assert.equal(a.z, b.z, 'the wheel-brake stop is unchanged by a tailwind');
});

test('touchdown in a headwind rolls out at ground speed along the heading', () => {
  const f = new FlightController(flat, 'trainer'); f.setWind(steady(360, 8), { immediate: true });
  const s = f.state;
  s.position.set(0, 40 + (f.type.groundClearance ?? 2.8) + 0.05, 0);
  Object.assign(s, { speed: 32, heading: 0, pitch: 0, bank: 0, verticalSpeed: -1, gearDown: true, throttle: 0, spool: 0 });
  f.setQuaternion();
  fly(f, 0.2);
  assert.ok(s.grounded, 'landed');
  close(s.touchdown.speed, 32, 0.6, 'the touchdown records airspeed');
  assert.ok(s.speed < 25.5 && s.speed > 22, `wheel speed is airspeed minus the headwind (${s.speed.toFixed(1)} m/s)`);
  const x = s.position.x; fly(f, 3); assert.equal(s.position.x, x, 'no drift on the runway');
});

test('helicopter: hover hold keeps its ground point in wind; a level disc drifts downwind', () => {
  for (const preset of ['breeze', 'gusts']) {
    const f = new FlightController(() => 78, 'helicopter'); f.setWind(preset, { immediate: true });
    const start = f.state.position.clone(); f.toggleAutopilot();
    fly(f, 60);
    const off = Math.hypot(f.state.position.x - start.x, f.state.position.z - start.z);
    assert.ok(off < (preset === 'gusts' ? 6 : 1), `${preset}: hold within ${off.toFixed(2)} m of its point`);
    close(f.state.position.y, start.y, 2, `${preset}: altitude held`);
    if (preset === 'breeze') close(f.state.speed, WIND_PRESETS.breeze.speed, 0.3, 'holding a ground point in wind shows the wind as airspeed');
  }
  // Manual, disc held level by self-stability: it drifts with the air toward the wind's speed.
  const f = new FlightController(() => 78, 'helicopter'); f.setWind(steady(270, 6), { immediate: true });
  fly(f, 90);
  const v = f.state.velocity;
  assert.ok(v.x > 4 && Math.abs(v.z) < 0.5, `drifting east (${v.x.toFixed(2)}, ${v.z.toFixed(2)})`);
  assert.ok(f.state.speed < 2, `little air moves past a drifting rotor (${f.state.speed.toFixed(2)} m/s)`);
  // On the ground it stays put and settles there exactly as in calm air.
  const g = new FlightController(() => 78, 'helicopter'); g.setWind('gusts', { immediate: true });
  const s = g.runwayStart(10, 0, 20, 0); fly(g, 10);
  assert.equal(s.position.x, 10); assert.equal(s.position.z, 20); assert.equal(s.velocity.length(), 0);
});

test('settings: wind is its own choice, calm by default and for older or invalid saves, kept by restore defaults', () => {
  assert.equal(defaultSettings().wind, 'calm');
  assert.equal(normalizeSettings({ weather: 'overcast' }).wind, 'calm', 'an older save without wind is calm, whatever its weather');
  assert.equal(normalizeSettings({ weather: 'golden', wind: 'gusts' }).wind, 'gusts');
  assert.equal(normalizeSettings({ weather: 'golden', wind: 'gusts' }).weather, 'golden', 'independent of the light');
  assert.equal(normalizeSettings({ wind: 'hurricane' }).wind, 'calm');
  assert.equal(resetSettings({ wind: 'breeze' }).wind, 'breeze', 'a selection, not a customization');
});

test('windsock yaw streams downwind in world space, undoing each airport group rotation; droop follows strength', () => {
  for (const groupHeading of [0, deg(138), deg(352), deg(162), deg(106)]) {
    for (const from of [0, 45, 90, 240, 260, 359]) {
      const group = new Group(); group.rotation.y = -groupHeading;
      const sock = new Object3D(); group.add(sock);
      const wind = windVector(deg(from), 7);
      sock.rotation.y = windsockYaw(wind) - sock.parent.rotation.y;
      group.updateMatrixWorld(true);
      const tail = new Vector3(1, 0, 0).transformDirection(sock.matrixWorld);
      close(tail.x, wind.x / 7, 1e-9, `field ${groupHeading.toFixed(2)} wind ${from}° x`);
      close(tail.z, wind.z / 7, 1e-9, `field ${groupHeading.toFixed(2)} wind ${from}° z`);
    }
  }
  assert.equal(windsockYaw({ x: 0, z: 0 }), null, 'calm keeps the last heading');
  assert.equal(windsockDroop(0), WINDSOCK.hang); close(windsockDroop(40), WINDSOCK.full, 1e-12, 'straight out');
  assert.ok(windsockDroop(WIND_PRESETS.breeze.speed) < windsockDroop(WIND_PRESETS.gusts.speed), 'stronger wind extends the sock further');
});
