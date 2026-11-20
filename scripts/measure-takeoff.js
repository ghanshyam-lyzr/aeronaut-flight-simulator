// node scripts/measure-takeoff.js; add --import ./tests/init-wasm.js for the native path.
import { setup, flyTakeoff } from '../tests/takeoff-pilot.js';
for (const rate of [30, 60, 144]) for (const mode of ['keyboard', 'yoke']) {
  const x = setup(); x.activities.startTakeoff(x.flight);
  const { trace, ...result } = flyTakeoff(x, { rate, mode });
  console.log(JSON.stringify({ backend: x.flight.backend, rate, mode, ...result }));
}
