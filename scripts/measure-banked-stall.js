// Gameplay measurement: normal ramped FlightInputs, no pose/speed writes after the initial airborne start.
// Deliberately independent of the new threshold helper: record actual state.stalled and the known level stall.
import { pathToFileURL } from 'node:url';
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { FLEET } from '../src/fleet.js';

const DEG = Math.PI / 180;
export function bankedTurn(id, { rate = 60, flaps = 0, direction = 1 } = {}) {
  const flight = new FlightController(() => 40, id), s = flight.state, f = flight.type.flight;
  s.position.y = 6000;
  for (let i = 0; i < flaps; i++) flight.cycleFlaps();
  const levelStall = f.stallSpeed - s.flaps * f.flapStallGain, targetSpeed = levelStall * 1.12;
  s.speed = targetSpeed;
  s.throttle = s.spool = (targetSpeed - f.idleSpeed + s.flaps * f.flapDrag + (s.gearDown ? f.gearDrag : 0)) / f.thrustSpeed;
  const bankTarget = direction * Math.min(f.bankLimit * 0.95, 60 * DEG);
  const inputs = new FlightInputs(0);
  let firstStall = null, recovery = null, minSpeed = Infinity, worstSink = 0, maxBank = 0, stallTime = 0;
  // Begin in stable slow flight; hold wings level for 35 s, turn for 10 s, then roll level for 15 s.
  for (let frame = 1; frame <= 60 * rate; frame++) {
    const time = (frame - 1) / rate, turning = time >= 35 && time < 45;
    const bank = turning ? bankTarget : 0;
    const drag = s.flaps * f.flapDrag + (s.gearDown ? f.gearDrag : 0) + Math.abs(Math.sin(s.bank)) * f.bankDrag;
    const climb = Math.max(0, Math.sin(s.pitch)) * f.climbDrag - Math.max(0, -Math.sin(s.pitch)) * f.diveGain;
    const power = (targetSpeed - f.idleSpeed + drag + climb) / f.thrustSpeed + (targetSpeed - s.speed) * 0.04;
    inputs.set({ roll: (bank - s.bank) * 4 / f.rollRate, pitch: -s.pitch * 4 / f.pitchRate,
      throttle: (power - s.throttle) * 4 }, time);
    inputs.advance(frame / rate, (dt, controls) => {
      flight.update(dt, controls);
      const sample = { time: s.flightTime, speed: s.speed, bank: s.bank / DEG, pitch: s.pitch / DEG, sink: s.verticalSpeed };
      if (s.stalled) {
        stallTime += dt;
        if (!firstStall) firstStall = sample;
      } else if (firstStall && !recovery) recovery = sample;
      if (s.flightTime > 35) {
        minSpeed = Math.min(minSpeed, s.speed); worstSink = Math.min(worstSink, s.verticalSpeed); maxBank = Math.max(maxBank, Math.abs(s.bank) / DEG);
      }
    });
  }
  return { id, flaps: s.flaps, levelStall, targetSpeed, firstStall, recovery, minSpeed, worstSink, maxBank, stallTime,
    finalSpeed: s.speed, finalBank: s.bank / DEG, finalSink: s.verticalSpeed, finalStalled: s.stalled, finalPitch: s.pitch / DEG, crashed: s.crashed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ids = process.argv.slice(2);
  for (const id of ids.length ? ids : Object.keys(FLEET).filter(id => !FLEET[id].flight.rotorcraft && !FLEET[id].flight.aerobatic)) {
    for (const flaps of FLEET[id].noFlaps ? [0] : [0, 1, 2]) console.log(JSON.stringify(bankedTurn(id, { flaps })));
  }
}
