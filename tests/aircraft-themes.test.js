import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, MeshStandardMaterial } from 'three';
import { createAircraft, createCockpit } from '../src/aircraft.js';
import { FLEET } from '../src/fleet.js';
import { disposeObject } from '../src/helicopter.js';
import { createAircraftPaint } from '../src/aircraft-paint.js';
import { AIRCRAFT_THEME_PRESETS, PAINT_ROLES, factoryAircraftTheme, normalizePaintHex, normalizeAircraftTheme } from '../src/aircraft-themes.js';
import { AIRCRAFT_THEME_STORAGE_PREFIX, AIRCRAFT_THEME_STORAGE_VERSION, loadAircraftTheme, saveAircraftTheme, resetAircraftTheme } from '../src/aircraft-theme-storage.js';

const custom = () => ({ preset: 'custom', colors: { body: '#8bafc3', accent: '#34215f', stripe: '#e09c42' } });
const materialState = m => ({ json: m.toJSON(), color: m.color?.toArray(), vertexColors: m.vertexColors });
const allMaterials = root => {
  const materials = new Set();
  root.traverse(o => { for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) materials.add(m); });
  return [...materials];
};
const graphState = root => {
  const nodes = [];
  root.traverse(o => nodes.push({ id: o.uuid, geometry: o.geometry, material: o.material, position: o.position.toArray(), quaternion: o.quaternion.toArray(), scale: o.scale.toArray(), visible: o.visible }));
  return nodes;
};

test('presets and complete custom hex colors normalize to defensive canonical values', () => {
  assert.deepEqual(AIRCRAFT_THEME_PRESETS.map(p => p.id), ['factory', 'alpine-rescue', 'glacier', 'midnight']);
  for (const p of AIRCRAFT_THEME_PRESETS) {
    assert.deepEqual(normalizeAircraftTheme(p.id), { preset: p.id, colors: p.colors });
    assert.deepEqual(normalizeAircraftTheme({ preset: p.id, colors: custom().colors }), { preset: p.id, colors: p.colors });
    if (p.colors) for (const color of Object.values(p.colors)) assert.equal(normalizePaintHex(color), color);
  }
  assert.equal(normalizePaintHex(' #AbC '), '#aabbcc');
  assert.equal(normalizePaintHex('#123DeF'), '#123def');
  for (const value of ['red', 'ffffff', '#12', '#1234', '#12345678', '#ggg', 'rgb(0,0,0)', '', null, 0, {}, []]) assert.equal(normalizePaintHex(value), null);
  const input = { preset: 'custom', colors: { body: '#AbC', accent: '#123DeF', stripe: ' #00f ' }, extra: true };
  const theme = normalizeAircraftTheme(input);
  assert.deepEqual(theme, { preset: 'custom', colors: { body: '#aabbcc', accent: '#123def', stripe: '#0000ff' } });
  input.colors.body = '#000'; assert.equal(theme.colors.body, '#aabbcc');
  theme.colors.accent = '#000'; assert.equal(AIRCRAFT_THEME_PRESETS[1].colors.accent, '#d5442e');
  for (const raw of [null, undefined, 1, [], {}, 'old-preset', { preset: 'custom' }, { preset: 'custom', colors: { body: '#fff' } }, { ...custom(), colors: { ...custom().colors, stripe: 'red' } }]) assert.deepEqual(normalizeAircraftTheme(raw), factoryAircraftTheme());
});

test('paint bindings reject duplicate materials rather than allowing roles to overwrite one another', () => {
  const m = new MeshStandardMaterial();
  try {
    assert.throws(() => createAircraftPaint({ body: [m], accent: [m] }), /repeated/);
    assert.throws(() => createAircraftPaint({ body: [null] }), /Invalid/);
  } finally { m.dispose(); }
});

for (const [id, type] of Object.entries(FLEET)) {
  test(`${id}: explicit fleet paint covers hull and moving surfaces, preserves details and restores Factory exactly`, () => {
    const a = createAircraft(id), b = createAircraft(id), cockpit = createCockpit(id);
    try {
      const { paint } = a;
      assert.deepEqual(paint.roles, id === 'fighter' || id === 'helicopter' ? ['body', 'accent'] : PAINT_ROLES);
      assert.ok(Object.isFrozen(paint.roles) && Object.isFrozen(paint.materials));
      const bound = new Set(Object.values(paint.materials).flat()), used = new Set(allMaterials(a.group));
      for (const [role, list] of Object.entries(paint.materials)) {
        assert.ok(Object.isFrozen(list));
        for (const m of list) assert.ok(used.has(m), `${role} material reaches rendered geometry`);
        let vertices = 0;
        a.group.traverse(o => { if (list.includes(o.material)) vertices += o.geometry.attributes.position.count; });
        assert.ok(vertices > (role === 'body' ? 500 : 30), `${role} covers meaningful airframe geometry (${vertices} vertices)`);
      }
      for (const [name, m] of Object.entries(a.materials)) {
        if (/^(glass|metal|rubber|wood|leather|dark|ink|signal|tips|strut|nozzle|burnt|titanium|heatTint|ivory|seam|storeBand)$/.test(name)) assert.ok(!bound.has(m), `${name} is protected`);
      }
      // Blade surfaces and their safety tips never belong to paint, even when they originally shared a color.
      let blades = 0;
      a.group.traverse(o => {
        if (!o.isMesh) return;
        let rotor = false;
        for (let p = o.parent; p && p !== a.group; p = p.parent) rotor ||= /rotor|propeller/i.test(p.name);
        if (rotor && (o.geometry.type === 'BoxGeometry' || /blade/i.test(o.name))) {
          blades++;
          assert.ok(!bound.has(o.material), 'blades and tips have independent materials');
        }
      });
      if (type.flight.rotorcraft || ['piston', 'turboprop', 'aeroprop'].includes(type.engine) || ['canard', 'motorglider', 'racer', 'pushpull'].includes(id)) assert.ok(blades > 0, 'protected rotor geometry was exercised');

      const originals = new Map(allMaterials(a.group).map(m => [m, materialState(m)]));
      const other = allMaterials(b.group).map(materialState), deck = allMaterials(cockpit).map(materialState);
      const graph = graphState(a.group);
      for (const preset of ['alpine-rescue', 'glacier', 'midnight', custom()]) {
        const theme = paint.apply(preset);
        for (const [role, list] of Object.entries(paint.materials)) for (const m of list) {
          assert.deepEqual(m.color.toArray(), new Color(theme.colors[role]).toArray());
          assert.equal(m.vertexColors, false, 'old fighter counter-shading does not muddy chosen colors');
        }
        for (const [m, original] of originals) if (!bound.has(m)) assert.deepEqual(materialState(m), original, 'protected detail unchanged');
        assert.deepEqual(graphState(a.group), graph, 'no geometry, material assignment, transform or visibility change');
        assert.deepEqual(allMaterials(b.group).map(materialState), other, 'another instance keeps its own paint');
        assert.deepEqual(allMaterials(cockpit).map(materialState), deck, 'cockpit appearance is independent');
        assert.deepEqual(paint.restore(), factoryAircraftTheme());
        for (const [m, original] of originals) assert.deepEqual(materialState(m), original, 'Factory restores exact original properties and color components');
      }
      const input = custom(), returned = paint.apply(input);
      input.colors.body = '#000000'; returned.colors.body = '#ffffff';
      const read = paint.theme; read.colors.body = '#000000';
      assert.deepEqual(paint.theme, custom(), 'theme input, returned state and getters cannot leak changes');

      if (!type.flight.rotorcraft) {
        const state = { flightTime: 0, gearDown: true, flaps: 0, speed: type.flight.cruiseSpeed, bank: 0, pitch: 0, heading: 0, bodyRates: { roll: 0, pitch: 0, yaw: 0 } };
        a.update(0.1, 0.75, state);
        const before = new Map(); a.group.traverse(o => { if (o.isGroup) before.set(o, o.quaternion.clone()); });
        a.update(0.1, 0.75, { ...state, flaps: 2, bank: 0.1, pitch: 0.1, heading: 0.1, bodyRates: { roll: 0.4, pitch: 0.3, yaw: 0.2 } });
        const moving = [...before].filter(([o, q]) => !q.equals(o.quaternion) && !/rotor|propeller|fan/i.test(o.name)).map(([o]) => o);
        assert.ok(moving.length >= 3, 'actual flaps, ailerons, elevator and rudder pivots were exercised');
        for (const pivot of moving) pivot.traverse(o => { if (o.isMesh) assert.ok(bound.has(o.material), 'moving painted surfaces are bound too'); });
        const animated = graphState(a.group), surfaces = a.surfaces, gear = a.gearPosition;
        paint.apply('glacier'); paint.restore();
        assert.deepEqual(graphState(a.group), animated, 'live changes never restart animations or move the aircraft');
        assert.deepEqual(a.surfaces, surfaces); assert.equal(a.gearPosition, gear);
      }
      a.setCockpit(true); paint.apply('midnight'); paint.restore(); assert.equal(a.group.visible, false);
      a.setCockpit(false); assert.equal(a.group.visible, true);
      const disposed = new Set();
      for (const m of allMaterials(a.group)) m.addEventListener('dispose', () => disposed.add(m));
      a.dispose();
      for (const m of used) assert.ok(disposed.has(m), 'original and isolated materials remain owned by model disposal');
      assert.deepEqual(allMaterials(b.group).map(materialState), other, 'disposing one instance leaves another untouched');
    } finally { b.dispose(); disposeObject(cockpit); }
  });
}

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}
const storageKey = id => `${AIRCRAFT_THEME_STORAGE_PREFIX}.${id}`;

test('themes survive reloads and aircraft switching; reset touches only the selected aircraft', () => {
  const storage = new MemoryStorage();
  storage.setItem('aeronaut-settings', 'unrelated settings'); storage.setItem('flight-log', 'unrelated log');
  for (const [index, id] of Object.keys(FLEET).entries()) {
    const theme = index % 2 ? custom() : normalizeAircraftTheme('glacier');
    assert.equal(saveAircraftTheme(id, theme, storage), true);
    const reloaded = new MemoryStorage(); reloaded.data = new Map(storage.data);
    const a = createAircraft(id);
    try { assert.deepEqual(a.paint.apply(loadAircraftTheme(id, reloaded)), theme); } finally { a.dispose(); }
  }
  const before = new Map(storage.data);
  assert.equal(resetAircraftTheme('fighter', storage), true);
  assert.deepEqual(loadAircraftTheme('fighter', storage), factoryAircraftTheme());
  before.delete(storageKey('fighter')); assert.deepEqual(storage.data, before);
  assert.equal(storage.getItem('aeronaut-settings'), 'unrelated settings');
  assert.equal(saveAircraftTheme('jet', 'factory', storage), true);
  assert.deepEqual(loadAircraftTheme('jet', storage), factoryAircraftTheme());
  const input = custom(); saveAircraftTheme('jet', input, storage); input.colors.body = '#000000';
  const read = loadAircraftTheme('jet', storage); read.colors.body = '#000000';
  assert.deepEqual(loadAircraftTheme('jet', storage), custom());
});

test('missing, invalid, old or corrupt data falls back to Factory without touching other storage', () => {
  const storage = new MemoryStorage();
  const valid = JSON.stringify({ version: AIRCRAFT_THEME_STORAGE_VERSION, theme: custom() });
  for (const raw of [null, '', '{oops', 'null', '[]', '42', JSON.stringify(custom()), JSON.stringify({ version: 0, theme: custom() }), JSON.stringify({ version: 99, theme: custom() }), JSON.stringify({ version: '1', theme: custom() }), JSON.stringify({ version: 1, theme: { preset: 'old-preset' } }), JSON.stringify({ version: 1, theme: { ...custom(), colors: { body: '#fff' } } })]) {
    storage.data.clear(); if (raw !== null) storage.setItem(storageKey('jet'), raw);
    storage.setItem(storageKey('trainer'), valid);
    const before = new Map(storage.data);
    assert.deepEqual(loadAircraftTheme('jet', storage), factoryAircraftTheme());
    assert.deepEqual(storage.data, before, 'reads do not rewrite or remove stored choices');
    assert.deepEqual(loadAircraftTheme('trainer', storage), custom());
  }
  for (const id of ['unknown', '__proto__', 'constructor', null, {}, 42]) {
    const before = new Map(storage.data);
    assert.deepEqual(loadAircraftTheme(id, storage), factoryAircraftTheme());
    assert.equal(saveAircraftTheme(id, custom(), storage), false); assert.equal(resetAircraftTheme(id, storage), false);
    assert.deepEqual(storage.data, before);
  }
});

test('full, blocked or absent browser storage never throws or breaks live paint', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
  for (const storage of [null, blocked]) {
    assert.deepEqual(loadAircraftTheme('jet', storage), factoryAircraftTheme());
    assert.equal(saveAircraftTheme('jet', custom(), storage), false); assert.equal(resetAircraftTheme('jet', storage), false);
  }
  const full = new MemoryStorage(); saveAircraftTheme('trainer', 'midnight', full);
  full.setItem = () => { throw new Error('quota exceeded'); };
  assert.equal(saveAircraftTheme('trainer', custom(), full), false);
  assert.equal(loadAircraftTheme('trainer', full).preset, 'midnight', 'a failed write keeps the previous valid choice');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  const a = createAircraft('jet');
  try {
    assert.deepEqual(loadAircraftTheme('jet'), factoryAircraftTheme());
    a.paint.apply(custom()); assert.equal(saveAircraftTheme('jet', a.paint.theme), false);
    assert.deepEqual(a.paint.theme, custom(), 'persistence failure leaves the selected live theme usable');
    assert.equal(resetAircraftTheme('jet'), false); a.paint.restore();
    assert.deepEqual(a.paint.theme, factoryAircraftTheme());
  } finally {
    a.dispose();
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;
  }
});
