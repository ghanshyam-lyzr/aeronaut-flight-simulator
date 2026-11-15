/**
 * Touchdown feedback: a restrained procedural contact sound and a brief camera-local settling impulse when the wheels
 * or skids meet the ground. Presentation only. It reads the impact telemetry FlightController.recordTouchdown already
 * captures and never changes the flight state, collisions, touchdown thresholds or mission scoring.
 *
 * Bounds (all documented in docs/touchdown-feedback.md):
 * - severity is the pre-contact sink as a share of the type's own maxTouchdownSink, clamped to 0–1; at and above
 *   FIRM_FROM a touchdown is 'firm', below it 'gentle'. Crashes never produce feedback (their own effect handles them).
 * - the contact sound peaks between MIN_GAIN and MAX_GAIN on the master output, below the 0.22 stall horn, and lasts
 *   at most 0.6 s.
 * - the camera impulse is a pure translation along the camera's own up axis: at most 4.5 cm in the cockpit (the deck is
 *   camera-local, so it never nears the 1 m near plane) and 12 cm × the aircraft's camera scale outside, over
 *   0.22–0.42 s, ending exactly at rest. It never turns the camera, so aim and framing stay put.
 */

/** Severity (sink / maxTouchdownSink) at and above which a touchdown counts as firm. */
export const FIRM_FROM = 0.5;
/** Flight seconds the aircraft must have been airborne before a new contact counts (a hover skim never chatters). */
export const REARM_AIRBORNE = 0.35;
/** Touchdown telemetry older than this many flight seconds when it is first seen is stale and ignored. */
export const STALE_AFTER = 0.25;
export const MIN_GAIN = 0.035;
export const MAX_GAIN = 0.16;
/** Impulse amplitude, in metres, at full severity for the heaviest class. Outside views scale by cameraScale. */
export const IMPULSE_LIMITS = Object.freeze({ cockpit: 0.045, outside: 0.12, minDuration: 0.22, maxDuration: 0.42 });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Contact classes. thump is the falling body-tone sweep in Hz; weight scales gain and impulse; roll is the tyre onset
 * (wheels) or skid scrape (skids). Heavier airframes sit lower and ring longer.
 */
export const TOUCHDOWN_CLASSES = Object.freeze({
  light: Object.freeze({ contact: 'wheels', thump: [124, 64], weight: 0.78, decay: 0.2, roll: 'tyre' }),
  medium: Object.freeze({ contact: 'wheels', thump: [98, 52], weight: 0.88, decay: 0.26, roll: 'tyre' }),
  heavy: Object.freeze({ contact: 'wheels', thump: [74, 40], weight: 1, decay: 0.34, roll: 'tyre' }),
  skids: Object.freeze({ contact: 'skids', thump: [108, 56], weight: 0.74, decay: 0.18, roll: 'scrape' }),
  rotorWheels: Object.freeze({ contact: 'wheels', thump: [92, 48], weight: 0.84, decay: 0.24, roll: 'tyre' }),
});

/** A type's contact class: helicopter skids or wheels, otherwise fixed-wing wheels by airframe size (cameraScale). */
export function touchdownClass(type) {
  if (type.flight.rotorcraft) return type.landingGear === 'wheels' ? 'rotorWheels' : 'skids';
  const size = type.cameraScale ?? 1;
  return size >= 2.2 ? 'heavy' : size >= 1.3 ? 'medium' : 'light';
}

/**
 * The bounded response to one touchdown record. Deterministic: the same record and type always give the same numbers.
 * Returns the severity, its gentle/firm level, the sound parameters FlightAudio.playTouchdown plays and the camera
 * impulse. Speed is ground speed at contact in m/s.
 */
export function touchdownResponse(touchdown, type) {
  const id = touchdownClass(type), c = TOUCHDOWN_CLASSES[id];
  const maxSink = type.flight.maxTouchdownSink || 3;
  const sink = Math.max(0, Number(touchdown?.sink) || 0), speed = Math.max(0, Number(touchdown?.speed) || 0);
  const severity = clamp(sink / maxSink, 0, 1);
  const level = severity >= FIRM_FROM ? 'firm' : 'gentle';
  const gain = clamp(MAX_GAIN * c.weight * (0.22 + 0.78 * severity), MIN_GAIN, MAX_GAIN);
  // Tyres spin up with a short chirp that rises with ground speed; skids scrape briefly and low.
  const tyre = c.roll === 'tyre';
  const rollShare = tyre ? clamp(speed / 45, 0.25, 1) : 0.5;
  const sound = {
    gain,
    thumpFrom: c.thump[0], thumpTo: c.thump[1],
    decay: c.decay * (0.8 + 0.4 * severity),
    roll: c.roll,
    rollGain: gain * (tyre ? 0.42 : 0.36) * rollShare,
    rollFrequency: tyre ? clamp(760 + speed * 5, 760, 1150) : 420,
    rollDuration: tyre ? 0.22 + 0.2 * rollShare : 0.16,
  };
  const scale = clamp(type.cameraScale ?? 1, 0.5, 3);
  const size = (0.25 + 0.75 * severity) * c.weight;
  const impulse = {
    cockpit: IMPULSE_LIMITS.cockpit * size,
    outside: IMPULSE_LIMITS.outside * size * scale,
    duration: IMPULSE_LIMITS.minDuration + (IMPULSE_LIMITS.maxDuration - IMPULSE_LIMITS.minDuration) * clamp(severity * 0.6 + (c.weight - 0.74) * 1.5, 0, 1),
  };
  return { kind: id, contact: c.contact, severity, level, sink, speed, sound, impulse };
}

/**
 * Camera displacement along its own up axis, in units of the amplitude, `t` seconds into an impulse: a quick dip,
 * one small rebound and rest exactly at `duration`. Always within [-1, 1]; 0 outside the impulse.
 */
export function impulseShape(t, duration) {
  if (!(t > 0) || !(duration > 0) || t >= duration) return 0;
  const u = t / duration, envelope = (1 - u) ** 2;
  return -Math.sin(u * Math.PI * 2.5) * envelope;
}

/**
 * Which outputs a touchdown may use right now. Paused, a dialog over the flight or a hidden page discard the whole
 * event; muted or still-locked audio drops only the sound; reduced motion drops only the impulse. Nothing is queued.
 */
export function touchdownOutputs({ paused = false, dialogOpen = false, hidden = false, soundOn = false, audioRunning = false, reducedMotion = false } = {}) {
  const live = !paused && !dialogOpen && !hidden;
  return { sound: live && soundOn && audioRunning, motion: live && !reducedMotion };
}

/**
 * Detects each genuine new air-to-ground contact exactly once from flight state. A contact is a touchdown record the
 * detector has not seen, recorded within STALE_AFTER flight seconds, that left the aircraft grounded (not crashed)
 * after at least REARM_AIRBORNE seconds airborne. Sustained contact never records a new touchdown, so it never
 * retriggers. A reset, mission retry or aircraft change (flight time running backwards or a new type) resynchronises
 * without an event, as does a runway start, which begins grounded with no record.
 */
export class TouchdownDetector {
  constructor(state = null) { this.sync(state); }

  /** Adopt the current state as already seen: nothing in it can trigger later. */
  sync(state = null) {
    this.seen = state?.touchdown ?? null;
    this.aircraft = state?.aircraft ?? null;
    this.time = state?.flightTime ?? 0;
    this.airborne = 0;
  }

  /** Returns the touchdown record of a new contact, or null. Call once per frame after the flight update. */
  update(state) {
    if (!state) return null;
    if (state.aircraft !== this.aircraft || !(state.flightTime >= this.time)) { this.sync(state); return null; }
    const dt = state.flightTime - this.time;
    this.time = state.flightTime;
    const record = state.touchdown;
    let event = null;
    if (record && record !== this.seen) {
      this.seen = record;
      const age = state.flightTime - (Number(record.time) || 0);
      if (age >= 0 && age <= STALE_AFTER && state.grounded && !state.crashed && this.airborne + dt >= REARM_AIRBORNE) event = record;
    }
    this.airborne = state.grounded || state.crashed ? 0 : this.airborne + dt;
    return event;
  }
}
