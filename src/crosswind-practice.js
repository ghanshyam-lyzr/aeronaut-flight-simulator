// Crosswind practice: one repeatable beginner exercise, a landing mission at Alpine Field 36 in a fixed crosswind.
// It is the landing mission itself (src/landing-mission.js: the same start, touchdown, rollout rules and result),
// plus the wind it borrows for the attempt and a little feedback on the crab. No DOM, wall clock or persistence.
//
// Wind ownership: the first start takes the wind (flight.setWind returns the pilot's), retries keep it (and
// flight.reset() inside the mission's start replays the same gusts from time zero), and end() hands the pilot's
// selection back exactly once, whichever way the attempt ends: cancelled, free flight after a result, another
// activity, an aircraft change or an external reset.
import { KNOT, normalizeWind, sampleWind, windComponents, windText } from './wind.js';
import { missionAvailability, resolveAirport } from './airport-selection.js';
import { runwayCoordinates } from './airfield.js';
import { TOUCHDOWN_ATTITUDE } from './landing-mission.js';

const DEG = Math.PI / 180;
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The exercise: Alpine Field's long, wide runway 36 with an easterly wind from 080° at 9 kt gusting 12, so about
 * 9 kt crosses from the right with a breath of headwind. Tuned with ordinary inputs in the Mira T2 and Vela J8
 * (scripts/measure-crosswind.js); arcade numbers, not certified limits.
 */
export const PRACTICE = Object.freeze({
  id: 'crosswind-practice', name: 'Crosswind practice', airport: 'alpine-field', runway: '36', recommended: 'trainer',
  wind: normalizeWind({ id: 'crosswind-practice', direction: 80 * DEG, speed: 9 * KNOT, gust: 3 * KNOT, veer: 4 * DEG, seed: 3 }),
});

/** The practice runway, turned to land on runway 36. */
export const practiceField = () => resolveAirport(PRACTICE.airport, PRACTICE.runway).field;

/** Whether an aircraft type may fly the exercise: fixed-wing only, and only where the landing mission accepts it. */
export function practiceAvailability(type, field = practiceField()) {
  if (type.flight.rotorcraft) return { available: false, reason: 'Helicopters hover into the wind rather than crab, so this exercise is for fixed-wing aircraft' };
  const fit = missionAvailability(field, type.id);
  return fit.available ? { available: true, reason: '' } : { available: false, reason: `${fit.reason} for ${field.name} ${field.runway}` };
}

/**
 * The brief's numbers for an aircraft: the steady wind's head- and crosswind components on the runway (m/s,
 * crosswind + from the right), the approach speed and the crab that holds the centreline at it (radians, + right).
 */
export function practiceBrief(type, field = practiceField()) {
  const w = PRACTICE.wind, steady = sampleWind({ ...w, gust: 0, veer: 0 }, 0), c = windComponents(steady, field.heading);
  const speed = type.landing.speed;
  return { field, wind: w, report: windText(w), headwind: c.headwind, crosswind: c.crosswind, gustCrosswind: c.crosswind * (w.speed + w.gust) / w.speed,
    speed, crab: speed > 0 ? Math.asin(Math.min(0.5, Math.abs(c.crosswind) / speed)) * Math.sign(c.crosswind) : 0,
    side: c.crosswind >= 0 ? 'right' : 'left' };
}

// The stretch of final the crab is judged over: from 800 m out to 50 m before the threshold.
const CRAB_WINDOW = Object.freeze({ from: -800, to: -50 });

export class CrosswindPractice {
  constructor(landing, field = practiceField()) {
    this.landing = landing; this.field = field;
    this.running = false; this.owning = false; this.previous = null; this.flight = null;
    this.clear();
  }

  clear() { this.crabSum = 0; this.crabTime = 0; this.thresholdCross = null; this.lastTime = 0; }

  /** Begin or retry an attempt in the flight's current aircraft; null (and nothing changed) when it cannot fly it. */
  start(flight) {
    if (!practiceAvailability(flight.type, this.field).available) return null;
    // Only the first start borrows the wind; a retry already owns it, so the pilot's selection is never overwritten.
    if (!this.owning) { this.previous = flight.setWind(PRACTICE.wind, { immediate: true }); this.owning = true; this.flight = flight; }
    else flight.setWind(PRACTICE.wind, { immediate: true });
    const s = this.landing.start(flight, this.field);
    this.running = true; this.clear();
    return s;
  }

  /** While the attempt owns the wind, a new pilot choice (the Weather dialog) is what end() restores. */
  holdPilotChoice(config) { if (!this.owning) return false; this.previous = normalizeWind(config); return true; }

  /**
   * The wind a flight started after the attempt will meet: the pilot's selection while the attempt owns the wind,
   * otherwise `live`. Runway advice for the selected destination reads this, never the practice wind.
   */
  pilotWind(live) { return this.owning ? this.previous : live; }

  /** End the attempt (if any) and give the pilot's wind back, exactly once. Returns whether it restored the wind. */
  end() {
    const restored = this.owning;
    if (restored) this.flight.setWind(this.previous, { immediate: true });
    if (this.running && this.landing.status !== 'idle') this.landing.cancel();
    this.running = false; this.owning = false; this.previous = null; this.flight = null; this.clear();
    return restored;
  }

  /** One physics slice after the mission's own: crab on final and the offset at the threshold. */
  update(dt, state) {
    if (!this.running) return;
    // The mission cancels itself on an aircraft change or an external reset: the wind goes back with it.
    if (this.landing.status === 'idle') { this.end(); return; }
    if (!this.landing.active || !Number.isFinite(dt) || dt <= 0 || state.grounded) return;
    const at = runwayCoordinates(state.position, this.field);
    if (at.along >= CRAB_WINDOW.from && at.along <= CRAB_WINDOW.to) { this.crabSum += angle(state.heading - this.field.heading) * dt; this.crabTime += dt; }
    if (this.thresholdCross === null && at.along >= 0) this.thresholdCross = at.cross;
  }

  /** Live crosswind words for the card, or null outside the attempt. Drift is the ground track's sideways speed. */
  guidance(state, ground) {
    if (!this.running || !this.landing.profile) return null;
    const crab = angle(state.heading - this.field.heading), drift = ground ? Math.sin(angle(ground.track - this.field.heading)) * ground.speed : 0;
    const wind = windComponents({ x: state.windVelocity.x, z: state.windVelocity.z }, this.field.heading);
    return { crab, drift, crosswind: wind.crosswind, headwind: wind.headwind };
  }

  /**
   * What the attempt showed about the correction: mean crab on final (+ right), offset at the threshold (+ right),
   * and the recorded touchdown's crab, bank (+ right wing low) and pitch (+ nose up), or null without a touchdown.
   */
  feedback() {
    const t = this.landing.touchdown;
    return { crab: this.crabTime > 1 ? this.crabSum / this.crabTime : null, thresholdCross: this.thresholdCross,
      touchdownCrab: t ? angle(t.heading - this.field.heading) : null, touchdownBank: t ? t.bank : null, touchdownPitch: t ? t.pitch : null };
  }

  snapshot() {
    return { running: this.running, owning: this.owning, previous: this.previous, wind: PRACTICE.wind, field: this.field.id, runway: this.field.runway,
      landing: this.running ? this.landing.status : 'idle', ...this.feedback() };
  }
}

/** Height (m above the runway, about 10 ft) at which the brief, the live cue and the test pilot take the crab out. */
export const STRAIGHTEN_HEIGHT = 3;
/** Below this height (m) the flare matters more than drift: hold the crab, flare, and wait for STRAIGHTEN_HEIGHT. */
export const FLARE_HEIGHT = 8;

/**
 * The live crosswind cue for the landing card, or null when the landing mission's own cue should show (rollout, a
 * heading more than 12° off the runway). `crab` (heading off the runway) and `drift` (ground track's sideways speed)
 * are + right; `cross` is metres right of the centreline. `rudder: false` is a fixed-wing phone: the touch yoke has no
 * rudder, so the cue names a bank and a level-wing touchdown with the crab left in, which the mission's 12° rule allows.
 */
export function practiceCue({ height, alignment, crab, drift, cross, side = 'right', rudder = true }) {
  if (!(alignment <= 12 * DEG)) return null;
  const into = side === 'right' ? 1 : -1, away = side === 'right' ? 'left' : 'right';
  const yawInto = into > 0 ? 'E' : 'Q', yawBack = into > 0 ? 'Q' : 'E';
  const turnInto = rudder ? yawInto : `a gentle ${side} bank`, turnBack = rudder ? yawBack : `a gentle ${away} bank`;
  if (height < STRAIGHTEN_HEIGHT) {
    if (!rudder) return 'Wings level · let it settle, the crab can stay in';
    return Math.abs(crab) > 1 * DEG ? `Straighten now with ${crab > 0 ? 'Q' : 'E'} · hold the flare` : 'Nose lined up · hold the flare and let it settle';
  }
  if (height < FLARE_HEIGHT) return rudder ? `Keep the crab · flare gently with S · straighten at 10 ft with ${yawBack}` : 'Keep the crab · level the wings and flare gently';
  if (drift * into < -1.5) return `Drifting ${away} · turn into the wind with ${turnInto}`;
  if (drift * into > 1.5) return `Drifting ${side} · ease the crab back with ${turnBack}`;
  if (Math.abs(cross) > 8) return `${Math.round(Math.abs(cross))} m ${cross > 0 ? 'right' : 'left'} of centre · steer gently back`;
  return crab * into > 1.5 * DEG ? `Crabbed ${Math.round(Math.abs(crab) / DEG)}° ${side} · tracking the centreline` : `Crab ${side} into the wind with ${turnInto}`;
}

/**
 * One sentence on the correction for the result panel, in the arcade model's terms: crab into the wind to hold the
 * centreline, straighten with rudder just before the wheels touch (or, without rudder, land level with the crab in).
 * It names only what was measured: no centreline claim without a threshold crossing, and no alignment or wings-level
 * claim the recorded touchdown and the landing mission's TOUCHDOWN_ATTITUDE limits do not bear out.
 */
export function crosswindAdvice(feedback, mission, side = 'right', { rudder = true } = {}) {
  const deg = r => Math.round(Math.abs(r) / DEG), m = v => Math.round(Math.abs(v));
  const into = side === 'right' ? 1 : -1, crab = feedback.crab, cross = feedback.thresholdCross, td = feedback.touchdownCrab;
  const away = side === 'right' ? 'left' : 'right';
  if (crab === null || crab * into < 1 * DEG) {
    const drifted = cross !== null ? ` · the wind carried you ${m(cross)} m ${cross < 0 ? 'left' : 'right'} by the threshold` : '';
    return `No crab into the wind on final${drifted}. Turn a few degrees ${side} early and hold it.`;
  }
  if (cross === null) return `Crabbed ${deg(crab)}° ${side} on final; the attempt ended before the threshold.`;
  if (Math.abs(cross) > 12) return `Crabbed ${deg(crab)}° ${side}, but crossed the threshold ${m(cross)} m ${cross < 0 ? 'left' : 'right'} of centre: ${cross * into < 0 ? `turn further ${side}` : `ease the crab back toward ${away}`} sooner.`;
  if (td === null) return `Crabbed ${deg(crab)}° ${side} and crossed the threshold on the centreline.`;
  // The recorded touchdown against the mission's own limits; an unrecorded bank or pitch is never called level.
  const bank = feedback.touchdownBank, pitch = feedback.touchdownPitch, limit = TOUCHDOWN_ATTITUDE;
  const aligned = Math.abs(td) / DEG <= limit.alignment, level = Number.isFinite(bank) && Math.abs(bank) <= limit.bank;
  const faults = [];
  if (!aligned) faults.push(`the nose was ${deg(td)}° ${td > 0 ? 'right' : 'left'} of the runway at touchdown, past the ${limit.alignment}° the landing accepts`);
  if (Number.isFinite(bank) && !level) faults.push(`the wings were banked ${deg(bank)}° ${bank > 0 ? 'right' : 'left'}, past the ${deg(limit.bank)}° the landing accepts`);
  if (Number.isFinite(pitch) && Math.abs(pitch) > limit.pitch) faults.push(`the nose was ${deg(pitch)}° ${pitch > 0 ? 'high' : 'low'}, past the ${deg(limit.pitch)}° the landing accepts`);
  if (faults.length) {
    // Each fix uses only the controls the pilot has: on a phone, gentle banks set the crab and the yoke levels the wings.
    const fixes = [];
    if (!aligned) fixes.push(rudder ? 'straighten with rudder at about 10 ft' : `hold a modest crab, about ${deg(crab)}°, with gentle banks`);
    if (Number.isFinite(bank) && !level) fixes.push('level the wings before the wheels touch');
    if (Number.isFinite(pitch) && Math.abs(pitch) > limit.pitch) fixes.push('flare gently');
    return `Crabbed ${deg(crab)}° ${side} and held the centreline, but ${faults.join(' and ')}: ${fixes.join(' and ')}.`;
  }
  if (Math.abs(td) > 4 * DEG) return rudder
    ? `Crabbed ${deg(crab)}° ${side} and held the centreline; you touched down still ${deg(td)}° ${td > 0 ? 'right' : 'left'}: straighten with rudder at about 10 ft.`
    : `Crabbed ${deg(crab)}° ${side} and held the centreline, then touched down ${level ? 'wings level ' : ''}with ${deg(td)}° of crab, within the ${limit.alignment}° the landing accepts.`;
  if (mission.status === 'success') return `Crabbed ${deg(crab)}° ${side} to hold the centreline and straightened to ${deg(td)}° for touchdown.`;
  return `Crabbed ${deg(crab)}° ${side}, held the centreline and straightened to ${deg(td)}°.`;
}
