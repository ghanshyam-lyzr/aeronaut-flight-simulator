// Original four-engine cargo turboprop. Every performance value is arcade tuning for Alpine Field, not operating data.
export const cargo = {
  id: 'cargo', name: 'Montis C90', type: 'Four-engine cargo turboprop', registration: 'A-MC90', badge: 'CARGO',
  engine: 'turboprop', engines: 4, landing: { speed: 50 },
  summary: 'Montis C90 · four-engine cargo turboprop', choice: 'Broad high wing, four turboprops, rear ramp. Heavy and steady at 200 kt.',
  help: 'A heavy transport: its four turboprops spool slowly and the airframe answers gently, so set power early and expect it to keep its speed. Use 15° flaps and rotate near 90 kt. Lower the retractable gear and full flaps for a 97 kt approach at about 35% power; touch down below 120 kt and 630 ft/min. Runway performance is compressed for this valley.',
  runwayHint: 'Runway 36 · F for 15° flaps, full power with Shift, hold S near 90 kt',
  speedScale: 300, groundClearance: 3.975, cameraScale: 2.95, cockpitOffset: [-0.62, 1.15, -12.35],
  flight: {
    cruiseSpeed: 102, cruiseThrottle: 0.72, throttleRate: 0.17, spoolUp: 0.3, spoolCruise: 0.55,
    idleSpeed: 30, thrustSpeed: 100, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 22, maxSpeed: 150, speedRate: 0.14, maxAcceleration: 2.2,
    flapDrag: 6, gearDrag: 5, bankDrag: 9, climbDrag: 64, diveGain: 34,
    stallSpeed: 46, flapStallGain: 5, pitchRate: 0.17, pitchResponse: 2.6,
    rollRate: 0.46, rollResponse: 2.9, yawRate: 0.12, pitchLimits: [-0.36, 0.3], bankLimit: 0.88,
    aerobatic: false, autopilotGain: 0.85, groundThrust: 96, groundRate: 0.1, rotateSpeed: 51,
    maxTouchdownSpeed: 62, maxTouchdownSink: 3.2,
  },
};
