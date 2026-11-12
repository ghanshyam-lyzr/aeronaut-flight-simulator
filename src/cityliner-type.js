// Valnera Q100: an original four-engine short-field cityliner. Performance is arcade tuning for Alpine Field.
export const cityliner = {
  id: 'cityliner', name: 'Valnera Q100', type: 'Short-field cityliner', registration: 'A-VQ10', badge: 'Q100',
  engine: 'cityliner', landing: { speed: 51 },
  summary: 'Valnera Q100 · four-engine cityliner', choice: 'High swept wing, four small turbofans, T-tail. Short-field jet at 205 kt.',
  help: 'A quiet four-engine jet built for short runways. Its four turbofans share one slow spool, so set power early and expect several seconds before thrust builds. Use 15° flaps and rotate near 89 kt. Lower the retractable gear and use full flaps for a 99 kt approach at about 35% power; touch down below 124 kt and 610 ft/min.',
  runwayHint: 'Runway 36 · F for 15° flaps, full power with Shift, hold S near 89 kt',
  speedScale: 300, groundClearance: 3.375, cameraScale: 1.95, cockpitOffset: [-0.5, 0.75, -11.7],
  flight: {
    cruiseSpeed: 105.44, cruiseThrottle: 0.72, throttleRate: 0.18, spoolUp: 0.36, spoolCruise: 0.66,
    idleSpeed: 32, thrustSpeed: 102, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 22, maxSpeed: 165, speedRate: 0.15, maxAcceleration: 5,
    flapDrag: 7, gearDrag: 5, bankDrag: 8, climbDrag: 60, diveGain: 36,
    stallSpeed: 46, flapStallGain: 6, pitchRate: 0.21, pitchResponse: 3.1,
    rollRate: 0.6, rollResponse: 3.5, yawRate: 0.14, pitchLimits: [-0.4, 0.34], bankLimit: 0.92,
    aerobatic: false, autopilotGain: 0.88, groundThrust: 112, groundRate: 0.17, rotateSpeed: 52,
    maxTouchdownSpeed: 64, maxTouchdownSink: 3.1,
  },
};
