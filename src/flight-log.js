// Browser-local history uses the same safe storage boundary as preferences.
import { browserStorage } from './settings.js';
import { FLEET } from './fleet.js';

export const FLIGHTS_KEY = 'aeronaut-flights';
export const MAX_FLIGHTS = 20;
const metric = value => Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, value)) : 0;
function dateString(value) {
  // Saved dates are ISO strings. Date.parse alone silently rolls February 30 into March.
  const parts = typeof value === 'string' && /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (!parts) return null;
  const [year, month, day] = parts.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  const timestamp = Date.parse(value);
  return day >= 1 && day <= days && Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeFlight(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (!Object.hasOwn(value, 'time') && !Object.hasOwn(value, 'distance'))) return null;
  const entry = { date: dateString(value.date), time: metric(value.time), distance: metric(value.distance), maxAltitude: metric(value.maxAltitude) };
  // Older entries predate aircraft ids. Unknown ids must not be attributed to the default jet.
  if (typeof value.aircraft === 'string' && Object.hasOwn(FLEET, value.aircraft)) entry.aircraft = value.aircraft;
  return entry;
}

/** Keep the first 20 recoverable flights in their existing newest-first order. */
export function normalizeFlights(value) {
  const flights = [];
  if (!Array.isArray(value)) return flights;
  for (const raw of value) {
    const entry = normalizeFlight(raw);
    if (entry) flights.push(entry);
    if (flights.length === MAX_FLIGHTS) break;
  }
  return flights;
}

export function loadFlights(storage = browserStorage()) {
  try { return normalizeFlights(JSON.parse(storage?.getItem(FLIGHTS_KEY) ?? 'null')); } catch { return []; }
}

/** Normalize on write too; blocked/full storage never interrupts a flight. */
export function saveFlights(flights, storage = browserStorage()) {
  if (!storage) return false;
  try { storage.setItem(FLIGHTS_KEY, JSON.stringify(normalizeFlights(flights))); return true; } catch { return false; }
}

/** A completed flight is eligible at ten seconds, just as before. Never mutate the caller's history. */
export function recordFlight(flights, value) {
  const entry = normalizeFlight(value), history = normalizeFlights(flights);
  return entry && entry.time >= 10 ? [entry, ...history].slice(0, MAX_FLIGHTS) : history;
}

export function flightTotals(flights, current = {}) {
  return normalizeFlights(flights).reduce((total, entry) => ({ time: metric(total.time + entry.time), distance: metric(total.distance + entry.distance) }),
    { time: metric(current?.time), distance: metric(current?.distance) });
}

export function formatFlightDate(value, locale) {
  const date = dateString(value);
  return date === null ? 'Unknown date' : new Date(date).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}
