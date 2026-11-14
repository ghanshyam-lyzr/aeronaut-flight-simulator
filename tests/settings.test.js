import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_KEY, SETTINGS_VERSION, CUSTOMIZATION_KEYS, defaultSettings, normalizeSettings, resetSettings, loadSettings, saveSettings, bounded, RESPONSE } from '../src/settings.js';

class MemoryStorage {
  constructor(entries = {}) { this.data = new Map(Object.entries(entries)); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
}
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };

test('defaults keep the original gentle flight, chase view and silent start', () => {
  const d = defaultSettings();
  assert.equal(d.version, SETTINGS_VERSION);
  assert.deepEqual(d.response, { pitch: 1, roll: 1, yaw: 1, throttle: 1 });
  assert.equal(d.camera, 'chase'); assert.equal(d.chaseDistance, 1);
  assert.equal(d.muted, true); assert.equal(d.volume, 1);
  for (const key of ['showHud', 'showInstruments', 'showHints', 'showCrosshair', 'showMap']) assert.equal(d[key], true);
  assert.deepEqual(normalizeSettings(undefined), d);
  d.response.pitch = 2;
  assert.equal(defaultSettings().response.pitch, 1, 'defaults are never shared objects');
});

test('version-1 settings migrate with every earlier choice kept', () => {
  const v1 = { quality: 'low', invertPitch: true, mouseSteering: true, showMap: false, weather: 'golden', aircraft: 'fighter', mapFraming: 'world', mapZoom: 6, airport: 'orvane', runway: '09' };
  const s = loadSettings(new MemoryStorage({ [SETTINGS_KEY]: JSON.stringify(v1) }));
  assert.equal(s.version, SETTINGS_VERSION);
  for (const [key, value] of Object.entries(v1)) assert.equal(s[key], value, key);
  assert.deepEqual(s.response, defaultSettings().response);
  assert.equal(s.camera, 'chase'); assert.equal(s.muted, true);
});

test('invalid values fall back per field; numbers are clamped and snapped to their steps', () => {
  const s = normalizeSettings({
    quality: 'ultra', invertPitch: 'yes', mouseSteering: 1, weather: 'storm', aircraft: 'zeppelin', mapFraming: 'spiral', mapZoom: 99,
    response: { pitch: 9, roll: -4, yaw: 'NaN', throttle: '1.3' }, camera: 'drone', chaseDistance: 0.2, volume: 1.7, muted: 'no',
    showHud: null, showInstruments: false, airport: 42, runway: {},
  });
  assert.equal(s.quality, 'high'); assert.equal(s.invertPitch, false); assert.equal(s.mouseSteering, false);
  assert.equal(s.weather, 'clear'); assert.equal(s.aircraft, 'jet'); assert.equal(s.mapFraming, 'route'); assert.equal(s.mapZoom, 9);
  assert.deepEqual(s.response, { pitch: 2, roll: 0.5, yaw: 1, throttle: 1.25 });
  assert.equal(s.camera, 'chase'); assert.equal(s.chaseDistance, 1); assert.equal(s.volume, 1); assert.equal(s.muted, true);
  assert.equal(s.showHud, true); assert.equal(s.showInstruments, false);
  assert.equal('airport' in s, false); assert.equal('runway' in s, false);
  assert.equal(bounded(Infinity, RESPONSE, 1), 1);
  assert.equal(bounded(0.62, RESPONSE, 1), 0.5);
  assert.equal(bounded(1.88, RESPONSE, 1), 2);
  for (const raw of [null, 'text', 42, [], [1, 2]]) assert.deepEqual(normalizeSettings(raw), defaultSettings());
});

test('corrupt or unavailable storage yields defaults and never throws', () => {
  assert.deepEqual(loadSettings(new MemoryStorage({ [SETTINGS_KEY]: '{not json' })), defaultSettings());
  assert.deepEqual(loadSettings(new MemoryStorage({ [SETTINGS_KEY]: 'null' })), defaultSettings());
  assert.deepEqual(loadSettings(throwing), defaultSettings());
  assert.deepEqual(loadSettings(null), defaultSettings());
  assert.equal(saveSettings(defaultSettings(), throwing), false);
  assert.equal(saveSettings(defaultSettings(), null), false);
});

test('saved settings round-trip exactly, and only validated values are written', () => {
  const storage = new MemoryStorage();
  const custom = { ...defaultSettings(), quality: 'medium', response: { pitch: 1.5, roll: 0.75, yaw: 2, throttle: 0.5 }, camera: 'cockpit', chaseDistance: 1.3, volume: 0.45, muted: false, showHints: false, showCrosshair: false, airport: 'serein', runway: '27' };
  assert.equal(saveSettings(custom, storage), true);
  assert.deepEqual(loadSettings(storage), custom);
  saveSettings({ ...custom, volume: 'loud', camera: 'drone' }, storage);
  const stored = JSON.parse(storage.getItem(SETTINGS_KEY));
  assert.equal(stored.volume, 1); assert.equal(stored.camera, 'chase');
});

test('restore defaults resets customization but keeps aircraft, field, runway, weather and map framing', () => {
  const custom = normalizeSettings({ quality: 'low', invertPitch: true, mouseSteering: true, response: { pitch: 2, roll: 2, yaw: 2, throttle: 2 }, camera: 'orbit', chaseDistance: 1.6, volume: 0.2, muted: false, showHud: false, showInstruments: false, showHints: false, showCrosshair: false, showMap: false, aircraft: 'helicopter', airport: 'brume', runway: '18', weather: 'overcast', mapFraming: 'follow', mapZoom: 1 });
  const reset = resetSettings(custom);
  const d = defaultSettings();
  for (const key of CUSTOMIZATION_KEYS) assert.deepEqual(reset[key], d[key], key);
  for (const key of ['aircraft', 'airport', 'runway', 'weather', 'mapFraming', 'mapZoom']) assert.equal(reset[key], custom[key], key);
  assert.equal(custom.response.pitch, 2, 'the current object is not mutated');
});

// A minimal Web Audio stand-in: records connections and gain targets.
class FakeContext {
  constructor() { this.currentTime = 0; this.destination = { name: 'destination' }; this.created = 0; this.resumed = 0; }
  param(value = 0) { return { value, setTargetAtTime(v) { this.value = v; }, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } }; }
  node(extra = {}) { this.created++; const n = { outputs: [], connect(to) { n.outputs.push(to); return to; }, disconnect() {}, start() {}, stop() {}, ...extra }; return n; }
  createGain() { return this.node({ gain: this.param(1) }); }
  createOscillator() { return this.node({ frequency: this.param(), type: 'sine' }); }
  createBiquadFilter() { return this.node({ frequency: this.param(), Q: this.param() }); }
  createBufferSource() { return this.node({ loop: false }); }
  createBuffer(_c, length) { return { getChannelData: () => new Float32Array(length) }; }
  async resume() { this.resumed++; }
}

test('master volume sits after every engine, wind and warning voice, on one audio context', async () => {
  const { FlightAudio } = await import('../src/flight.js');
  const contexts = [];
  globalThis.AudioContext = class extends FakeContext { constructor() { super(); contexts.push(this); } };
  try {
    const audio = new FlightAudio();
    audio.setVolume(0.5); // Before the gesture unlock: remembered, nothing created.
    assert.equal(contexts.length, 0);
    assert.equal(await audio.start(), true);
    const ctx = contexts[0];
    assert.deepEqual(audio.master.outputs, [audio.output]);
    assert.deepEqual(audio.output.outputs, [ctx.destination]);
    assert.equal(audio.output.gain.value, 0.25);
    for (const bus of [audio.jetBus, audio.fighterBus, audio.helicopterBus, audio.propBus, audio.gearHorn, audio.wind]) assert.deepEqual(bus.outputs, [audio.master]);
    audio.setVolume(0); assert.equal(audio.output.gain.value, 0);
    audio.setVolume(7); assert.equal(audio.output.gain.value, 1, 'bounded to the original mix');
    audio.setVolume(NaN); assert.equal(audio.output.gain.value, 1);
    audio.soundStallHorn();
    assert.ok(audio.stallHorn.outputs[0].outputs.includes(audio.master), 'the stall horn joins the master bus');
    audio.toggle(); assert.equal(audio.enabled, false);
    await audio.start(); await audio.start();
    assert.equal(contexts.length, 1, 'muting and unmuting reuse the single context');
    assert.equal(audio.enabled, true);
  } finally { delete globalThis.AudioContext; }
});
