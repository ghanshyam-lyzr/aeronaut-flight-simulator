// Original two-seat canard pusher. Every performance value is arcade tuning for Alpine Field, not operating data.
export const canard = {
  id: 'canard', name: 'Neris P2', type: 'Canard pusher tourer', registration: 'A-NP02', badge: 'CNRD',
  engine: 'piston', fixedGear: true, noFlaps: true, landing: { speed: 40 },
  summary: 'Neris P2 · canard pusher tourer', choice: 'Forewing canard, swept wing, rear propeller. Smooth 155 kt touring.',
  help: 'A slippery two-seat tourer with its propeller behind the cabin. The forward canard stalls first and lowers the nose, so add power and ease back to recover. Fixed tricycle gear, no flaps. Rotate near 68 kt; approach at 78 kt and plan a long, shallow descent — it is slow to lose speed.',
  runwayHint: 'Runway 36 · Shift for power, hold S near 68 kt · fixed gear, no flaps',
  speedScale: 220, groundClearance: 2.585, cameraScale: 0.66, cockpitOffset: [0, 0.6, -1.9],
  flight: {
    cruiseSpeed: 80.48, cruiseThrottle: 0.72, throttleRate: 0.3, spoolUp: 2.6, spoolCruise: 3.4,
    idleSpeed: 22, thrustSpeed: 84, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 16, maxSpeed: 128, speedRate: 0.18, maxAcceleration: 5.6,
    flapDrag: 0, gearDrag: 2, bankDrag: 5, climbDrag: 40, diveGain: 34,
    stallSpeed: 30, flapStallGain: 0, pitchRate: 0.27, pitchResponse: 3.6,
    rollRate: 0.74, rollResponse: 4.2, yawRate: 0.2, pitchLimits: [-0.5, 0.42], bankLimit: 1.02,
    aerobatic: false, autopilotGain: 1, groundThrust: 86, groundRate: 0.24, rotateSpeed: 35,
    maxTouchdownSpeed: 50, maxTouchdownSink: 3.1,
  },
};
