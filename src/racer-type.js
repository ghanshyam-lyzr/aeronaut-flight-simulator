// Rava R6: an original single-seat piston racing monoplane. Every value is arcade tuning for Alpine Field.
const flight = {
  cruiseSpeed: 117.84,   // ~229 kt: 30 + 0.72 × 122 with the gear tucked away
  cruiseThrottle: 0.72, throttleRate: 0.4, spoolUp: 3.2, spoolCruise: 4,
  idleSpeed: 30, thrustSpeed: 122, afterburnerFrom: null, afterburnerSpeed: 0,
  minSpeed: 20, maxSpeed: 176, speedRate: 0.3, maxAcceleration: 6.5,
  flapDrag: 5, gearDrag: 5, bankDrag: 7, climbDrag: 52, diveGain: 36,
  stallSpeed: 38,        // ~74 kt clean; each flap stage lowers it by 4 m/s
  flapStallGain: 4, pitchRate: 0.44, pitchResponse: 5.4,
  rollRate: 1.55, rollResponse: 6.2, yawRate: 0.28, pitchLimits: [-0.62, 0.56], bankLimit: 1.3,
  aerobatic: false,      // crisp, but held inside normal pitch and bank limits
  autopilotGain: 0.85, groundThrust: 100, groundRate: 0.25,
  rotateSpeed: 44,       // ~78 kt with 15° flaps
  maxTouchdownSpeed: 60, // ~117 kt
  maxTouchdownSink: 3.2, // ~630 ft/min
};
const kt = v => Math.round(v * 1.94384), fpm = v => Math.round(v * 196.85 / 10) * 10;

export const racer = {
  id: 'racer', name: 'Rava R6', type: 'Piston racing monoplane', registration: 'A-RR06', badge: 'RACE',
  engine: 'piston', landing: { speed: 46 },
  // A high-revving inline twelve: a harder, higher firing note than the touring singles on the same propeller bus.
  propVoice: { pitch: 1.32, level: 1.15 },
  summary: 'Rava R6 · piston racing monoplane',
  choice: 'Long inline nose, bubble canopy, retractable tailwheel gear. Quick 229 kt cruise.',
  help: `A single-seat racer with a long inline-engine nose. It answers quickly but stays inside normal pitch and bank limits, so short taps are enough. Use 15° flaps and rotate near ${kt(flight.rotateSpeed - flight.flapStallGain)} kt; raise the retractable tailwheel gear with G once climbing. Approach at ${kt(46)} kt with gear down and full flaps, then touch down below ${kt(flight.maxTouchdownSpeed)} kt and ${fpm(flight.maxTouchdownSink)} ft/min. The long nose hides the runway in the flare, so look along its side.`,
  runwayHint: `Runway 36 · F for 15° flaps, Shift for power, hold S near ${kt(flight.rotateSpeed - flight.flapStallGain)} kt · G raises the gear`,
  speedScale: 300, groundClearance: 2.25, cameraScale: 0.68, cockpitOffset: [0, 0.85, -0.15],
  flight,
};
