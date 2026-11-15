import { valleyCurve } from './terrain.js';

// One curated, beginner-friendly checkpoint course down Lake Azure, the central valley's
// lake, south to north past Alpine Field. Distances are metres; headings are radians
// clockwise from north, as for runways, so a gate's forward axis is (sin h, 0, -cos h).
// No DOM, wall clock, rendering or persistence: the course runs on flight time alone.

const bearing = (a, b) => Math.atan2(b.x - a.x, -(b.z - a.z));
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));

/** Builds gates along the lake: x follows the valley's centreline plus a gentle slalom offset. */
function buildCourse({ start, gates, ...spec }) {
  const points = gates.map(([z, offset, y]) => ({ x: Math.round(valleyCurve(z) + offset), y, z }));
  const from = { x: Math.round(valleyCurve(start.z)), y: start.y, z: start.z };
  // Each gate faces the bisector of the legs into and out of it, so a smooth line flies straight through.
  const faced = points.map((p, i) => {
    const into = bearing(i ? points[i - 1] : from, p);
    const out = i < points.length - 1 ? bearing(p, points[i + 1]) : into;
    return Object.freeze({ ...p, heading: into + angle(out - into) / 2, width: spec.width, height: spec.height, index: i });
  });
  const length = [from, ...faced].reduce((sum, p, i, all) => i ? sum + Math.hypot(p.x - all[i - 1].x, p.z - all[i - 1].z) : 0, 0);
  return Object.freeze({ ...spec, length, start: Object.freeze({ ...from, heading: bearing(from, faced[0]) }), gates: Object.freeze(faced) });
}

export const COURSE = buildCourse({
  id: 'lake-azure', name: 'Lake Azure gates', region: 'central-valley',
  summary: 'Six gates down Lake Azure, past Alpine Field. Gentle turns over open water, no climbs steeper than 2°.',
  width: 140, height: 80,
  start: { z: 6000, y: 190 },
  // [z, offset from the valley centreline, gate centre height above sea level]
  gates: [[4400, -120, 190], [2600, 140, 160], [800, -140, 210], [-1000, 120, 170], [-2800, -140, 200], [-4600, 100, 180]],
});

/** Aircraft the course is built for: fixed-wing only. Helicopters are refused by name, never switched. */
export const RECOMMENDED_AIRCRAFT = 'trainer';
export function courseAvailability(type) {
  if (type.flight.rotorcraft) return { available: false, reason: 'The gates are set for fixed-wing speeds and turns; helicopters keep the landing missions' };
  return { available: true, reason: '' };
}

/** A point in a gate's own frame: `along` its forward axis, `cross` to its right, `up` above its centre. */
export function gateCoordinates(position, gate) {
  const dx = position.x - gate.x, dz = position.z - gate.z, s = Math.sin(gate.heading), c = Math.cos(gate.heading);
  return { along: dx * s - dz * c, cross: dx * c + dz * s, up: position.y - gate.y };
}

/**
 * Where the swept segment from `a` to `b` crosses `gate`'s plane, or null when it does not.
 * `direction` is 'forward' (back to front) or 'backward'; `inside` is whether the crossing
 * point lies within the opening; `t` (0–1) is the fraction of the segment at the plane.
 * A segment that starts exactly on the plane does not cross it again, so a pass counts once.
 */
export function gateCrossing(gate, a, b) {
  const pa = gateCoordinates(a, gate), pb = gateCoordinates(b, gate);
  const forward = pa.along < 0 && pb.along >= 0, backward = pa.along > 0 && pb.along <= 0;
  if (!forward && !backward) return null;
  const t = pa.along / (pa.along - pb.along);
  const cross = pa.cross + (pb.cross - pa.cross) * t, up = pa.up + (pb.up - pa.up) * t;
  return { direction: forward ? 'forward' : 'backward', t, cross, up,
    inside: Math.abs(cross) <= gate.width / 2 && Math.abs(up) <= gate.height / 2 };
}

/** Faster than any aircraft in the fleet: a longer step between updates is a reset or teleport, never flight. */
export const MAX_TRAVEL_SPEED = 600;

/**
 * A timed, single-attempt checkpoint run. Gates count in order, only when the aircraft's
 * path from its previous to its current position crosses the next gate's plane forward
 * through its opening. The clock is flight time, so a paused simulator freezes it.
 */
export class CheckpointCourse {
  constructor(course = COURSE) { this.course = course; this.best = null; this.cancel(); }

  cancel() {
    this.status = 'idle'; this.next = 0; this.elapsed = 0; this.splits = []; this.reason = '';
    this.aircraft = null; this.lastTime = 0; this.previous = null; this.event = null; this.newBest = false;
  }

  get active() { return this.status === 'flying'; }
  get finished() { return this.status === 'complete' || this.status === 'failed'; }
  get gate() { return this.course.gates[this.next] ?? null; }

  /** Begin (or retry) a run in the flight's current aircraft: placed lined up with gate 1, assist left to the caller. */
  start(flight) {
    this.cancel();
    const type = flight.type;
    if (!courseAvailability(type).available) return null;
    const s = flight.reset(), f = type.flight, { start } = this.course;
    s.position.set(start.x, Math.max(start.y, flight.groundAt(start.x, start.z) + 120), start.z);
    Object.assign(s, { heading: start.heading, pitch: 0, bank: 0, verticalSpeed: 0, speed: f.cruiseSpeed,
      throttle: f.cruiseThrottle, spool: f.cruiseThrottle, gearDown: !!type.fixedGear, flaps: 0, autopilot: false });
    s.velocity.set(Math.sin(s.heading) * s.speed, 0, -Math.cos(s.heading) * s.speed);
    flight.setQuaternion();
    this.aircraft = type.id; this.lastTime = s.flightTime; this.previous = { x: s.position.x, y: s.position.y, z: s.position.z };
    this.status = 'flying';
    return s;
  }

  fail(reason) { this.status = 'failed'; this.reason = reason; }

  update(state) {
    if (!this.active) return;
    // Aircraft changes and external resets end the attempt; they never continue or score it.
    if (state.aircraft !== this.aircraft || state.flightTime < this.lastTime) { this.cancel(); return; }
    const dt = state.flightTime - this.lastTime, here = { x: state.position.x, y: state.position.y, z: state.position.z };
    if (![here.x, here.y, here.z].every(Number.isFinite)) return;
    const from = this.previous, moved = Math.hypot(here.x - from.x, here.y - from.y, here.z - from.z);
    this.previous = here; this.lastTime = state.flightTime;
    // A move faster than any aircraft flies is a reset or teleport: the clock runs on, no gate is judged.
    if (moved > MAX_TRAVEL_SPEED * dt + 1) this.event = { type: 'jump' };
    else if (dt > 0) {
      const gates = this.course.gates, crossing = gateCrossing(gates[this.next], from, here);
      if (crossing?.direction === 'forward' && crossing.inside) {
        const time = this.elapsed + crossing.t * dt;
        this.splits.push(time); this.next++; this.event = { type: 'gate', gate: this.next - 1, time };
        if (this.next === gates.length) {
          this.elapsed = time; this.status = 'complete';
          this.newBest = this.best === null || time < this.best; if (this.newBest) this.best = time;
          return;
        }
      } else if (crossing) {
        this.event = { type: crossing.direction === 'backward' ? 'backward' : 'missed', gate: this.next };
      } else {
        // Any other gate flown through out of order is named, never counted.
        const other = gates.findIndex((g, i) => i !== this.next && gateCrossing(g, from, here)?.inside);
        if (other >= 0) this.event = { type: 'order', gate: other };
      }
    }
    this.elapsed += dt;
    if (state.crashed) this.fail(state.crashReason || 'Aircraft crashed');
  }

  /** The next gate relative to the aircraft: distance, bearing off the nose (+ right) and height above (+) it. */
  guidance(state) {
    const g = this.gate;
    if (!g) return null;
    const dx = g.x - state.position.x, dz = g.z - state.position.z;
    return { gate: g.index, number: g.index + 1, total: this.course.gates.length, distance: Math.hypot(dx, dz),
      relative: angle(Math.atan2(dx, -dz) - state.heading), height: state.position.y - g.y,
      side: gateCoordinates(state.position, g).along > 0 ? 'behind' : 'ahead' };
  }

  snapshot() {
    return { status: this.status, next: this.next, total: this.course.gates.length, elapsed: this.elapsed,
      splits: [...this.splits], reason: this.reason, aircraft: this.aircraft, best: this.best, newBest: this.newBest,
      event: this.event && { ...this.event } };
  }
}

/** m:ss.s for course times. */
export const formatCourseTime = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
