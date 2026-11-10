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

export const FLEET = { jet, fighter };
export const DEFAULT_AIRCRAFT = 'jet';
export const aircraftType = id => FLEET[id] ?? FLEET[DEFAULT_AIRCRAFT];
