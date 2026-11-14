// The airport network: one registry for the visible fields, the terrain they are
// graded into, runway starts, missions, airport selection and the map. Pure data
// and arithmetic (no three.js), like regions.js.
//
// Metres; +x is east, +z is south. A field's `heading` is its primary runway's
// landing direction in radians clockwise from north (Alpine Field's convention),
// and `runwayCoordinates`/`runwayPoint` from airfield.js measure `along` from that
// runway's threshold. `runwayDirection(field, designator)` turns a field round to
// land the other way. Every name and identifier is fictional.
import { AIRFIELD } from './airfield.js';
import { AIRPORT_SITES } from './regions.js';

const degrees = d => d * Math.PI / 180;
const ANY = Object.freeze(['asphalt', 'grass']), PAVED = Object.freeze(['asphalt']);

/** Runway number for a heading: tens of degrees, 36 for north. */
export function designator(heading) {
  const tens = Math.round(((heading * 180 / Math.PI) % 360 + 360) % 360 / 10) % 36;
  return String(tens || 36).padStart(2, '0');
}

// Flat ground kept around every runway and apron beyond its paint, so the
// coarsest terrain mesh near the camera (an 84.6 m grid at step 2, 169 m
// between vertices, up to 240 m on the diagonal of a rotated runway) still lays
// its triangles flat under the pavement. Beyond it the ground eases back to the
// natural surface: gently along the extended centreline, so finals never meet a
// wall, more quickly to the sides.
export const GRADING = Object.freeze({ margin: 250, along: 700, cross: 300 });

function field(spec) {
  const heading = degrees(spec.headingDegrees), runway = designator(heading), reciprocal = designator(heading + Math.PI);
  const s = Math.sin(heading), c = Math.cos(heading), L = spec.runwayLength;
  const threshold = along => ({ x: spec.x + (along - L / 2) * s, z: spec.z - (along - L / 2) * c });
  return Object.freeze({
    ...spec, heading, runway, reciprocal,
    runways: Object.freeze([
      Object.freeze({ designator: runway, heading, threshold: Object.freeze(threshold(0)) }),
      Object.freeze({ designator: reciprocal, heading: (heading + Math.PI) % (2 * Math.PI), threshold: Object.freeze(threshold(L)) }),
    ]),
    apron: Object.freeze({ along: Object.freeze(spec.apron.along), cross: Object.freeze(spec.apron.cross) }),
  });
}

// The outer regions' fields are built on the sites surveyed in regions.js
// (docs/world-scale.md), keeping each site's id, name, position, elevation,
// runway and apron exactly; the registry adds an ident, lighting and the words.
const surveyed = (id, spec) => {
  const { approach, heading, ...site } = AIRPORT_SITES.find(s => s.id === id);
  return field({ ...site, apron: { along: [...site.apron.along], cross: [...site.apron.cross] }, ...spec });
};

// The original field keeps its own object's numbers and its original elliptical
// apron grading in terrain.js (`grading: 'legacy'`); the new fields grade the
// rectangle `footprint()` describes in runway-local coordinates.
export const ALPINE_FIELD = field({
  ...AIRFIELD, id: 'alpine-field', ident: 'QAAF', kind: 'valley', region: 'central-valley', headingDegrees: 0,
  surface: 'asphalt', grading: 'legacy', lit: true,
  apron: { along: [600, 900], cross: [45, 175] },
  summary: 'The original lakeside valley field beside Lake Azure: long, wide and forgiving.',
  caution: '',
});

export const AIRPORTS = Object.freeze([
  ALPINE_FIELD,
  field({
    id: 'orvane-regional', ident: 'QAOR', name: 'Orvane Regional', kind: 'regional', region: 'eastern-plateau',
    x: 21000, z: -2000, elevation: 1058, headingDegrees: 138, runwayLength: 2600, runwayWidth: 45, surface: 'asphalt', lit: true,
    apron: { along: [980, 1620], cross: [70, 250] },
    summary: 'The long paved runway on the open Orvane tableland, built for the large jets.',
    caution: 'Field elevation 1,058 m: allow a longer roll and a wider pattern.',
  }),
  field({
    id: 'verdance-meadow', ident: 'QAVM', name: 'Verdance Meadow', kind: 'grass', region: 'western-valley',
    x: -23900, z: -3100, elevation: 440, headingDegrees: 352, runwayLength: 900, runwayWidth: 30, surface: 'grass', lit: false,
    apron: { along: [370, 520], cross: [-105, -40] },
    summary: 'A mown grass strip on the Val Verdance floor, between steep ranges.',
    caution: 'Grass: light aircraft and turboprops only. Approaches follow the valley floor.',
  }),
  field({
    id: 'serein-lakeside', ident: 'QASL', name: 'Serein Lakeside', kind: 'lakeside', region: 'southern-basin',
    x: 1390, z: 15540, elevation: 42, headingDegrees: 162, runwayLength: 1400, runwayWidth: 30, surface: 'asphalt', lit: true,
    apron: { along: [520, 860], cross: [-190, -45] },
    summary: 'A shore runway where the Narrows open into Lac Serein; both finals come in over open water, then a short stretch of shore.',
    caution: '',
  }),
  field({
    id: 'brume-col', ident: 'QACB', name: 'Col de Brume', kind: 'mountain', region: 'western-valley',
    x: -11350, z: 2350, elevation: 1142, headingDegrees: 106, runwayLength: 650, runwayWidth: 18, surface: 'asphalt', lit: false,
    apron: { along: [190, 360], cross: [30, 105] },
    summary: 'A short altiport on the 1,140 m saddle of the Col de Brume, approached up either valley.',
    caution: 'Short and narrow at 1,142 m, with high ground beside the strip: light and short-field aircraft only.',
  }),
  surveyed('calmeterre-international', { ident: 'QACI', lit: true,
    summary: 'The long runway on the open Calmeterre floodplain, with a gated terminal for the large jets.',
    caution: 'The Calme and an oxbow lake lie under the runway 01 final; a 40 m terrace rises 1 km east.' }),
  surveyed('aurin-cote', { ident: 'QAAC', lit: true,
    summary: 'A long coastal runway on the Aurin plain, built for the large jets.',
    caution: 'The Divide rises close north of the runway 10 final: join it from the sea to the south, inside 4 km, and keep right of the centreline.' }),
  surveyed('port-aurin', { ident: 'QAPA', lit: true,
    summary: "A regional shore field 800 m inland from the Mer d'Aurin, open water along its south side.",
    caution: 'Aurin Côte lies 18 km east: keep the pattern west of the gorge.' }),
  surveyed('sorre-meadow', { ident: 'QASM', lit: false,
    summary: 'A mown grass strip among the farms of the Plaine de Sorre, open tableland both ways.',
    caution: 'Grass at 703 m: light aircraft and turboprops only. Puy de Sorre stands 10 km north-north-east.' }),
  surveyed('vauclair-altiport', { ident: 'QAPV', lit: true,
    summary: 'A high paved strip on the outwash floor of Val Vauclair, below the glacier.',
    caution: 'Field elevation 1,483 m with walls 350 m high 2 km either side: approach along the trough only, and allow a longer roll.' }),
]);

/** A field by id, or undefined. */
export const airportById = id => AIRPORTS.find(a => a.id === id);

/**
 * The same field landing the other way: `runwayDirection(field, '32')` keeps the
 * field's centre and length and swaps its heading and designators, so
 * runwayCoordinates/runwayPoint and LandingMission work from that threshold.
 */
export function runwayDirection(airport, runway = airport.runway) {
  if (runway === airport.runway) return airport;
  if (runway !== airport.reciprocal) throw new RangeError(`${airport.name} has no runway ${runway}`);
  const flip = d => ({ along: [airport.runwayLength - d.along[1], airport.runwayLength - d.along[0]], cross: [-d.cross[1], -d.cross[0]] });
  return Object.freeze({ ...airport, heading: (airport.heading + Math.PI) % (2 * Math.PI), runway: airport.reciprocal, reciprocal: airport.runway,
    runways: Object.freeze([airport.runways[1], airport.runways[0]]), apron: Object.freeze(flip(airport.apron)) });
}

/**
 * The paved (or mown) area in runway-local coordinates: `along` from the primary
 * threshold, `cross` right of the centreline. Runway with 60 m of overrun at each
 * end, its shoulders, and the apron with its buildings.
 */
export function footprint(airport) {
  const half = airport.runwayWidth / 2 + 15;
  return { along: [Math.min(-60, airport.apron.along[0]), Math.max(airport.runwayLength + 60, airport.apron.along[1])],
    cross: [Math.min(-half, airport.apron.cross[0]), Math.max(half, airport.apron.cross[1])] };
}

/** Runway-local coordinates of a world point (see airfield.js runwayCoordinates). */
export function localCoordinates(airport, x, z) {
  const dx = x - airport.x, dz = z - airport.z, s = Math.sin(airport.heading), c = Math.cos(airport.heading);
  return { along: dx * s - dz * c + airport.runwayLength / 2, cross: dx * c + dz * s };
}

/**
 * How the terrain is graded for a field: a rectangle centred `along`/`cross` from
 * the field centre, `halfAlong`/`halfCross` flat (footprint plus GRADING.margin),
 * then a smoothstep back to the natural ground over `blendAlong`/`blendCross`.
 */
export function gradingBox(airport) {
  const f = footprint(airport), m = GRADING.margin;
  const along = (f.along[0] + f.along[1]) / 2 - airport.runwayLength / 2, cross = (f.cross[0] + f.cross[1]) / 2;
  const halfAlong = (f.along[1] - f.along[0]) / 2 + m, halfCross = (f.cross[1] - f.cross[0]) / 2 + m;
  return { along, cross, halfAlong, halfCross, blendAlong: GRADING.along, blendCross: GRADING.cross,
    reach: Math.hypot(Math.abs(along) + halfAlong + GRADING.along, Math.abs(cross) + halfCross + GRADING.cross),
    sin: Math.sin(airport.heading), cos: Math.cos(airport.heading) };
}

/** Graded fields with their boxes, for terrain.js (Alpine Field keeps its own ellipse). */
export const GRADED_AIRPORTS = Object.freeze(AIRPORTS.filter(a => a.grading !== 'legacy').map(a => Object.freeze({ airport: a, ...gradingBox(a) })));

/**
 * Space trees and houses keep clear of: the footprint plus 120 m, and a funnel
 * 1.5 km beyond each threshold widening from 150 m to 300 m either side of the
 * centreline (true when (x, z) lies in it).
 */
export function inProtectedArea(airport, x, z) {
  const { along, cross } = localCoordinates(airport, x, z), f = footprint(airport);
  if (along > f.along[0] - 120 && along < f.along[1] + 120 && cross > f.cross[0] - 120 && cross < f.cross[1] + 120) return true;
  const beyond = along < 0 ? -along : along - airport.runwayLength;
  return beyond > 0 && beyond < 1500 && Math.abs(cross) < 150 + beyond * .1;
}

// Shortest and narrowest runway, and the surfaces, each aircraft uses with a
// sensible margin. Lengths are at least 1.5x the takeoff and landing rolls the
// flight model produces (tests/airport-network.test.js measures them); a runway
// half as long again as `length` is recommended.
const need = (length, width, surfaces = ANY) => Object.freeze({ length, width, surfaces });
export const RUNWAY_NEEDS = Object.freeze({
  helicopter: need(0, 0), transport: need(0, 0),
  bush: need(250, 10), biplane: need(250, 10), motorglider: need(300, 12), trainer: need(350, 10), utility: need(350, 12),
  canard: need(400, 10, PAVED), aerobatic: need(400, 10), commuter: need(700, 18), cityliner: need(700, 23, PAVED),
  jet: need(700, 23, PAVED), regional: need(900, 30, PAVED), fighter: need(900, 23, PAVED), cargo: need(1000, 30),
  airliner: need(1100, 30, PAVED), widebody: need(1100, 45, PAVED),
});

/**
 * Whether an aircraft (a fleet id) suits a field: `rating` is 'recommended',
 * 'suitable' (it fits with little margin) or 'unsuitable', with a short reason.
 */
export function suitability(airport, aircraftId) {
  const n = RUNWAY_NEEDS[aircraftId];
  if (!n) return { rating: 'unsuitable', reason: 'Unknown aircraft' };
  if (!n.length) return { rating: 'recommended', reason: 'Lands vertically' };
  if (!n.surfaces.includes(airport.surface)) return { rating: 'unsuitable', reason: 'Needs a paved runway' };
  if (airport.runwayWidth < n.width) return { rating: 'unsuitable', reason: `Needs a runway ${n.width} m wide` };
  if (airport.runwayLength < n.length) return { rating: 'unsuitable', reason: `Needs ${n.length.toLocaleString('en')} m of runway` };
  if (airport.runwayLength < n.length * 1.5) return { rating: 'suitable', reason: 'Fits with little margin' };
  return { rating: 'recommended', reason: 'Ample runway' };
}

/** Fleet ids grouped by rating for a field. */
export function aircraftFor(airport, ids = Object.keys(RUNWAY_NEEDS)) {
  const groups = { recommended: [], suitable: [], unsuitable: [] };
  for (const id of ids) groups[suitability(airport, id).rating].push(id);
  return groups;
}
