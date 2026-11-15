// The TERRAIN warning: a bounded look-ahead along the aircraft's actual travel. Read-only — it never touches the
// flight model, collisions or mission scoring. The path is the current velocity extrapolated in a straight line
// (flightPathVelocity, which rebuilds the fixed-wing velocity rather than trusting the stale state.velocity), and
// the ground is the same procedural height function rendering and collisions use. Metres and seconds.
import * as THREE from 'three';
import { flightPathVelocity } from './flight-path.js';
import { AIRPORTS } from './airports.js';
import { runwayCoordinates } from './airfield.js';

/**
 * - horizon / maxDistance: how far ahead the path is probed, in time and capped in distance.
 * - probes: samples along that path besides the current point, so at most probes + 1 height lookups per sample.
 * - interval: flight seconds between samples (paused flight is never resampled).
 * - margin: the clearance (above the wheels or skids) the path must keep over ground that rises toward it.
 * - closure: how much the clearance must shrink before a low point counts, so level low flight over flat ground
 *   (clearance unchanged) is harmless. A point where the path actually meets the ground skips both rules.
 * - warnTime: a conflict this close is a pull-up warning; further out it is a caution.
 * - sinkTime / minSink: descending straight into flat ground warns only when impact is this close.
 * - hysteresis: metres added to the open-ground margin while alerting; hold: flight seconds an alert outlives its cause.
 */
export const TERRAIN_ALERT = Object.freeze({
  fixedWing: Object.freeze({ horizon: 20, maxDistance: 4000, probes: 16, interval: 0.25, margin: 45, closure: 15,
    warnTime: 9, sinkTime: 6, minSink: 0, hysteresis: 15, hold: 1, approachMargin: 5 }),
  rotorcraft: Object.freeze({ horizon: 10, maxDistance: 600, probes: 16, interval: 0.25, margin: 10, closure: 4,
    warnTime: 4, sinkTime: 3, minSink: 2, hysteresis: 4, hold: 1, approachMargin: 2 }),
  /**
   * Runways: a track within runwayAlignment of either direction lands where it meets the ground on the runway (or
   * up to runwayUndershoot short). Descending with the gear down through the approachLength before it (a corridor
   * splaying by approachSplay each side), the glide path may sit under the margin: there only ground within
   * approachMargin of the path (a ridge or bank blocking it) counts. Takeoffs climb, so they get no corridor.
   */
  runwayAlignment: 20 * Math.PI / 180, runwayUndershoot: 100, runwayEdge: 15,
  approachLength: 3000, approachSplay: 0.1,
});

const LEVEL = Object.freeze({ clear: 0, caution: 1, warning: 2 });

/** Notice text for each level; helicopters are told to use the collective. */
export function terrainNotice(level, rotorcraft = false) {
  if (level === 'warning') return rotorcraft ? 'TERRAIN · Raise collective' : 'TERRAIN · Pull up';
  if (level === 'caution') return 'Terrain ahead · Climb or turn away';
  return '';
}

const angle = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * Where a point sits relative to a runway the aircraft is travelling along (either direction): { field, along,
 * onRunway } with `along` measured from the threshold it is heading for, or null when it is on no runway and in no
 * approach corridor. Checked for every field, mission or not, so free-flight landings are treated the same.
 */
export function runwayRelief(point, track, airports = AIRPORTS) {
  const a = TERRAIN_ALERT;
  for (const field of airports) {
    const forward = angle(track, field.heading) <= a.runwayAlignment, reverse = angle(track, field.heading + Math.PI) <= a.runwayAlignment;
    if (!forward && !reverse) continue;
    const at = runwayCoordinates(point, field), along = forward ? at.along : field.runwayLength - at.along;
    if (along > field.runwayLength || along < -a.approachLength) continue;
    const onRunway = along >= -a.runwayUndershoot;
    const halfWidth = field.runwayWidth / 2 + a.runwayEdge + (onRunway ? 0 : -along * a.approachSplay);
    if (Math.abs(at.cross) <= halfWidth) return { field, along, onRunway };
  }
  return null;
}

/** The runway a ground-contact point lies on, if the aircraft is travelling along it: meeting the ground there is a landing. */
export function landingRunway(point, track, airports = AIRPORTS) {
  const r = runwayRelief(point, track, airports);
  return r?.onRunway ? r.field : null;
}

const _v = new THREE.Vector3();

/**
 * One look-ahead sample. Returns { level, cause, time, clearance, probes } where cause is 'rising' (ground ahead
 * climbs into the path), 'descent' (the path sinks into flat ground) or '' and time is the seconds to the first
 * conflicting probe (or to the interpolated contact, where the path meets the ground); `extra` metres widen the
 * open-ground margin (the hysteresis while an alert shows). `probes` counts the height lookups, never more than the
 * profile's probes + 1.
 */
export function sampleTerrain(state, type, heightAt, { airports = AIRPORTS, extra = 0 } = {}) {
  const rotorcraft = !!type.flight.rotorcraft, c = rotorcraft ? TERRAIN_ALERT.rotorcraft : TERRAIN_ALERT.fixedWing;
  const result = { level: 'clear', cause: '', time: Infinity, clearance: Infinity, probes: 0 };
  if (!state || state.crashed || state.grounded) return result;
  const v = flightPathVelocity(state, type, _v);
  if (!v) return result;
  const gear = type.flight.groundClearance ?? type.groundClearance ?? 2.8, p = state.position;
  const ground = (x, z) => { result.probes++; const h = heightAt(x, z); return Number.isFinite(h) ? h : 0; };
  const h0 = ground(p.x, p.z), c0 = p.y - h0 - gear;
  result.clearance = c0;
  const speed = Math.hypot(v.x, v.z), horizon = Math.min(c.horizon, speed > 0 ? c.maxDistance / speed : c.horizon);
  const track = Math.atan2(v.x, -v.z), margin = c.margin + extra, approaching = speed > 1 && v.y < 0 && state.gearDown;
  const last = { t: 0, clearance: c0 };
  for (let i = 1; i <= c.probes; i++) {
    const t = horizon * i / c.probes, x = p.x + v.x * t, z = p.z + v.z * t, h = ground(x, z), clearance = p.y + v.y * t - h - gear;
    result.clearance = Math.min(result.clearance, clearance);
    // The path actually meets the ground at this probe: the margin and closure rules only keep near misses quiet
    // and never hide it. `contact` interpolates between probes to when the clearance reaches zero.
    const meets = clearance <= 0;
    const contact = !meets ? t : last.clearance > 0 ? last.t + (t - last.t) * last.clearance / (last.clearance - clearance) : last.t;
    last.t = t; last.clearance = clearance;
    const relief = approaching ? runwayRelief({ x, z }, track, airports) : null;
    // Meeting the ground on a runway while lined up with it is a landing: nothing beyond that point matters.
    if (relief?.onRunway) { if (clearance <= 0) return result; continue; }
    // Widening the corridor's small margin can latch a prior caution onto an otherwise clear glide path.
    if (!meets && (!(clearance < (relief ? c.approachMargin : margin)) || c0 - clearance < c.closure)) continue;
    // Rising: the ground climbs into the path, or above the wheels' current height so even level flight meets it.
    if (h - h0 >= c.closure / 2 || (meets && p.y - h - gear <= 0)) {
      result.cause = 'rising'; result.time = contact; result.level = contact <= c.warnTime ? 'warning' : 'caution';
      return result;
    }
    // Flat ground: only a descent close to impact counts, so ordinary low descents (and gentle helicopter
    // settling) stay quiet until late.
    const sink = -v.y, impact = meets ? contact : c0 / sink;
    if (sink > c.minSink && sink > 0 && impact <= c.sinkTime) {
      result.cause = 'descent'; result.time = Math.max(0, impact); result.level = 'warning';
      return result;
    }
    // Nothing beyond the point where the path meets the ground matters.
    if (meets) return result;
  }
  return result;
}

/**
 * Per-frame alert state with a bounded cadence and hysteresis. It samples at most once per `interval` of flight
 * time, escalates at once and steps down only after `hold` flight seconds without the cause, and forgets everything
 * when the flight restarts (flight time runs backwards) or the aircraft changes.
 */
export class TerrainAlert {
  constructor(heightAt, airports = AIRPORTS) { this.heightAt = heightAt; this.airports = airports; this.reset(); }

  reset() {
    this.level = 'clear'; this.cause = ''; this.time = Infinity; this.lastSample = -Infinity; this.lastRaised = -Infinity;
    this.aircraft = null; this.samples = 0; this.probes = 0;
    return this;
  }

  /** Returns { level, cause, time }; `suppress` (a finished mission, say) clears it outright. */
  update(state, type, suppress = false) {
    if (state.aircraft !== this.aircraft || !(state.flightTime >= this.lastSample)) this.reset();
    this.aircraft = state.aircraft;
    if (suppress || state.grounded || state.crashed) {
      this.level = 'clear'; this.cause = ''; this.time = Infinity; this.lastSample = state.flightTime;
      return this.view();
    }
    const c = type.flight.rotorcraft ? TERRAIN_ALERT.rotorcraft : TERRAIN_ALERT.fixedWing;
    if (state.flightTime - this.lastSample < c.interval) return this.view();
    this.lastSample = state.flightTime;
    const r = sampleTerrain(state, type, this.heightAt, { airports: this.airports, extra: this.level === 'clear' ? 0 : c.hysteresis });
    this.samples++; this.probes += r.probes;
    if (LEVEL[r.level] >= LEVEL[this.level]) {
      if (r.level !== 'clear') this.lastRaised = state.flightTime;
      this.level = r.level; this.cause = r.cause; this.time = r.time;
    } else if (state.flightTime - this.lastRaised >= c.hold) {
      if (r.level !== 'clear') this.lastRaised = state.flightTime;
      this.level = r.level; this.cause = r.cause; this.time = r.time;
    }
    return this.view();
  }

  view() { return { level: this.level, cause: this.cause, time: this.time }; }
}
