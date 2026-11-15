// The horizontal wind: one deterministic field shared by the flight model, the windsocks and the weather panel.
// Pure and DOM-free. Metres, seconds and radians.
//
// Conventions
// - World axes: +x is east, +z is south, +y is up (as everywhere in Aeronaut). Headings are true, clockwise from
//   north (-z): a heading h points along (sin h, 0, -cos h).
// - A wind's `direction` is where it blows FROM, in radians true, as in an aviation report: a 270° wind blows from
//   the west toward the east, so its air velocity points +x. `speed` is the steady speed and `gust` the most the
//   gusts add on top of it, both in m/s. Wind is horizontal: it never pushes the aircraft up or down.
// - The air velocity of a sample is { x, z } in m/s: the velocity of the air over the ground. Ground velocity is
//   air-relative velocity plus this vector.
//
// Time
// - A sample is a pure function of a configuration and a simulation time: the same time always gives the same wind.
//   The flight controller owns one Wind and advances it only from its own physics steps, so the wind freezes with
//   pause and dialogs, and a reset (retry, new start) samples the same gusts again from time zero.

const TAU = Math.PI * 2;
export const KNOT = 1852 / 3600;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Bounds every configuration is clamped to: about 39 kt steady, 23 kt of gust, ±20° of gust veer. */
export const WIND_LIMITS = Object.freeze({ speed: 20, gust: 12, veer: 20 * Math.PI / 180, transition: 6 });

/** A still-air configuration: what every new flight and every older saved setting gets until the pilot picks wind. */
export const CALM = Object.freeze({ id: 'calm', direction: 0, speed: 0, gust: 0, veer: 0, seed: 0 });

/**
 * The weather dialog's choices. Calm is still air; Breeze is a steady wind; Gusts is a stronger wind whose speed
 * rises by up to `gust` and whose direction swings by up to `veer` either side, on a fixed, repeatable rhythm.
 */
export const WIND_PRESETS = Object.freeze({
  calm: CALM,
  breeze: Object.freeze({ id: 'breeze', label: 'Breeze', direction: 240 * Math.PI / 180, speed: 8 * KNOT, gust: 0, veer: 0, seed: 0 }),
  gusts: Object.freeze({ id: 'gusts', label: 'Gusts', direction: 260 * Math.PI / 180, speed: 14 * KNOT, gust: 10 * KNOT, veer: 12 * Math.PI / 180, seed: 1 }),
});
export const WINDS = Object.freeze(Object.keys(WIND_PRESETS));

/** Wraps an angle into [0, 2π). */
export const wrapAngle = a => ((finite(a) % TAU) + TAU) % TAU;

/**
 * Validates anything into a bounded configuration: a preset id ('breeze'), a preset or a custom
 * { direction, speed, gust, veer, seed }. Missing or invalid fields fall back to calm values.
 */
const normalized = new WeakSet([CALM, ...Object.values(WIND_PRESETS)]);
export function normalizeWind(config) {
  if (typeof config === 'string') return WIND_PRESETS[config] ?? CALM;
  if (!config || typeof config !== 'object') return CALM;
  if (normalized.has(config)) return config;
  const out = Object.freeze({
    id: typeof config.id === 'string' ? config.id : 'custom',
    direction: wrapAngle(config.direction),
    speed: clamp(finite(config.speed), 0, WIND_LIMITS.speed),
    gust: clamp(finite(config.gust), 0, WIND_LIMITS.gust),
    veer: clamp(finite(config.veer), 0, WIND_LIMITS.veer),
    seed: Math.trunc(clamp(finite(config.seed), 0, 1e6)),
  });
  normalized.add(out);
  return out;
}

/** The air velocity of a wind blowing FROM `direction` at `speed`: toward direction + 180°. */
export function windVector(direction, speed, target = { x: 0, z: 0 }) {
  // Still air is exactly zero (never -0), so calm samples compare equal to an untouched state.
  target.x = speed ? -Math.sin(direction) * speed : 0;
  target.z = speed ? Math.cos(direction) * speed : 0;
  return target;
}

// Three incommensurate periods (seconds) so the gusts never visibly repeat; weights sum to 1, so each signal stays in [-1, 1].
const GUST_WAVES = [[7.3, 0.5], [3.1, 0.3], [1.7, 0.2]];
const VEER_WAVES = [[11.9, 0.6], [4.3, 0.4]];
const wave = (waves, t, phase) => waves.reduce((sum, [period, weight], i) => sum + weight * Math.sin(TAU * t / period + phase * (i + 1.618)), 0);

/**
 * The wind at simulation time `t`: { x, z, speed, direction, gust } with x/z the air velocity (m/s), `speed` its
 * magnitude, `direction` where it comes from and `gust` the 0–1 gust factor. Pure: the same inputs give the same
 * sample. Speed stays within [speed, speed + gust] and direction within ±veer of the configured one.
 */
export function sampleWind(config, t = 0, target = {}) {
  const c = normalizeWind(config);
  const time = finite(t), phase = c.seed * 2.399963;
  const gust = c.gust > 0 ? (wave(GUST_WAVES, time, phase) + 1) / 2 : 0;
  const speed = c.speed + c.gust * gust;
  const direction = wrapAngle(c.direction + (c.veer > 0 ? c.veer * wave(VEER_WAVES, time, phase + 1) : 0));
  windVector(direction, speed, target);
  target.speed = speed; target.direction = direction; target.gust = gust;
  return target;
}

/** A smooth 0→1 ease with zero slope at both ends. */
const ease = k => k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);

/**
 * The flight's wind: a configuration, its own simulation clock, and a bounded transition between configurations.
 * - set(config) blends from the wind blowing now to the new one over WIND_LIMITS.transition seconds of simulation
 *   time (smoothstep), so a weather choice never jumps the aircraft's velocity or attitude; { immediate: true } skips
 *   the blend. Returns the previous configuration, so an activity can restore it.
 * - advance(dt) moves the clock (the flight controller calls it from each physics step only).
 * - reset() restarts the clock at zero and finishes any blend: the same gusts follow every retry.
 * - sample(t) is the wind at simulation time t (default: now); snapshot() is a frozen, read-only summary.
 */
export class Wind {
  constructor(config = CALM) { this.config = normalizeWind(config); this.reset(); }

  reset() { this.time = 0; this.from = null; return this; }

  set(config, { immediate = false } = {}) {
    const previous = this.config, next = normalizeWind(config);
    if (immediate) this.from = null;
    else {
      const now = this.sample();
      this.from = { x: now.x, z: now.z, start: this.time };
    }
    this.config = next;
    return previous;
  }

  advance(dt) {
    if (Number.isFinite(dt) && dt > 0) this.time += dt;
    if (this.from && this.time - this.from.start >= WIND_LIMITS.transition) this.from = null;
    return this;
  }

  /** The transition's progress at time t: 1 when no blend is underway. */
  blend(t = this.time) { return this.from ? ease((t - this.from.start) / WIND_LIMITS.transition) : 1; }

  sample(t = this.time, target = {}) {
    sampleWind(this.config, t, target);
    const k = this.blend(t);
    if (k < 1) {
      target.x = this.from.x + (target.x - this.from.x) * k;
      target.z = this.from.z + (target.z - this.from.z) * k;
      target.speed = Math.hypot(target.x, target.z);
      if (target.speed > 1e-9) target.direction = wrapAngle(Math.atan2(-target.x, target.z));
    }
    return target;
  }

  snapshot() {
    const s = this.sample();
    return Object.freeze({ config: this.config, time: this.time, transitioning: this.blend() < 1,
      x: s.x, z: s.z, speed: s.speed, direction: s.direction, gust: s.gust });
  }
}

/** Degrees and whole knots for a wind report: "Calm", "240° at 8 kt", "260° 14G24 kt". */
export function windText(config) {
  const c = normalizeWind(config), kt = Math.round(c.speed / KNOT), deg = String(Math.round(c.direction * 180 / Math.PI) % 360 || 360).padStart(3, '0');
  if (kt === 0 && c.gust === 0) return 'Calm';
  return c.gust > 0 ? `${deg}° ${kt}G${Math.round((c.speed + c.gust) / KNOT)} kt` : `${deg}° at ${kt} kt`;
}

/** The live sample in the same words: "Now 263° at 17 kt", or "Now calm". */
export function sampleText(sample) {
  const kt = Math.round(finite(sample?.speed) / KNOT);
  if (kt === 0) return 'Now calm';
  return `Now ${String(Math.round(wrapAngle(sample.direction) * 180 / Math.PI) % 360 || 360).padStart(3, '0')}° at ${kt} kt`;
}

/**
 * Headwind and crosswind components (m/s) of a wind sample for a heading (a runway's, say): headwind positive into
 * the nose, crosswind positive from the right. For the dependent runway and crosswind activities.
 */
export function windComponents(sample, heading) {
  const fx = Math.sin(heading), fz = -Math.cos(heading);
  // Air moving toward the nose (against the forward vector) is a headwind; air moving to the left is from the right.
  return { headwind: -(sample.x * fx + sample.z * fz), crosswind: -(sample.x * Math.cos(heading) + sample.z * Math.sin(heading)) };
}

/**
 * A windsock's world yaw (rotation about +y, three.js convention) for its tail, built along local +x, to stream
 * downwind; null in calm air, so the sock keeps its last heading.
 */
export function windsockYaw(sample) {
  if (!(Math.hypot(sample.x, sample.z) > 1e-6)) return null;
  // rotation.y = θ takes local +x to (cos θ, 0, -sin θ): solve for the air velocity's direction.
  return Math.atan2(-sample.z, sample.x);
}

/** Sock droop (rotation about its local z, negative tips the tail down): hanging in calm, straight out from 15 kt. */
export const WINDSOCK = Object.freeze({ hang: -1.2, full: -0.05, fullSpeed: 15 * KNOT });
export function windsockDroop(speed) {
  const k = clamp(finite(speed) / WINDSOCK.fullSpeed, 0, 1);
  return WINDSOCK.hang + (WINDSOCK.full - WINDSOCK.hang) * k;
}
