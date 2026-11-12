// Varen G18: an original self-launching powered sailplane. Every value is arcade tuning for Alpine Field.
export const motorglider = {
  id: 'motorglider', name: 'Varen G18', type: 'Self-launching motorglider', registration: 'A-VG18', badge: 'GLDR',
  engine: 'piston', fixedGear: true, landing: { speed: 25 },
  // A small mast-mounted prop: higher, quieter blade tone than the piston singles on the same propeller bus.
  // Below stopBelow spool the prop is stopped: still in the model, labelled on the panel and silent.
  propVoice: { pitch: 1.45, level: 0.5, stopBelow: 0.02 },
  summary: 'Varen G18 · powered sailplane',
  choice: 'Slender 18 m wing, mast prop, monowheel. Glides at 49 kt.',
  help: 'An efficient sailplane with a small motor for self-launch. The monowheel, tailwheel and wing outriggers are fixed. Use 15° flaps and full power, then hold S near 40 kt. Pull power to idle and the prop stops; released, the nose trims about 2° low for a 49 kt glide sinking near 260 ft/min (about 19:1). There is no lift or thermal model, so every power-off glide descends. Roll response is deliberately gentle. Approach at 49 kt with full flaps and a little power; it floats, so ease the nose down early.',
  runwayHint: 'Runway 36 · F for 15° flaps, Shift for full power, hold S near 40 kt · gear fixed',
  speedScale: 130, groundClearance: 1.465, cameraScale: 0.98, cockpitOffset: [0, 0.42, -1.7],
  flight: {
    cruiseSpeed: 34.34,    // ~67 kt motoring at the default 72% power
    cruiseThrottle: 0.72, throttleRate: 0.3, spoolUp: 2.6, spoolCruise: 3.4,
    idleSpeed: 20, thrustSpeed: 22, afterburnerFrom: null, afterburnerSpeed: 0,
    minSpeed: 12, maxSpeed: 62, speedRate: 0.3, maxAcceleration: 1.8,
    flapDrag: 3.5, gearDrag: 1.5, bankDrag: 3, climbDrag: 90, diveGain: 200,
    stallSpeed: 19,        // ~37 kt clean, ~31 kt with full flaps
    flapStallGain: 1.5, pitchRate: 0.2, pitchResponse: 3.2,
    rollRate: 0.4, rollResponse: 2.6, yawRate: 0.16, pitchLimits: [-0.5, 0.42], bankLimit: 0.95,
    aerobatic: false, autopilotGain: 1.1, groundThrust: 46, groundRate: 0.28, rotateSpeed: 22,
    maxTouchdownSpeed: 31, maxTouchdownSink: 2.6,
    // Glider capabilities: the stopped prop adds little sink, and released pitch trims to a shallow glide.
    idleSink: 1.5,         // m/s per unit of spool below 0.32 (other aircraft: 6)
    glidePitch: 0.036,     // radians nose-down the self-stability settles to with the engine at idle
  },
};
