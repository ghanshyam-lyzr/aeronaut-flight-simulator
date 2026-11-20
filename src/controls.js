// The four flight axes the pilot's response settings tune, the one-sided wheel brake (0–1), then the pitch-trim
// adjustment (−1 nose down … 1 nose up), a rate command for the trim wheel, never for the aircraft's rotation.
const RESPONSIVE = ['pitch', 'roll', 'yaw', 'throttle'];
const AXES = [...RESPONSIVE, 'brake', 'trim'];
const neutral = () => Object.fromEntries(AXES.map(axis => [axis, 0]));
const clamp = (value, min = -1) => Math.max(min, Math.min(1, Number(value) || 0));
// Full stick travel takes 650 ms; the throttle buttons reach full slew in 350 ms.
// A 100 ms tap is a fine correction, while a held control retains full authority.
// Held brakes come on over 800 ms, so a tapped B only trims speed; release is immediate.
// The trim wheel turns at its own fixed rate the instant it is held and stops the instant it is released (no ramp).
export const TRAVEL = Object.freeze({ pitch: 0.65, roll: 0.65, yaw: 0.65, throttle: 0.35, brake: 0.8, trim: 0 });
// Pilot-chosen response divides the travel time, bounded so a tap stays a correction.
const RESPONSE_MIN = 0.5, RESPONSE_MAX = 2;
const responseOf = value => Number.isFinite(value) ? Math.max(RESPONSE_MIN, Math.min(RESPONSE_MAX, value)) : 1;

/** A held keyboard, touch or mouse axis takes priority over that axis on the controller, even at zero. */
export function mergeFlightControls(manual, gamepad, owned = {}) {
  return Object.fromEntries(AXES.map(axis => [axis, clamp(owned[axis] || !RESPONSIVE.includes(axis) ? manual[axis] : gamepad[axis], axis === 'brake' ? 0 : -1)]));
}

// Shared manual-intent thresholds: neutral controllers never disengage assist or change activity eligibility.
export const manualFlightIntent = (inputs, rotorcraft = false) => Math.abs(inputs.pitch) + Math.abs(inputs.roll) + Math.abs(inputs.yaw) > (rotorcraft ? 0.001 : 0.12)
  || (rotorcraft && Math.abs(inputs.throttle) > 0.001);

/** Timestamped continuous inputs, independent of keyboard repeat and render cadence. */
export class FlightInputs {
  constructor(now = 0, response) { this.setResponse(response); this.reset(now); }

  /** Per-axis response (0.5–2, 1 = default): how quickly held inputs reach full deflection. */
  setResponse(response = {}) {
    this.travel = Object.fromEntries(RESPONSIVE.map(axis => [axis, TRAVEL[axis] / responseOf(Number(response?.[axis] ?? 1))]));
    this.travel.brake = TRAVEL.brake;
    this.travel.trim = TRAVEL.trim;
  }

  reset(now) {
    this.time = now;
    this.target = neutral();
    this.value = neutral();
    this.events = [];
  }

  set(inputs, now) {
    const target = Object.fromEntries(AXES.map(axis => [axis, clamp(inputs[axis], axis === 'brake' ? 0 : -1)]));
    const previous = this.events.at(-1)?.target ?? this.target;
    if (AXES.some(axis => target[axis] !== previous[axis])) {
      this.events.push({ time: Math.max(this.time, now), target });
    }
  }

  /** Feed small physics slices, splitting at actual press/release times, even between frames. */
  advance(now, step) {
    if (!Number.isFinite(now) || now <= this.time) return;
    // Match the flight model's background-tab safety cap; never replay a long absence.
    this.time = Math.max(this.time, now - 0.25);
    while (this.time < now) {
      while (this.events.length && this.events[0].time <= this.time + 1e-9) {
        this.target = this.events.shift().target;
      }
      const end = Math.min(now, this.events[0]?.time ?? now, this.time + 1 / 120);
      const dt = end - this.time;
      const controls = {};
      for (const axis of AXES) {
        const target = this.target[axis];
        if (!this.travel[axis]) {
          // Slices split at press and release, so an unramped axis is exactly the held fraction of time.
          controls[axis] = this.value[axis] = target;
          continue;
        }
        let value = this.value[axis];
        // Releasing, easing back or reversing never leaves a continuing stick command.
        if (Math.sign(value) !== Math.sign(target)) value = 0;
        if (Math.abs(value) > Math.abs(target)) value = target;
        const direction = Math.sign(target);
        const travelTime = Math.min(dt, Math.abs(target - value) * this.travel[axis]);
        const next = value + direction * travelTime / this.travel[axis];
        // Exact mean of the ramp, including a partial slice at full deflection.
        controls[axis] = ((value + next) * 0.5 * travelTime + target * (dt - travelTime)) / dt;
        this.value[axis] = next;
      }
      step(dt, controls);
      this.time = end;
    }
  }
}
