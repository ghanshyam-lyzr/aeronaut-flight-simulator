// Cervin P6: an original centreline-thrust push-pull touring twin. Every value is arcade tuning for Alpine Field.
const flight = {
  cruiseSpeed: 76.1,     // ~148 kt: 22 + 0.72 × 80 − 3.5 fixed-gear drag
  cruiseThrottle: 0.72, throttleRate: 0.28, spoolUp: 2.4, spoolCruise: 3.1,
  idleSpeed: 22, thrustSpeed: 80, afterburnerFrom: null, afterburnerSpeed: 0,
  minSpeed: 15, maxSpeed: 124, speedRate: 0.2, maxAcceleration: 4.6,
  flapDrag: 4.5, gearDrag: 3.5, bankDrag: 5, climbDrag: 40, diveGain: 28,
  stallSpeed: 30,        // ~58 kt clean; each flap stage lowers it by 3 m/s
  flapStallGain: 3, pitchRate: 0.23, pitchResponse: 3.4,
  rollRate: 0.58, rollResponse: 3.7, yawRate: 0.19, pitchLimits: [-0.48, 0.4], bankLimit: 0.98,
  aerobatic: false, autopilotGain: 1.05, groundThrust: 80, groundRate: 0.24,
  rotateSpeed: 35,       // ~62 kt with 15° flaps
  maxTouchdownSpeed: 48, // ~93 kt
  maxTouchdownSink: 3.2, // ~630 ft/min
};
const kt = v => Math.round(v * 1.94384), fpm = v => Math.round(v * 196.85 / 10) * 10;

export const pushpull = {
  id: 'pushpull', name: 'Cervin P6', type: 'Push-pull touring twin', registration: 'A-CP06', badge: 'PUSH',
  engine: 'piston', fixedGear: true, landing: { speed: 38 },
  // Two pistons on one centreline: a lower, fuller blade tone than the singles; both propellers share one throttle.
  propVoice: { pitch: 0.86, level: 1.1 },
  summary: 'Cervin P6 · push-pull touring twin',
  choice: 'Front and rear props on one centreline, twin booms, high wing. Steady 148 kt touring.',
  help: `A calm touring twin: one propeller pulls at the nose and one pushes behind the cabin, so power never swings the nose. Both engines follow one throttle. Fixed tricycle gear is always down. Use 15° flaps and rotate near ${kt(flight.rotateSpeed - flight.flapStallGain)} kt; approach at ${kt(38)} kt with full flaps and touch down below ${kt(flight.maxTouchdownSpeed)} kt and ${fpm(flight.maxTouchdownSink)} ft/min. It settles back towards level when you let go.`,
  runwayHint: `Runway 36 · F for 15° flaps, Shift for power, hold S near ${kt(flight.rotateSpeed - flight.flapStallGain)} kt · gear fixed`,
  speedScale: 200, groundClearance: 2.525, cameraScale: 0.95, cockpitOffset: [-0.3, 0.38, -1.3],
  flight,
};
