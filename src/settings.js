// Saved preferences: one validated shape, finite bounds and enums, and safe storage.
// Every value read back from storage passes through normalizeSettings, so a corrupt,
// partial, older or hand-edited `aeronaut-settings` entry still yields a flyable sim.
import { aircraftType } from './fleet.js';
import { FRAMINGS, ZOOM_SPANS } from './navigation.js';

export const SETTINGS_KEY = 'aeronaut-settings';
export const SETTINGS_VERSION = 2;
export const AXES = Object.freeze(['pitch', 'roll', 'yaw', 'throttle']);
export const QUALITIES = Object.freeze(['high', 'medium', 'low']);
export const WEATHERS = Object.freeze(['clear', 'golden', 'overcast']);
export const VIEWS = Object.freeze(['chase', 'cockpit', 'orbit']);
// Control response multiplies how fast a held input travels to full deflection. 100% is the
// original gentle ramp; full deflection is always reached, so held authority never changes.
export const RESPONSE = Object.freeze({ min: 0.5, max: 2, step: 0.25 });
// Chase distance only pulls the camera back from the fitted default, so the whole aircraft
// still fits portrait screens; it never moves closer.
export const CHASE_DISTANCE = Object.freeze({ min: 1, max: 1.6, step: 0.1 });
export const VOLUME = Object.freeze({ min: 0, max: 1, step: 0.05 });
export const DISPLAY = Object.freeze(['showHud', 'showInstruments', 'showHints', 'showCrosshair', 'showMap']);

const DEFAULTS = Object.freeze({
  quality: 'high', invertPitch: false, mouseSteering: false,
  response: Object.freeze({ pitch: 1, roll: 1, yaw: 1, throttle: 1 }),
  camera: 'chase', chaseDistance: 1,
  // Sound stays off until the pilot turns it on, as before; unmuting is remembered.
  volume: 1, muted: true,
  showHud: true, showInstruments: true, showHints: true, showCrosshair: true, showMap: true,
  weather: 'clear', aircraft: 'jet', mapFraming: 'route', mapZoom: 3,
});

// Restore defaults resets these; aircraft, airfield/runway, weather and map framing are choices
// made elsewhere and survive, as do the logbook and the flight in progress.
export const CUSTOMIZATION_KEYS = Object.freeze(['quality', 'invertPitch', 'mouseSteering', 'response', 'camera', 'chaseDistance', 'volume', 'muted', ...DISPLAY]);

export function defaultSettings() {
  return { ...DEFAULTS, response: { ...DEFAULTS.response }, version: SETTINGS_VERSION };
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const oneOf = (values, value, fallback) => values.includes(value) ? value : fallback;
const flag = (value, fallback) => typeof value === 'boolean' ? value : fallback;
/** A finite number clamped to [min, max] and snapped to the step; anything else is the fallback. */
export function bounded(value, { min, max, step }, fallback) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  const snapped = min + Math.round((Math.min(max, Math.max(min, n)) - min) / step) * step;
  return Math.round(Math.min(max, snapped) * 1000) / 1000;
}

/** Validates any stored value (including version-1 settings, which had no version) into the current shape. */
export function normalizeSettings(raw) {
  const s = isObject(raw) ? raw : {};
  const d = defaultSettings();
  const response = isObject(s.response) ? s.response : {};
  const out = {
    version: SETTINGS_VERSION,
    quality: oneOf(QUALITIES, s.quality, d.quality),
    invertPitch: flag(s.invertPitch, d.invertPitch),
    mouseSteering: flag(s.mouseSteering, d.mouseSteering),
    response: Object.fromEntries(AXES.map(axis => [axis, bounded(response[axis], RESPONSE, 1)])),
    camera: oneOf(VIEWS, s.camera, d.camera),
    chaseDistance: bounded(s.chaseDistance, CHASE_DISTANCE, d.chaseDistance),
    volume: bounded(s.volume, VOLUME, d.volume),
    muted: flag(s.muted, d.muted),
    weather: oneOf(WEATHERS, s.weather, d.weather),
    aircraft: aircraftType(typeof s.aircraft === 'string' ? s.aircraft : d.aircraft).id,
    mapFraming: oneOf(FRAMINGS, s.mapFraming, d.mapFraming),
    mapZoom: Math.round(bounded(s.mapZoom, { min: 0, max: ZOOM_SPANS.length - 1, step: 1 }, d.mapZoom)),
  };
  for (const key of DISPLAY) out[key] = flag(s[key], d[key]);
  // The airfield and runway are validated by AirportSelection, which falls back to Alpine Field 36.
  if (typeof s.airport === 'string') out.airport = s.airport;
  if (typeof s.runway === 'string') out.runway = s.runway;
  return out;
}

/** Resets customization only; selections (aircraft, field, runway, weather, map framing) are kept. */
export function resetSettings(current) {
  const s = normalizeSettings(current), d = defaultSettings();
  for (const key of CUSTOMIZATION_KEYS) s[key] = key === 'response' ? { ...d.response } : d[key];
  return s;
}

/** The browser's storage, or null where it is blocked (private modes, sandboxed frames). */
export function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function loadSettings(storage = browserStorage()) {
  let raw = null;
  try { raw = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null'); } catch { raw = null; }
  return normalizeSettings(raw);
}

/** Saves a validated copy; returns false when storage is unavailable or full, never throws. */
export function saveSettings(settings, storage = browserStorage()) {
  if (!storage) return false;
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings))); return true; } catch { return false; }
}

export const percent = value => `${Math.round(value * 100)}%`;
