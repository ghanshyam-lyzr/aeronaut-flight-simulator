// Veyra U9: an original single-engine utility turboprop. Performance is arcade tuning for Alpine Field.
export const utility = {
  id: 'utility', name: 'Veyra U9', type: 'Utility turboprop', registration: 'A-VU09', badge: 'UTIL',
  engine: 'turboprop', fixedGear: true, landing: { speed: 37 },
  summary: 'Veyra U9 · utility turboprop', choice: 'Boxy high-wing cabin, five-blade turboprop, fixed gear. Steady at 150 kt.',
  help: 'A stable utility hauler. The single turbine spools gradually, so set power early. Fixed tricycle gear is always down. Use 15° flaps and rotate near 56 kt for a short takeoff; approach at 72 kt with full flaps and about 33% power. Touch down below 90 kt and 650 ft/min.',
  runwayHint: 'Runway 36 · F for 15° flaps, full power with Shift, hold S near 56 kt · gear fixed',
  speedScale: 220, groundClearance: 2.725, cameraScale: 1.02, cockpitOffset: [-0.38, 0.62, -2.75],
  flight: {
    cruiseSpeed: 77.54, cruiseThrottle: 0.72, throttleRate: 0.26, spoolUp: 0.7, spoolCruise: 1.2,
    idleSpeed: 22, thrustSpeed: 82, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 14, maxSpeed: 118, speedRate: 0.24, maxAcceleration: 4.6,
    flapDrag: 5, gearDrag: 3.5, bankDrag: 5, climbDrag: 34, diveGain: 25,
    stallSpeed: 30, flapStallGain: 4, pitchRate: 0.22, pitchResponse: 3.4,
    rollRate: 0.58, rollResponse: 3.9, yawRate: 0.18, pitchLimits: [-0.5, 0.44], bankLimit: 1,
    aerobatic: false, autopilotGain: 1, groundThrust: 70, groundRate: 0.26, rotateSpeed: 33,
    maxTouchdownSpeed: 46, maxTouchdownSink: 3.3,
  },
};
