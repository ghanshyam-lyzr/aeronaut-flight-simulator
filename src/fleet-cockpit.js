import * as THREE from 'three';
import { aircraftType } from './fleet.js';

/** Camera-local decks: analogue singles, twin-prop engine monitor, and glass passenger flight decks. */
export function createFleetCockpit(id) {
  const type = aircraftType(id), single = type.fixedGear, bubble = id === 'aerobatic', twinProp = id === 'commuter';
  const root = new THREE.Group(); root.name = `${type.name} — cockpit`;
  const panel = new THREE.Group(); panel.position.set(0, 0.25, -0.45); root.add(panel);
  const dark = new THREE.MeshStandardMaterial({ color: 'hsl(205, 20%, 13%)', roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: 'hsl(205, 12%, 30%)', metalness: 0.5, roughness: 0.4 });
  function part(g, m = dark, parent = root) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; parent.add(mesh); return mesh; }
  function bar(a, b, r = 0.035, mat = dark) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), mesh = part(new THREE.CylinderGeometry(r, r, start.distanceTo(end), 8), mat);
    mesh.position.copy(start).add(end).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  }
  for (const side of [-1, 1]) {
    bar([side * 1.55, -0.9, -1.6], [side * 1.55, -0.75, -2.65], 0.05);
    if (!bubble) bar([side * 1.55, -0.8, -1.8], [side * 1.25, 1.6, -2.25], single ? 0.04 : 0.055);
  }
  if (single && !bubble) bar([-1.3, 1.45, -2.2], [1.3, 1.45, -2.2], 0.07); // high-wing cabin roof beam
  if (!single) {
    bar([0.66, -0.65, -2.2], [0.52, 1.75, -2.35], 0.04); // offset central windshield pillar
    bar([-1.3, 1.65, -2.25], [1.3, 1.65, -2.25], 0.06);
  }
  const shell = part(new THREE.BoxGeometry(single ? 2.55 : 3, 0.54, 0.18), dark, panel); shell.position.set(0, -0.94, -1.9);
  const hood = part(new THREE.BoxGeometry(single ? 2.65 : 3.1, 0.06, 0.4), trim, panel); hood.position.set(0, -0.65, -1.96);
  if (bubble) {
    bar([0, -1.4, -1.3], [0, -0.94, -1.55], 0.045, trim);
    const grip = part(new THREE.BoxGeometry(0.1, 0.18, 0.1)); grip.position.set(0, -0.9, -1.55);
  } else for (const x of single ? [-0.35] : [-0.45, 0.9]) {
    bar([x, -1.42, -1.4], [x, -1.05, -1.5], 0.035, trim);
    bar([x - 0.17, -0.98, -1.5], [x, -1.08, -1.5], 0.025, trim);
    bar([x, -1.08, -1.5], [x + 0.17, -0.98, -1.5], 0.025, trim);
  }
  root.userData.fit = aspect => { panel.scale.x = Math.min(1, Math.max(0.43, aspect / 1.05)); panel.position.y = aspect < 0.8 ? 0.3 : 0.25; };
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 250;
    const ctx = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const screen = part(new THREE.PlaneGeometry(single ? 2.42 : 2.84, 0.48), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), panel);
    screen.position.set(0, -0.94, -1.801);
    const colors = { background: 'hsl(205 20% 10%)', ink: 'hsl(60 9% 96%)', muted: 'hsl(200 10% 65%)', signal: 'hsl(77 88% 67%)', sky: 'hsl(201 32% 31%)', earth: 'hsl(39 24% 30%)' };
    const text = (label, x, y, size = 18, color = colors.ink) => { ctx.fillStyle = color; ctx.font = `${size}px monospace`; ctx.textAlign = 'center'; ctx.fillText(label, x, y); };
    function dial(x, label, value, max, units) {
      ctx.fillStyle = 'hsl(205 15% 26%)'; ctx.beginPath(); ctx.arc(x, 140, 82, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors.background; ctx.beginPath(); ctx.arc(x, 140, 75, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i <= 20; i++) {
        const a = Math.PI * (0.75 + i / 20 * 1.5); ctx.strokeStyle = colors.muted; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 61, 140 + Math.sin(a) * 61); ctx.lineTo(x + Math.cos(a) * 69, 140 + Math.sin(a) * 69); ctx.stroke();
      }
      const a = Math.PI * (0.75 + THREE.MathUtils.clamp(value / max, 0, 1) * 1.5);
      ctx.strokeStyle = colors.signal; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, 140); ctx.lineTo(x + Math.cos(a) * 57, 140 + Math.sin(a) * 57); ctx.stroke();
      text(label, x, 112, 13, colors.muted); text(String(Math.round(value)), x, 180, 21); text(units, x, 200, 11, colors.muted);
    }
    let last = -1;
    root.userData.update = state => {
      const tick = Math.floor((state.flightTime ?? 0) * 8); if (tick === last) return; last = tick;
      ctx.fillStyle = colors.background; ctx.fillRect(0, 0, 1200, 250);
      text(`${type.name.toUpperCase()} / ${type.registration}`, 600, 24, 18, colors.muted);
      const knots = state.speed * 1.94384, altitude = state.position.y * 3.28084;
      if (single) {
        dial(110, 'AIRSPEED', knots, type.speedScale, 'KT'); dial(320, 'ALTITUDE', altitude, 10000, 'FT');
        dial(880, 'ENGINE', (state.spool ?? 0) * 2700, 3000, 'RPM'); dial(1090, 'VSI', Math.abs(state.verticalSpeed) * 196.85, 2000, 'FT/MIN');
      } else {
        text(`${Math.round(knots)} KT`, 110, 115, 28, colors.signal); text(`${Math.round(altitude)} FT`, 110, 158, 24);
        text(`HDG ${String(Math.round(state.heading * 180 / Math.PI) % 360).padStart(3, '0')}`, 110, 200, 18);
        text(twinProp ? 'PROP L / R' : 'FAN L / R', 900, 80, 16, colors.muted);
        text(`${Math.round((state.spool ?? 0) * 100)}%   ${Math.round((state.spool ?? 0) * 100)}%`, 900, 125, 24, colors.signal);
        text(`FLAPS ${state.flaps * 15}°`, 900, 172, 19); text(`GEAR ${state.gearDown ? 'DOWN' : 'UP'}`, 900, 205, 19);
        text(type.badge, 1100, 135, 22, colors.muted);
      }
      ctx.save(); ctx.beginPath(); ctx.rect(435, 50, 330, 180); ctx.clip(); ctx.translate(600, 140); ctx.rotate(-state.bank); ctx.translate(0, state.pitch * 120);
      ctx.fillStyle = colors.sky; ctx.fillRect(-260, -300, 520, 300); ctx.fillStyle = colors.earth; ctx.fillRect(-260, 0, 520, 300);
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-250, 0); ctx.lineTo(250, 0); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = colors.signal; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(550, 140); ctx.lineTo(585, 140); ctx.lineTo(600, 148); ctx.lineTo(615, 140); ctx.lineTo(650, 140); ctx.stroke();
      texture.needsUpdate = true;
    };
  }
  return root;
}
