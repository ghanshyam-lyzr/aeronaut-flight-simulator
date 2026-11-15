// Run against this checkout, or pass another checkout to compare the same scenarios.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const load = file => import(pathToFileURL(resolve(root, 'src', file)));
const { FlightController } = await load('flight.js');
const { FlightInputs } = await load('controls.js');
const { FLEET } = await load('fleet.js');
const degrees = angle => angle * 180 / Math.PI;
function advance(flight, input, from, to) {
  for (let t = from; t < to - 1e-9;) {
    t = Math.min(to, t + 1 / 120);
    input.advance(t, (dt, controls) => flight.update(dt, controls));
  }
}
function tap(id, axis, duration = 0.1, response = 1) {
  const flight = new FlightController(() => 78, id), input = new FlightInputs(0, { [axis]: response });
  const field = { pitch: 'pitch', roll: 'bank', yaw: 'heading', throttle: 'throttle' }[axis];
  const initial = flight.state[field];
  input.set({ [axis]: 1 }, 0); input.set({}, duration);
  advance(flight, input, 0, duration);
  const released = flight[`${axis}Rate`];
  advance(flight, input, duration, duration + 0.2);
  const remainingRate = axis === 'throttle' ? null : Math.abs(flight[`${axis}Rate`] / released);
  advance(flight, input, duration + 0.2, 1.6);
  return { correction: axis === 'throttle' ? (flight.state[field] - initial) * 100 : degrees(flight.state[field] - initial), remainingRate, verticalSpeed: flight.state.verticalSpeed };
}
const tapExamples = Object.fromEntries(['trainer', 'widebody', 'racer', 'pushpull', 'fighter', 'interceptor', 'tandem'].map(id => [id,
  Object.fromEntries(['pitch', 'roll', 'yaw', 'throttle'].map(axis => [axis, tap(id, axis)]))]));
const tapEnvelope = {};
for (const axis of ['pitch', 'roll', 'yaw', 'throttle']) {
  let largest = { correction: 0 };
  for (const id of Object.keys(FLEET)) for (const response of [0.5, 1, 2]) for (const duration of [0.05, 0.1, 0.15]) {
    const result = tap(id, axis, duration, response);
    if (Math.abs(result.correction) > largest.correction) largest = { id, response, duration, ...result };
  }
  tapEnvelope[axis] = largest;
}
function reversal(id, axis, response) {
  const flight = new FlightController(() => 78, id), input = new FlightInputs(0, { [axis]: response });
  input.set({ [axis]: 1 }, 0); input.set({ [axis]: -1 }, 1.6);
  advance(flight, input, 0, 1.6);
  for (let t = 1.6; t < 3;) {
    const next = t + 1 / 120;
    input.advance(next, (dt, c) => flight.update(dt, c));
    t = next;
    if (flight[`${axis}Rate`] < 0) return t - 1.6;
  }
  throw new Error(`${id} ${axis} never reversed`);
}
const reversalExamples = {}, reversalEnvelope = { seconds: 0 };
for (const id of Object.keys(FLEET)) for (const axis of ['pitch', 'roll', 'yaw']) for (const response of [0.5, 1, 2]) {
  const seconds = reversal(id, axis, response);
  if (id in tapExamples && response === 1) (reversalExamples[id] ??= {})[axis] = seconds;
  if (seconds > reversalEnvelope.seconds) Object.assign(reversalEnvelope, { id, axis, response, seconds });
}
const assist = {};
for (const id of Object.keys(FLEET).filter(id => FLEET[id].flight.rotorcraft)) {
  assist[id] = {};
  for (const mode of ['translation', 'climb', 'descent']) {
    const flight = new FlightController(() => 78, id), s = flight.state, f = FLEET[id].flight;
    if (mode !== 'translation') s.throttle = s.spool = f.hoverCollective + (mode === 'climb' ? 0.14 : -0.1);
    for (let i = 0; i < 8 * 120; i++) flight.update(1 / 120, mode === 'translation' ? { pitch: -1, yaw: 0.08 } : {});
    const target = s.position.clone(), throttle = s.throttle;
    flight.toggleAutopilot(); flight.update(1 / 120);
    const throttleStep = s.throttle - throttle;
    let peakVertical = 0, finalWindowVertical = 0, peakDistance = 0;
    for (let i = 1; i < 65 * 120; i++) {
      flight.update(1 / 120);
      peakVertical = Math.max(peakVertical, Math.abs(s.position.y - target.y));
      peakDistance = Math.max(peakDistance, s.position.distanceTo(target));
      if (i > 55 * 120) finalWindowVertical = Math.max(finalWindowVertical, Math.abs(s.position.y - target.y));
    }
    assist[id][mode] = { throttleStep, peakVertical, peakDistance, finalWindowVertical, finalDistance: s.position.distanceTo(target), finalSpeed: s.speed };
  }
}
console.log(JSON.stringify({ tapExamples, tapEnvelope, reversalExamples, reversalEnvelope, assist }, (_key, value) => typeof value === 'number' ? +value.toFixed(6) : value, 2));
