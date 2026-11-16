import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController } from '../src/flight.js';
import { FlightInputs } from '../src/controls.js';
import { groundVelocity, groundTrack } from '../src/flight-path.js';
import { LandingMission } from '../src/landing-mission.js';
import { WORLD, WATER_LEVEL, LANDMARKS, inWorld } from '../src/regions.js';
import { AIRPORTS, ALPINE_FIELD, airportById } from '../src/airports.js';
import { AirportSelection, describeField, resolveAirport } from '../src/airport-selection.js';
import { groundHeight } from '../src/terrain.js';
import {
  METRES_PER_NM, NAVIGATION, navigationDestination, bearingDistance, relativeBearing, degrees, formatNM, formatEte, navigationReadout,
  ZOOM_SPANS, createView, clampCentre, routeZoom, frameView, zoomFrom, inView, edgePointer, scaleBar,
  TILE_PIXELS, MAX_TILE_LEVEL, tileLevel, tilesFor, tile, parentTile, tileMetres, rasterTile, terrainColour, mapPlaces, mapAirports, placeLabels,
} from '../src/navigation.js';

const close = (a, b, tolerance = 1e-9) => Math.abs(a - b) < tolerance;
const heightAt = (x, z) => Math.max(WATER_LEVEL, groundHeight(x, z)); // world.js heightAt
const DEG = Math.PI / 180;

test('bearings are clockwise from north on the world axes (+x east, +z south)', () => {
  const o = { x: 0, z: 0 };
  assert.ok(close(bearingDistance(o, { x: 0, z: -1000 }).bearing, 0));
  assert.ok(close(bearingDistance(o, { x: 1000, z: 0 }).bearing, Math.PI / 2));
  assert.ok(close(bearingDistance(o, { x: 0, z: 1000 }).bearing, Math.PI));
  assert.ok(close(bearingDistance(o, { x: -1000, z: 0 }).bearing, Math.PI * 1.5));
  assert.ok(close(bearingDistance(o, { x: 300, z: -400 }).distance, 500));
  assert.equal(degrees(0), '360');
  assert.equal(degrees(Math.PI / 2), '090');
  assert.equal(degrees(-5 * DEG), '355');
  assert.ok(close(relativeBearing(10 * DEG, 350 * DEG), 20 * DEG), 'target 20° right across north');
  assert.ok(close(relativeBearing(350 * DEG, 10 * DEG), -20 * DEG), 'target 20° left across north');
});

test('the bearing matches the heading the flight model flies', () => {
  for (const headingDeg of [0, 47, 138, 270]) {
    const flight = new FlightController(), inputs = new FlightInputs(0);
    flight.reset();
    const s = flight.state, heading = headingDeg * DEG;
    Object.assign(s, { heading, autopilot: true });
    flight.holdHeading = heading;
    const start = { x: s.position.x, z: s.position.z };
    for (let frame = 1; frame <= 600; frame++) inputs.advance(frame / 120, (step, c) => flight.update(step, c));
    const { bearing } = bearingDistance(start, s.position);
    assert.ok(Math.abs(relativeBearing(bearing, heading)) < 2 * DEG, `${headingDeg}°: track ${bearing / DEG}`);
  }
});

test('distance and time en route read in accurate units', () => {
  assert.equal(formatNM(METRES_PER_NM * 12.44), '12.4 NM');
  assert.equal(formatNM(0), '0.0 NM');
  assert.equal(formatNM(METRES_PER_NM * 140.2), '140 NM');
  assert.equal(formatEte(6000, 100), '1 min');
  assert.equal(formatEte(30000, 100), '5 min');
  assert.equal(formatEte(1e6, 100), '2 h 47');
  assert.equal(formatEte(5000, 0), '', 'no time en route when parked');
  const orvane = airportById('orvane-regional');
  const r = navigationReadout({ position: { x: ALPINE_FIELD.x, z: ALPINE_FIELD.z }, heading: 0, groundVelocity: { x: 0, z: -100 } }, orvane);
  const dx = orvane.x - ALPINE_FIELD.x, dz = orvane.z - ALPINE_FIELD.z;
  assert.ok(close(r.distance, Math.hypot(dx, dz)));
  assert.equal(r.bearingText, String(Math.round(Math.atan2(dx, -dz) / DEG)).padStart(3, '0'));
  assert.equal(r.distanceText, `${(Math.hypot(dx, dz) / METRES_PER_NM).toFixed(1)} NM`);
});

test('the destination is the mission field while a mission runs, else the selected field', () => {
  const selection = new AirportSelection('serein-lakeside');
  const state = mission => ({ selected: selection.snapshot(), mission });
  assert.equal(navigationDestination(state(null)).id, 'serein-lakeside');
  assert.equal(navigationDestination(state(null)).mission, false);
  // A mission at Orvane runway 32, then the pilot picks another field: navigation stays with the mission.
  const field = resolveAirport('orvane-regional', '32').field;
  selection.select('verdance-meadow');
  const d = navigationDestination(state({ ...describeField(field), status: 'approach' }));
  assert.equal(d.id, 'orvane-regional'); assert.equal(d.runway, '32'); assert.equal(d.mission, true);
  assert.ok(close(d.heading, field.heading)); assert.deepEqual(d.threshold, field.runways[0].threshold);
  // Cancelled: back to the selection.
  assert.equal(navigationDestination(state(null)).id, 'verdance-meadow');
  assert.equal(navigationDestination(null), null);
});

// Navigation only receives the flight-path contract's ground velocity. No helper rebuilds it from airspeed,
// heading or wind; input-driven examples below also check it against actual horizontal displacement.
const north = { x: 0, z: -10000 };
const nav = (v, destination = north, heading = 0, position = { x: 0, z: 0 }) =>
  navigationReadout({ position, heading, groundVelocity: v }, destination);
const flightNav = (flight, destination = north) => navigationReadout({ position: flight.state.position,
  heading: flight.state.heading, groundVelocity: groundVelocity(flight.state, flight.type) }, destination);

test('calm, headwind, tailwind and crosswind use horizontal travel and closing speed, not nose or airspeed', () => {
  const calm = nav({ x: 0, y: 70, z: -100 }), head = nav({ x: 0, z: -80 }), tail = nav({ x: 0, z: -120 });
  const cross = nav({ x: 40, y: -70, z: -100 });
  assert.equal(calm.groundSpeed, 100, 'vertical travel is excluded');
  assert.equal(calm.groundSpeedText, '194 kt'); assert.equal(calm.trackText, '360°');
  assert.equal(calm.eteSeconds, 100); assert.equal(head.eteSeconds, 125); assert.ok(close(tail.eteSeconds, 10000 / 120));
  assert.ok(cross.groundSpeed > calm.groundSpeed); assert.ok(cross.track > 0);
  assert.equal(cross.closingSpeed, 100); assert.equal(cross.eteSeconds, calm.eteSeconds, 'crosswind adds speed without adding progress north');
  const copy = { position: { x: 0, z: 0 }, heading: Math.PI, speed: 999, airspeed: 999, groundVelocity: { x: 0, z: -100 } };
  const before = structuredClone(copy), result = navigationReadout(copy, north);
  assert.equal(result.eteSeconds, calm.eteSeconds, 'neither nose direction nor airspeed drives the estimate');
  assert.deepEqual(copy, before, 'navigation is read-only');
});

test('track wraps through north independently of nose heading and disappears below walking speed', () => {
  for (const angle of [-.2, 0, .2, 359.8, 360, 720]) {
    const a = angle * DEG, r = nav({ x: Math.sin(a) * 10, z: -Math.cos(a) * 10 }, north, 350 * DEG);
    assert.ok(r.track >= 0 && r.track < 2 * Math.PI);
    assert.equal(r.trackText, `${degrees(a)}°`);
    assert.ok(close(r.relative, 10 * DEG), 'bearing arrow still refers to the nose');
  }
  assert.equal(nav({ x: 0, z: 0 }).track, null);
  assert.equal(nav({ x: .1, z: -.2 }).trackText, '—');
  assert.equal(nav({ x: 0, z: -NAVIGATION.trackSpeed }).trackText, '360°');
  assert.equal(nav({ x: 0, z: 0 }).groundSpeedText, '0 kt');
});

test('hover, sideways, slow and outbound progress have no estimate; nearby and unavailable states are explicit', () => {
  for (const v of [{ x: 0, z: 0 }, { x: 0, z: -2 }, { x: 0, z: 40 }, { x: 100, z: 0 }, { x: 100, z: -1 }, { x: 100, z: -50 }]) {
    const r = nav(v);
    assert.equal(r.eteState, 'not-closing', JSON.stringify(v));
    assert.equal(r.ete, ''); assert.equal(r.eteSeconds, null); assert.equal(r.eteReason, 'Not closing');
  }
  assert.equal(nav({ x: 0, z: -2.01 }).eteState, 'estimate', 'slow rotorcraft travel can still make useful progress');
  for (const distance of [0, 1e-12, 99, 100]) {
    const r = nav({ x: 0, z: -30 }, { x: 0, z: -distance });
    assert.equal(r.eteState, 'near-destination'); assert.equal(r.ete, ''); assert.equal(r.eteSeconds, null);
    assert.ok(Number.isFinite(r.closingSpeed));
  }
  assert.equal(nav({ x: 0, z: -30 }, { x: 0, z: -101 }).eteState, 'estimate');
  for (const v of [null, undefined, { x: NaN, z: 0 }, { x: 0, z: Infinity }]) {
    const r = nav(v);
    assert.equal(r.eteState, 'unavailable'); assert.equal(r.groundSpeed, null); assert.equal(r.track, null);
    assert.equal(r.groundSpeedText, '—'); assert.equal(r.eteSeconds, null);
  }
  const noDestination = nav({ x: 20, z: 0 }, null);
  assert.equal(noDestination.eteState, 'no-destination'); assert.equal(noDestination.bearing, null);
  assert.equal(noDestination.eteSeconds, null); assert.equal(noDestination.trackText, '090°');
  assert.equal(formatEte(1000, Infinity), ''); assert.equal(formatEte(Infinity, 30), '');
});

function navigationFlight({ aircraft = 'trainer', direction = 0, wind = 0, seconds = 8, controls = {}, assist = true, rate = 120 } = {}) {
  const flight = new FlightController(() => 40, aircraft), inputs = new FlightInputs(0);
  flight.setWind({ direction: direction * DEG, speed: wind }, { immediate: true });
  if (assist) flight.toggleAutopilot();
  inputs.set(controls, 0);
  let displacement;
  for (let frame = 1; frame <= seconds * rate; frame++) inputs.advance(frame / rate, (dt, c) => {
    const before = flight.state.position.clone(); flight.update(dt, c);
    if (dt > 1e-6) displacement = flight.state.position.clone().sub(before).divideScalar(dt);
  });
  return { flight, inputs, displacement };
}

test('normal-input flight in calm/headwind/tailwind/crosswind reports measured travel, with unchanged heading assist', () => {
  const observations = [];
  for (const direction of [0, 0, 180, 270]) {
    const wind = observations.length ? 12 : 0;
    const { flight, displacement } = navigationFlight({ direction, wind });
    const destination = { x: flight.state.position.x, z: flight.state.position.z - 10000 };
    const n = flightNav(flight, destination), g = groundTrack(flight.state, flight.type);
    assert.ok(close(n.groundSpeed, Math.hypot(displacement.x, displacement.z), 1e-6));
    assert.ok(close(n.closingSpeed, -displacement.z, 1e-6));
    assert.ok(close(n.track, g.track));
    assert.ok(close(n.eteSeconds, 10000 / -displacement.z, 1e-6));
    assert.equal(flight.state.autopilot, true); assert.equal(flight.state.heading, 0); assert.equal(flight.state.crashed, false);
    observations.push({ ...n, airspeed: flight.state.airspeed });
  }
  const [calm, head, tail, cross] = observations;
  assert.equal(calm.airspeed, head.airspeed); assert.equal(calm.airspeed, tail.airspeed); assert.equal(calm.airspeed, cross.airspeed);
  assert.ok(head.eteSeconds > calm.eteSeconds && calm.eteSeconds > tail.eteSeconds);
  assert.ok(cross.track > calm.track); assert.ok(close(cross.eteSeconds, calm.eteSeconds));
});

test('normal rotorcraft inputs support hover and backwards closing; no estimate survives a crash or stationary ground wind', () => {
  const { flight: hover } = navigationFlight({ aircraft: 'helicopter' });
  assert.equal(flightNav(hover).groundSpeed, 0); assert.equal(flightNav(hover).eteState, 'not-closing');
  for (const rate of [30, 60, 144]) {
    const { flight, displacement } = navigationFlight({ aircraft: 'helicopter', controls: { pitch: .3 }, assist: false, rate });
    const p = flight.state.position, ahead = flightNav(flight, { x: p.x, z: p.z - 10000 }), behind = flightNav(flight, { x: p.x, z: p.z + 10000 });
    assert.equal(flight.state.crashed, false); assert.ok(displacement.z > 2, 'nose-up cyclic moves backwards');
    assert.equal(ahead.eteState, 'not-closing'); assert.equal(behind.eteState, 'estimate'); assert.equal(behind.trackText, '180°');
    assert.ok(close(behind.closingSpeed, displacement.z, .02)); assert.equal(flight.state.heading, 0);
  }
  for (const aircraft of ['trainer', 'helicopter']) {
    const flight = new FlightController(() => 40, aircraft), inputs = new FlightInputs(0);
    flight.setWind({ direction: 0, speed: 12 }, { immediate: true }); flight.runwayStart(0, 42, 0);
    for (let frame = 1; frame <= 240; frame++) inputs.advance(frame / 120, (dt, c) => flight.update(dt, c));
    assert.ok(flight.state.airspeed > 0, 'wind is seen by the airspeed instrument');
    assert.equal(flightNav(flight).groundSpeed, 0); assert.equal(flightNav(flight).track, null);
    assert.equal(flightNav(flight).eteState, 'not-closing');
  }
  const { flight: crashed } = navigationFlight({ aircraft: 'helicopter', controls: { throttle: -1, pitch: 1 }, assist: false, seconds: 120 });
  assert.equal(crashed.state.crashed, true, 'ordinary controls produce a real crash');
  assert.equal(flightNav(crashed).eteState, 'unavailable'); assert.equal(flightNav(crashed).track, null);
  crashed.reset(); assert.equal(flightNav(crashed).eteState, 'not-closing', 'reset clears the unavailable state');
});

test('estimates immediately follow selection, mission lock, retry, cancel, runway and aircraft changes', () => {
  const selection = new AirportSelection('serein-lakeside'), mission = new LandingMission(), flight = new FlightController(heightAt, 'trainer');
  const destination = () => navigationDestination({ selected: selection.snapshot(), mission: mission.status !== 'idle' ? describeField(mission.field) : null });
  const readout = () => flightNav(flight, destination());
  const original = readout(); selection.select('orvane-regional', '32');
  assert.notEqual(readout().distance, original.distance); assert.notEqual(readout().closingSpeed, original.closingSpeed);
  mission.start(flight, selection.field); const locked = readout(); selection.select('verdance-meadow', '17');
  assert.equal(destination().id, 'orvane-regional'); assert.equal(destination().runway, '32'); assert.deepEqual(readout(), locked);
  assert.equal(locked.eteState, 'estimate');
  mission.start(flight); assert.deepEqual(readout(), locked, 'retry starts at the same locked runway');
  mission.cancel(); assert.equal(destination().id, 'verdance-meadow'); assert.notEqual(readout().distance, locked.distance);
  selection.select('verdance-meadow', '35'); assert.equal(destination().runway, '35');
  flight.setAircraft('helicopter'); assert.equal(readout().eteState, 'not-closing');
  flight.runwayStart(selection.field.x, selection.field.elevation + 2, selection.field.z, selection.field.heading);
  assert.equal(readout().eteState, 'near-destination'); assert.equal(readout().groundSpeed, 0);
});

test('views project north up and east right, and unproject back', () => {
  const v = createView(1000, -2000, 25, 240, 155);
  assert.deepEqual(v.project(1000, -2000), [120, 77.5]);
  const [ex] = v.project(2000, -2000), [, ny] = v.project(1000, -3000);
  assert.ok(ex > 120, 'east is right'); assert.ok(ny < 77.5, 'north is up');
  const p = v.unproject(...v.project(-1234, 5678));
  assert.ok(close(p.x, -1234, 1e-6) && close(p.z, 5678, 1e-6));
  assert.ok(close(v.bounds.maxX - v.bounds.minX, 240 * 25));
});

test('the scale bar is a round distance drawn true to the view', () => {
  for (const mpp of [3, 17, 39, 120, 455, 1000]) for (const max of [56, 90]) {
    const s = scaleBar(mpp, max), lead = s.metres / 10 ** Math.floor(Math.log10(s.metres));
    assert.ok([1, 2, 5].includes(lead), `${s.metres}`);
    assert.ok(close(s.px * mpp, s.metres, 1e-9));
    assert.ok(s.px <= max && s.px > max / 2.5, `${mpp} m/px: ${s.px}px`);
  }
  assert.equal(scaleBar(40, 70).label, '2 km');
  assert.equal(scaleBar(4, 70).label, '200 m');
});

test('route framing keeps the aircraft and any destination on the map, wherever they are', () => {
  const places = [...AIRPORTS, { x: WORLD.minX + 500, z: WORLD.minZ + 500 }, { x: WORLD.maxX - 500, z: WORLD.maxZ - 500 }, { x: -20000, z: 30000 }];
  for (const [w, h] of [[240, 155], [126, 91], [700, 560], [330, 300]]) for (const a of places) for (const d of AIRPORTS) {
    const framing = { framing: 'route' }, v = frameView(framing, w, h, a, d, 20);
    assert.ok(inView(v, v.project(a.x, a.z), 19), `aircraft at ${a.x},${a.z} in ${w}x${h}`);
    assert.ok(inView(v, v.project(d.x, d.z), 19), `${d.id} in ${w}x${h}`);
    const span = Math.round(v.mpp * Math.min(w, h));
    assert.ok(ZOOM_SPANS.includes(span) || span > ZOOM_SPANS.at(-1), 'route steps through the zoom spans');
  }
});

test('route zoom grows at once and shrinks with hysteresis', () => {
  assert.equal(routeZoom(1000, 9), 2, 'never closer than the minimum step');
  assert.equal(routeZoom(20000, 4), 6, 'grows to the first span that fits');
  assert.equal(routeZoom(18500, 6), 6, 'keeps the step until the span fits the smaller one with margin');
  assert.equal(routeZoom(16000, 6), 5);
  assert.equal(routeZoom(1e6, 3), ZOOM_SPANS.length - 1);
});

test('world framing shows the whole world and every airport', () => {
  for (const [w, h] of [[240, 155], [126, 91], [700, 560], [330, 300]]) {
    const v = frameView({ framing: 'world' }, w, h, { x: 0, z: 0 }, null, 20);
    for (const [x, z] of [[WORLD.minX, WORLD.minZ], [WORLD.maxX, WORLD.maxZ]]) assert.ok(inView(v, v.project(x, z), 19.9));
    for (const a of AIRPORTS) assert.ok(inView(v, v.project(a.x, a.z), 20));
  }
});

test('follow framing centres the aircraft and stops at the world edge', () => {
  const framing = { framing: 'follow', zoom: 3 };
  const mid = frameView(framing, 240, 155, { x: 2000, z: 3000 }, null);
  assert.deepEqual(mid.project(2000, 3000), [120, 77.5]);
  assert.ok(close(mid.mpp * 155, ZOOM_SPANS[3]));
  const edge = frameView(framing, 240, 155, { x: WORLD.maxX - 100, z: WORLD.minZ + 100 }, null);
  assert.ok(edge.bounds.maxX <= WORLD.maxX + 1500 + 1e-6 && edge.bounds.minZ >= WORLD.minZ - 1500 - 1e-6, 'no view past the rim margin');
  assert.ok(inView(edge, edge.project(WORLD.maxX - 100, WORLD.minZ + 100)), 'aircraft still on the map near the rim');
  const wide = clampCentre(30000, 0, 1000, 240, 155);
  assert.equal(wide.cx, 0, 'a view wider than the world is centred on it');
  // Zoom controls step from whatever is shown and then follow the aircraft.
  const z = zoomFrom({ framing: 'route', zoom: 6 }, createView(0, 0, ZOOM_SPANS[6] / 155, 240, 155), 1);
  assert.deepEqual(z, { framing: 'follow', zoom: 5 });
  assert.equal(zoomFrom({ framing: 'follow', zoom: 0 }, createView(0, 0, ZOOM_SPANS[0] / 155, 240, 155), 1).zoom, 0, 'clamped');
});

test('off-map points get an edge pointer that aims at them', () => {
  const v = createView(0, 0, 50, 240, 160);
  assert.equal(edgePointer(v, 1000, 1000), null);
  const east = edgePointer(v, 30000, 0, 12);
  assert.ok(close(east.x, 228) && close(east.y, 80) && close(east.angle, Math.PI / 2));
  const ne = edgePointer(v, 20000, -20000, 12);
  assert.ok(inView(v, [ne.x, ne.y], 11.99), 'stays inside the map');
  assert.ok(close(ne.angle, Math.PI / 4));
});

test('terrain tiles cover a view, nest in their parents and sample the world height function', () => {
  assert.equal(tileLevel(WORLD.size / TILE_PIXELS), 0);
  assert.ok(tileLevel(30) > tileLevel(300));
  assert.equal(tileLevel(100, 2), tileLevel(100) - 1, 'low quality draws a level coarser');
  assert.equal(tileLevel(.5), MAX_TILE_LEVEL, 'capped');
  assert.ok(tileMetres(MAX_TILE_LEVEL) / TILE_PIXELS < 35, 'the closest chart keeps its 34 m pixels on the larger world');
  const v = createView(900, -1800, 40, 240, 155), level = tileLevel(v.mpp), tiles = tilesFor(v, level);
  const minX = Math.min(...tiles.map(t => t.minX)), maxX = Math.max(...tiles.map(t => t.minX + t.size));
  const minZ = Math.min(...tiles.map(t => t.minZ)), maxZ = Math.max(...tiles.map(t => t.minZ + t.size));
  assert.ok(minX <= v.bounds.minX && maxX >= v.bounds.maxX && minZ <= v.bounds.minZ && maxZ >= v.bounds.maxZ);
  assert.ok(tileMetres(level) / TILE_PIXELS <= v.mpp, 'tile pixels no larger than the view\'s');
  const t = tiles[0], p = parentTile(t);
  assert.equal(p.level, t.level - 1);
  assert.ok(p.minX + p.qi * p.size / 2 === t.minX && p.minZ + p.qj * p.size / 2 === t.minZ);
  // Samples land on the tile's pixel corners, inside the world.
  const seen = [];
  rasterTile(tile(2, 1, 2), (x, z) => { seen.push([x, z]); return 500; });
  assert.equal(seen.length, (TILE_PIXELS + 1) ** 2);
  assert.ok(seen.every(([x, z]) => inWorld(x, z)));
  // Real terrain: Lake Azure is water, Alpine Field and Orvane Regional are ground.
  const at = (x, z) => {
    const level = 6, size = tileMetres(level), i = Math.floor((x - WORLD.minX) / size), j = Math.floor((z - WORLD.minZ) / size), tt = tile(level, i, j);
    const data = rasterTile(tt, heightAt), px = Math.floor((x - tt.minX) / size * TILE_PIXELS), py = Math.floor((z - tt.minZ) / size * TILE_PIXELS);
    return [...data.slice((py * TILE_PIXELS + px) * 4, (py * TILE_PIXELS + px) * 4 + 3)];
  };
  const water = terrainColour(WATER_LEVEL, WATER_LEVEL, WATER_LEVEL, WATER_LEVEL, 10);
  assert.deepEqual(at(-100, -2400), water, 'Lake Azure');
  assert.notDeepEqual(at(ALPINE_FIELD.x, ALPINE_FIELD.z + 400), water, 'Alpine Field');
  assert.notDeepEqual(at(21000, -2000), water, 'Orvane Regional');
  assert.ok(terrainColour(2600, 2600, 2600, 2600, 50)[0] > terrainColour(400, 400, 400, 400, 50)[0], 'high ground is paler');
});

test('labels never overlap, stay inside the map and give way by priority', () => {
  const labels = [
    { id: 'dest', w: 40, h: 14, x: 120, y: 70, priority: 0 },
    { id: 'near', w: 40, h: 14, x: 124, y: 72, priority: 1 },
    { id: 'edge', w: 60, h: 14, x: 236, y: 10, priority: 2 },
    { id: 'blocked', w: 30, h: 13, x: 30, y: 140, priority: 3 },
  ];
  const placed = placeLabels(labels, 240, 155, [{ x: 0, y: 120, w: 90, h: 35 }], 3);
  assert.equal(placed[0].id, 'dest');
  for (const a of placed) {
    assert.ok(a.box.x >= 3 && a.box.y >= 3 && a.box.x + a.box.w <= 237 && a.box.y + a.box.h <= 152, a.id);
    for (const b of placed) if (a !== b) assert.ok(a.box.x + a.box.w <= b.box.x || b.box.x + b.box.w <= a.box.x || a.box.y + a.box.h <= b.box.y || b.box.y + b.box.h <= a.box.y, `${a.id}/${b.id}`);
  }
  assert.ok(placed.find(l => l.id === 'edge').box.x < 236 - 60, 'flips left at the right edge');
  assert.ok(!placed.find(l => l.id === 'blocked'), 'reserved space is respected');
});

test('the map names every region, landmark and airport once, all inside the world', () => {
  const places = mapPlaces(), names = places.map(p => p.name);
  assert.equal(new Set(names).size, names.length);
  for (const a of AIRPORTS) assert.ok(!names.includes(a.name), `${a.name} is named by its airport`);
  for (const p of places) assert.ok(inWorld(p.x, p.z), p.name);
  for (const r of ['Alpine Valley', 'Serein Basin', 'Val Verdance', 'Orvane Plateau', 'Northern Range']) assert.ok(names.includes(r), r);
  assert.ok(LANDMARKS.filter(l => l.type === 'peak').every(l => names.includes(l.name)));
  assert.equal(mapAirports('serein-lakeside').at(-1).id, 'serein-lakeside', 'the destination is drawn last, on top');
  assert.equal(mapAirports().length, AIRPORTS.length);
});
