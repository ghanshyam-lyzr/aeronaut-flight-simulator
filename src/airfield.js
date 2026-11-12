// One source for the visible runway, mission coordinates and map. Distances are metres.
export const AIRFIELD = Object.freeze({
  x: 900, z: -1800, elevation: 78, runwayLength: 1100, runwayWidth: 53,
  heading: 0, name: 'Alpine Field', runway: '36',
});

/** Distance along runway 36 from its south threshold, and right of its centreline. */
export function runwayCoordinates(position, field = AIRFIELD) {
  const dx = position.x - field.x, dz = position.z - field.z;
  return { along: dx * Math.sin(field.heading) - dz * Math.cos(field.heading) + field.runwayLength / 2,
    cross: dx * Math.cos(field.heading) + dz * Math.sin(field.heading) };
}

export function runwayPoint(along, cross = 0, field = AIRFIELD) {
  const d = along - field.runwayLength / 2;
  return { x: field.x + d * Math.sin(field.heading) + cross * Math.cos(field.heading),
    z: field.z - d * Math.cos(field.heading) + cross * Math.sin(field.heading) };
}
