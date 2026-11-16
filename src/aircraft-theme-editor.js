import { AIRCRAFT_THEME_PRESETS, PAINT_ROLES, normalizePaintHex } from './aircraft-themes.js';
import { saveAircraftTheme, resetAircraftTheme } from './aircraft-theme-storage.js';
import { createAircraftThemePreview } from './aircraft-theme-preview.js';

const label = role => role[0].toUpperCase() + role.slice(1);
const description = { factory: 'Every original shade', 'alpine-rescue': 'Ivory · rescue red', glacier: 'Ice · deep teal', midnight: 'Slate · warm brass' };
const swatches = colors => `<span class="paint-swatches" aria-hidden="true">${colors ? Object.values(colors).map(color => `<i style="--paint-swatch:${color}"></i>`).join('') : '<span>Original</span>'}</span>`;

/** Immediate, per-aircraft appearance changes. The caller only invalidates the world render. */
export function createAircraftThemeEditor({ renderer, getAircraft, getType, onChange, back }) {
  const preview = createAircraftThemePreview(renderer);
  let root = null, colors = null;
  function palette() {
    const paint = getAircraft().paint;
    return paint.theme.colors ?? Object.fromEntries(PAINT_ROLES.map(role => [role,
      paint.materials[role]?.[0] ? `#${paint.materials[role][0].color.getHexString()}` : AIRCRAFT_THEME_PRESETS[1].colors[role]]));
  }
  function refresh(message) {
    const paint = getAircraft().paint, theme = paint.theme;
    colors = palette();
    root.querySelectorAll('[data-paint-preset]').forEach(b => {
      const on = b.dataset.paintPreset === theme.preset;
      b.setAttribute('aria-checked', on); b.tabIndex = on || (theme.preset === 'custom' && b.dataset.paintPreset === 'factory') ? 0 : -1;
    });
    for (const role of paint.roles) {
      root.querySelector(`#paint-${role}`).value = colors[role];
      const hex = root.querySelector(`#paint-${role}-hex`); hex.value = colors[role]; hex.removeAttribute('aria-invalid');
      root.querySelector(`#paint-${role}-error`).textContent = '';
    }
    root.querySelector('#paint-current').textContent = AIRCRAFT_THEME_PRESETS.find(p => p.id === theme.preset)?.label ?? 'Custom colors';
    root.querySelector('#paint-status').textContent = message ?? `Changes apply live and save for the ${getType().name}.`;
    preview.invalidate(); onChange();
  }
  function apply(value) {
    const type = getType(), theme = getAircraft().paint.apply(value);
    const saved = theme.preset === 'factory' ? resetAircraftTheme(type.id) : saveAircraftTheme(type.id, theme);
    const name = AIRCRAFT_THEME_PRESETS.find(p => p.id === theme.preset)?.label ?? 'Custom colors';
    refresh(saved ? `${name} applied · saved for ${type.name}.` : `${name} applied for this flight. Browser storage is unavailable; ${theme.preset === 'factory' ? 'the previous colors may return' : 'this choice may be lost'} after reload.`);
  }
  return {
    markup() {
      const type = getType(), paint = getAircraft().paint; colors = palette();
      return `<div class="dialog-head"><div><button class="paint-back" id="paint-back">← Explore</button><h2 id="paint-title">Aircraft appearance</h2></div><button class="icon-btn" data-close aria-label="Close aircraft appearance"><i data-lucide="x"></i></button></div>
      <div class="paint-layout"><section class="paint-preview" aria-label="Live aircraft preview"><div class="paint-aircraft"><span>${type.badge} · ${type.registration}</span><h3>${type.name}</h3></div><canvas id="paint-canvas" role="img" aria-label="Live ${type.name} exterior color preview"></canvas><div class="paint-preview-footer"><span>Live preview <strong id="paint-current"></strong></span><div><button id="paint-left" aria-label="Rotate aircraft preview left">↶</button><button id="paint-right" aria-label="Rotate aircraft preview right">↷</button></div></div></section>
      <div class="paint-controls"><fieldset><legend>Choose a finish</legend><div class="paint-presets" role="radiogroup" aria-label="Aircraft finish">${AIRCRAFT_THEME_PRESETS.map(p => `<button class="paint-preset" role="radio" data-paint-preset="${p.id}" aria-checked="false" tabindex="-1">${swatches(p.colors)}<strong>${p.label}</strong><span>${description[p.id]}</span></button>`).join('')}</div></fieldset>
      <fieldset class="paint-custom"><legend>Custom colors</legend><p id="paint-color-help">Pick a color or enter a hex value. Factory preserves all original shades.</p>${paint.roles.map(role => `<div class="paint-color"><input type="color" id="paint-${role}" value="${colors[role]}" aria-label="${label(role)} color picker"/><div><label for="paint-${role}-hex">${label(role)}</label><input type="text" id="paint-${role}-hex" aria-label="${label(role)} hex color" aria-describedby="paint-color-help paint-${role}-error" value="${colors[role]}" spellcheck="false" autocomplete="off" autocapitalize="off" maxlength="7"/><span class="paint-error" id="paint-${role}-error"></span></div></div>`).join('')}</fieldset>
      <p id="paint-status" class="paint-status" role="status" aria-live="polite"></p><button class="secondary-btn" id="paint-restore"><i data-lucide="rotate-ccw"></i>Restore aircraft colors</button><button class="primary-btn" data-close>Done <i data-lucide="check"></i></button><p class="paint-scope">Only the ${type.name}’s exterior. Your flight stays where you left it.</p></div></div>`;
    },
    mount(element) {
      root = element; preview.mount(root.querySelector('#paint-canvas'), getAircraft());
      root.querySelector('#paint-back').onclick = back;
      root.querySelectorAll('[data-paint-preset]').forEach(button => {
        button.onclick = () => apply(button.dataset.paintPreset);
        button.onkeydown = event => {
          const items = [...root.querySelectorAll('[data-paint-preset]')], index = items.indexOf(button);
          const next = { ArrowRight: (index + 1) % items.length, ArrowDown: (index + 1) % items.length, ArrowLeft: (index + items.length - 1) % items.length, ArrowUp: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1 }[event.key];
          if (next === undefined) return;
          event.preventDefault(); items[next].click(); items[next].focus({ preventScroll: true });
        };
      });
      for (const role of getAircraft().paint.roles) {
        const picker = root.querySelector(`#paint-${role}`), hex = root.querySelector(`#paint-${role}-hex`), error = root.querySelector(`#paint-${role}-error`);
        picker.oninput = () => apply({ preset: 'custom', colors: { ...colors, [role]: picker.value } });
        hex.oninput = () => {
          const color = normalizePaintHex(hex.value);
          if (!color) { hex.setAttribute('aria-invalid', 'true'); error.textContent = 'Use #RGB or #RRGGBB'; return; }
          // Keep the text/caret stable as complete values apply, including three-digit shorthand.
          const value = hex.value, start = hex.selectionStart, end = hex.selectionEnd;
          apply({ preset: 'custom', colors: { ...colors, [role]: color } });
          hex.value = value; hex.setSelectionRange(start, end);
        };
        hex.onblur = () => { if (normalizePaintHex(hex.value)) hex.value = colors[role]; };
        hex.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); if (normalizePaintHex(hex.value)) hex.value = colors[role]; } };
      }
      root.querySelector('#paint-restore').onclick = () => apply('factory');
      root.querySelector('#paint-left').onclick = () => preview.turn(-Math.PI / 6);
      root.querySelector('#paint-right').onclick = () => preview.turn(Math.PI / 6);
      refresh(); root.querySelector('#paint-back').focus({ preventScroll: true });
    },
    unmount() { root = null; preview.unmount(); },
    render: () => preview.render(),
  };
}
