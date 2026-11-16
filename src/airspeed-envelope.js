// The usable speed range on the fixed-wing airspeed instrument. The read-only display shares its low-speed
// threshold with the controller through stall.js. Speeds are knots unless a name says m/s.
import { stallSpeed } from './stall.js';
export { stallSpeed } from './stall.js';
export const KNOTS = 1.94384;

/**
 * Simulator-tuned upper limits, in knots, for each fixed-wing type. These are not certified speeds for any aircraft.
 * `caution` sits at or just above the type's full-power level speed (afterburner included), so ordinary cruise and
 * sustained full power stay clear of it; only a powered descent enters the band. `overspeed` sits about midway
 * between that speed and the fastest a full-power dive at the type's pitch limit can carry before the model's hard
 * `maxSpeed` clamp, so it is reachable but never in level flight. `speedScale` is only the instrument's display range.
 */
export const UPPER_LIMITS = Object.freeze({
  jet: { caution: 255, overspeed: 270 },
  fighter: { caution: 545, overspeed: 550 },     // burner level ~540 kt, dive ceiling ~554 kt
  airliner: { caution: 320, overspeed: 335 },
  trainer: { caution: 132, overspeed: 140 },
  bush: { caution: 115, overspeed: 125 },
  commuter: { caution: 225, overspeed: 235 },
  regional: { caution: 295, overspeed: 305 },
  widebody: { caution: 355, overspeed: 365 },
  aerobatic: { caution: 200, overspeed: 225 },
  canard: { caution: 210, overspeed: 220 },
  utility: { caution: 200, overspeed: 210 },
  cargo: { caution: 260, overspeed: 265 },
  motorglider: { caution: 85, overspeed: 105 },  // the long wing gains speed fast in any dive
  biplane: { caution: 115, overspeed: 120 },
  cityliner: { caution: 265, overspeed: 275 },
  racer: { caution: 305, overspeed: 320 },
  pushpull: { caution: 197, overspeed: 205 },
  interceptor: { caution: 525, overspeed: 545 }, // burner level ~517 kt, dive ceiling ~568 kt
});

/** The low-speed margin ends this far above the effective stall speed for the current flaps and bank. */
export const LOW_MARGIN = 1.2;
/** A state clears only once the speed is this many knots back inside it, so a threshold never flickers. */
export const HYSTERESIS = Object.freeze({ upper: 4, low: 3 });
export const OVERSPEED_NOTICE = 'OVERSPEED · Reduce power and ease the nose up';
export const AIRSPEED_LABELS = Object.freeze({ off: 'Airspeed', normal: 'Airspeed', low: 'Low speed', high: 'High speed', overspeed: 'Overspeed' });

/** Full-power level speed in m/s, clean (fixed gear always drags), with any afterburner lit. */
export function sustainedSpeed(type) {
  const f = type.flight;
  return f.idleSpeed + f.thrustSpeed + (f.afterburnerSpeed || 0) - (type.fixedGear ? f.gearDrag : 0);
}

/** The steady speed of a full-power dive at the type's pitch limit (vertical for free-attitude types), capped by maxSpeed. */
export function diveCeiling(type) {
  const f = type.flight, dive = f.pitchLimits ? -f.pitchLimits[0] : Math.PI / 2;
  return Math.min(f.maxSpeed, sustainedSpeed(type) + f.diveGain * Math.sin(dive));
}

/** A type's upper limits: its tuned entry, or for an untuned type the same placement derived from its numbers. */
export function upperLimits(type) {
  if (UPPER_LIMITS[type.id]) return UPPER_LIMITS[type.id];
  const level = sustainedSpeed(type) * KNOTS, gap = diveCeiling(type) * KNOTS - level;
  return { caution: Math.ceil(level + gap * 0.2), overspeed: Math.round(level + gap * 0.6) };
}

/** Everything the instrument marks, in knots, or null for rotorcraft (their airspeed keeps its original meaning). */
export function airspeedEnvelope(type, flaps = 0, state = {}) {
  if (type.flight.rotorcraft) return null;
  const stall = stallSpeed(type, flaps, state) * KNOTS, { caution, overspeed } = upperLimits(type);
  // The tape keeps the type's own scale when the red line already fits on it with room to spare.
  const scale = type.speedScale >= overspeed + 10 ? type.speedScale : Math.ceil(overspeed * 1.08 / 10) * 10;
  return { stall, low: stall * LOW_MARGIN, caution, overspeed, scale };
}

/** Tape positions, in percent of its width, for the stall, low-margin, caution and overspeed bands and the marker. */
export function tapeLayout(envelope, speed) {
  const at = kt => Math.min(100, Math.max(0, kt / envelope.scale * 100));
  return { stall: at(envelope.stall), low: at(envelope.low), caution: at(envelope.caution), overspeed: at(envelope.overspeed),
    marker: Math.min(96, at(speed)) };
}

/**
 * Latches the airspeed state with hysteresis. `update` returns 'off' (rotorcraft, grounded, crashed or not `active`:
 * paused, a dialog, a finished mission), 'low', 'normal', 'high' or 'overspeed'. An inactive frame, a new aircraft
 * or a restarted flight (its timer going back) clears the latch, so no state carries across a reset.
 */
export class AirspeedMonitor {
  constructor() { this.reset(); }

  reset() {
    this.state = 'off';
    this.aircraft = null;
    this.time = 0;
  }

  update(state, type, active = true) {
    if (state.aircraft !== this.aircraft || state.flightTime < this.time) this.state = 'off';
    this.aircraft = state.aircraft;
    this.time = state.flightTime;
    const envelope = airspeedEnvelope(type, state.flaps, state);
    if (!envelope || !active || state.grounded || state.crashed) return (this.state = 'off');
    const kt = state.speed * KNOTS, was = this.state;
    if (kt >= envelope.overspeed || (was === 'overspeed' && kt > envelope.overspeed - HYSTERESIS.upper)) this.state = 'overspeed';
    else if (kt >= envelope.caution || ((was === 'high' || was === 'overspeed') && kt > envelope.caution - HYSTERESIS.upper)) this.state = 'high';
    else if (kt < envelope.low || (was === 'low' && kt < envelope.low + HYSTERESIS.low)) this.state = 'low';
    else this.state = 'normal';
    return this.state;
  }
}
