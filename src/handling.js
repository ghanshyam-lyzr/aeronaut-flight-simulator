/**
 * First-order body response, with stronger damping while unloading or opposing a rate.
 * Authority and acceleration keep the type's tuning; the old turn is arrested four times
 * faster. Integrate the exponential exactly so release distance does not depend on dt.
 */
export function angularResponse(current, target, response, dt) {
  const braking = current * target < 0 || Math.abs(target) < Math.abs(current);
  const rate = response * (braking ? 4 : 1);
  if (current * target < 0) {
    const stopTime = Math.log1p(Math.abs(current / target)) / rate;
    if (stopTime < dt) {
      // Brake only until the old rotation stops, then accelerate in the new direction.
      // Splitting here avoids a whole fast-response slice leaking into the reversal.
      const next = angularResponse(0, target, response, dt - stopTime);
      return { rate: next.rate, angle: current / rate + target * stopTime + next.angle };
    }
  }
  const change = -Math.expm1(-rate * dt);
  return {
    rate: current + (target - current) * change,
    angle: target * dt + (current - target) * change / rate,
  };
}
