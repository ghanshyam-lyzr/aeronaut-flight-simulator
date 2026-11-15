import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { FlightController } from '../src/flight.js';
import { FLEET } from '../src/fleet.js';
import { AIRPORTS, airportById, runwayDirection } from '../src/airports.js';
import { runwayPoint, runwayCoordinates } from '../src/airfield.js';
import { LandingMission, landingProfile, TOUCHDOWN_ZONE } from '../src/landing-mission.js';
import { glideIndication, createGlideLights, unitOffsets, lightSide, GLIDE_LIGHTS } from '../src/glide-lights.js';

const plane = landingProfile(FLEET.jet), heli = landingProfile(FLEET.helicopter);
const field = (id, rw) => { const a = airportById(id); return runwayDirection(a, rw ?? a.runway); };
/** A world position `distance` metres before the aim point, `cross` right of the centreline, at `angle`° above it. */
function approach(f, distance, angle = Math.atan(plane.slope) * 180 / Math.PI, cross = 0, profile = plane) {
  const p = runwayPoint(TOUCHDOWN_ZONE.aim - distance, cross, f);
  return new Vector3(p.x, f.elevation + profile.clearance + distance * Math.tan(angle * Math.PI / 180), p.z);
}
const path = Math.atan(plane.slope) * 180 / Math.PI;

test('the lights read the landing profile slope: two white on path, more white high, more red low', () => {
  const f = field('alpine-field');
  assert.equal(glideIndication(approach(f, 1320), f, plane).white, 2);
  const counts = [-1, -0.3, 0, 0.3, 1].map(d => glideIndication(approach(f, 1320, path + d), f, plane).white);
  assert.deepEqual(counts, [0, 1, 2, 3, 4]);
  // Outer units whiten first, the inner (nearest the runway) last.
  assert.deepEqual(glideIndication(approach(f, 1320, path + 0.3), f, plane).units, [false, true, true, true]);
  assert.deepEqual(glideIndication(approach(f, 1320, path - 0.3), f, plane).units, [false, false, false, true]);
});

test('on/high/low transitions happen at the published offsets, monotonically', () => {
  const f = field('alpine-field');
  let last = -1;
  for (let a = path - 1.5; a <= path + 1.5; a += 0.01) {
    const w = glideIndication(approach(f, 2000, a), f, plane).white;
    assert.ok(w >= last, `no step back at ${a.toFixed(2)}°`); last = w;
  }
  for (const [i, o] of GLIDE_LIGHTS.offsets.entries()) {
    assert.equal(glideIndication(approach(f, 2000, path + o - 0.02), f, plane).units[i], false);
    assert.equal(glideIndication(approach(f, 2000, path + o + 0.02), f, plane).units[i], true);
  }
});

test('the mission start and the mission guidance agree with the lights', () => {
  for (const a of AIRPORTS) for (const rw of [a.runway, a.reciprocal]) {
    const f = runwayDirection(a, rw), flight = new FlightController(() => -1e4, 'jet'), m = new LandingMission();
    const s = m.start(flight, f), g = m.guidance(s), ind = glideIndication(s.position, f, m.profile, s);
    if (Math.abs(g.pathError) < 1) assert.equal(ind.white, 2, `${a.name} ${rw} starts on path`);
    else assert.ok(g.pathError > 0 ? ind.white >= 2 : ind.white <= 2, `${a.name} ${rw}`);
    assert.ok(ind.visible);
  }
});

test('approach-sector limits hide the lights behind, past, beside, too far and too high', () => {
  const f = field('orvane-regional');
  assert.ok(glideIndication(approach(f, GLIDE_LIGHTS.minDistance + 1), f, plane).visible);
  assert.equal(glideIndication(approach(f, GLIDE_LIGHTS.minDistance - 1), f, plane).reason, 'past the approach');
  assert.equal(glideIndication(approach(f, -500), f, plane).reason, 'past the approach'); // over the runway
  assert.equal(glideIndication(approach(f, -3000), f, plane).reason, 'past the approach'); // behind the far end
  assert.ok(glideIndication(approach(f, GLIDE_LIGHTS.maxDistance - 1), f, plane).visible);
  assert.equal(glideIndication(approach(f, GLIDE_LIGHTS.maxDistance + 1), f, plane).reason, 'too far');
  const edge = f.runwayWidth / 2 + 2000 * Math.tan(GLIDE_LIGHTS.sector * Math.PI / 180);
  for (const side of [1, -1]) {
    assert.ok(glideIndication(approach(f, 2000, path, side * (edge - 1)), f, plane).visible);
    assert.equal(glideIndication(approach(f, 2000, path, side * (edge + 1)), f, plane).reason, 'outside the sector');
  }
  assert.ok(glideIndication(approach(f, 2000, GLIDE_LIGHTS.maxAngle - 0.1), f, plane).visible);
  assert.equal(glideIndication(approach(f, 2000, GLIDE_LIGHTS.maxAngle + 0.1), f, plane).reason, 'above the sector');
  // Well below the path stays visible as four reds (terrain may still hide the units).
  assert.equal(glideIndication(approach(f, 2000, -2), f, plane).white, 0);
});

test('reciprocal runways measure from their own threshold and aim point', () => {
  for (const a of AIRPORTS) {
    const fwd = runwayDirection(a, a.runway), rev = runwayDirection(a, a.reciprocal);
    const onRev = approach(rev, 1500);
    assert.equal(glideIndication(onRev, rev, plane).white, 2, `${a.name} ${a.reciprocal}`);
    assert.equal(glideIndication(onRev, fwd, plane).reason, 'past the approach', `${a.name}: behind runway ${a.runway}`);
    assert.equal(glideIndication(approach(fwd, 1500), rev, plane).reason, 'past the approach');
    // Units sit at each direction's own aim point, on opposite sides of the strip for the same apron.
    const u = unitOffsets(rev)[0], p = runwayPoint(TOUCHDOWN_ZONE.aim, u, rev), back = runwayCoordinates(p, fwd);
    assert.ok(Math.abs(back.along - (a.runwayLength - TOUCHDOWN_ZONE.aim)) < 1e-6);
  }
});

test('elevated fields use their own elevation, and a low-field height reads all red there', () => {
  const brume = field('brume-col'), orvane = field('orvane-regional'), alpine = field('alpine-field');
  assert.ok(brume.elevation > 1000 && orvane.elevation > 1000);
  for (const f of [brume, orvane]) {
    assert.equal(glideIndication(approach(f, 1200), f, plane).white, 2, f.name);
    const lowField = approach(f, 1200); lowField.y += alpine.elevation - f.elevation;
    assert.equal(glideIndication(lowField, f, plane).white, 0);
  }
  // Each aircraft's own ground clearance shifts the path exactly as the mission's guidance does.
  const big = landingProfile(FLEET.airliner);
  assert.equal(glideIndication(approach(orvane, 1500, path, 0, big), orvane, big).white, 2);
});

test('helicopters, the ground, crashes and bad input hide the lights', () => {
  const f = field('alpine-field'), p = approach(f, 1320);
  assert.equal(glideIndication(p, f, heli).reason, 'helicopter');
  assert.equal(glideIndication(p, f, plane, { grounded: true }).reason, 'on the ground');
  assert.equal(glideIndication(p, f, plane, { crashed: true }).reason, 'crashed');
  assert.equal(glideIndication(new Vector3(NaN, 0, 0), f, plane).reason, 'invalid');
  assert.equal(glideIndication(p, null, plane).visible, false);
});

test('one set of resources moves between runways and frees itself', () => {
  const scene = new Scene(), lights = createGlideLights(scene);
  assert.equal(scene.children.length, 1);
  const meshes = []; lights.group.traverse(o => o.geometry && meshes.push(o));
  assert.equal(meshes.length, 2, 'one point draw and one housing bar');
  assert.equal(scene.children.filter(o => o.isLight).length + lights.group.children.filter(o => o.isLight).length, 0, 'no scene lights');
  const geometries = new Set(meshes.map(m => m.geometry.uuid));
  for (const a of AIRPORTS) for (const rw of [a.runway, a.reciprocal]) {
    const f = runwayDirection(a, rw); lights.setField(f);
    assert.equal(lights.field, f);
    assert.equal(lights.group.position.y, f.elevation);
    const ind = lights.update(approach(f, 1500), plane, {});
    assert.ok(ind.visible && lights.group.visible, `${a.name} ${rw}`);
    // Every unit sits beside the runway at the aim point, clear of the apron side.
    for (const c of unitOffsets(f)) assert.ok(Math.abs(c) > f.runwayWidth / 2 + 5 && Math.sign(c) === lightSide(f));
    if (f.apron.cross[1] < 0) assert.equal(lightSide(f), 1);
    lights.update(approach(f, 1500), heli, {});
    assert.equal(lights.group.visible, false);
  }
  assert.equal(scene.children.length, 1, 'no stale groups');
  const seen = []; lights.group.traverse(o => o.geometry && seen.push(o.geometry.uuid));
  assert.deepEqual(new Set(seen), geometries, 'no new geometry per runway');
  let freed = 0; for (const m of meshes) { m.geometry.addEventListener('dispose', () => freed++); m.material.addEventListener('dispose', () => freed++); }
  lights.dispose();
  assert.equal(scene.children.length, 0); assert.equal(freed, 4);
});

test('colours change only when the count changes, and follow the indication', () => {
  const scene = new Scene(), lights = createGlideLights(scene), f = field('serein-lakeside');
  lights.setField(f);
  const white = () => Array.from(lights.group.children[0].geometry.attributes.white.array);
  lights.update(approach(f, 1500, path + 1), plane, {}); assert.deepEqual(white(), [1, 1, 1, 1]);
  lights.update(approach(f, 1500), plane, {}); assert.deepEqual(white(), [0, 0, 1, 1]);
  lights.update(approach(f, 1500, path - 1), plane, {}); assert.deepEqual(white(), [0, 0, 0, 0]);
  const v = lights.group.children[0].geometry.attributes.white.version;
  lights.update(approach(f, 1400, path - 1), plane, {});
  assert.equal(lights.group.children[0].geometry.attributes.white.version, v);
  lights.dispose();
});
