// Heading-bug turns under flight assist, through the real input pipeline: time to capture, worst bank, worst
// altitude excursion and overshoot for each fixed-wing type. Run: node scripts/measure-heading-select.js
import { FlightController, hasHeadingSelect } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';

const DEG = Math.PI / 180;
const RATE = 60;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Engages assist at `from`°, then selects `to`° and flies hands-off for `seconds`. Capture is the first moment the nose
 * is within 2° of the target with the wings within 3° of level. Free-attitude types can start from a non-level
 * attitude (`bank`, `pitch` in degrees) to exercise the recovery.
 */
export function turnToHeading(id, { from = 0, to = 90, seconds = 120, bank = 0, pitch = 0, selectFirst = true } = {}) {
  const flight = new FlightController(() => 0, id), s = flight.state, input = new FlightInputs(0);
  s.position.y = 2400;
  Object.assign(s, { heading: from * DEG, bank: bank * DEG, pitch: pitch * DEG });
  flight.setQuaternion();
  const throttle = s.throttle, trim = s.pitchTrim;
  if (selectFirst) { flight.setHeadingTarget(to); flight.holdSelectedHeading(); }
  else { flight.toggleAutopilot(); flight.setHeadingTarget(to); }
  const altitude = flight.holdAltitude;
  let t = 0, capture = null, firstTurn = 0, worstBank = 0, worstAltitude = 0, overshoot = 0, worstBankRate = 0, lastBank = s.bank;
  const target = to * DEG, sign = Math.sign(wrap(target - from * DEG)) || 1;
  while (t < seconds) {
    t += 1 / RATE;
    input.advance(t, (dt, c) => flight.update(dt, c));
    const error = wrap(target - s.heading);
    if (!firstTurn && Math.abs(s.bank) > 0.5 * DEG) firstTurn = Math.sign(s.bank);
    worstBankRate = Math.max(worstBankRate, Math.abs(wrap(s.bank - lastBank)) * RATE); lastBank = s.bank;
    if (t > 8) worstBank = Math.max(worstBank, Math.abs(s.bank));
    worstAltitude = Math.max(worstAltitude, Math.abs(s.position.y - altitude));
    if (capture === null && Math.abs(error) < 2 * DEG && Math.abs(s.bank) < 3 * DEG) capture = t;
    if (capture !== null) overshoot = Math.max(overshoot, -error * sign);
  }
  return {
    id, capture, firstTurn, finalError: Math.abs(wrap(target - s.heading)) / DEG, worstBank: worstBank / DEG,
    worstBankRate: worstBankRate / DEG, altitudeExcursion: worstAltitude, finalAltitudeError: Math.abs(s.position.y - altitude),
    overshoot: Math.max(0, overshoot) / DEG, autopilot: s.autopilot, headingHold: s.headingHold,
    throttleChanged: s.throttle !== throttle, trimChanged: s.pitchTrim !== trim,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fmt = (v, d = 1) => v === null ? '—' : v.toFixed(d);
  console.log('type          350→010 s  000→180 s  090→270 s  worst bank°  bank rate°/s  alt ±m  overshoot°');
  for (const id of Object.keys(FLEET).filter(id => hasHeadingSelect(FLEET[id]))) {
    const wrapTurn = turnToHeading(id, { from: 350, to: 10, seconds: 90 });
    const half = turnToHeading(id, { from: 0, to: 180, seconds: 240 });
    const west = turnToHeading(id, { from: 90, to: 270, seconds: 240 });
    const worst = [wrapTurn, half, west];
    console.log(`${id.padEnd(13)} ${fmt(wrapTurn.capture).padStart(9)}  ${fmt(half.capture).padStart(9)}  ${fmt(west.capture).padStart(9)}`
      + `  ${fmt(Math.max(...worst.map(r => r.worstBank))).padStart(11)}  ${fmt(Math.max(...worst.map(r => r.worstBankRate))).padStart(12)}`
      + `  ${fmt(Math.max(...worst.map(r => r.altitudeExcursion))).padStart(6)}  ${fmt(Math.max(...worst.map(r => r.overshoot)), 2).padStart(10)}`);
  }
  for (const id of ['aerobatic', 'fighter', 'interceptor']) {
    const r = turnToHeading(id, { from: 0, to: 120, bank: 150, pitch: 30, seconds: 240 });
    console.log(`${id} from 150° bank / 30° pitch → 120°: capture ${fmt(r.capture)} s, final error ${fmt(r.finalError, 2)}°, hold ${r.headingHold}`);
  }
}
