// Taris F12: an original twin-engine interceptor. Every value is arcade tuning for Alpine Field.
const flight = {
  cruiseSpeed: 175.84,   // ~342 kt: 52 + 0.72 × 172
  cruiseThrottle: 0.72, throttleRate: 0.32, spoolUp: 0.6, spoolCruise: 1.45,
  idleSpeed: 52, thrustSpeed: 172,
  afterburnerFrom: 0.92, // reheat lights only at the very top of the lever
  afterburnerSpeed: 42,  // restrained: ~425 kt level with both burners lit
  minSpeed: 32, maxSpeed: 292, speedRate: 0.27, maxAcceleration: 11,
  flapDrag: 9, gearDrag: 8, bankDrag: 9, climbDrag: 100, diveGain: 52,
  stallSpeed: 60,        // ~117 kt clean; each flap stage lowers it by 5 m/s
  flapStallGain: 5, pitchRate: 0.72, pitchResponse: 6.2,
  rollRate: 2.7, rollResponse: 7.2, yawRate: 0.32,
  pitchLimits: null, bankLimit: null,
  aerobatic: true,       // free body-axis attitude once airborne: loops, rolls and inverted flight
  autopilotGain: 0.36, groundThrust: 122, groundRate: 0.085,
  rotateSpeed: 72,       // ~130 kt with 15° flaps
  maxTouchdownSpeed: 84, // ~163 kt
  maxTouchdownSink: 3.6, // ~710 ft/min
};
const kt = v => Math.round(v * 1.94384), fpm = v => Math.round(v * 196.85 / 10) * 10;

export const interceptor = {
  id: 'interceptor', name: 'Taris F12', type: 'Twin-engine interceptor', registration: 'A-TF12', badge: 'INTC',
  engine: 'fighter', landing: { speed: 72 },
  // Two turbofans on the fighter bus: a deeper compressor tone and a broader exhaust than the single-engine Arolla.
  engineVoice: { whine: 0.86, roar: 0.9, roarGain: 1.12, rumbleGain: 1.18, burnerGain: 0.8 },
  summary: 'Taris F12 · twin-engine interceptor',
  choice: 'Twin engines and tails, swept wing, retractable gear. Free loops and rolls at 342 kt.',
  help: `A heavier twin-engine jet with free loops, rolls and inverted flight once airborne; release the controls to hold the attitude, Space recovers to level flight. Both engines spool over a few seconds and light restrained afterburners above ${Math.round(flight.afterburnerFrom * 100)}% throttle. Use 15° flaps and rotate near ${kt(flight.rotateSpeed - flight.flapStallGain)} kt. Approach near ${kt(72)} kt with gear down and full flaps, and touch down below ${kt(flight.maxTouchdownSpeed)} kt and ${fpm(flight.maxTouchdownSink)} ft/min.`,
  runwayHint: `Runway 36 · F for 15° flaps, full power with Shift, hold S near ${kt(flight.rotateSpeed - flight.flapStallGain)} kt`,
  speedScale: 560, groundClearance: 2.525, cameraScale: 1.12, cockpitOffset: [0, 0.95, -4.45],
  flight,
};
