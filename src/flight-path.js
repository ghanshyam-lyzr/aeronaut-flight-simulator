// The flight-path marker: where the aircraft is actually travelling, drawn where that direction meets the screen.
// Everything here is read-only. Fixed-wing state.velocity is only seeded at resets and is not kept up to date in
// flight, so the fixed-wing velocity is rebuilt from the same terms FlightController.step moves the position with.
import * as THREE from 'three';

/** Shown from 2 m/s and kept down to 1 m/s, so a hover or a stop does not flicker it. Margin in CSS pixels. */
export const FLIGHT_PATH = Object.freeze({ showSpeed: 2, hideSpeed: 1, margin: 20 });

const _forward = new THREE.Vector3(), _inverse = new THREE.Quaternion(), _clip = new THREE.Vector4();

/**
 * World-space velocity in m/s, matching the last flight step's displacement over its time step, or null when the
 * aircraft is not moving under its own model (crashed) or the state is not finite.
 * - Helicopters integrate state.velocity directly, including sideways and backwards travel (zeroed on the ground).
 * - Fixed-wing ground rolls move along the heading at state.speed.
 * - Free-attitude (aerobatic) types move along the nose horizontally, with the lagging state.verticalSpeed vertically.
 * - Other fixed-wing types move along the heading at cos(pitch) · speed, with state.verticalSpeed vertically.
 */
export function flightPathVelocity(state, type, target = new THREE.Vector3()) {
  if (!state || state.crashed) return null;
  const f = type.flight;
  if (f.rotorcraft) {
    if (state.grounded) target.set(0, 0, 0);
    else target.copy(state.velocity);
  } else if (state.grounded) {
    target.set(Math.sin(state.heading) * state.speed, 0, -Math.cos(state.heading) * state.speed);
  } else if (f.aerobatic) {
    const forward = _forward.set(0, 0, -1).applyQuaternion(state.quaternion);
    target.set(forward.x * state.speed, state.verticalSpeed, forward.z * state.speed);
  } else {
    const horizontal = Math.cos(state.pitch) * state.speed;
    target.set(Math.sin(state.heading) * horizontal, state.verticalSpeed, -Math.cos(state.heading) * horizontal);
  }
  return Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z) ? target : null;
}

/**
 * Projects a world direction (a point at infinity, so no parallax from the chase or orbit offset) through a
 * camera's orientation and projection matrix. Returns CSS-pixel coordinates in a width × height viewport, or null
 * when the direction is behind the camera or would fall within `margin` of an edge: it is never clamped inward.
 */
export function projectDirection(direction, camera, width, height, margin = FLIGHT_PATH.margin) {
  const length = direction.length();
  if (!(length > 0) || !(width > 0) || !(height > 0)) return null;
  _inverse.copy(camera.quaternion).invert();
  _forward.copy(direction).divideScalar(length).applyQuaternion(_inverse);
  // In front of the camera means -z; anything at or beyond 90° from the view axis cannot be on screen.
  if (_forward.z > -1e-3) return null;
  _clip.set(_forward.x, _forward.y, _forward.z, 0).applyMatrix4(camera.projectionMatrix);
  if (!(_clip.w > 0)) return null;
  const x = (_clip.x / _clip.w + 1) / 2 * width, y = (1 - _clip.y / _clip.w) / 2 * height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < margin || x > width - margin || y < margin || y > height - margin) return null;
  return { x, y };
}

/**
 * Per-frame marker state. It remembers only whether it was showing (for the speed hysteresis), and forgets that
 * whenever the flight restarts (flight time runs backwards: resets, teleports, mission starts) or the aircraft
 * changes, so nothing carries over from the previous flight.
 */
export class FlightPathMarker {
  constructor() { this.velocity = new THREE.Vector3(); this.reset(); }

  reset() { this.visible = false; this.lastTime = -Infinity; this.aircraft = null; return this; }

  /** Returns { visible, x, y, reason }: reason names why it is hidden ('off', 'stopped', 'slow', 'behind or off screen'). */
  update(state, type, camera, width, height, enabled = true) {
    if (state.aircraft !== this.aircraft || !(state.flightTime >= this.lastTime)) this.visible = false;
    this.aircraft = state.aircraft;
    this.lastTime = state.flightTime;
    const hide = reason => { this.visible = false; return { visible: false, x: 0, y: 0, reason }; };
    if (!enabled) return hide('off');
    const v = flightPathVelocity(state, type, this.velocity);
    if (!v) return hide('stopped');
    const speed = v.length();
    if (speed < (this.visible ? FLIGHT_PATH.hideSpeed : FLIGHT_PATH.showSpeed)) return hide('slow');
    const point = projectDirection(v, camera, width, height);
    if (!point) return hide('behind or off screen');
    this.visible = true;
    return { visible: true, x: point.x, y: point.y, reason: '' };
  }
}
