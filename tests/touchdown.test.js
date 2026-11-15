import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController, FlightAudio } from '../src/flight.js';
import { FLEET } from '../src/fleet.js';
import { airportById } from '../src/airports.js';
import { LandingMission } from '../src/landing-mission.js';
import { groundHeight } from '../src/world.js';
import { TouchdownDetector, touchdownResponse, touchdownClass, touchdownOutputs, impulseShape,
  FIRM_FROM, MIN_GAIN, MAX_GAIN, IMPULSE_LIMITS, REARM_AIRBORNE, STALE_AFTER } from '../src/touchdown.js';
import { landMission, circuits } from '../scripts/measure-touchdown.js';

const TYPES = Object.values(FLEET);
const dt = 1 / 60;

test('every type has a contact class: helicopter skids or wheels, fixed-wing wheels by size', () => {
  for (const type of TYPES) assert.ok(touchdownClass(type), type.id);
  assert.equal(touchdownClass(FLEET.helicopter), 'skids');
  assert.equal(touchdownClass(FLEET.transport), 'rotorWheels');
  assert.equal(touchdownClass(FLEET.tandem), 'rotorWheels');
  assert.equal(touchdownClass(FLEET.trainer), 'light');
  assert.equal(touchdownClass(FLEET.airliner), 'heavy');
  assert.equal(touchdownClass(FLEET.widebody), 'heavy');
});

test('severity follows actual sink against the type limit, within documented gain and impulse bounds', () => {
  for (const type of TYPES) {
    const max = type.flight.maxTouchdownSink;
    let previous = null;
    for (const share of [0, 0.1, 0.3, 0.49, 0.5, 0.8, 0.99, 1, 3]) {
      const r = touchdownResponse({ sink: max * share, speed: type.landing.speed }, type);
      assert.ok(r.severity >= 0 && r.severity <= 1, `${type.id} ${share}`);
      assert.equal(r.level, Math.min(share, 1) >= FIRM_FROM ? 'firm' : 'gentle', `${type.id} ${share}`);
      assert.ok(r.sound.gain >= MIN_GAIN && r.sound.gain <= MAX_GAIN, `${type.id} gain ${r.sound.gain}`);
      assert.ok(r.sound.gain < 0.22, 'always quieter than the stall horn');
      assert.ok(r.sound.rollGain < r.sound.gain);
      assert.ok(Math.max(r.sound.decay, r.sound.rollDuration) <= 0.55, `${type.id}: short`);
      assert.ok(r.impulse.cockpit > 0 && r.impulse.cockpit <= IMPULSE_LIMITS.cockpit);
      assert.ok(r.impulse.outside > 0 && r.impulse.outside <= IMPULSE_LIMITS.outside * Math.min(3, type.cameraScale ?? 1));
      assert.ok(r.impulse.duration >= IMPULSE_LIMITS.minDuration && r.impulse.duration <= IMPULSE_LIMITS.maxDuration);
      if (previous) {
        assert.ok(r.sound.gain >= previous.sound.gain && r.impulse.cockpit >= previous.impulse.cockpit, `${type.id}: monotonic`);
      }
      previous = r;
    }
    const gentle = touchdownResponse({ sink: max * 0.2, speed: 30 }, type), firm = touchdownResponse({ sink: max * 0.85, speed: 30 }, type);
    assert.ok(firm.sound.gain > gentle.sound.gain * 1.6, `${type.id}: firm is clearly louder`);
    assert.ok(firm.impulse.cockpit > gentle.impulse.cockpit * 1.6, `${type.id}: firm settles further`);
  }
  // Heavier airframes sit lower; garbage telemetry is a gentle, bounded response.
  const sink = { sink: 1.5, speed: 40 };
  assert.ok(touchdownResponse(sink, FLEET.airliner).sound.thumpFrom < touchdownResponse(sink, FLEET.trainer).sound.thumpFrom);
  const odd = touchdownResponse({ sink: NaN, speed: -5 }, FLEET.trainer);
  assert.equal(odd.severity, 0); assert.equal(odd.level, 'gentle'); assert.equal(odd.sound.gain, MIN_GAIN);
});

test('the camera impulse is a bounded dip and rebound that ends exactly at rest', () => {
  for (const duration of [IMPULSE_LIMITS.minDuration, IMPULSE_LIMITS.maxDuration]) {
    let min = 0, max = 0;
    for (let t = -0.1; t < duration + 0.1; t += 0.001) {
      const v = impulseShape(t, duration);
      assert.ok(Math.abs(v) <= 1);
      min = Math.min(min, v); max = Math.max(max, v);
    }
    assert.ok(min < -0.4, 'dips down first');
    assert.ok(max > 0 && max < -min, 'smaller rebound');
    assert.ok(impulseShape(duration * 0.05, duration) < 0);
    assert.equal(impulseShape(0, duration), 0);
    assert.equal(impulseShape(duration, duration), 0);
    assert.ok(Math.abs(impulseShape(duration - 0.001, duration)) < 1e-4, 'arrives at rest without a jump');
  }
  assert.equal(impulseShape(0.1, 0), 0);
  assert.equal(impulseShape(NaN, 0.3), 0);
});

test('real gentle and firm landings each trigger once, with the matching level, without changing the mission', () => {
  for (const [id, airport] of [['trainer', 'alpine-field'], ['airliner', 'orvane-regional'], ['helicopter', 'alpine-field'], ['transport', 'alpine-field']]) {
    const field = airportById(airport);
    for (const [share, level] of [[0.25, 'gentle'], [0.8, 'firm']]) {
      const r = landMission(id, field, share);
      assert.equal(r.mission.status, 'success', `${id} ${level}: ${r.mission.reason}`);
      assert.equal(r.events.length, 1, `${id} ${level}: exactly one response for one contact`);
      const [e] = r.events;
      assert.equal(e.level, level, `${id}: ${e.severity.toFixed(2)}`);
      assert.equal(e.record, r.mission.touchdown && r.state.touchdown, 'the response reads the telemetry the flight model recorded');
      assert.ok(Math.abs(e.sink - r.mission.touchdown.sink) < 1e-12, 'the mission scored the same sink');
    }
  }
});

test('the detector is read-only: flying with it is identical to flying without it', () => {
  const field = airportById('alpine-field');
  const fly = withDetector => {
    const flight = new FlightController(groundHeight, 'trainer'), mission = new LandingMission(field), s = flight.state;
    mission.start(flight);
    const detector = new TouchdownDetector(s);
    for (let i = 0; i < 40 * 60 && mission.active; i++) {
      flight.update(dt, { pitch: s.position.y - field.elevation < 12 ? 0.2 : 0, throttle: s.grounded ? -1 : 0 });
      mission.update(dt, s);
      if (withDetector) detector.update(s);
    }
    return JSON.stringify({ ...s, mission: mission.snapshot() });
  };
  assert.equal(fly(true), fly(false));
});

test('sustained contact, stationary runway starts and stale telemetry never trigger', () => {
  for (const id of ['trainer', 'helicopter', 'tandem']) {
    const flight = new FlightController(() => 78, id), type = flight.type;
    const s = flight.runwayStart(0, 78 + (type.flight.rotorcraft ? type.flight.groundClearance : type.groundClearance ?? 2.8), 0);
    const detector = new TouchdownDetector(s);
    for (let i = 0; i < 20 * 60; i++) { flight.update(dt, { brake: 1 }); assert.equal(detector.update(s), null, `${id}: parked on the runway`); }
    assert.equal(s.grounded, true);
  }
  // A record left over from long ago, appearing only now, is stale.
  const flight = new FlightController(() => 78, 'trainer'), s = flight.state, detector = new TouchdownDetector(s);
  for (let i = 0; i < 60; i++) { flight.update(dt); detector.update(s); }
  s.grounded = true;
  s.touchdown = { sink: 2, speed: 40, time: s.flightTime - STALE_AFTER - 0.1 };
  assert.equal(detector.update(s), null);
  // A future-dated record is never trusted either.
  s.touchdown = { sink: 2, speed: 40, time: s.flightTime + 1 };
  assert.equal(detector.update(s), null);
});

test('consecutive landings in one flight each give a fresh response, gentle then firm', () => {
  for (const id of ['trainer', 'jet', 'helicopter', 'tandem']) {
    const r = circuits(id, [0.25, 0.8]);
    assert.equal(r.state.crashed, false, id);
    assert.equal(r.landed, 2, id);
    assert.deepEqual(r.events.map(e => e.level), ['gentle', 'firm'], `${id}: one per landing`);
    assert.ok(r.groundedFrames > 300, `${id}: long sustained contact stayed silent`);
    assert.notEqual(r.events[0].record, r.events[1].record);
  }
});

test('a crash, a reset, a mission retry and an aircraft change never trigger', () => {
  // Crash: a fast steep descent into the ground records telemetry but gives no feedback.
  const crash = new FlightController(() => 78, 'trainer'), cs = crash.state, detector = new TouchdownDetector(cs);
  cs.position.y = 100; cs.pitch = -0.4;
  for (let i = 0; i < 30 * 60 && !cs.crashed; i++) { crash.update(dt, { pitch: -1 }); assert.equal(detector.update(cs), null); }
  assert.equal(cs.crashed, true); assert.ok(cs.touchdown);
  // Touch down, then reset or retry inside the same frame as other state changes: the next frames stay quiet.
  const field = airportById('alpine-field');
  for (const after of ['reset', 'retry', 'aircraft']) {
    const r = landMission('trainer', field, 0.3), flight = new FlightController(groundHeight, 'trainer');
    Object.assign(flight.state, r.state);
    const d = new TouchdownDetector(r.state);
    if (after === 'reset') flight.reset();
    else if (after === 'retry') new LandingMission(field).start(flight);
    else flight.setAircraft('helicopter');
    for (let i = 0; i < 120; i++) { flight.update(dt); assert.equal(d.update(flight.state), null, after); }
  }
});

test('a skim that re-touches within the re-arm time is not a second landing; a real lift-off re-arms', () => {
  // Synthetic frames in flight time, as a helicopter skimming the ground produces them.
  const state = { aircraft: 'helicopter', flightTime: 0, grounded: false, crashed: false, touchdown: null };
  const detector = new TouchdownDetector(state), frames = [];
  const fly = (seconds, grounded) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      state.flightTime += dt;
      if (grounded && !state.grounded) state.touchdown = { sink: 0.6, speed: 0, time: state.flightTime };
      state.grounded = grounded;
      frames.push(detector.update(state));
    }
    return frames.splice(0).filter(Boolean).length;
  };
  assert.equal(fly(1, false), 0);
  assert.equal(fly(0.5, true), 1, 'first contact');
  assert.equal(fly(REARM_AIRBORNE / 2, false), 0);
  assert.equal(fly(0.5, true), 0, 'skim contact after a brief hop');
  assert.equal(fly(REARM_AIRBORNE + 0.1, false), 0);
  assert.equal(fly(0.5, true), 1, 'a real lift-off and landing');
});

test('paused, dialog and hidden discard the event; mute or locked audio drop only sound; reduced motion only the impulse', () => {
  assert.deepEqual(touchdownOutputs({ soundOn: true, audioRunning: true }), { sound: true, motion: true });
  for (const key of ['paused', 'dialogOpen', 'hidden']) assert.deepEqual(touchdownOutputs({ soundOn: true, audioRunning: true, [key]: true }), { sound: false, motion: false }, key);
  assert.deepEqual(touchdownOutputs({ soundOn: false, audioRunning: true }), { sound: false, motion: true }, 'muted');
  assert.deepEqual(touchdownOutputs({ soundOn: true, audioRunning: false }), { sound: false, motion: true }, 'not unlocked');
  assert.deepEqual(touchdownOutputs({ soundOn: true, audioRunning: true, reducedMotion: true }), { sound: true, motion: false }, 'reduced motion keeps sound');
  assert.deepEqual(touchdownOutputs(), { sound: false, motion: true });
});

test('FlightAudio plays one short synthesized contact on the existing context, never queued, under the warnings', async t => {
  const param = () => ({ value: 0, events: [], setValueAtTime(v, at) { this.events.push(['set', v, at]); }, linearRampToValueAtTime(v, at) { this.events.push(['linear', v, at]); },
    exponentialRampToValueAtTime(v, at) { this.events.push(['exp', v, at]); }, setTargetAtTime(v) { this.events.push(['target', v]); } });
  const node = () => ({ connections: [], connect(target) { this.connections.push(target); return target; }, disconnect() { this.disconnected = true; } });
  const made = { contexts: 0, oscillators: [], sources: [] };
  class AudioContext {
    constructor() { made.contexts++; }
    state = 'suspended'; currentTime = 2; sampleRate = 100; destination = node();
    createGain() { return { ...node(), gain: param() }; }
    createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
    createBuffer() { return { getChannelData: () => new Float32Array(200) }; }
    createBufferSource() { const s = { ...node(), starts: [], stops: [], start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); } }; made.sources.push(s); return s; }
    createOscillator() { const o = { ...node(), type: '', frequency: param(), starts: [], stops: [], start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); } }; made.oscillators.push(o); return o; }
    async resume() { this.state = 'running'; }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { value: AudioContext, configurable: true });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'AudioContext', original); else delete globalThis.AudioContext; });

  const firm = touchdownResponse({ sink: 2.6, speed: 30 }, FLEET.trainer).sound;
  const audio = new FlightAudio();
  assert.equal(audio.playTouchdown(firm), false, 'before the audio is unlocked');
  await audio.start();
  assert.equal(made.contexts, 1);
  audio.context.state = 'suspended';
  assert.equal(audio.playTouchdown(firm), false, 'a suspended context drops it');
  audio.context.state = 'running';
  const voices = made.oscillators.length;
  assert.equal(audio.playTouchdown(firm), true);
  assert.equal(made.contexts, 1, 'no second AudioContext');
  const thump = made.oscillators.at(-1), noise = made.sources.at(-1);
  assert.equal(made.oscillators.length, voices + 1);
  assert.equal(thump.type, 'sine');
  assert.ok(thump.stops[0] - thump.starts[0] <= 0.6 && noise.stops[0] - noise.starts[0] <= 0.6, 'short');
  assert.equal(noise.buffer, audio.noiseBuffer, 'reuses the shared synthesized noise; no loaded asset');
  const bus = audio.touchdownVoice.bus;
  assert.deepEqual(bus.connections, [audio.output], 'after the volume control, independent of engine level');
  assert.equal(bus.gain.value, 1);
  const peak = Math.max(...thump.connections[0].gain.events.map(e => e[1]));
  assert.ok(peak <= MAX_GAIN && peak === firm.gain);

  // A second contact replaces the first; a warning halves it; muting stops it and refuses further contacts.
  audio.stallActive = true;
  assert.equal(audio.playTouchdown(firm), true);
  assert.ok(thump.stops.length >= 2, 'the earlier voice was stopped');
  assert.equal(audio.touchdownVoice.bus.gain.value, 0.5, 'stall horn stays clear');
  audio.stallActive = false;
  audio.update({ aircraft: 'jet', throttle: 0.1, spool: 0.1, speed: 60, crashed: false }, true);
  assert.equal(audio.gearWarningOn, true);
  audio.playTouchdown(firm);
  assert.equal(audio.touchdownVoice.bus.gain.value, 0.5, 'gear horn stays clear');
  const sounding = made.oscillators.at(-1);
  audio.toggle();
  assert.equal(audio.touchdownVoice, null);
  assert.ok(sounding.stops.length >= 2, 'muting stops a sounding contact');
  const count = made.oscillators.length;
  assert.equal(audio.playTouchdown(firm), false, 'muted: discarded, not deferred');
  await audio.start();
  assert.equal(made.oscillators.length, count, 'unmuting plays nothing that happened while muted');
});
