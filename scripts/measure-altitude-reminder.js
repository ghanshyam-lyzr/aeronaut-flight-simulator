// Reproducible gameplay example, not certified aircraft performance. Flat synthetic ground, calm wind.
// After the normal airborne start, only ordinary FlightInputs fly the jet; the reminder only reads it.
import { pathToFileURL } from 'node:url';
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { AltitudeReminder, FEET_PER_METRE } from '../src/altitude-reminder.js';

export function measureAltitudeReminder() {
  const flight = new FlightController(() => 0, 'jet'), input = new FlightInputs(0), reminder = new AltitudeReminder();
  const target = Math.round(flight.state.position.y * FEET_PER_METRE) + 300;
  reminder.select(target, flight.state);
  const events = []; let previousPhase = reminder.phase, serial = 0;
  for (let i = 1; i <= 20 * 120; i++) {
    const now = i / 120, up = now <= .5 || (now > 2.5 && now <= 3.5);
    input.set({ pitch: up ? 1 : 0 }, (i - 1) / 120);
    input.advance(now, (dt, c) => {
      flight.update(dt, c); const v = reminder.update(flight.state);
      if (v.phase !== previousPhase || v.events !== serial) {
        events.push({ phase: v.phase, alert: v.alert, time: +v.time.toFixed(3), errorFt: +v.error.toFixed(2) });
        previousPhase = v.phase; serial = v.events;
      }
    });
    if (i === 2.5 * 120) reminder.acknowledge();
  }
  return { aircraft: 'Vela J8', targetFtMSL: target, events, final: reminder.snapshot(), assist: flight.state.autopilot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(measureAltitudeReminder(), null, 2));
