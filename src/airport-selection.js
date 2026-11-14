// The selected airport: the one owner of the field and runway that runway
// departures and new landing missions use, persisted as a stable registry id.
// Pure data and events (no three.js, no DOM), like airports.js.
//
// Selecting a field never moves a flight: main.js only reads it when the pilot
// asks for a departure or a landing mission. A mission keeps its own field
// (LandingMission.field) until it is cancelled, so retries stay where they began.
import { AIRPORTS, ALPINE_FIELD, airportById, runwayDirection, suitability } from './airports.js';
import { region } from './regions.js';

export const DEFAULT_AIRPORT = ALPINE_FIELD.id;

/**
 * A saved `{ airport id, runway }` made safe: an unknown or missing id falls back
 * to Alpine Field, a runway the field lacks to its primary runway. `field` is the
 * registry field turned to land on that runway (runwayDirection).
 */
export function resolveAirport(id, runway) {
  const airport = airportById(id) ?? ALPINE_FIELD;
  const designator = runway === airport.reciprocal ? airport.reciprocal : airport.runway;
  return { id: airport.id, runway: designator, airport, field: runwayDirection(airport, designator) };
}

/** Whole degrees for a heading in radians, 001–360 as runways are read. */
export const headingDegrees = heading => String(Math.round((heading * 180 / Math.PI % 360 + 360) % 360) || 360).padStart(3, '0');

/** Short public description of a field and runway, for event payloads and diagnostics. */
export function describeField(field) {
  return { id: field.id, ident: field.ident, name: field.name, region: field.region, regionName: region(field.region)?.name ?? '',
    runway: field.runway, reciprocal: field.reciprocal, heading: field.heading, x: field.x, z: field.z, elevation: field.elevation,
    runwayLength: field.runwayLength, runwayWidth: field.runwayWidth, surface: field.surface,
    threshold: { ...field.runways[0].threshold } };
}

/**
 * Whether a scored landing mission can be flown by an aircraft (a fleet id) at
 * a field. Unsuitable pairings (too short, too narrow, grass for a paved-only
 * aircraft) are refused with the reason and the fields that do suit it, nearest
 * first; runway departures stay open to any pairing for free exploration.
 */
export function missionAvailability(airport, aircraftId) {
  const fit = suitability(airport, aircraftId), available = fit.rating !== 'unsuitable';
  const away = a => Math.hypot(a.x - airport.x, a.z - airport.z);
  return { available, rating: fit.rating, reason: fit.reason,
    alternatives: available ? [] : AIRPORTS.filter(a => suitability(a, aircraftId).rating !== 'unsuitable').sort((a, b) => away(a) - away(b)).map(a => a.id) };
}

/**
 * The selection: `id`, `runway`, `airport` (registry field) and `field` (turned
 * to the selected runway). `select()` fires a 'change' event only when either
 * changes. Construct it from saved settings; bad values fall back safely.
 */
export class AirportSelection extends EventTarget {
  constructor(id, runway) { super(); Object.assign(this, resolveAirport(id, runway)); }

  /** Choose a field (and optionally its runway); keeps the runway when re-selecting the same field. */
  select(id, runway) {
    const next = resolveAirport(id, runway ?? (id === this.id ? this.runway : undefined));
    if (next.id === this.id && next.runway === this.runway) return false;
    Object.assign(this, next);
    this.dispatchEvent(new Event('change'));
    return true;
  }

  snapshot() { return describeField(this.field); }
}
