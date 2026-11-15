import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';
import { groundHeight } from '../src/world.js';
import { inWorld } from '../src/regions.js';
import { AIRPORTS } from '../src/airports.js';
import { LandingMission } from '../src/landing-mission.js';
import { Activities } from '../src/activities.js';
import { CheckpointCourse, COURSE, gateCrossing, gateCoordinates, courseAvailability, RECOMMENDED_AIRCRAFT, MAX_TRAVEL_SPEED, formatCourseTime } from '../src/checkpoint-course.js';
import { createCourseGates } from '../src/course-gates.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), angle = a => Math.atan2(Math.sin(a), Math.cos(a));
const FIXED_WING = Object.keys(FLEET).filter(id => !FLEET[id].flight.rotorcraft);
/** A world point in `gate`'s frame: `along` its forward axis, `cross` to its right, `up` above its centre. */
const at = (gate, along, cross = 0, up = 0) => ({
  x: gate.x + Math.sin(gate.heading) * along + Math.cos(gate.heading) * cross,
  y: gate.y + up, z: gate.z - Math.cos(gate.heading) * along + Math.sin(gate.heading) * cross });
const G = COURSE.gates;

/** A running course whose aircraft is moved by hand: `fly(point, seconds)` is one physics slice ending at `point`. */
function run(id = 'trainer') {
  const flight = new FlightController(groundHeight, id), course = new CheckpointCourse(), s = flight.state;
  course.start(flight);
  const fly = (p, seconds = 0.1) => { s.position.set(p.x, p.y, p.z); s.flightTime += seconds; course.update(s); };
  return { flight, course, s, fly };
}
/** Flies straight through gate `i` along its axis in two slices. */
const through = (fly, i, cross = 0, up = 0) => { fly(at(G[i], -20, cross, up)); fly(at(G[i], 20, cross, up)); };

test('the course is one curated route of six gates over Lake Azure with generous openings', () => {
  assert.equal(G.length, 6);
  assert.equal(COURSE.id, 'lake-azure');
  for (const g of G) {
    assert.ok(g.width >= 120 && g.height >= 70, 'beginner-sized opening');
    assert.ok(inWorld(g.x, g.z, 1000));
  }
  // Each gate faces between the leg into it and the leg out of it; no leg turns more than 30°.
  const pts = [COURSE.start, ...G], bearing = (a, b) => Math.atan2(b.x - a.x, -(b.z - a.z));
  for (let i = 1; i < pts.length; i++) {
    const leg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    assert.ok(leg > 1500 && leg < 2200, `leg ${i} is ${leg} m`);
    assert.ok(Math.abs(pts[i].y - pts[i - 1].y) / leg < Math.tan(2.1 * Math.PI / 180), 'no climb or descent steeper than about 2°');
    if (i < pts.length - 1) {
      const into = bearing(pts[i - 1], pts[i]), out = bearing(pts[i], pts[i + 1]);
      assert.ok(Math.abs(angle(out - into)) < 30 * Math.PI / 180);
      assert.ok(Math.abs(angle(pts[i].heading - (into + angle(out - into) / 2))) < 1e-9);
    }
  }
  assert.ok(Math.abs(angle(COURSE.start.heading - bearing(COURSE.start, G[0]))) < 1e-9, 'the start is lined up with gate 1');
});

test('terrain stays well clear of every gate and of the corridor between them', () => {
  for (const g of G) {
    for (const cross of [-g.width / 2, 0, g.width / 2]) {
      const p = at(g, 0, cross);
      assert.ok(g.y - g.height / 2 - Math.max(10, groundHeight(p.x, p.z)) >= 80, `gate ${g.index + 1} bottom clears the ground`);
    }
  }
  const pts = [COURSE.start, ...G];
  for (let i = 1; i < pts.length; i++) {
    for (let t = 0; t <= 1; t += 0.02) {
      const x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z = pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t;
      const y = Math.min(pts[i - 1].y, pts[i].y);
      // 400 m either side of the line: room to wander and turn.
      for (const dx of [-400, 0, 400]) assert.ok(y - Math.max(10, groundHeight(x + dx, z)) >= 100, `corridor clear near ${x.toFixed(0)}, ${z.toFixed(0)}`);
    }
  }
  // Clear of every airfield's runway, so the course never overflies a landing in progress at low level.
  for (const a of AIRPORTS) for (const g of G) assert.ok(Math.hypot(g.x - a.x, g.z - a.z) > a.runwayLength / 2 + 400, `${a.id} vs gate ${g.index + 1}`);
});

test('a swept crossing counts only forward through the opening', () => {
  const g = G[2];
  const forward = gateCrossing(g, at(g, -10), at(g, 30));
  assert.equal(forward.direction, 'forward'); assert.equal(forward.inside, true);
  assert.ok(Math.abs(forward.t - 0.25) < 1e-9);
  assert.equal(gateCrossing(g, at(g, 30), at(g, -10)).direction, 'backward');
  // Around the posts, over the top beam, under the bottom beam: the plane is crossed outside the opening.
  for (const [cross, up] of [[g.width / 2 + 5, 0], [-g.width / 2 - 5, 0], [0, g.height / 2 + 5], [0, -g.height / 2 - 5]]) {
    const c = gateCrossing(g, at(g, -10, cross, up), at(g, 10, cross, up));
    assert.equal(c.inside, false, `${cross}, ${up}`);
  }
  // Exactly on the edge still counts; a segment that never reaches the plane, or runs along it, does not cross.
  assert.equal(gateCrossing(g, at(g, -1, g.width / 2 - 1e-6), at(g, 1, g.width / 2 - 1e-6)).inside, true);
  assert.equal(gateCrossing(g, at(g, -50), at(g, -1)), null);
  assert.equal(gateCrossing(g, at(g, 10, -200), at(g, 10, 200)), null, 'flying across behind the gate never crosses its plane');
  // A segment ending exactly on the plane counts once: the next one starts on it and does not cross again.
  assert.equal(gateCrossing(g, at(g, -10), at(g, 0)).direction, 'forward');
  assert.equal(gateCrossing(g, at(g, 0), at(g, 10)), null);
  // A diagonal pass is judged where it meets the plane, not at either end.
  assert.equal(gateCrossing(g, at(g, -100, -200), at(g, 100, 200)).inside, true);
  assert.equal(gateCrossing(g, at(g, -100, 0), at(g, 100, 400)).inside, false);
  assert.deepEqual(Object.keys(gateCoordinates(at(g, 1, 2, 3), g)), ['along', 'cross', 'up']);
});

test('fast aircraft and low frame rates cannot skip a gate between two positions', () => {
  // 290 m/s at 4 frames a second: 72 m a step, never near the gate's 3.5 m bars.
  const { course, fly } = run('interceptor');
  fly(at(G[0], -40), 0.25); fly(at(G[0], 32), 0.25);
  assert.equal(course.next, 1);
  // One very long (but physically possible) slice straight through gate 2.
  fly(at(G[1], -400), 0.25); fly(at(G[1], 300), 700 / 290);
  assert.equal(course.next, 2);
});

test('gates count only in order; wrong order, around, behind and backwards never advance', () => {
  const { course, fly, s } = run();
  through(fly, 1);
  assert.equal(course.next, 0); assert.deepEqual(course.event, { type: 'order', gate: 1 });
  through(fly, 0, G[0].width / 2 + 10);
  assert.equal(course.next, 0); assert.deepEqual(course.event, { type: 'missed', gate: 0 });
  fly(at(G[0], 30, -300)); fly(at(G[0], 30, 300)); // across behind it
  assert.equal(course.next, 0);
  fly(at(G[0], 20)); fly(at(G[0], -20)); // backwards through the opening
  assert.equal(course.next, 0); assert.deepEqual(course.event, { type: 'backward', gate: 0 });
  through(fly, 0);
  assert.equal(course.next, 1); assert.equal(course.event.type, 'gate');
  // Back through gate 1 the right way again: it is behind us and counts for nothing.
  fly(at(G[0], -20)); through(fly, 0);
  assert.equal(course.next, 1); assert.equal(course.splits.length, 1);
  assert.equal(course.status, 'flying'); assert.equal(s.crashed, false);
});

test('resets and teleports never award a gate', () => {
  const { course, fly, s, flight } = run('jet');
  // A teleport across gate 1's opening, with almost no flight time between the two positions.
  fly(at(G[0], -600), 0.1); fly(at(G[0], 600), 0.1);
  assert.equal(course.next, 0); assert.deepEqual(course.event, { type: 'jump' });
  // A move with no flight time at all (paused) is a jump too.
  fly(at(G[0], -5), 0); fly(at(G[0], 5), 0);
  assert.equal(course.next, 0);
  // After a jump the next ordinary slice measures from the new place, so flying on still counts.
  fly(at(G[0], -10), 0.1); fly(at(G[0], 10), 0.1);
  assert.equal(course.next, 1);
  assert.ok(MAX_TRAVEL_SPEED > Math.max(...Object.values(FLEET).map(t => (t.flight.maxSpeed ?? 0) + (t.flight.afterburnerSpeed ?? 0))));
  // Any reset (flight time runs backwards) cancels the attempt instead of continuing it.
  flight.reset(); course.update(s);
  assert.equal(course.status, 'idle'); assert.equal(course.next, 0);
});

test('the clock is flight time: frozen while paused, gate splits interpolated to the crossing', () => {
  const { course, fly, s } = run();
  fly(at(G[0], -40), 20);
  assert.ok(Math.abs(course.elapsed - 20) < 1e-9);
  // A paused simulator does not advance flight time: repeated updates at the same time leave the clock alone.
  for (let i = 0; i < 50; i++) course.update(s);
  assert.ok(Math.abs(course.elapsed - 20) < 1e-9);
  fly(at(G[0], 10), 1); // crosses the plane 80% of the way through the slice
  assert.ok(Math.abs(course.splits[0] - 20.8) < 1e-9);
  assert.ok(Math.abs(course.elapsed - 21) < 1e-9);
  assert.equal(formatCourseTime(2.8), '0:02.8');
  assert.equal(formatCourseTime(127.04), '2:07.0');
});

test('the last gate completes the run at its crossing time and keeps the session best', () => {
  const { course, fly, flight } = run();
  for (let i = 0; i < G.length; i++) through(fly, i);
  assert.equal(course.status, 'complete'); assert.equal(course.finished, true); assert.equal(course.active, false);
  assert.equal(course.splits.length, 6);
  assert.ok(Math.abs(course.elapsed - (G.length * 2 - 1) * 0.1 - 0.05) < 1e-9, 'stops at the final crossing, not the end of the slice');
  const first = course.best;
  assert.equal(course.newBest, true); assert.equal(first, course.elapsed);
  // Further updates after completion change nothing.
  fly(at(G[5], 400), 5); assert.equal(course.elapsed, first);
  // Retry: a fresh attempt, the best kept; a slower run does not replace it.
  course.start(flight);
  assert.equal(course.status, 'flying'); assert.equal(course.next, 0); assert.equal(course.elapsed, 0); assert.deepEqual(course.splits, []);
  for (let i = 0; i < G.length; i++) { fly(at(G[i], -20), 1); fly(at(G[i], 20), 1); }
  assert.equal(course.newBest, false); assert.equal(course.best, first);
});

test('a crash ends the run with its reason; an aircraft change cancels it', () => {
  const a = run('jet');
  Object.assign(a.s, { crashed: true, crashReason: 'Terrain collision' }); a.fly(at(G[0], -500));
  assert.equal(a.course.status, 'failed'); assert.equal(a.course.reason, 'Terrain collision'); assert.equal(a.course.finished, true);
  const b = run('jet');
  b.flight.setAircraft('trainer'); b.course.update(b.s);
  assert.equal(b.course.status, 'idle');
  b.s.flightTime = 99; b.s.aircraft = 'jet'; b.course.update(b.s);
  assert.equal(b.course.status, 'idle', 'a cancelled run stays cancelled');
});

test('every start is the same lined-up airborne start, in the chosen aircraft; helicopters are refused by name', () => {
  for (const id of Object.keys(FLEET)) {
    const flight = new FlightController(groundHeight, id), course = new CheckpointCourse(), s = flight.state;
    Object.assign(s, { crashed: true, autopilot: true, flaps: 2 });
    const started = course.start(flight), fit = courseAvailability(FLEET[id]);
    assert.equal(s.aircraft, id, 'the aircraft is never switched');
    if (FLEET[id].flight.rotorcraft) {
      assert.equal(started, null); assert.equal(fit.available, false); assert.match(fit.reason, /helicopter/i);
      assert.equal(course.status, 'idle');
      continue;
    }
    assert.equal(fit.available, true);
    assert.equal(s.crashed, false); assert.equal(s.autopilot, false); assert.equal(s.flaps, 0); assert.equal(s.flightTime, 0);
    assert.equal(s.heading, COURSE.start.heading); assert.equal(s.gearDown, !!FLEET[id].fixedGear);
    assert.ok(s.speed > FLEET[id].flight.stallSpeed * 1.3);
    assert.ok(s.position.y - groundHeight(s.position.x, s.position.z) > 120);
    assert.ok(gateCoordinates(s.position, G[0]).along < -1500);
    const first = s.position.toArray();
    course.start(flight);
    assert.deepEqual(s.position.toArray(), first);
  }
  assert.equal(FLEET[RECOMMENDED_AIRCRAFT].name, 'Mira T2');
});

/** A deterministic feedback pilot: ordinary rate inputs toward a point ahead on the line through the gates. */
function flyCourse(id, { maxSpeed = Infinity, frameRate = 60 } = {}) {
  const flight = new FlightController(groundHeight, id), course = new CheckpointCourse(), s = flight.state;
  course.start(flight);
  const last = G.at(-1), pts = [COURSE.start, ...G, at(last, 3000)];
  const ahead = (p, seg, lead) => {
    let a = pts[seg], b = pts[seg + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
    let d = clamp(((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / len, 0, len) + lead;
    while (d > len && seg < pts.length - 2) { d -= len; seg++; a = pts[seg]; b = pts[seg + 1]; len = Math.hypot(b.x - a.x, b.z - a.z); }
    return { x: a.x + (b.x - a.x) * d / len, z: a.z + (b.z - a.z) * d / len };
  };
  const inputs = new FlightInputs(0), f = flight.type.flight;
  let clearance = Infinity;
  for (let frame = 1; frame < frameRate * 600 && course.active; frame++) {
    const g = course.gate, t = ahead(s.position, course.next, Math.max(250, s.speed * 5));
    const err = angle(Math.atan2(t.x - s.position.x, -(t.z - s.position.z)) - s.heading);
    const limit = Math.min(0.85, (f.bankLimit ?? 1) - 0.05), bank = clamp(err * 3, -limit, limit);
    const pitch = clamp((g.y - s.position.y) * 0.01 - s.verticalSpeed * 0.03, -0.15, 0.15);
    inputs.set({ roll: clamp((bank - s.bank) * 3, -1, 1), pitch: clamp((pitch - s.pitch) * 4, -1, 1),
      throttle: clamp((Math.min(f.cruiseSpeed, maxSpeed) - s.speed) * 0.2, -1, 1) }, (frame - 1) / frameRate);
    inputs.advance(frame / frameRate, (step, c) => { if (!course.active) return; flight.update(step, c); course.update(s); });
    clearance = Math.min(clearance, s.position.y - Math.max(10, groundHeight(s.position.x, s.position.z)));
  }
  return { course, s, clearance };
}

for (const id of ['trainer', 'jet']) {
  test(`${FLEET[id].name}: flies the whole course with normal controls at cruise power`, () => {
    const { course, s, clearance } = flyCourse(id);
    assert.equal(course.status, 'complete', JSON.stringify(course.snapshot()));
    assert.equal(s.crashed, false); assert.ok(clearance > 100);
    assert.equal(course.splits.length, 6);
    assert.ok(course.splits.every((t, i) => i === 0 || t > course.splits[i - 1]));
    // About 3½ minutes in the trainer, under 2 in the jet.
    assert.ok(course.elapsed > (id === 'trainer' ? 180 : 90) && course.elapsed < (id === 'trainer' ? 250 : 130), String(course.elapsed));
  });
}

test('the same pilot at 20 frames a second still counts every gate', () => {
  const { course } = flyCourse('jet', { frameRate: 20 });
  assert.equal(course.status, 'complete', JSON.stringify(course.snapshot()));
});

test('every fixed-wing aircraft completes the course below 210 kt, the pace the brief advises', () => {
  for (const id of FIXED_WING) {
    const { course, s } = flyCourse(id, { maxSpeed: 108 });
    assert.equal(course.status, 'complete', `${id}: ${JSON.stringify(course.snapshot())}`);
    assert.equal(s.crashed, false);
  }
});

test('landing missions and the course are mutually exclusive and keep their own starts', () => {
  const flight = new FlightController(groundHeight, 'trainer'), landing = new LandingMission(), course = new CheckpointCourse();
  const activities = new Activities(landing, course);
  assert.equal(activities.kind, 'free');
  activities.startCourse(flight);
  assert.equal(activities.kind, 'course');
  const courseStart = flight.state.position.toArray();
  // A landing start cancels the course and is the landing mission's own start.
  activities.startLanding(flight);
  assert.equal(activities.kind, 'landing'); assert.equal(course.status, 'idle'); assert.equal(landing.status, 'flying');
  const reference = new FlightController(groundHeight, 'trainer'); new LandingMission().start(reference);
  assert.deepEqual(flight.state.position.toArray(), reference.state.position.toArray());
  // And back: the course start cancels the landing.
  activities.startCourse(flight);
  assert.equal(activities.kind, 'course'); assert.equal(landing.status, 'idle');
  assert.deepEqual(flight.state.position.toArray(), courseStart);
  // Updates reach only the activity underway: an idle landing mission ignores course flight.
  activities.update(0.1, { ...flight.state, flightTime: 0.1 });
  assert.equal(landing.status, 'idle');
  assert.equal(activities.finished, false);
  Object.assign(flight.state, { crashed: true, flightTime: 0.2 }); activities.update(0.1, flight.state);
  assert.equal(activities.finished, true); assert.equal(activities.kind, 'course');
  activities.cancel();
  assert.equal(activities.kind, 'free'); assert.equal(activities.finished, false);
  assert.equal(course.best, null, 'a failed run sets no best');
});

test('gate rendering: one shared geometry, next gate highlighted, passed gates hidden, full disposal', () => {
  const scene = new Scene(), gates = createCourseGates(scene, COURSE, groundHeight, '#c8f060');
  assert.equal(scene.children.length, 1); assert.equal(gates.frames.length, 6);
  assert.equal(gates.group.visible, false);
  gates.update(true, 0);
  const geometries = new Set(), materials = new Set();
  gates.group.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } });
  assert.equal(geometries.size, 1); assert.ok(materials.size <= 3);
  const colour = i => gates.frames[i].parts[0].material, next = colour(0), ahead = colour(1);
  assert.notEqual(next, ahead); assert.equal(colour(5), ahead);
  gates.update(true, 2);
  assert.equal(gates.frames[0].frame.visible, false); assert.equal(gates.frames[1].frame.visible, false);
  assert.equal(colour(2), next); assert.equal(colour(3), ahead);
  assert.ok(gates.frames[2].parts.every(m => m.material === next), 'all four bars of the next gate');
  // Gate frames sit on their gate and face its heading: the opening's centre is the gate's centre.
  const g = G[3], centre = new Vector3(); gates.frames[3].frame.getWorldPosition(centre);
  assert.deepEqual(centre.toArray(), [g.x, g.y, g.z]);
  const right = new Vector3(1, 0, 0).applyQuaternion(gates.frames[3].frame.quaternion);
  assert.ok(Math.abs(right.x - Math.cos(g.heading)) < 1e-9 && Math.abs(right.z - Math.sin(g.heading)) < 1e-9);
  gates.update(false, 2); assert.equal(gates.group.visible, false);
  gates.dispose(); assert.equal(scene.children.length, 0);
});
