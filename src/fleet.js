// Flyable aircraft. Flight numbers are metres, seconds and radians; labels feed every screen that names the aircraft.
const jet = {
  id: 'jet',
  name: 'Vela J8',
  type: 'Twin turbofan',
  registration: 'A-VJ08',
  badge: 'JET',
  summary: 'Vela J8 · twin turbofan jet',
  choice: 'Smooth light jet. Cruises near 195 knots.',
  help: 'Jet engines take a few seconds to spool up, so set power early. Lower your gear and flaps for a gentle landing below 130 knots.',
  runwayHint: 'Runway 36 · Add power with Shift, then hold S to lift off',
  speedScale: 190, // knots at the end of the airspeed tape
  flight: {
    cruiseSpeed: 100,      // ~195 kt at the default 72% power
    cruiseThrottle: 0.72,
    throttleRate: 0.19,
    spoolUp: 0.55,         // turbines accelerate slowly from idle
    spoolCruise: 0.95,
    idleSpeed: 34,
    thrustSpeed: 92,       // speed added between idle and full power
    afterburnerFrom: null,
    afterburnerSpeed: 0,
    minSpeed: 24,
    maxSpeed: 150,
    speedRate: 0.18,
    maxAcceleration: null,
    flapDrag: 7,
    gearDrag: 6,
    bankDrag: 6,
    climbDrag: 55,
    diveGain: 40,
    stallSpeed: 42,        // ~82 kt clean; each flap stage lowers it
    flapStallGain: 3,
    pitchRate: 0.29,
    pitchResponse: 3.8,
    rollRate: 0.86,
    rollResponse: 4.2,
    yawRate: 0.19,
    pitchLimits: [-0.56, 0.48],
    bankLimit: 1.14,
    aerobatic: false,      // pitch and bank stay inside the limits above
    autopilotGain: 1,
    groundThrust: 95,
    groundRate: 0.15,
    rotateSpeed: 48,       // ~93 kt, minus flap gain
    maxTouchdownSpeed: 68, // ~132 kt
    maxTouchdownSink: 3,   // ~590 ft/min
  },
};

const fighter = {
  id: 'fighter',
  name: 'Arolla F7',
  type: 'Single-seat fighter',
  registration: 'A-F07',
  badge: 'FTR',
  summary: 'Arolla F7 · single-seat fighter',
  choice: 'Agile delta-wing jet. Cruises near 330 knots.',
  help: 'The jet spools up over a few seconds and lights its afterburner above 90% throttle. Fly the approach near 135 knots with gear and full flaps, and touch down below 155 knots and 700 ft/min.',
  runwayHint: 'Runway 36 · Full power with Shift, hold S from 130 knots to rotate',
  speedScale: 560,
  flight: {
    cruiseSpeed: 171,      // ~330 kt at the default 72% power
    cruiseThrottle: 0.72,
    throttleRate: 0.35,
    spoolUp: 0.65,         // a turbine accelerates slowly from idle
    spoolCruise: 1.6,
    idleSpeed: 50,
    thrustSpeed: 168,
    afterburnerFrom: 0.9,  // reheat lights at the top of the lever
    afterburnerSpeed: 60,  // ~530 kt in level flight with the burner lit
    minSpeed: 30,
    maxSpeed: 285,
    speedRate: 0.3,
    maxAcceleration: 13,   // m/s² with full afterburner, about 1.3 g
    flapDrag: 9,
    gearDrag: 8,
    bankDrag: 9,
    climbDrag: 95,
    diveGain: 50,
    stallSpeed: 56,        // ~109 kt clean; each flap stage lowers it
    flapStallGain: 5,
    pitchRate: 0.8,
    pitchResponse: 7,
    rollRate: 3.2,
    rollResponse: 8,
    yawRate: 0.35,
    pitchLimits: null,     // unrestricted: loops, rolls and inverted flight
    bankLimit: null,
    aerobatic: true,       // free body-axis attitude once airborne
    autopilotGain: 0.38,   // the altitude hold is gentler at fighter speeds
    groundThrust: 115,
    groundRate: 0.09,
    rotateSpeed: 68,       // ~132 kt clean, minus the flap gain
    maxTouchdownSpeed: 80, // ~155 kt
    maxTouchdownSink: 3.6, // ~700 ft/min
  },
};

const helicopter = {
  id: 'helicopter',
  name: 'Laret H4',
  type: 'Light helicopter',
  registration: 'A-LH04',
  badge: 'HELI',
  summary: 'Laret H4 · light helicopter',
  choice: 'Hover, lift vertically and explore at your own pace.',
  help: '58% collective holds a level hover. Shift / Ctrl or the collective lever adds / removes lift; the rotor needs a few seconds to spin up from the ground. W tilts forward, S backward, A / D sideways; release cyclic to level. Q / E turns the nose. Space brakes to a hover and holds position, altitude and heading. Touch down level below 10 knots and 400 ft/min. Fixed skids need no gear or flaps.',
  runwayHint: 'Raise collective with Shift to spin up and lift vertically · 58% hovers',
  speedScale: 100,
  flight: {
    rotorcraft: true,
    cruiseSpeed: 0,
    cruiseThrottle: 0.58,
    throttleRate: 0.22,
    hoverCollective: 0.58,
    collectiveResponse: 3,
    rotorSpinUp: 1.1,
    rotorSpinDown: 0.35,
    pitchRate: 0.48,
    pitchResponse: 6,
    rollRate: 0.55,
    rollResponse: 6,
    yawRate: 0.65,
    pitchLimits: [-0.55, 0.45],
    bankLimit: 0.5,
    groundClearance: 1.6,
    maxTouchdownSpeed: 5,
    maxTouchdownSink: 2,
    aerobatic: false,
  },
};

// Geometry follows Boeing's 737-800W planning drawing. Performance is arcade tuning for this valley.
const airliner = {
  id: 'airliner',
  name: 'Boeing 737-800',
  type: 'Passenger airliner',
  registration: 'A-B738',
  badge: 'B738',
  summary: 'Boeing 737-800 · passenger airliner',
  choice: 'Swept wings, twin turbofans. Deliberate handling; cruises near 250 knots.',
  help: 'Allow time for the big turbofans to spool. Use 15° flaps for takeoff and rotate near 130 knots. Approach near 140 knots with gear, 30° flaps and about 45% power; touch down below 155 knots and 600 ft/min. Speeds and runway performance are tuned for this game.',
  runwayHint: 'Runway 36 · F for 15° flaps, full power with Shift, hold S near 130 knots',
  speedScale: 380,
  groundClearance: 4.53, // 3.6 m to the tyres + 0.93 m raised runway (the existing fleet uses the same offset)
  cameraScale: 2.65,
  cockpitOffset: [-0.65, 0.95, -15.6],
  flight: {
    cruiseSpeed: 128,
    cruiseThrottle: 0.72,
    throttleRate: 0.16,
    spoolUp: 0.32,
    spoolCruise: 0.62,
    idleSpeed: 40,
    thrustSpeed: 122,
    afterburnerFrom: null,
    afterburnerSpeed: 0,
    minSpeed: 29,
    maxSpeed: 195,
    speedRate: 0.12,
    maxAcceleration: 5,
    flapDrag: 8,
    gearDrag: 7,
    bankDrag: 10,
    climbDrag: 72,
    diveGain: 45,
    stallSpeed: 66,
    flapStallGain: 6,
    pitchRate: 0.18,
    pitchResponse: 2.8,
    rollRate: 0.5,
    rollResponse: 3.1,
    yawRate: 0.12,
    pitchLimits: [-0.35, 0.3],
    bankLimit: 0.87,
    aerobatic: false,
    autopilotGain: 0.8,
    groundThrust: 125,
    groundRate: 0.12,
    rotateSpeed: 73,
    maxTouchdownSpeed: 80,
    maxTouchdownSink: 3,
  },
};

export const FLEET = { jet, fighter, helicopter, airliner };
export const DEFAULT_AIRCRAFT = 'jet';
export const aircraftType = id => FLEET[id] ?? FLEET[DEFAULT_AIRCRAFT];
