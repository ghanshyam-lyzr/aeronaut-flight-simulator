import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightController } from '../src/flight.js';
import { LandingMission } from '../src/landing-mission.js';
import { AIRPORTS, airportById, runwayDirection, suitability } from '../src/airports.js';
import { AirportSelection } from '../src/airport-selection.js';
import { WIND_PRESETS, KNOT, sampleWind, windVector, windComponents } from '../src/wind.js';
import { RUNWAY_WIND, reportedWind, components, gustExtremes, componentText, windBand, adviseRunway, liveComponents,
  windReadout, readoutField, applyAdvice } from '../src/runway-wind.js';

const deg = d => d * Math.PI / 180;
const close = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);
const steady = (d, knots) => ({ direction: deg(d), speed: knots * KNOT });

test('projections and signs for both runway directions at every field', () => {
  for (const a of AIRPORTS) {
    const [primary, reciprocal] = a.runways;
    close(reciprocal.heading, (primary.heading + Math.PI) % (2 * Math.PI), 1e-12, `${a.ident} reciprocal heading`);
    for (const r of a.runways) {
      const h = r.heading, label = `${a.ident} ${r.designator}`;
      // Straight down the runway, straight up it, and from each side, 10 kt each.
      const head = components(h, 10 * KNOT, h), tail = components(h + Math.PI, 10 * KNOT, h);
      const right = components(h + Math.PI / 2, 10 * KNOT, h), left = components(h - Math.PI / 2, 10 * KNOT, h);
      close(head.headwind, 10 * KNOT, 1e-9, `${label}: a wind from the runway heading is a headwind`); close(head.crosswind, 0, 1e-9, `${label}: no crosswind`);
      close(tail.headwind, -10 * KNOT, 1e-9, `${label}: from behind is a tailwind`);
      close(right.crosswind, 10 * KNOT, 1e-9, `${label}: from 90° right is a right crosswind`); close(right.headwind, 0, 1e-9, `${label}: no headwind`);
      close(left.crosswind, -10 * KNOT, 1e-9, `${label}: from 90° left is a left crosswind`);
      // A 45° wind from front right splits evenly; the other direction sees it as a tailwind from its left.
      const diag = components(h + Math.PI / 4, 10 * KNOT, h), back = components(h + Math.PI / 4, 10 * KNOT, h + Math.PI);
      close(diag.headwind, diag.crosswind, 1e-9, `${label}: 45° splits evenly`);
      close(back.headwind, -diag.headwind, 1e-9, `${label}: the reciprocal has the opposite headwind`);
      close(back.crosswind, -diag.crosswind, 1e-9, `${label}: and the crosswind from the other side`);
      // The same numbers as the wind-model's own projection of its air velocity.
      const v = windVector(h + Math.PI / 4, 10 * KNOT), w = windComponents(v, h);
      close(w.headwind, diag.headwind, 1e-12, `${label}: matches windComponents`);
    }
    // runwayDirection turns the field round: its heading is the reciprocal runway's.
    close(runwayDirection(a, a.reciprocal).heading, reciprocal.heading, 1e-12, `${a.ident} turned field heading`);
  }
});

test('words: whole knots, the side named, tiny components read as none', () => {
  assert.equal(componentText({ headwind: 6 * KNOT, crosswind: 4 * KNOT }).text, 'Headwind 6 kt · crosswind 4 kt from the right');
  assert.equal(componentText({ headwind: -3 * KNOT, crosswind: -4.4 * KNOT }).text, 'Tailwind 3 kt · crosswind 4 kt from the left');
  assert.equal(componentText({ headwind: -3 * KNOT, crosswind: -4.4 * KNOT }).short, 'Tail 3 · Cross 4 L kt');
  assert.equal(componentText({ headwind: 0.3 * KNOT, crosswind: -0.2 * KNOT }).text, 'No headwind · no crosswind');
  assert.equal(componentText({ headwind: -0.3 * KNOT, crosswind: 0 }).short, 'Calm');
  assert.equal(componentText({ headwind: -3 * KNOT, crosswind: 0 }).tone, 'tailwind');
  assert.equal(componentText({ headwind: 3 * KNOT, crosswind: 0 }).tone, 'headwind');
  assert.equal(componentText({ headwind: 1 * KNOT, crosswind: 9 * KNOT }).tone, 'neutral');
});

test('calm air: no recommendation at any field, and the readout says calm', () => {
  for (const a of AIRPORTS) for (const r of a.runways) {
    const advice = adviseRunway(a, r.designator, WIND_PRESETS.calm, 'trainer');
    assert.equal(advice.verdict, 'calm'); assert.equal(advice.recommended, null); assert.equal(advice.canApply, false);
    assert.equal(advice.headline, 'Calm · either runway'); assert.equal(advice.gust, null);
  }
  const r = windReadout(sampleWind('calm', 12), airportById('alpine-field'));
  assert.equal(r.text, 'Calm'); assert.equal(r.arrow, null);
});

test('a tailwind offers the reciprocal; a headwind keeps the runway', () => {
  for (const a of AIRPORTS) {
    const [primary, reciprocal] = a.runways, behind = (primary.heading + Math.PI) * 180 / Math.PI;
    const tail = adviseRunway(a, primary.designator, steady(behind, 8), 'helicopter');
    assert.equal(tail.verdict, 'switch', `${a.ident}: tailwind`); assert.equal(tail.recommended, reciprocal.designator);
    assert.equal(tail.canApply, true); close(tail.selected.headwind, -8 * KNOT, 1e-9, 'tailwind on the selected runway');
    close(tail.other.headwind, 8 * KNOT, 1e-9, 'headwind on the reciprocal');
    const into = adviseRunway(a, reciprocal.designator, steady(behind, 8), 'helicopter');
    assert.equal(into.verdict, 'into-wind'); assert.equal(into.recommended, null);
  }
  // The Breeze preset (240° at 8 kt) at Alpine Field: runway 36 (heading 0) has a 4 kt tailwind and 7 kt from the left.
  const breeze = adviseRunway(airportById('alpine-field'), '36', 'breeze', 'trainer');
  assert.equal(breeze.verdict, 'switch'); assert.equal(breeze.recommended, '18');
  assert.equal(componentText(breeze.selected).text, 'Tailwind 4 kt · crosswind 7 kt from the left');
  assert.equal(componentText(breeze.other).text, 'Headwind 4 kt · crosswind 7 kt from the right');
});

test('direct crosswind: neither direction is recommended, and the strong one is named', () => {
  const a = airportById('serein-lakeside'), h = a.heading * 180 / Math.PI;
  const across = adviseRunway(a, a.runway, steady(h + 90, 12), 'trainer');
  assert.equal(across.verdict, 'crosswind'); assert.equal(across.recommended, null);
  assert.match(across.headline, /^Direct crosswind/);
  const strong = adviseRunway(a, a.runway, steady(h - 90, 18), 'trainer');
  assert.equal(strong.strong, true); assert.match(strong.headline, /^Strong crosswind/);
  // A 1.5 kt tailwind is ambiguous: no switch suggested.
  const slight = adviseRunway(a, a.runway, { direction: deg(h + 180), speed: 1.5 * KNOT }, 'trainer');
  assert.equal(slight.recommended, null); assert.equal(slight.verdict, 'light');
});

test('recommendations do not flicker: hysteresis on the band, the reported wind rather than gusts', () => {
  // Sweep a wind slowly round through the crosswind boundary and back; a fresh call each step with the band before.
  const a = airportById('verdance-meadow'), h = a.heading;
  for (const knots of [3, 8, 14]) {
    let band, changes = 0, last;
    const path = [...Array(400).keys()].map(i => 80 + 20 * Math.sin(i / 400 * Math.PI * 2) + Math.sin(i * 1.7));
    for (const d of path) {
      const advice = adviseRunway(a, a.runway, { direction: h + deg(d), speed: knots * KNOT }, 'trainer', band);
      band = advice.band;
      if (last !== undefined && advice.recommended !== last) changes++;
      last = advice.recommended;
    }
    assert.ok(changes <= 2, `${knots} kt: the suggestion changes ${changes} times over one slow swing`);
    // Without the band from before, the same swing's 1° of noise would flip the suggestion at the threshold.
    if (knots === 14) {
      const raw = path.map(d => adviseRunway(a, a.runway, { direction: h + deg(d), speed: knots * KNOT }, 'trainer').recommended);
      assert.ok(raw.filter((r, i) => i && r !== raw[i - 1]).length > changes, 'hysteresis removes flicker');
    }
  }
  // Exactly at the threshold, the band keeps whatever it was until the far side of the dead band.
  assert.equal(windBand(-1.5 * KNOT, 'tail'), 'tail'); assert.equal(windBand(-1.5 * KNOT, 'across'), 'across');
  assert.equal(windBand(-0.9 * KNOT, 'tail'), 'across'); assert.equal(windBand(1.5 * KNOT, 'into'), 'into');
  assert.equal(windBand(2 * KNOT), 'into'); assert.equal(windBand(-2 * KNOT), 'tail');
  // Gusts preset: the advice comes from the reported 260° 14 kt, identical whatever the gust clock says.
  const gusts = AIRPORTS.map(f => adviseRunway(f, f.runway, 'gusts', 'trainer'));
  for (const g of gusts) assert.ok(g.gust, `${g.field}: gust extremes reported`);
  const flight = new FlightController(() => 40, 'trainer');
  flight.setWind('gusts', { immediate: true });
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    flight.wind.advance(0.1);
    const config = flight.windSnapshot().config;
    seen.add(AIRPORTS.map(f => adviseRunway(f, f.runway, config, 'trainer').recommended).join());
  }
  assert.equal(seen.size, 1, 'one recommendation per field through a minute of gusts');
});

test('gust extremes: peak speed anywhere within the veer', () => {
  const w = reportedWind('gusts');
  assert.equal(w.gusting, true); close(w.peak, 24 * KNOT, 1e-9, 'peak 24 kt'); close(w.speed, 14 * KNOT, 1e-9, 'steady 14 kt');
  // Runway 26 (260°) at Alpine Field turned: a pure headwind steady, but veer ±12° at 24 kt brings 5 kt of crosswind.
  const g = gustExtremes('gusts', deg(260));
  close(Math.abs(g.crosswind), 24 * KNOT * Math.sin(deg(12)), 1e-6, 'worst crosswind at the edge of the veer');
  assert.equal(g.tailwind, 0, 'no tailwind into the wind');
  // Steady-wind extremes are the steady components.
  const s = gustExtremes(steady(90, 10), 0);
  close(s.crosswind, 10 * KNOT, 1e-9, 'steady crosswind'); assert.equal(s.tailwind, 0);
  // Every sample the model produces stays within the reported extremes.
  for (let t = 0; t < 60; t += 0.25) {
    const c = windComponents(sampleWind('gusts', t), deg(260));
    assert.ok(Math.abs(c.crosswind) <= Math.abs(g.crosswind) + 1e-9, `sample crosswind within extremes at ${t}s`);
  }
});

test('suitability: the switch is shown but not offered to an aircraft the field does not suit', () => {
  const brume = airportById('brume-col'), behind = (brume.heading + Math.PI) * 180 / Math.PI;
  assert.equal(suitability(brume, 'airliner').rating, 'unsuitable');
  const airliner = adviseRunway(brume, brume.runway, steady(behind, 10), 'airliner');
  assert.equal(airliner.recommended, brume.reciprocal); assert.equal(airliner.canApply, false); assert.equal(airliner.rating, 'unsuitable');
  const trainer = adviseRunway(brume, brume.runway, steady(behind, 10), 'trainer');
  assert.equal(trainer.canApply, true);
  assert.equal(adviseRunway(brume, brume.runway, steady(behind, 10), 'biplane').rating, suitability(brume, 'biplane').rating);
});

test('explicit application selects the reciprocal runway and nothing else', () => {
  const selection = new AirportSelection('orvane-regional'), f = selection.airport, behind = (f.heading + Math.PI) * 180 / Math.PI;
  let changes = 0; selection.addEventListener('change', () => changes++);
  const advice = adviseRunway(f, selection.runway, steady(behind, 9), 'airliner');
  // Giving, viewing and re-computing advice changes nothing.
  for (let i = 0; i < 5; i++) adviseRunway(f, selection.runway, steady(behind, 9), 'airliner', advice.band);
  assert.equal(selection.runway, f.runway); assert.equal(changes, 0);
  assert.equal(applyAdvice(selection, advice), true);
  assert.equal(selection.id, 'orvane-regional'); assert.equal(selection.runway, f.reciprocal); assert.equal(changes, 1);
  // Stale advice (the runway already changed) and advice with nothing to offer do nothing.
  assert.equal(applyAdvice(selection, advice), false); assert.equal(changes, 1);
  assert.equal(applyAdvice(selection, adviseRunway(f, selection.runway, 'calm', 'airliner')), false);
  const unsuited = new AirportSelection('brume-col'), b = unsuited.airport;
  assert.equal(applyAdvice(unsuited, adviseRunway(b, b.runway, steady((b.heading + Math.PI) * 180 / Math.PI, 10), 'airliner')), false);
  assert.equal(unsuited.runway, b.runway);
});

test('mission locking: the readout keeps the mission runway while Explore selects elsewhere; the flight is untouched', () => {
  const flight = new FlightController(() => 40, 'trainer'), selection = new AirportSelection('alpine-field', '36');
  flight.setWind('breeze', { immediate: true });
  const mission = new LandingMission(selection.field);
  assert.equal(readoutField(selection, mission), selection.field, 'idle mission: the selection');
  mission.start(flight, selection.field);
  const before = flight.state.position.toArray(), heading = flight.state.heading, missionField = mission.field;
  selection.select('serein-lakeside');
  const advice = adviseRunway(selection.airport, selection.runway, flight.windSnapshot().config, flight.type.id);
  if (advice.canApply) applyAdvice(selection, advice);
  selection.select('alpine-field', '18');
  assert.equal(readoutField(selection, mission), missionField, 'mission field kept');
  assert.equal(readoutField(selection, mission).runway, '36');
  assert.deepEqual(flight.state.position.toArray(), before, 'no teleport'); assert.equal(flight.state.heading, heading);
  assert.equal(mission.field, missionField); assert.equal(mission.status, 'flying');
  const r = windReadout(flight.sampleWind(), readoutField(selection, mission));
  assert.equal(r.runway, '36'); assert.equal(r.text, 'Tail 4 · Cross 7 L kt');
  close(liveComponents(flight.sampleWind(), missionField).headwind, r.headwind, 1e-12, 'live components');
  mission.cancel();
  assert.equal(readoutField(selection, mission).runway, '18', 'free flight: the selection again');
});

test('readout arrow points where the air goes on the north-up map', () => {
  const f = airportById('alpine-field');
  close(windReadout(windVector(deg(270), 10), f).arrow, deg(90), 1e-9, 'a westerly blows toward the east (right)');
  close(windReadout(windVector(deg(360), 10), f).arrow, Math.PI, 1e-9, 'a northerly blows toward the bottom');
  close(windReadout(windVector(deg(180), 10), f).arrow, 0, 1e-9, 'a southerly blows up the map');
  assert.ok(RUNWAY_WIND.keep < RUNWAY_WIND.switch && RUNWAY_WIND.trace < RUNWAY_WIND.keep);
});
