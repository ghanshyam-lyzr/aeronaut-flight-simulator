import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const mix = (value, target, rate, dt) => THREE.MathUtils.lerp(value, target, 1 - Math.exp(-rate * dt));
const TAU = Math.PI * 2;
const GRAVITY = 9.81;

/** Vela J8 performance, in metres per second. Speeds are tuned for the valley, not a certified type. */
export const JET = {
  cruiseSpeed: 100,      // ~195 kt at the default 72% power
  idleSpeed: 34,
  thrustSpeed: 92,       // speed added between idle and full power
  stallSpeed: 42,        // ~82 kt clean; each flap stage lowers it
  flapStallGain: 3,
  rotateSpeed: 48,       // ~93 kt, minus flap gain
  maxTouchdownSpeed: 68, // ~132 kt
  maxTouchdownSink: 3,   // ~590 ft/min
  groundThrust: 95,
  spoolUp: 0.55,         // turbines accelerate slowly from idle
  spoolCruise: 0.95,
};

/** A forgiving, coordinated-turn flight model. All distances are metres. */
export class FlightController {
  constructor(heightAt = () => 0) {
    this.heightAt = heightAt;
    this.state = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this.attitude = new THREE.Euler(0, 0, 0, 'YXZ');
    this.reset();
  }

  reset() {
    const s = this.state;
    s.position.set(0, Math.max(620, this.groundAt(0, 1900) + 180), 1900);
    s.quaternion.identity();
    Object.assign(s, {
      speed: JET.cruiseSpeed,
      throttle: 0.72,
      spool: 0.72,
      heading: 0,
      pitch: 0,
      bank: 0,
      verticalSpeed: 0,
      gearDown: false,
      flaps: 0,
      crashed: false,
      stalled: false,
      grounded: false,
      flightTime: 0,
      distance: 0,
      autopilot: false,
      crashReason: '',
    });
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;
    this.holdAltitude = s.position.y;
    this.holdHeading = 0;
    return s;
  }

  groundAt(x, z) {
    const height = this.heightAt(x, z);
    return Math.max(10, Number.isFinite(height) ? height : 0);
  }

  toggleAutopilot() {
    if (this.state.crashed || this.state.grounded) return false;
    this.state.autopilot = !this.state.autopilot;
    this.holdAltitude = this.state.position.y;
    this.holdHeading = this.state.heading;
    return this.state.autopilot;
  }

  toggleGear() {
    this.state.gearDown = !this.state.gearDown;
    return this.state.gearDown;
  }

  cycleFlaps() {
    this.state.flaps = (this.state.flaps + 1) % 3;
    return this.state.flaps;
  }

  update(dt, inputs = {}) {
    if (this.state.crashed || !Number.isFinite(dt) || dt <= 0) return this.state;
    // A backgrounded tab must never move the aircraft through a mountain in one frame.
    const elapsed = Math.min(dt, 0.25);
    const steps = Math.max(1, Math.ceil(elapsed / 0.025));
    const controls = {
      pitch: clamp(Number(inputs.pitch) || 0, -1, 1),
      roll: clamp(Number(inputs.roll) || 0, -1, 1),
      yaw: clamp(Number(inputs.yaw) || 0, -1, 1),
      throttle: clamp(Number(inputs.throttle) || 0, -1, 1),
    };
    if (Math.abs(controls.pitch) + Math.abs(controls.roll) + Math.abs(controls.yaw) > 0.12) {
      this.state.autopilot = false;
    }
    for (let i = 0; i < steps && !this.state.crashed; i++) this.step(elapsed / steps, controls);
    return this.state;
  }

  step(dt, controls) {
    const s = this.state;
    s.flightTime += dt;
    s.throttle = clamp(s.throttle + controls.throttle * dt * 0.19, 0, 1);
    // Engine response lags the lever, slowest near idle.
    s.spool = mix(s.spool, s.throttle, s.spool < 0.35 ? JET.spoolUp : JET.spoolCruise, dt);

    if (s.autopilot) {
      const altitudeError = this.holdAltitude - s.position.y;
      const desiredPitch = clamp(altitudeError * 0.002 - s.verticalSpeed * 0.013, -0.16, 0.16);
      let headingError = this.holdHeading - s.heading;
      headingError = Math.atan2(Math.sin(headingError), Math.cos(headingError));
      s.pitch = mix(s.pitch, desiredPitch, 0.85, dt);
      s.bank = mix(s.bank, clamp(headingError * 1.6, -0.4, 0.4), 1.1, dt);
      this.pitchRate = mix(this.pitchRate, 0, 5, dt);
      this.rollRate = mix(this.rollRate, 0, 5, dt);
    } else {
      this.pitchRate = mix(this.pitchRate, controls.pitch * 0.29, 3.8, dt);
      this.rollRate = mix(this.rollRate, controls.roll * 0.86, 4.2, dt);
      s.pitch += this.pitchRate * dt;
      s.bank += this.rollRate * dt;
      // Soft self-stability makes cruising possible without continuous corrections.
      if (Math.abs(controls.roll) < 0.05) s.bank = mix(s.bank, 0, 0.17, dt);
      if (Math.abs(controls.pitch) < 0.05) s.pitch = mix(s.pitch, 0, 0.045, dt);
    }

    s.pitch = clamp(s.pitch, -0.56, 0.48);
    s.bank = clamp(s.bank, -1.14, 1.14);
    this.yawRate = mix(this.yawRate, controls.yaw * 0.19, 2.8, dt);

    if (s.grounded) {
      s.stalled = false;
      this.stepGround(dt, controls);
      this.setQuaternion();
      return;
    }

    const flapDrag = s.flaps * 7;
    const gearDrag = s.gearDown ? 6 : 0;
    const bankDrag = Math.abs(Math.sin(s.bank)) * 6;
    const climbDrag = Math.max(0, Math.sin(s.pitch)) * 55;
    const diveGain = Math.max(0, -Math.sin(s.pitch)) * 40;
    const desiredSpeed = clamp(JET.idleSpeed + s.spool * JET.thrustSpeed - flapDrag - gearDrag - bankDrag - climbDrag + diveGain, 24, 150);
    s.speed = mix(s.speed, desiredSpeed, 0.18, dt);

    const stallSpeed = JET.stallSpeed - s.flaps * JET.flapStallGain;
    s.stalled = s.speed < stallSpeed && !s.grounded;
    const stallAmount = clamp((stallSpeed + 4 - s.speed) / 12, 0, 1);
    if (s.stalled) {
      s.pitch = mix(s.pitch, -0.25, 0.7 + stallAmount, dt);
      s.autopilot = false;
    }

    // Banking produces a coordinated turn; yaw adds a small rudder correction.
    const turnRate = GRAVITY * Math.tan(s.bank) / Math.max(s.speed, 24);
    s.heading = ((s.heading + (turnRate + this.yawRate) * dt) % TAU + TAU) % TAU;
    const idleSink = Math.max(0, 0.32 - s.spool) * 6;
    const lowSpeedSink = stallAmount * stallAmount * 8;
    const turnSink = Math.abs(Math.sin(s.bank)) * 0.9;
    const targetVerticalSpeed = Math.sin(s.pitch) * s.speed - idleSink - lowSpeedSink - turnSink;
    s.verticalSpeed = mix(s.verticalSpeed, targetVerticalSpeed, 2.1, dt);

    const distance = Math.cos(s.pitch) * s.speed * dt;
    s.position.x += Math.sin(s.heading) * distance;
    s.position.z -= Math.cos(s.heading) * distance;
    s.position.y += s.verticalSpeed * dt;
    s.distance += distance;

    const ground = this.groundAt(s.position.x, s.position.z) + 2.8;
    if (s.position.y <= ground) {
      s.position.y = ground;
      const landable = this.heightAt(s.position.x, s.position.z) > 10.2 && s.gearDown && Math.abs(s.verticalSpeed) < JET.maxTouchdownSink && s.speed < JET.maxTouchdownSpeed && Math.abs(s.bank) < 0.3;
      if (landable) {
        s.grounded = true;
        s.stalled = false;
        s.verticalSpeed = 0;
        s.autopilot = false;
      } else {
        s.crashed = true;
        s.crashReason = s.gearDown ? 'Hard landing' : 'Terrain collision';
        s.speed = 0;
        s.verticalSpeed = 0;
        s.autopilot = false;
      }
    }
    this.setQuaternion();
  }

  stepGround(dt, controls) {
    const s = this.state;
    // Rolling resistance stops an idle aircraft. Full power allows a takeoff roll.
    const targetSpeed = s.spool > 0.2 ? (s.spool - 0.2) * JET.groundThrust : 0;
    s.speed = mix(s.speed, targetSpeed, s.spool < 0.2 ? 0.35 : 0.15, dt);
    s.heading = ((s.heading + (controls.yaw + controls.roll * 0.6) * dt * 0.35) % TAU + TAU) % TAU;
    s.bank = mix(s.bank, 0, 5, dt);
    s.pitch = mix(s.pitch, Math.max(0, controls.pitch) * 0.12, 3, dt);
    const distance = s.speed * dt;
    s.position.x += Math.sin(s.heading) * distance;
    s.position.z -= Math.cos(s.heading) * distance;
    s.position.y = this.groundAt(s.position.x, s.position.z) + 2.8;
    s.distance += distance;
    if (s.speed > JET.rotateSpeed - s.flaps * JET.flapStallGain && controls.pitch > 0.15) {
      s.grounded = false;
      s.pitch = 0.10;
      s.verticalSpeed = 2.5;
      s.position.y += 0.5;
    }
  }

  setQuaternion() {
    const s = this.state;
    this.attitude.set(s.pitch, -s.heading, -s.bank, 'YXZ');
    s.quaternion.setFromEuler(this.attitude);
  }
}

/** Mix levels for the twin turbofans at a given engine spool (0–1) and airspeed (m/s). */
export function jetSound(spool, speed = 0) {
  const n1 = clamp(Number(spool) || 0, 0, 1);
  const airspeed = clamp(Number(speed) || 0, 0, 150);
  return {
    whine: 900 + n1 * 2600,          // compressor tone, Hz
    whineGain: 0.012 + n1 * 0.026,
    fan: 110 + n1 * 190,             // fan blade-pass hum, Hz
    fanGain: 0.05 + n1 * 0.05,
    roar: 260 + n1 * 820,            // exhaust band centre, Hz
    roarGain: 0.05 + n1 * n1 * 0.38,
    rumbleGain: 0.04 + n1 * n1 * 0.3,
    wind: clamp(airspeed / 480, 0.015, 0.3),
    master: 0.42 + n1 * 0.3,
  };
}

/** Synthesized twin-turbofan engines and slipstream. Call start() from a user gesture. */
export class FlightAudio {
  constructor() {
    this.enabled = false;
    this.context = null;
  }

  async start() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return false;
    if (!this.context) {
      const ctx = new AudioContext();
      this.context = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);
      const noise = (brown) => {
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let previous = 0;
        for (let i = 0; i < data.length; i++) {
          const white = Math.random() * 2 - 1;
          previous = brown ? (previous + white * 0.035) / 1.035 : white;
          data[i] = brown ? previous * 3.5 : white * 0.5;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.start();
        return source;
      };
      const voice = (input, type, frequency, q) => {
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = q;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        input.connect(filter).connect(gain).connect(this.master);
        return { filter, gain };
      };
      const exhaust = noise(false);
      this.roar = voice(exhaust, 'bandpass', 400, 0.7);
      this.rumble = voice(exhaust, 'lowpass', 140, 0.5);
      // Two slightly detuned compressors beat against each other, like a real twin.
      this.whines = [1, 1.012].map(ratio => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 900 * ratio;
        osc.start();
        return { osc, ratio, ...voice(osc, 'highpass', 600, 0.4) };
      });
      this.fan = ctx.createOscillator();
      this.fan.type = 'triangle';
      this.fan.frequency.value = 110;
      this.fan.start();
      this.fanVoice = voice(this.fan, 'lowpass', 520, 0.6);
      this.wind = ctx.createGain();
      this.wind.gain.value = 0.05;
      noise(true).connect(this.wind).connect(this.master);
    }
    this.enabled = true;
    try { await this.context.resume(); } catch { this.enabled = false; }
    return this.enabled;
  }

  toggle() {
    if (!this.enabled) {
      void this.start();
      return true;
    }
    this.enabled = false;
    this.master?.gain.setTargetAtTime(0, this.context.currentTime, 0.1);
    return false;
  }

  update(state) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const mix = jetSound(state.spool ?? state.throttle, state.speed);
    for (const { osc, ratio, gain } of this.whines) {
      osc.frequency.setTargetAtTime(mix.whine * ratio, now, 0.25);
      gain.gain.setTargetAtTime(mix.whineGain, now, 0.25);
    }
    this.fan.frequency.setTargetAtTime(mix.fan, now, 0.25);
    this.fanVoice.gain.gain.setTargetAtTime(mix.fanGain, now, 0.25);
    this.roar.filter.frequency.setTargetAtTime(mix.roar, now, 0.3);
    this.roar.gain.gain.setTargetAtTime(mix.roarGain, now, 0.3);
    this.rumble.gain.gain.setTargetAtTime(mix.rumbleGain, now, 0.3);
    this.wind.gain.setTargetAtTime(mix.wind, now, 0.3);
    this.master.gain.setTargetAtTime(this.enabled && !state.crashed ? mix.master : 0, now, 0.15);
  }
}
