// Real controller, current terrain and ordinary shaped controls; gameplay measurements, not aircraft data.
import { setup, flyHover } from '../tests/hover-pilot.js';
for (const mode of ['touch', 'keys']) for (const rate of [30, 60, 144]) {
  const x = setup(); x.activities.startHover(x.flight);
  const r = flyHover(x, { mode, rate });
  console.log(JSON.stringify({ mode, fps: rate, status: r.status, elapsed: r.elapsed, holdSeconds: r.holdTime,
    excursions: r.excursions, finalErrors: r.errors, minimumClearance: r.minClearance, assist: r.final.autopilot }));
}
