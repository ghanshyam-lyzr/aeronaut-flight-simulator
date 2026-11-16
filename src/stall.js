/**
 * Load demanded by the arcade model's upright coordinated turns, not measured state.gForce.
 * Approximate the level-turn demand as 1 / cos(bank), capped at 2 g (60° bank): steeper banks
 * consume no more margin. Conventional types are attitude-limited and always upright in normal play.
 * Ground rolls, rotorcraft and every free-attitude type keep their original stall handling. Also
 * refuse an inverted/knife-edge pose supplied by a restore; this is not a general lift/AoA model.
 * Pitch inputs do not measure unloading here: roll level to lower demand; lowering the nose also
 * helps recovery through the controller's existing speed model. Telemetry stays independent.
 */
export function turnLoadDemand(type, { bank = 0, grounded = false } = {}) {
  if (grounded || type.flight.rotorcraft || type.flight.aerobatic || Math.abs(bank) >= Math.PI / 2) return 1;
  return 1 / Math.max(0.5, Math.cos(bank));
}

/** Effective fixed-wing stall speed in m/s; omitted flight state preserves the wings-level API. */
export function stallSpeed(type, flaps = 0, state = {}) {
  if (type.flight.rotorcraft) return null;
  const level = type.flight.stallSpeed - flaps * type.flight.flapStallGain;
  return level * Math.sqrt(turnLoadDemand(type, state));
}
