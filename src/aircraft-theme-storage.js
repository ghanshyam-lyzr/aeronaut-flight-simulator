import { FLEET } from './fleet.js';
import { factoryAircraftTheme, normalizeAircraftTheme } from './aircraft-themes.js';

export const AIRCRAFT_THEME_STORAGE_PREFIX = 'aeronaut-aircraft-theme';
export const AIRCRAFT_THEME_STORAGE_VERSION = 1;
const keyFor = id => typeof id === 'string' && Object.hasOwn(FLEET, id) ? `${AIRCRAFT_THEME_STORAGE_PREFIX}.${id}` : null;
const browserStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** One versioned entry per known aircraft. Missing, old, corrupt or blocked storage yields Factory. */
export function loadAircraftTheme(id, storage = browserStorage()) {
  const key = keyFor(id);
  if (!key) return factoryAircraftTheme();
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? 'null');
    return saved?.version === AIRCRAFT_THEME_STORAGE_VERSION ? normalizeAircraftTheme(saved.theme) : factoryAircraftTheme();
  } catch { return factoryAircraftTheme(); }
}

/** Save a validated copy; a full or unavailable browser store never interrupts flying. */
export function saveAircraftTheme(id, theme, storage = browserStorage()) {
  const key = keyFor(id);
  if (!key || !storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ version: AIRCRAFT_THEME_STORAGE_VERSION, theme: normalizeAircraftTheme(theme) }));
    return true;
  } catch { return false; }
}

/** Remove only this aircraft's choice. Call model.paint.restore() separately to update the live airframe. */
export function resetAircraftTheme(id, storage = browserStorage()) {
  const key = keyFor(id);
  if (!key || !storage) return false;
  try { storage.removeItem(key); return true; } catch { return false; }
}
