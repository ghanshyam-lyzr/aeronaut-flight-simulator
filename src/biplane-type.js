// Alba B2: an original open-cockpit biplane. Every performance value is arcade tuning for Alpine Field, not operating data.
export const biplane = {
  id: 'biplane', name: 'Alba B2', type: 'Open-cockpit biplane', registration: 'A-AB02', badge: 'BIPL',
  engine: 'piston', fixedGear: true, noFlaps: true, landing: { speed: 27 },
  summary: 'Alba B2 · open-cockpit biplane', choice: 'Stacked wings, open cockpit, fixed tailwheel. Slow and nimble at 85 kt.',
  help: 'A light piston biplane that turns tightly at low speed. Fixed tailwheel gear is always down and there are no flaps. Rotate near 47 kt; approach at 52 kt on the clean wings and touch down below 74 kt and 650 ft/min. Short taps make gentle corrections; bank and pitch stay within normal limits.',
  runwayHint: 'Runway 36 · Shift for power, hold S near 47 kt · fixed gear, no flaps',
  speedScale: 130, groundClearance: 2.2, cameraScale: 0.68, cockpitOffset: [0, 0.75, 0.15],
  flight: {
    cruiseSpeed: 43.62,    // ~85 kt: 14 + 0.72 × 46 − 3.5 fixed-gear and wire drag
    cruiseThrottle: 0.72, throttleRate: 0.34, spoolUp: 3, spoolCruise: 3.8,
    idleSpeed: 14, thrustSpeed: 46, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 10, maxSpeed: 72, speedRate: 0.34, maxAcceleration: 4.5,
    flapDrag: 0, gearDrag: 3.5, bankDrag: 5, climbDrag: 24, diveGain: 18,
    stallSpeed: 20,        // ~39 kt; no flaps lower it
    flapStallGain: 0, pitchRate: 0.3, pitchResponse: 4.2,
    rollRate: 0.85, rollResponse: 4.8, yawRate: 0.3, pitchLimits: [-0.6, 0.55], bankLimit: 1.15,
    aerobatic: false, autopilotGain: 1.1, groundThrust: 56, groundRate: 0.32,
    rotateSpeed: 24,       // ~47 kt
    maxTouchdownSpeed: 38, // ~74 kt
    maxTouchdownSink: 3.3, // ~650 ft/min
  },
};
