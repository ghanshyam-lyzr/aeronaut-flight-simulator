// The navigation map's canvas: cached terrain tiles from the world's own height
// function, airports with their runways, named places, the route to the
// destination, the flight trail and the aircraft. The arithmetic lives in
// navigation.js; this file only draws. One tile cache serves every map.
import { WORLD } from './regions.js';
import { mapAirports, mapPlaces, frameView, placeLabels, edgePointer, scaleBar, tileLevel, tilesFor, parentTile, rasterTile, TILE_PIXELS, ZOOM_SPANS } from './navigation.js';

// ---- Tile cache ---------------------------------------------------------------

const KEEP = 700;              // Tiles kept (32 px each: about 3 MB of canvas).
class TileCache {
  constructor() { this.tiles = new Map(); this.heightAt = null; }
  get(key) { const c = this.tiles.get(key); if (c) { this.tiles.delete(key); this.tiles.set(key, c); } return c; }
  build(t) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = TILE_PIXELS;
    canvas.getContext('2d').putImageData(new ImageData(rasterTile(t, this.heightAt), TILE_PIXELS), 0, 0);
    this.tiles.set(t.key, canvas);
    // Forget the least recently drawn tiles, but never the coarse levels every view falls back on.
    for (const key of this.tiles.keys()) { if (this.tiles.size <= KEEP) break; if (Number(key[0]) > 2) this.tiles.delete(key); }
    return canvas;
  }
}
const cache = new TileCache();

// ---- Drawing ------------------------------------------------------------------

const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const widths = new Map();
function textWidth(ctx, text) {
  const key = `${ctx.font}|${text}`;
  if (!widths.has(key)) widths.set(key, ctx.measureText(text).width);
  return widths.get(key);
}

/**
 * A map on a canvas. `options.heightAt` is the world's height function;
 * `options.compact` marks the small in-flight map (identifiers only, fewer
 * places, room kept for the north arrow).
 */
export class NavigationMap {
  constructor(canvas, { heightAt, compact = false, quality = 'high' }) {
    cache.heightAt = heightAt;
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.compact = compact; this.view = null; this.pending = 0;
    this.places = mapPlaces();
    this.colors = { accent: token('--accent'), ink: token('--background'), ivory: token('--foreground'), muted: token('--muted') };
    this.setQuality(quality);
  }

  setQuality(quality) { this.quality = quality; this.width = 0; }

  // Matches the backing store to the canvas's CSS size; true when it is laid out.
  fit() {
    const w = Math.round(this.canvas.clientWidth), h = Math.round(this.canvas.clientHeight);
    if (!w || !h) return false;
    const dpr = Math.min(devicePixelRatio || 1, this.quality === 'low' ? 1 : 2);
    if (w !== this.width || h !== this.height || dpr !== this.dpr) {
      Object.assign(this, { width: w, height: h, dpr });
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    }
    return true;
  }

  /**
   * Draw. `scene` = { framing (navigation state, updated in place), aircraft
   * { x, z, heading }, destination (navigationDestination) or null, trail [{x, z}],
   * budget (ms of terrain sampling allowed this call) }. Returns the view drawn.
   */
  draw({ framing, aircraft, destination, trail = [], budget }) {
    if (!this.fit()) return null;
    const { ctx, width, height, compact, colors } = this, low = this.quality === 'low';
    const view = this.view = frameView(framing, width, height, aircraft, destination, compact ? 20 : 34);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = colors.ink; ctx.fillRect(0, 0, width, height);
    // The chart samples a little coarser than its pixels; low quality samples a quarter as much again.
    this.drawTerrain(view, budget ?? (low ? 3 : 6), (compact ? 1 : 1.5) * (low ? 2 : 1));

    // The world's edge, where the terrain ends.
    const [ex0, ez0] = view.project(WORLD.minX, WORLD.minZ), [ex1, ez1] = view.project(WORLD.maxX, WORLD.maxZ);
    ctx.strokeStyle = 'hsl(60 9% 96% / .18)'; ctx.lineWidth = 1; ctx.strokeRect(ex0 + .5, ez0 + .5, ex1 - ex0 - 1, ez1 - ez0 - 1);

    const plane = view.project(aircraft.x, aircraft.z), reserved = [];
    if (compact) reserved.push({ x: width - 34, y: 0, w: 34, h: 40 });
    const scale = scaleBar(view.mpp, compact ? 56 : 90);
    ctx.font = `500 11px 'DM Sans', sans-serif`;
    const scaleBox = { x: width - 10 - Math.max(scale.px, textWidth(ctx, scale.label)), y: height - 26, w: Math.max(scale.px, textWidth(ctx, scale.label)) + 10, h: 26 };
    reserved.push(scaleBox, { x: plane[0] - 11, y: plane[1] - 11, w: 22, h: 22 });

    // Route: a quiet line from the aircraft to the destination, and the
    // destination runway's extended centreline toward its threshold.
    if (destination) {
      const d = view.project(destination.x, destination.z);
      ctx.save(); ctx.setLineDash([2, 4]); ctx.lineWidth = 1.25; ctx.strokeStyle = 'hsl(60 9% 96% / .55)';
      ctx.beginPath(); ctx.moveTo(...plane); ctx.lineTo(...d); ctx.stroke();
      if (destination.threshold) {
        const t = view.project(destination.threshold.x, destination.threshold.z), out = 3000;
        const o = view.project(destination.threshold.x - Math.sin(destination.heading) * out, destination.threshold.z + Math.cos(destination.heading) * out);
        ctx.setLineDash([5, 4]); ctx.strokeStyle = 'hsl(77 88% 67% / .45)'; ctx.beginPath(); ctx.moveTo(...o); ctx.lineTo(...t); ctx.stroke();
      }
      ctx.restore();
    }

    // Flight trail since the last start, as before: dashed chartreuse.
    ctx.save(); ctx.strokeStyle = 'hsl(77 88% 67% / .6)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.beginPath();
    const stride = low && trail.length > 600 ? 2 : 1;
    trail.forEach((p, i) => { if (i % stride && i !== trail.length - 1) return; const q = view.project(p.x, p.z); i ? ctx.lineTo(...q) : ctx.moveTo(...q); });
    if (trail.length) ctx.lineTo(...plane);
    ctx.stroke(); ctx.restore();

    // Airports: each runway to scale (never shorter than 10 px) along its heading.
    const labels = [], span = view.mpp * Math.min(width, height);
    for (const a of mapAirports(destination?.id)) {
      const p = view.project(a.x, a.z), dest = a.id === destination?.id, len = Math.max(10, a.runwayLength / view.mpp) / 2;
      if (p[0] < -40 || p[1] < -40 || p[0] > width + 40 || p[1] > height + 40) continue;
      ctx.save(); ctx.translate(...p); ctx.rotate(a.heading); ctx.lineCap = 'round';
      ctx.strokeStyle = 'hsl(210 8% 9% / .7)'; ctx.lineWidth = dest ? 6 : 5; ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(0, len); ctx.stroke();
      ctx.strokeStyle = dest ? colors.accent : 'hsl(60 9% 96% / .9)'; ctx.lineWidth = dest ? 3 : 2.5; ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(0, len); ctx.stroke();
      ctx.restore();
      if (dest) { ctx.strokeStyle = colors.accent; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(...p, Math.max(9, len + 4), 0, Math.PI * 2); ctx.stroke(); }
      const r = dest ? Math.max(9, len + 4) : Math.min(len, 8);
      reserved.push({ x: p[0] - r, y: p[1] - r, w: r * 2, h: r * 2 });
      const text = compact ? a.ident : `${a.name} · ${a.ident}`;
      ctx.font = compact ? `500 13px 'Barlow Condensed', sans-serif` : `500 12px 'DM Sans', sans-serif`;
      labels.push({ id: a.id, text, font: ctx.font, w: textWidth(ctx, text) + 4, h: 14, x: p[0], y: p[1], gap: r + 3, priority: dest ? 0 : 1,
        color: dest ? colors.accent : colors.ivory });
    }

    // Named places, by priority and only at the spans where they help.
    const maxPlaces = compact ? (low ? 2 : 4) : low ? 10 : 24;
    let count = 0;
    for (const p of this.places) {
      if (span < (compact ? Math.max(p.minSpan, 6000) : p.minSpan) || span > (compact ? p.maxSpan * .6 : p.maxSpan)) continue;
      if (compact && p.priority > 5) continue;
      const q = view.project(p.x, p.z);
      if (q[0] < 0 || q[1] < 0 || q[0] > width || q[1] > height) continue;
      if (count++ >= maxPlaces) break;
      const region = p.kind === 'region';
      ctx.font = region ? `500 11px 'DM Sans', sans-serif` : `400 11px 'DM Sans', sans-serif`;
      labels.push({ id: p.name, text: p.name, font: ctx.font, w: textWidth(ctx, p.name) + 4, h: 13, x: q[0], y: q[1], priority: 2 + p.priority,
        color: region ? 'hsl(60 9% 96% / .7)' : 'hsl(60 9% 96% / .85)', dot: !region, offsets: region ? [[-(textWidth(ctx, p.name) + 4) / 2, -6.5]] : undefined });
    }

    // Pointers to a destination (and, once panned away, the aircraft) beyond the edge.
    const pointers = [];
    if (destination) { const e = edgePointer(view, destination.x, destination.z, 12); if (e) pointers.push({ ...e, color: colors.accent, text: destination.ident }); }
    { const e = edgePointer(view, aircraft.x, aircraft.z, 12); if (e) pointers.push({ ...e, color: colors.ivory, text: '' }); }
    for (const e of pointers) {
      reserved.push({ x: e.x - 9, y: e.y - 9, w: 18, h: 18 });
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.angle); ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 4); ctx.lineTo(0, 1); ctx.lineTo(-6, 4); ctx.closePath();
      ctx.fillStyle = e.color; ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke(); ctx.restore();
      if (e.text) {
        ctx.font = `500 13px 'Barlow Condensed', sans-serif`;
        // Labels on the pointer's inner side, so they never run off the map.
        const w = textWidth(ctx, e.text) + 4, ox = e.x > width / 2 ? -w - 12 : 12, oy = e.y > height / 2 ? -20 : 6;
        labels.push({ id: 'pointer', text: e.text, font: ctx.font, w, h: 14, x: e.x, y: e.y, priority: -1, color: e.color, offsets: [[ox, oy], [ox, -7]] });
      }
    }

    for (const l of placeLabels(labels, width, height, reserved, 3)) {
      if (l.dot) { ctx.fillStyle = 'hsl(60 9% 96% / .7)'; ctx.beginPath(); ctx.arc(l.x, l.y, 1.8, 0, Math.PI * 2); ctx.fill(); }
      ctx.font = l.font; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'hsl(210 8% 9% / .72)'; ctx.lineWidth = 3; ctx.strokeText(l.text, l.box.x + 2, l.box.y + l.box.h / 2);
      ctx.fillStyle = l.color; ctx.fillText(l.text, l.box.x + 2, l.box.y + l.box.h / 2);
    }

    // The aircraft, nose along its heading.
    ctx.save(); ctx.translate(...plane); ctx.rotate(aircraft.heading); ctx.beginPath();
    ctx.moveTo(0, -11); ctx.lineTo(7, 9); ctx.lineTo(0, 5); ctx.lineTo(-7, 9); ctx.closePath();
    ctx.fillStyle = colors.accent; ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.fill(); ctx.stroke(); ctx.restore();

    // Scale bar, true to the view drawn.
    ctx.font = `500 11px 'DM Sans', sans-serif`; ctx.textBaseline = 'alphabetic';
    const sx = width - 10 - scale.px, sy = height - 8;
    ctx.strokeStyle = colors.ink; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + scale.px, sy); ctx.stroke();
    ctx.strokeStyle = colors.ivory; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx, sy - 3); ctx.lineTo(sx, sy); ctx.lineTo(sx + scale.px, sy); ctx.lineTo(sx + scale.px, sy - 3); ctx.stroke();
    const lw = textWidth(ctx, scale.label);
    ctx.strokeStyle = 'hsl(210 8% 9% / .72)'; ctx.lineWidth = 3; ctx.strokeText(scale.label, width - 10 - lw, sy - 6);
    ctx.fillStyle = colors.ivory; ctx.fillText(scale.label, width - 10 - lw, sy - 6);
    this.scale = scale;
    return view;
  }

  // Terrain: the tiles at the view's level, each drawn from the cache or, until
  // it is sampled, from the nearest coarser tile. New tiles are sampled centre
  // first within the time budget, so a map update never stalls a frame.
  drawTerrain(view, budget, detail) {
    const { ctx } = this, level = tileLevel(view.mpp, detail), start = performance.now();
    let pending = 0;
    ctx.imageSmoothingEnabled = true;
    // Coarse fallbacks first: build levels 0–2 under the view if missing (cheap, and kept for good).
    for (let l = 0; l <= Math.min(2, level); l++) for (const t of tilesFor(view, l)) if (!cache.get(t.key)) cache.build(t);
    for (const t of tilesFor(view, level)) {
      let canvas = cache.get(t.key);
      if (!canvas && performance.now() - start < budget) canvas = cache.build(t);
      const [x0, y0] = view.project(t.minX, t.minZ), [x1, y1] = view.project(t.minX + t.size, t.minZ + t.size);
      const dx = Math.floor(x0), dy = Math.floor(y0), dw = Math.ceil(x1) - dx, dh = Math.ceil(y1) - dy;
      if (canvas) { ctx.drawImage(canvas, dx, dy, dw, dh); continue; }
      pending++;
      // Walk up to a cached ancestor and draw the part of it this tile covers.
      let p = t, sx = 0, sy = 0, s = TILE_PIXELS;
      while ((p = parentTile(p))) {
        s /= 2; sx = sx / 2 + p.qi * TILE_PIXELS / 2; sy = sy / 2 + p.qj * TILE_PIXELS / 2;
        const c = cache.get(p.key);
        if (c) { ctx.drawImage(c, sx, sy, s, s, dx, dy, dw, dh); break; }
      }
    }
    this.pending = pending;
  }

  /** The airport id under a CSS-pixel point of the last view, or null. */
  airportAt(px, py, radius = 18) {
    if (!this.view) return null;
    let best = null, bestD = radius;
    for (const a of mapAirports()) {
      const [x, y] = this.view.project(a.x, a.z), d = Math.hypot(px - x, py - y);
      if (d < bestD) { best = a.id; bestD = d; }
    }
    return best;
  }
}

export { ZOOM_SPANS };
