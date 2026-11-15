// Lodra H20: an original heavy tandem-rotor transport helicopter. Every value is arcade tuning for Alpine Field.
const flight = {
  rotorcraft: true,
  cruiseSpeed: 0,
  cruiseThrottle: 0.66,
  throttleRate: 0.17,       // the heaviest collective lever in the fleet (Sorna H8: 0.18)
  hoverCollective: 0.66,
  collectiveResponse: 1.6,  // lift follows the lever more slowly than the Sorna H8's 1.7
  rotorSpinUp: 0.48,        // two large rotors take longest to reach flight RPM
  rotorSpinDown: 0.16,
  pitchRate: 0.26,
  pitchResponse: 3,
  rollRate: 0.28,
  rollResponse: 3,
  yawRate: 0.32,            // differential lateral cyclic turns the long cabin steadily
  yawResponse: 2.6,
  levelRate: 1,             // a centred cyclic levels the long fuselage gently
  pitchLimits: [-0.34, 0.28],
  bankLimit: 0.34,
  groundClearance: 2.05,    // tyre contact below the model origin
  footprint: [1.75, 4.1],   // half-width and half-length of the four-wheel base
  maxTouchdownSpeed: 4,
  maxTouchdownSink: 1.8,
  aerobatic: false,
};
const pct = v => Math.round(v * 100), knots = v => Math.round(v * 1.94384), fpm = v => Math.round(v * 196.85 / 10) * 10;

export const tandem = {
  id: 'tandem', name: 'Lodra H20', type: 'Heavy tandem-rotor helicopter', registration: 'A-LH20', badge: 'TNDM',
  engine: 'rotor', landing: { speed: 0 }, landingGear: 'wheels',
  // Two counter-rotating three-blade rotors, fore and aft; no tail rotor. Slow, deep blade-pass for the sound.
  rotor: { blades: 3, rate: 23, turbine: 400, tandem: true },
  summary: 'Lodra H20 · heavy tandem-rotor helicopter',
  choice: 'Two counter-rotating rotors over a long cargo cabin, fixed wheels. Slow and stable.',
  help: `The fleet's heaviest helicopter, with a rotor at each end of a long cargo cabin and no tail rotor. ${pct(flight.hoverCollective)}% collective holds a level hover; lift follows the lever slowly, so lead every collective change and wait for it. Both rotors need several seconds to reach flight RPM from a ground start. W / S and A / D tilt the cyclic gently; release to level. Q / E turns the long cabin steadily. Space brakes to a hover and holds position, altitude and heading. Touch down level below ${knots(flight.maxTouchdownSpeed)} knots and ${fpm(flight.maxTouchdownSink)} ft/min on its four fixed wheels; there are no flaps and nothing to lower.`,
  runwayHint: `Raise collective with Shift and let both rotors spin up · ${pct(flight.hoverCollective)}% hovers · wheels fixed`,
  speedScale: 100, cameraScale: 1.75, cockpitOffset: [-0.5, 0.7, -5.75],
  flight,
};
