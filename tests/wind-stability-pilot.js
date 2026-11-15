// The ordinary FlightInputs pipeline, shared by the load-factor regressions and their measurement script.
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { LandingMission } from '../src/landing-mission.js';

export function windFlight({ wind = 'gusts', landing = false, aircraft = 'trainer' } = {}) {
  const flight = new FlightController(() => 40, aircraft);
  flight.setWind(wind === 'transition' ? 'calm' : wind, { immediate: true });
  const mission = new LandingMission();
  if (landing) mission.start(flight);
  if (wind === 'transition') flight.setWind('gusts');
  return { flight, mission, input: new FlightInputs(0) };
}

export function inputFlight({ flight, input }, { rate = 60, seconds = 10, partials = false, visit = () => {} } = {}) {
  const start = input.time;
  let elapsed = 0, minStep = Infinity, tinySteps = 0, minG = Infinity, maxG = -Infinity;
  const impulse = {};
  const step = (dt, controls) => {
    flight.update(dt, controls);
    elapsed += dt;
    minStep = Math.min(minStep, dt);
    if (dt < 1e-8) tinySteps++;
    minG = Math.min(minG, flight.state.gForce); maxG = Math.max(maxG, flight.state.gForce);
    for (const [axis, value] of Object.entries(controls)) impulse[axis] = (impulse[axis] ?? 0) + value * dt;
    visit(dt, controls);
  };
  for (let frame = 1; frame <= seconds * rate; frame++) {
    const now = start + frame / rate;
    input.advance(now, step);
    // A legitimate positive interval after a frame, in addition to the machine-epsilon remainders emitted naturally.
    if (partials && frame < seconds * rate) input.advance(now + 1e-9, step);
  }
  const s = flight.state;
  return { minG, maxG, elapsed, minStep, tinySteps, impulse, position: s.position.clone(), speed: s.speed,
    distance: s.distance, flightTime: s.flightTime, windTime: flight.windSnapshot().time };
}
