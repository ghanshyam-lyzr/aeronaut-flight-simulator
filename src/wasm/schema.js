// Shared ABI: the build emits C++ double-only structs in exactly this order.
// Paths are relative to FlightController; no heap objects cross the WASM boundary.
export const STATE = [
  'state.position.x', 'state.position.y', 'state.position.z',
  'state.quaternion.x', 'state.quaternion.y', 'state.quaternion.z', 'state.quaternion.w',
  'state.velocity.x', 'state.velocity.y', 'state.velocity.z',
  'state.windVelocity.x', 'state.windVelocity.z', 'windEndpoint.x', 'windEndpoint.z',
  ...['speed', 'airspeed', 'throttle', 'spool', 'afterburner', 'brake', 'pitchTrim', 'heading', 'pitch', 'bank',
    'verticalSpeed', 'gForce', 'gearDown', 'rotorSpeed', 'flaps', 'crashed', 'stalled', 'grounded',
    'flightTime', 'distance', 'autopilot', 'selectedHeading', 'headingHold'].map(k => `state.${k}`),
  'state.bodyRates.pitch', 'state.bodyRates.roll', 'state.bodyRates.yaw',
  'pitchRate', 'rollRate', 'yawRate', 'holdPosition.x', 'holdPosition.y', 'holdPosition.z',
  'holdAltitude', 'holdHeading', 'recovering', 'loadElapsed', 'loadPreviousElapsed',
  'loadVelocity.x', 'loadVelocity.y', 'loadVelocity.z',
  'loadPreviousVelocity.x', 'loadPreviousVelocity.y', 'loadPreviousVelocity.z',
  // A seen attitude is private to the integrator, so a directly edited attitude re-seeds its quaternion.
  'seen.0', 'seen.1', 'seen.2',
];
export const PARAMS = [
  'rotorcraft', 'aerobatic', 'throttleRate', 'spoolUp', 'spoolCruise', 'afterburnerFrom', 'afterburnerSpeed',
  'pitchRate', 'pitchResponse', 'rollRate', 'rollResponse', 'yawRate', 'yawResponse', 'pitchMin', 'pitchMax',
  'bankLimit', 'glidePitch', 'autopilotGain', 'flapDrag', 'gearDrag', 'bankDrag', 'climbDrag', 'diveGain',
  'idleSpeed', 'thrustSpeed', 'minSpeed', 'maxSpeed', 'speedRate', 'maxAcceleration', 'stallSpeed',
  'flapStallGain', 'idleSink', 'groundThrust', 'groundRate', 'rotateSpeed', 'maxTouchdownSink',
  'maxTouchdownSpeed', 'groundClearance', 'brakeDeceleration', 'levelRate', 'hoverCollective',
  'collectiveResponse', 'rotorSpinUp', 'rotorSpinDown', 'footprintX', 'footprintZ',
];
export const CONTROLS = ['pitch', 'roll', 'yaw', 'throttle', 'brake', 'trim'];
export const WIND = ['time', 'direction', 'speed', 'gust', 'veer', 'seed', 'blending', 'fromX', 'fromZ', 'start'];
export const IMPACT = ['contact', 'reason', 'x', 'y', 'z', 'speed', 'sink', 'heading', 'bank', 'pitch', 'gearDown', 'flaps', 'stalled', 'time'];
export const fieldName = path => path.replace(/^state\./, '').replaceAll('.', '_');
