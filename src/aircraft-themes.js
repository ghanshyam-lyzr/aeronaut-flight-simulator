// Exterior paint only. Factory is intentionally not a color triplet: each model keeps its own materials.
export const PAINT_ROLES = Object.freeze(['body', 'accent', 'stripe']);
export const AIRCRAFT_THEME_PRESETS = Object.freeze([
  Object.freeze({ id: 'factory', label: 'Factory', colors: null }),
  Object.freeze({ id: 'alpine-rescue', label: 'Alpine rescue', colors: Object.freeze({ body: '#eeeae0', accent: '#d5442e', stripe: '#f4c65b' }) }),
  Object.freeze({ id: 'glacier', label: 'Glacier', colors: Object.freeze({ body: '#e4edef', accent: '#245963', stripe: '#86c5cb' }) }),
  Object.freeze({ id: 'midnight', label: 'Midnight', colors: Object.freeze({ body: '#26343f', accent: '#111d27', stripe: '#c49a60' }) }),
]);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const factoryAircraftTheme = () => ({ preset: 'factory', colors: null });

/** Accept CSS #RGB / #RRGGBB only; canonical values always use six lowercase digits. */
export function normalizePaintHex(value) {
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) return null;
  const hex = value.trim().slice(1).toLowerCase();
  return `#${hex.length === 3 ? [...hex].map(c => c + c).join('') : hex}`;
}

/** Invalid/partial custom input restores Factory; presets always use their authoritative palette. */
export function normalizeAircraftTheme(value) {
  const preset = typeof value === 'string' ? value : isObject(value) ? value.preset : null;
  const known = AIRCRAFT_THEME_PRESETS.find(p => p.id === preset);
  if (known) return { preset: known.id, colors: known.colors ? { ...known.colors } : null };
  if (preset !== 'custom' || !isObject(value.colors)) return factoryAircraftTheme();
  const colors = Object.fromEntries(PAINT_ROLES.map(role => [role, normalizePaintHex(value.colors[role])]));
  return PAINT_ROLES.every(role => colors[role]) ? { preset: 'custom', colors } : factoryAircraftTheme();
}
