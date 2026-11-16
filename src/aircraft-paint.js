import { PAINT_ROLES, factoryAircraftTheme, normalizeAircraftTheme } from './aircraft-themes.js';

/**
 * Bind explicitly owned exterior materials once, after building a model. Never discovers paint by color
 * or traverses meshes. Shared protected details must have their own material before static batching.
 */
export function createAircraftPaint(bindings) {
  const materials = {}, snapshots = [], seen = new Set();
  for (const role of PAINT_ROLES) {
    const list = bindings[role] ?? [];
    if (!list.length) continue;
    for (const material of list) {
      if (!material?.color || seen.has(material)) throw new Error(`Invalid or repeated aircraft paint binding: ${role}`);
      seen.add(material);
      snapshots.push({ role, material, color: material.color.clone(), vertexColors: material.vertexColors });
    }
    materials[role] = Object.freeze([...list]);
  }
  Object.freeze(materials);
  let current = factoryAircraftTheme();
  const apply = value => {
    const theme = normalizeAircraftTheme(value), factory = theme.preset === 'factory';
    for (const { role, material, color, vertexColors } of snapshots) {
      if (factory) material.color.copy(color);
      else material.color.set(theme.colors[role]);
      // Fighter counter-shading lives in geometry colors. Keep it intact for exact Factory restoration,
      // but don't multiply a pilot's chosen body color by the old grey paint.
      const next = factory ? vertexColors : false;
      if (material.vertexColors !== next) { material.vertexColors = next; material.needsUpdate = true; }
    }
    current = theme;
    return normalizeAircraftTheme(current);
  };
  return Object.freeze({
    roles: Object.freeze(Object.keys(materials)), materials,
    get theme() { return normalizeAircraftTheme(current); },
    apply,
    restore() { return apply('factory'); },
  });
}
