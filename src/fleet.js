import { canard } from './canard-type.js';
import { cargo } from './cargo-type.js';

// Flyable aircraft. Flight numbers are metres, seconds and radians; labels feed every screen that names the aircraft.
const jet = {
  id: 'jet',
  engine: 'turbofan',
  landing: { speed: 56 },
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
  engine: 'fighter',
  landing: { speed: 70 },
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
  engine: 'rotor',
  landing: { speed: 0 },
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
  engine: 'airliner',
  landing: { speed: 72 },
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

// Original designs. Every performance value is arcade tuning for Alpine Field, not operating data.
const trainer = {
  id: 'trainer', name: 'Mira T2', type: 'High-wing trainer', registration: 'A-MT02', badge: 'TRNR',
  engine: 'piston', fixedGear: true, landing: { speed: 33 },
  summary: 'Mira T2 · high-wing trainer', choice: 'Single prop, fixed tricycle gear. Forgiving at 100 kt.',
  help: 'A steady first aircraft with quick piston response. Fixed tricycle gear is always down. Use 15° flaps to take off near 52 kt; approach at 64 kt with full flaps. Short taps make gentle corrections.',
  runwayHint: 'Runway 36 · F for 15° flaps, Shift for power, hold S near 52 kt · gear fixed',
  speedScale: 160, groundClearance: 2.475, cameraScale: 0.74, cockpitOffset: [0, 0.55, -1.1],
  flight: {
    cruiseSpeed: 51, cruiseThrottle: 0.72, throttleRate: 0.32, spoolUp: 2.8, spoolCruise: 3.6,
    idleSpeed: 18, thrustSpeed: 50, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 12, maxSpeed: 85, speedRate: 0.32, maxAcceleration: 4,
    flapDrag: 4, gearDrag: 3, bankDrag: 4, climbDrag: 28, diveGain: 20,
    stallSpeed: 25, flapStallGain: 3, pitchRate: 0.24, pitchResponse: 3.8,
    rollRate: 0.62, rollResponse: 4.3, yawRate: 0.22, pitchLimits: [-0.55, 0.48], bankLimit: 1.05,
    aerobatic: false, autopilotGain: 1.1, groundThrust: 64, groundRate: 0.28, rotateSpeed: 30,
    maxTouchdownSpeed: 46, maxTouchdownSink: 3.2,
  },
};
const bush = {
  id: 'bush', name: 'Brenta B6', type: 'STOL bush plane', registration: 'A-BB06', badge: 'STOL',
  engine: 'piston', fixedGear: true, landing: { speed: 27 },
  summary: 'Brenta B6 · STOL bush plane', choice: 'Big tyres, tailwheel, braced high wing. Slow flight at 85 kt.',
  help: 'A short-field explorer with large tyres and a fixed tailwheel. Gear stays down. Use 15° flaps and rotate near 39 kt; approach at 52 kt with full flaps. Its broad wing flies slowly, but steep banks still lose height.',
  runwayHint: 'Runway 36 · F for 15° flaps, Shift for power, hold S near 39 kt · gear fixed',
  speedScale: 130, groundClearance: 2.875, cameraScale: 0.78, cockpitOffset: [0, 0.55, -0.9],
  flight: {
    cruiseSpeed: 44.12, cruiseThrottle: 0.72, throttleRate: 0.34, spoolUp: 2.4, spoolCruise: 3.2,
    idleSpeed: 14, thrustSpeed: 46, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 9, maxSpeed: 73, speedRate: 0.34, maxAcceleration: 4.8,
    flapDrag: 3, gearDrag: 3, bankDrag: 4, climbDrag: 22, diveGain: 18,
    stallSpeed: 20, flapStallGain: 3, pitchRate: 0.28, pitchResponse: 4,
    rollRate: 0.7, rollResponse: 4.5, yawRate: 0.28, pitchLimits: [-0.6, 0.55], bankLimit: 1.1,
    aerobatic: false, autopilotGain: 1.1, groundThrust: 58, groundRate: 0.34, rotateSpeed: 23,
    maxTouchdownSpeed: 39, maxTouchdownSink: 3.6,
  },
};
const commuter = {
  id: 'commuter', name: 'Sarine C24', type: 'Twin-turboprop commuter', registration: 'A-SC24', badge: 'PROP',
  engine: 'turboprop', landing: { speed: 53 },
  summary: 'Sarine C24 · twin turboprop', choice: 'High wing, T-tail, two six-blade props. Cruises at 170 kt.',
  help: 'Two turboprops take time to spool and pull strongly once ready. Use 15° flaps and rotate near 89 kt. Lower the retractable gear and use full flaps for a 103 kt approach. Set power early.',
  runwayHint: 'Runway 36 · F for 15° flaps, full power, hold S near 89 kt',
  speedScale: 250, groundClearance: 3.925, cameraScale: 1.7, cockpitOffset: [-0.4, 0.6, -8.9],
  flight: {
    cruiseSpeed: 87.92, cruiseThrottle: 0.72, throttleRate: 0.24, spoolUp: 0.8, spoolCruise: 1.4,
    idleSpeed: 26, thrustSpeed: 86, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 20, maxSpeed: 142, speedRate: 0.22, maxAcceleration: 5.5,
    flapDrag: 5, gearDrag: 4, bankDrag: 6, climbDrag: 46, diveGain: 30,
    stallSpeed: 42, flapStallGain: 4, pitchRate: 0.24, pitchResponse: 3.5,
    rollRate: 0.66, rollResponse: 3.8, yawRate: 0.18, pitchLimits: [-0.48, 0.4], bankLimit: 1,
    aerobatic: false, autopilotGain: 1, groundThrust: 100, groundRate: 0.2, rotateSpeed: 50,
    maxTouchdownSpeed: 65, maxTouchdownSink: 3.2,
  },
};
const regional = {
  id: 'regional', name: 'Orsino R70', type: 'Regional passenger jet', registration: 'A-OR70', badge: 'RJ70',
  engine: 'regional', landing: { speed: 66 },
  summary: 'Orsino R70 · regional jet', choice: 'Rear-mounted turbofans, slender wings and T-tail. Cruises at 225 kt.',
  help: 'Rear-mounted turbofans spool gradually. The slim regional jet responds faster than the big airliners. Rotate near 113 kt with 15° flaps; approach at 128 kt with gear down and full flaps.',
  runwayHint: 'Runway 36 · F for 15° flaps, full power, hold S near 113 kt',
  speedScale: 330, groundClearance: 3.625, cameraScale: 2.1, cockpitOffset: [-0.5, 0.65, -12.5],
  flight: {
    cruiseSpeed: 115.92, cruiseThrottle: 0.72, throttleRate: 0.21, spoolUp: 0.48, spoolCruise: 0.85,
    idleSpeed: 36, thrustSpeed: 111, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 25, maxSpeed: 180, speedRate: 0.16, maxAcceleration: 5.2,
    flapDrag: 7, gearDrag: 5, bankDrag: 8, climbDrag: 62, diveGain: 38,
    stallSpeed: 55, flapStallGain: 5, pitchRate: 0.23, pitchResponse: 3.3,
    rollRate: 0.68, rollResponse: 3.8, yawRate: 0.16, pitchLimits: [-0.42, 0.36], bankLimit: 0.96,
    aerobatic: false, autopilotGain: 0.9, groundThrust: 118, groundRate: 0.16, rotateSpeed: 63,
    maxTouchdownSpeed: 75, maxTouchdownSink: 3.1,
  },
};
const widebody = {
  id: 'widebody', name: 'Aven W280', type: 'Widebody airliner', registration: 'A-AW28', badge: 'WIDE',
  engine: 'widebody', landing: { speed: 77 },
  summary: 'Aven W280 · widebody airliner', choice: 'Broad cabin, raked wingtips, huge fans and four-wheel bogies. 275 kt cruise.',
  help: 'The largest aircraft needs early power changes and gentle inputs. Use 15° flaps to take off near 138 kt. Approach at 150 kt with gear down and full flaps; idle power on touchdown and keep straight. Runway performance is compressed for this valley.',
  runwayHint: 'Runway 36 · F for 15° flaps, full power, hold S near 138 kt',
  speedScale: 420, groundClearance: 5.925, cameraScale: 4.05, cockpitOffset: [-0.85, 1.1, -22.9],
  flight: {
    cruiseSpeed: 141.36, cruiseThrottle: 0.72, throttleRate: 0.15, spoolUp: 0.28, spoolCruise: 0.52,
    idleSpeed: 42, thrustSpeed: 138, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 32, maxSpeed: 218, speedRate: 0.11, maxAcceleration: 4.8,
    flapDrag: 9, gearDrag: 8, bankDrag: 12, climbDrag: 80, diveGain: 45,
    stallSpeed: 70, flapStallGain: 6, pitchRate: 0.15, pitchResponse: 2.5,
    rollRate: 0.4, rollResponse: 2.7, yawRate: 0.1, pitchLimits: [-0.32, 0.28], bankLimit: 0.8,
    aerobatic: false, autopilotGain: 0.72, groundThrust: 140, groundRate: 0.13, rotateSpeed: 77,
    maxTouchdownSpeed: 86, maxTouchdownSink: 3,
  },
};
const aerobatic = {
  id: 'aerobatic', name: 'Silex A3', type: 'Aerobatic prop plane', registration: 'A-SA03', badge: 'AERO',
  engine: 'aeroprop', fixedGear: true, noFlaps: true, landing: { speed: 45 },
  summary: 'Silex A3 · aerobatic prop', choice: 'Low tapered wing, bubble canopy, fixed tailwheel. Free loops and rolls.',
  help: 'A nimble piston single with continuous loops, rolls and inverted flight. Release the controls to hold attitude; Space recovers to level flight. Fixed tailwheel gear, no flaps. Rotate near 70 kt and approach at 87 kt. Keep bank and pitch gentle near the ground.',
  runwayHint: 'Runway 36 · Shift for power, hold S near 70 kt · fixed gear, no flaps',
  speedScale: 240, groundClearance: 2.675, cameraScale: 0.64, cockpitOffset: [0, 0.6, -0.45],
  flight: {
    cruiseSpeed: 75.1, cruiseThrottle: 0.72, throttleRate: 0.42, spoolUp: 3.6, spoolCruise: 4.5,
    idleSpeed: 20, thrustSpeed: 80, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 16, maxSpeed: 128, speedRate: 0.36, maxAcceleration: 7,
    flapDrag: 0, gearDrag: 2.5, bankDrag: 5, climbDrag: 38, diveGain: 32,
    stallSpeed: 32, flapStallGain: 0, pitchRate: 0.95, pitchResponse: 6.5,
    rollRate: 3.8, rollResponse: 7.5, yawRate: 0.4, pitchLimits: null, bankLimit: null,
    aerobatic: true, autopilotGain: 0.7, groundThrust: 92, groundRate: 0.26, rotateSpeed: 36,
    maxTouchdownSpeed: 57, maxTouchdownSink: 3.2,
  },
};

export const FLEET = { jet, fighter, helicopter, airliner, trainer, bush, commuter, regional, widebody, aerobatic, canard, cargo };
export const DEFAULT_AIRCRAFT = 'jet';
export const aircraftType = id => FLEET[id] ?? FLEET[DEFAULT_AIRCRAFT];
