// Sorna H8: an original twin-turbine medium transport helicopter. Every value is arcade tuning for Alpine Field.
const flight = {
  rotorcraft: true,
  cruiseSpeed: 0,
  cruiseThrottle: 0.62,
  throttleRate: 0.18,       // a heavier collective lever: slower per second than the Laret H4's 0.22
  hoverCollective: 0.62,
  collectiveResponse: 1.7,  // lift follows the lever more slowly than the light H4
  rotorSpinUp: 0.62,        // a larger five-blade rotor takes about twice as long to reach flight RPM
  rotorSpinDown: 0.22,
  pitchRate: 0.34,
  pitchResponse: 3.8,
  rollRate: 0.38,
  rollResponse: 3.8,
  yawRate: 0.42,
  yawResponse: 3.4,         // optional; the H4 keeps the shared default of 6
  levelRate: 1.2,           // optional; how quickly a centred cyclic levels the disc (default 1.6)
  pitchLimits: [-0.42, 0.36],
  bankLimit: 0.42,
  groundClearance: 1.78,    // tyre contact below the model origin
  footprint: [1.45, 2.3],   // optional; half-width and half-length of the wheel base for slope checks
  maxTouchdownSpeed: 4.5,
  maxTouchdownSink: 1.9,
  aerobatic: false,
};
const pct = v => Math.round(v * 100), knots = v => Math.round(v * 1.94384), fpm = v => Math.round(v * 196.85 / 10) * 10;

export const transport = {
  id: 'transport', name: 'Sorna H8', type: 'Medium transport helicopter', registration: 'A-SH08', badge: 'TRNS',
  engine: 'rotor', landing: { speed: 0 }, landingGear: 'wheels',
  // Rotor geometry for animation and sound: five slower main blades and a ducted multi-blade tail rotor.
  rotor: { blades: 5, rate: 27, tailRate: 105, turbine: 470 },
  summary: 'Sorna H8 · medium transport helicopter',
  choice: 'Twin-turbine cabin, five-blade rotor, fixed wheels. Deliberate and steady.',
  help: `A heavier twin-turbine transport. ${pct(flight.hoverCollective)}% collective holds a level hover; the lift answers the lever more slowly than the Laret H4, so lead collective changes. The larger rotor takes several seconds to reach flight RPM from a ground start. W / S and A / D tilt the cyclic more deliberately; release to level. Q / E turns the nose steadily. Space brakes to a hover and holds position, altitude and heading. Touch down level below ${knots(flight.maxTouchdownSpeed)} knots and ${fpm(flight.maxTouchdownSink)} ft/min. Fixed wheeled landing gear stays down; there are no flaps.`,
  runwayHint: `Raise collective with Shift and let the rotor spin up · ${pct(flight.hoverCollective)}% hovers · wheels fixed`,
  speedScale: 100, cameraScale: 1.32, cockpitOffset: [-0.55, 0.62, -2.55],
  flight,
};
