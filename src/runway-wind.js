// Runway wind advice: the wind-model's wind (src/wind.js) projected onto a field's two runway directions, and a
// calm, stable suggestion of which way to land or depart. Pure and DOM-free, like airports.js. It reads the wind
// and the existing suitability ratings only: it never moves an aircraft, changes the selection or touches a mission.
//
// Which wind
// - Advice uses the REPORTED wind: the configuration's direction and steady speed (the 14 in "260° 14G24 kt"),
//   never an instantaneous sample, so gusts and veer cannot make it flicker. Gusts are reported separately as the
//   worst crosswind and tailwind the gusts can bring: peak speed (steady + gust) anywhere within ±veer.
// - Live readouts (the map row and the mission card) show the instantaneous sample, labelled "now".
// Signs follow windComponents: headwind positive into the nose (negative is a tailwind), crosswind positive from
// the right. Gameplay advice for this arcade model, not certified aircraft crosswind limits.
import { normalizeWind, windVector, windComponents, KNOT } from './wind.js';
import { suitability } from './airports.js';

/**
 * Thresholds (m/s). Components under `trace` read as none. A tailwind of `switch` or more suggests the reciprocal,
 * and the suggestion stays until the tailwind falls below `keep`; the same band separates "into wind" from
 * "crosswind", so a wind near either boundary never alternates. `strong` marks a strong crosswind for gameplay.
 */
export const RUNWAY_WIND = Object.freeze({ trace: 0.5 * KNOT, keep: 1 * KNOT, switch: 2 * KNOT, strong: 15 * KNOT });

const kt = v => Math.round(Math.abs(v) / KNOT);

/** The reported wind of a configuration: steady direction and speed, peak gust speed and veer (m/s, radians). */
export function reportedWind(config) {
  const c = normalizeWind(config), peak = c.speed + c.gust;
  return { direction: c.direction, speed: c.speed, peak, veer: c.veer, gusting: c.gust > 0,
    calm: c.speed < RUNWAY_WIND.trace && peak < RUNWAY_WIND.trace };
}

/** Headwind / crosswind (m/s) of a wind from `direction` at `speed` for a runway heading. */
export function components(direction, speed, heading) {
  return windComponents(windVector(direction, speed), heading);
}

/**
 * The most a gusting wind can bring for a runway heading: the largest crosswind magnitude (`crosswind`, signed as
 * the side it comes from at that moment) and the largest tailwind (`tailwind`, ≥ 0) at peak speed anywhere within
 * ±veer of the reported direction. Without gusts or veer this is the steady wind's own components.
 */
export function gustExtremes(config, heading) {
  const w = reportedWind(config);
  let crosswind = 0, tailwind = 0;
  const steps = w.veer > 0 ? 32 : 0;
  for (let i = 0; i <= steps; i++) {
    const d = w.direction + (steps ? -w.veer + 2 * w.veer * i / steps : 0), c = components(d, w.peak, heading);
    if (Math.abs(c.crosswind) > Math.abs(crosswind)) crosswind = c.crosswind;
    tailwind = Math.max(tailwind, -c.headwind);
  }
  return { crosswind, tailwind };
}

/** Words for components (m/s): `along` ("Headwind 6 kt", "Tailwind 3 kt", "No headwind"), `cross`, and a short form. */
export function componentText({ headwind, crosswind }) {
  const h = kt(headwind), x = kt(crosswind);
  const along = h === 0 ? 'No headwind' : headwind > 0 ? `Headwind ${h} kt` : `Tailwind ${h} kt`;
  const cross = x === 0 ? 'no crosswind' : `crosswind ${x} kt from the ${crosswind > 0 ? 'right' : 'left'}`;
  const short = [h === 0 ? null : `${headwind > 0 ? 'Head' : 'Tail'} ${h}`, x === 0 ? null : `Cross ${x} ${crosswind > 0 ? 'R' : 'L'}`].filter(Boolean).join(' · ');
  return { along, cross, text: `${along} · ${cross}`, short: short ? `${short} kt` : 'Calm', side: x === 0 ? '' : crosswind > 0 ? 'right' : 'left',
    tone: headwind <= -RUNWAY_WIND.switch ? 'tailwind' : headwind >= RUNWAY_WIND.switch ? 'headwind' : 'neutral' };
}

/**
 * The along-runway band for a headwind (m/s), with hysteresis against the previous band for the same field and
 * runway: 'into' (a headwind), 'tail' (a tailwind worth turning round for) or 'across' (neither, ambiguous).
 */
export function windBand(headwind, previous) {
  const { keep, switch: enter } = RUNWAY_WIND;
  if (previous === 'tail' && headwind <= -keep) return 'tail';
  if (previous === 'into' && headwind >= keep) return 'into';
  if (headwind >= enter) return 'into';
  if (headwind <= -enter) return 'tail';
  return 'across';
}

/**
 * Advice for landing or departing on `runway` at `airport` (a registry field) in a wind configuration, for an
 * aircraft (a fleet id). `previous` is the band an earlier call returned for the same field and runway (or
 * undefined). Returns the components on both directions, gust extremes, the band, a verdict and — only when the
 * reciprocal has the lower tailwind by a clear margin — `recommended`, its designator; `canApply` says whether the
 * pilot may be offered it, which needs the aircraft to suit the field. Nothing here changes any state.
 */
export function adviseRunway(airport, runway, config, aircraftId, previous) {
  const selected = airport.runways.find(r => r.designator === runway) ?? airport.runways[0];
  const other = airport.runways.find(r => r !== selected);
  const w = reportedWind(config), fit = suitability(airport, aircraftId);
  const here = components(w.direction, w.speed, selected.heading), there = components(w.direction, w.speed, other.heading);
  const gust = w.gusting || w.veer > 0 ? gustExtremes(config, selected.heading) : null;
  const band = w.calm ? 'calm' : windBand(here.headwind, previous);
  const across = Math.abs(here.crosswind), crossKt = kt(here.crosswind);
  let verdict, recommended = null;
  if (band === 'calm') verdict = 'calm';
  else if (band === 'tail') { verdict = 'switch'; recommended = other.designator; }
  else if (band === 'into') verdict = 'into-wind';
  else verdict = across >= RUNWAY_WIND.trace ? 'crosswind' : 'light';
  const canApply = !!recommended && fit.rating !== 'unsuitable';
  const strong = Math.max(across, Math.abs(gust?.crosswind ?? 0)) >= RUNWAY_WIND.strong;
  const headline = {
    calm: 'Calm · either runway',
    'into-wind': `Into wind on runway ${selected.designator}`,
    switch: `Tailwind on runway ${selected.designator} · runway ${other.designator} is into wind`,
    crosswind: `${crossKt >= kt(RUNWAY_WIND.strong) ? 'Strong' : 'Direct'} crosswind · little headwind either way`,
    light: 'Light wind · either runway',
  }[verdict];
  return { field: airport.id, runway: selected.designator, reciprocal: other.designator, heading: selected.heading,
    wind: w, band, verdict, recommended, canApply, rating: fit.rating, strong, headline,
    selected: here, other: there, gust };
}

/** Instantaneous components (m/s) of a live wind sample for a field's runway heading: what the readouts show. */
export const liveComponents = (sample, field) => windComponents(sample, field.heading);

/**
 * The live readout for the map row: the runway in use (the mission's locked runway while one is underway,
 * otherwise the selected one) and the sample's components. `arrow` is the screen rotation (radians, north-up map)
 * of an arrow pointing where the air is going, or null in calm air.
 */
export function windReadout(sample, field) {
  const c = liveComponents(sample, field), t = componentText(c), still = !(Math.hypot(sample.x, sample.z) >= RUNWAY_WIND.trace);
  return { runway: field.runway, ident: field.ident, ...c, text: still ? 'Calm' : t.short, words: still ? 'calm' : t.text.toLowerCase(),
    tone: still ? 'neutral' : t.tone, arrow: still ? null : Math.atan2(sample.x, -sample.z) };
}

/**
 * The field and runway a live readout describes: a landing mission's own locked field while one is underway (even
 * when Explore selects another), otherwise the selected one.
 */
export const readoutField = (selection, landing) => landing && landing.status !== 'idle' ? landing.field : selection.field;

/**
 * Applies advice only when the pilot asks (a button): selects the recommended runway at the advised field and
 * nothing more. Returns false, changing nothing, when there is no recommendation the pilot may be offered or the
 * selection has moved on since the advice was given. Never starts, moves or alters a flight or a mission.
 */
export function applyAdvice(selection, advice) {
  if (!advice?.canApply || selection.id !== advice.field || selection.runway !== advice.runway) return false;
  return selection.select(advice.field, advice.recommended);
}
