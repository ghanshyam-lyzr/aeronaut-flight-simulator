// One standard-mapped Gamepad API controller. No device-specific guesses or writes to flight state.
export const GAMEPAD_DEAD_ZONE = Object.freeze({ min: 0.05, max: 0.35, step: 0.01 });
export const DEFAULT_DEAD_ZONE = 0.15;
const neutral = () => ({ pitch: 0, roll: 0, yaw: 0, throttle: 0 });
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const deadZoneOf = value => finite(value) ? Math.max(GAMEPAD_DEAD_ZONE.min, Math.min(GAMEPAD_DEAD_ZONE.max, value)) : DEFAULT_DEAD_ZONE;

/** Per-axis dead zone with continuous, full-range travel outside it. Invalid samples are neutral. */
export function gamepadAxis(value, deadZone = DEFAULT_DEAD_ZONE) {
  if (!finite(value)) return 0;
  const magnitude = Math.min(1, Math.abs(value)), zone = deadZoneOf(deadZone);
  return magnitude <= zone ? 0 : Math.sign(value) * (magnitude - zone) / (1 - zone);
}

export function editingFlightField(target) {
  return !!target?.closest?.('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="spinbutton"]');
}

export class GamepadControls {
  constructor(read = () => globalThis.navigator?.getGamepads?.()) {
    this.read = read;
    this.device = null;
    this.release();
  }

  // Interruptions require a fresh neutral sample, including a released Pause button.
  release() { this.armed = false; this.pauseReady = false; this.pauseHeld = false; this.inputs = neutral(); }

  poll({ enabled = false, deadZone = DEFAULT_DEAD_ZONE, suspended = false, paused = false } = {}) {
    let pads;
    try { pads = this.read(); } catch { return this.unavailable('blocked'); }
    if (!pads) return this.unavailable('unavailable');
    const connected = Array.from(pads).filter(p => p?.connected);
    const standard = connected.filter(p => p.mapping === 'standard' && p.axes?.length >= 4 && p.buttons?.length > 9);
    // Keep the chosen controller while present; adding another never steals the controls.
    const pad = standard.find(p => p.index === this.device?.index && p.id === this.device?.id) ?? standard[0];
    if (!pad) return this.unavailable(connected.length ? 'unsupported' : 'disconnected');
    if (this.device?.index !== pad.index || this.device?.id !== pad.id) {
      this.release();
      this.device = { index: pad.index, id: pad.id };
    }
    this.inputs = neutral();
    if (!enabled || suspended) {
      this.release();
      return this.snapshot(!enabled ? 'disabled' : 'suspended');
    }
    const axes = Array.from({ length: 4 }, (_, i) => gamepadAxis(pad.axes[i], deadZone));
    const held = pad.buttons[9]?.pressed === true || pad.buttons[9]?.value > 0.5;
    const centered = axes.every(value => value === 0) && !held;
    const pause = this.pauseReady && held && !this.pauseHeld;
    this.pauseHeld = held;
    if (centered) this.pauseReady = true;
    if (paused || pause) this.armed = false;
    else if (!this.armed) this.armed = centered;
    else this.inputs = { pitch: axes[1], roll: axes[0], yaw: axes[2], throttle: -axes[3] || 0 };
    return this.snapshot(paused ? 'paused' : this.armed ? 'ready' : 'centering', pause);
  }

  unavailable(status) { this.device = null; this.release(); return this.snapshot(status); }
  snapshot(status, pause = false) { return { status, device: this.device, inputs: this.inputs, pause }; }
}
