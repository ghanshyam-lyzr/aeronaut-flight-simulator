const AXES = ['pitch', 'roll', 'yaw', 'throttle'];
const neutral = () => Object.fromEntries(AXES.map(axis => [axis, 0]));
const clamp = value => Math.max(-1, Math.min(1, Number(value) || 0));
// Full stick travel takes 650 ms; the throttle buttons reach full slew in 350 ms.
// A 100 ms tap is a fine correction, while a held control retains full authority.
const TRAVEL = { pitch: 0.65, roll: 0.65, yaw: 0.65, throttle: 0.35 };

/** Timestamped continuous inputs, independent of keyboard repeat and render cadence. */
export class FlightInputs {
  constructor(now = 0) { this.reset(now); }

  reset(now) {
    this.time = now;
    this.target = neutral();
    this.value = neutral();
    this.events = [];
  }

  set(inputs, now) {
    const target = Object.fromEntries(AXES.map(axis => [axis, clamp(inputs[axis])]));
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
        let value = this.value[axis];
        // Releasing, easing back or reversing never leaves a continuing stick command.
        if (Math.sign(value) !== Math.sign(target)) value = 0;
        if (Math.abs(value) > Math.abs(target)) value = target;
        const direction = Math.sign(target);
        const travelTime = Math.min(dt, Math.abs(target - value) * TRAVEL[axis]);
        const next = value + direction * travelTime / TRAVEL[axis];
        // Exact mean of the ramp, including a partial slice at full deflection.
        controls[axis] = ((value + next) * 0.5 * travelTime + target * (dt - travelTime)) / dt;
        this.value[axis] = next;
      }
      step(dt, controls);
      this.time = end;
    }
  }
}
