import { AIRFIELD, runwayCoordinates, runwayPoint } from './airfield.js';

const degrees = radians => Math.abs(Math.atan2(Math.sin(radians), Math.cos(radians))) * 180 / Math.PI;
export const TOUCHDOWN_ZONE = Object.freeze({ start: 60, end: 440, aim: 220 });

export function landingProfile(type) {
  const f = type.flight, helicopter = !!f.rotorcraft, speed = type.landing.speed;
  const slope = 0.05, flaps = helicopter || type.noFlaps ? 0 : 2;
  const throttle = helicopter ? f.hoverCollective
    : (speed - f.idleSpeed + flaps * f.flapDrag + f.gearDrag - slope * f.diveGain) / f.thrustSpeed;
  return { helicopter, flaps, speed: helicopter ? 0 : speed, throttle, slope,
    maxSink: f.maxTouchdownSink, maxSpeed: f.maxTouchdownSpeed,
    speedMin: helicopter ? 0 : speed - 5, speedMax: helicopter ? 5 : speed + 5,
    // Rotorcraft settle just below their own hover collective; fixed-wing aircraft idle below 20% power.
    settlePower: helicopter ? Math.round((f.hoverCollective - 0.01) * 100) / 100 : 0.2,
    contact: helicopter ? (type.landingGear ?? 'skids') : 'gear',
    clearance: f.groundClearance ?? type.groundClearance ?? 2.8 };
}

/** A flight-time driven, single-attempt mission. No DOM, wall clock, input assist or persistence. */
export class LandingMission {
  constructor(field = AIRFIELD) { this.field = field; this.cancel(); }

  cancel() {
    this.status = 'idle'; this.phase = 'approach'; this.touchdown = null;
    this.reason = ''; this.stableTime = 0; this.lastTime = 0; this.profile = null; this.aircraft = null;
  }

  get active() { return this.status === 'flying'; }
  get finished() { return this.status === 'success' || this.status === 'failed'; }

  /** Begin (or retry) an attempt; a field argument moves the mission there first. */
  start(flight, field = this.field) {
    this.cancel();
    this.field = field;
    const s = flight.reset(), p = this.profile = landingProfile(flight.type);
    this.aircraft = flight.type.id;
    const along = p.helicopter ? TOUCHDOWN_ZONE.aim : -1100;
    const point = runwayPoint(along, 0, field);
    const height = p.helicopter ? 14 : (TOUCHDOWN_ZONE.aim - along) * p.slope;
    s.position.set(point.x, Math.max(field.elevation + p.clearance + height, flight.groundAt(point.x, point.z) + p.clearance + 5), point.z);
    Object.assign(s, { speed: p.speed, throttle: p.throttle, spool: p.throttle,
      heading: field.heading, pitch: p.helicopter ? 0 : -Math.atan(p.slope), bank: 0,
      gearDown: true, flaps: p.flaps, autopilot: false, rotorSpeed: p.helicopter ? 1 : 0,
      verticalSpeed: p.helicopter ? 0 : -p.speed * p.slope });
    s.velocity.set(Math.sin(s.heading) * s.speed, s.verticalSpeed, -Math.cos(s.heading) * s.speed);
    flight.setQuaternion();
    this.status = 'flying';
    return s;
  }

  fail(reason) { this.status = 'failed'; this.reason = reason; }

  update(dt, state) {
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
    // Aircraft changes / external resets cannot continue an earlier attempt.
    if (state.aircraft !== this.aircraft || state.flightTime < (this.lastTime ?? 0)) { this.cancel(); return; }
    this.lastTime = state.flightTime;
    const field = this.field, p = this.profile, position = runwayCoordinates(state.position, field);
    const onRunway = v => v.along >= 0 && v.along <= field.runwayLength && Math.abs(v.cross) <= field.runwayWidth / 2 - 3;
    if (!this.touchdown && state.touchdown) {
      this.touchdown = { ...state.touchdown, ...runwayCoordinates(state.touchdown.position, field), alignment: degrees(state.touchdown.heading - field.heading) };
      const t = this.touchdown;
      if (!onRunway(t)) return this.fail('Touchdown outside the runway');
      if (t.along < TOUCHDOWN_ZONE.start || t.along > TOUCHDOWN_ZONE.end) return this.fail('Missed the touchdown zone');
      if (p.helicopter && (Math.abs(t.along - TOUCHDOWN_ZONE.aim) > 18 || Math.abs(t.cross) > 10)) return this.fail(`Land the ${p.contact} inside the target box`);
      if (!t.gearDown) return this.fail('Landing gear was retracted');
      if (t.sink >= p.maxSink || t.speed >= p.maxSpeed || t.stalled) return this.fail('Unsafe touchdown speed or sink rate');
      if (t.alignment > 12 || Math.abs(t.bank) > 0.18 || Math.abs(t.pitch) > 0.22) return this.fail(`Touch down level and aligned with runway ${field.runway}`);
      if (!p.helicopter && t.flaps !== p.flaps) return this.fail(p.flaps ? 'Use full flaps for landing' : 'This aircraft has no flaps');
      this.phase = 'rollout';
    }
    if (state.crashed) return this.fail(state.crashReason || 'Aircraft crashed');
    if (state.grounded && !this.touchdown) return this.fail('Restart the approach to begin a new attempt');
    if (this.phase === 'rollout') {
      if (!onRunway(position)) return this.fail(position.along > field.runwayLength ? 'Runway overrun' : 'Left the runway during rollout');
      if (!state.grounded) return this.fail('Keep the aircraft on the runway after touchdown');
      if (!state.gearDown) return this.fail('Keep the landing gear down during rollout');
      const controlled = state.speed < 3 && degrees(state.heading - field.heading) <= 12
        && state.throttle < p.settlePower;
      this.stableTime = controlled ? this.stableTime + dt : 0;
      if (this.stableTime >= 2) this.status = 'success';
    } else if (position.along > field.runwayLength) this.fail('Runway passed · retry the approach');
  }

  guidance(state) {
    const p = this.profile;
    if (!p) return null;
    const at = runwayCoordinates(state.position, this.field);
    const height = state.position.y - this.field.elevation - p.clearance;
    return { ...at, height, distance: Math.max(0, -at.along), alignment: degrees(state.heading - this.field.heading),
      pathError: height - Math.max(0, TOUCHDOWN_ZONE.aim - at.along) * p.slope,
      remaining: Math.max(0, this.field.runwayLength - at.along) };
  }

  /** On this mission's final or runway with the gear down: terrain warnings stay quiet here. */
  onFinal(state) {
    if (!this.active || !state.gearDown) return false;
    const at = runwayCoordinates(state.position, this.field);
    return Math.abs(at.cross) < this.field.runwayWidth && at.along >= -1500 && at.along <= this.field.runwayLength;
  }

  snapshot() { return { status: this.status, phase: this.phase, reason: this.reason, field: this.field.id ?? null, runway: this.field.runway,
    touchdown: this.touchdown ? { ...this.touchdown, position: { ...this.touchdown.position } } : null,
    stableTime: this.stableTime, aircraft: this.aircraft }; }
}
