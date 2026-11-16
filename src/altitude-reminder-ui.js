import { ALTITUDE_REMINDER, FEET_PER_METRE } from './altitude-reminder.js';

/** DOM adapter; pilot actions go only to the reminder, never to the flight controller. */
export function createAltitudeReminderUI({ monitor, getState, finished, clearControls, closeHeading }) {
  const $ = id => document.getElementById(id), panel = $('altitude-select'), bug = $('altitude-bug'), input = $('altitude-input');
  let pointer = '', error = '', cache = '';
  const current = () => Math.round(getState().position.y * FEET_PER_METRE);
  const text = n => n === null ? 'Set' : String(n);
  const invalid = message => { error = message; input.setAttribute('aria-invalid', String(!!error)); input.parentElement.classList.toggle('invalid', !!error); cache = ''; };
  function select(value) {
    if (getState().crashed || finished()) return;
    if (monitor.select(value, getState()) === null) { invalid('Enter 0–60,000 feet MSL'); refresh(); return; }
    invalid(''); input.value = monitor.target; refresh();
  }
  function step(delta) { select(Math.max(ALTITUDE_REMINDER.min, Math.min(ALTITUDE_REMINDER.max, (monitor.target ?? current()) + delta))); }
  function close(refocus = false) {
    if (panel.hidden) return;
    const inside = panel.contains(document.activeElement);
    panel.hidden = true; bug.setAttribute('aria-expanded', 'false');
    if (inside || refocus) bug.focus({ preventScroll: true });
  }
  function place() {
    if (panel.hidden || innerWidth <= 550) { panel.style.left = ''; return; }
    const strip = document.querySelector('.instruments'), cell = $('altitude-instrument');
    const max = strip.clientWidth - panel.offsetWidth, centered = cell.offsetLeft + cell.offsetWidth / 2 - panel.offsetWidth / 2;
    const cameraEdge = document.querySelector('.view-tools').getBoundingClientRect().right - strip.getBoundingClientRect().left + 8;
    panel.style.left = `${Math.max(0, Math.min(max, Math.max(centered, cameraEdge)))}px`;
  }
  function open() {
    clearControls(); closeHeading(); invalid(''); panel.hidden = false; bug.setAttribute('aria-expanded', 'true');
    input.value = monitor.target ?? ''; place(); refresh();
    if (pointer === 'touch') panel.focus({ preventScroll: true });
    else { input.focus({ preventScroll: true }); input.select(); }
  }
  function refresh() {
    const v = monitor.snapshot(), s = getState(), blocked = s.crashed || finished();
    const status = !v.armed ? (v.target === null ? 'Choose a target to arm' : 'Disarmed') : s.grounded ? 'Armed · once airborne' :
      v.acknowledged ? (v.acknowledged === 'approach' ? 'Approach acknowledged' : 'Deviation acknowledged') :
      v.alert === 'approach' ? 'Approaching target' : v.alert === 'deviation' ? 'Outside target band' :
      v.phase === 'deviation' ? 'Captured · deviation armed' : 'Approach armed';
    const key = [v.target, v.armed, status, current(), blocked, error].join(); if (cache === key) return; cache = key;
    $('altitude-bug-value').textContent = text(v.target); bug.classList.toggle('active', v.armed);
    bug.setAttribute('aria-label', `Altitude reminder: ${v.target === null ? 'no target' : `${v.target} feet MSL, ${status.toLowerCase()}`}. Open selector`);
    bug.title = v.target === null ? 'Set altitude reminder (feet MSL)' : `${v.target.toLocaleString('en')} ft MSL · ${status}`;
    $('altitude-now').textContent = `Now ${current().toLocaleString('en')} ft MSL`;
    $('altitude-select-state').textContent = error || status;
    $('altitude-select-state').classList.toggle('error', !!error);
    if (document.activeElement !== input) input.value = v.target ?? '';
    if (v.target === null) input.removeAttribute('aria-valuenow'); else input.setAttribute('aria-valuenow', v.target);
    const arm = $('altitude-arm'); arm.textContent = v.armed ? 'Disarm' : 'Arm reminder';
    arm.setAttribute('aria-pressed', String(v.armed)); arm.classList.toggle('active', v.armed); arm.disabled = v.target === null || blocked;
    $('altitude-ack').disabled = !v.alert || blocked;
    panel.querySelectorAll('input,[data-altitude-step],#altitude-sync').forEach(el => { el.disabled = blocked; });
    if (blocked) close();
  }
  function acknowledge() { monitor.acknowledge(); refresh(); }
  bug.addEventListener('pointerdown', e => { pointer = e.pointerType; });
  bug.addEventListener('keydown', e => { pointer = ''; if (e.code === 'Space' || e.key === 'Enter') e.stopPropagation(); });
  bug.onclick = () => panel.hidden ? open() : close(true);
  $('altitude-select-close').onclick = () => close(true);
  $('altitude-sync').onclick = () => select(current());
  $('altitude-arm').onclick = () => { monitor.phase === 'off' ? monitor.arm(getState()) : monitor.disarm(); refresh(); };
  $('altitude-ack').onclick = acknowledge;
  $('altitude-notice-ack').onclick = acknowledge;
  $('altitude-notice-ack').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); e.target.blur(); } });
  panel.querySelectorAll('[data-altitude-step]').forEach(b => { b.onclick = () => step(Number(b.dataset.altitudeStep)); });
  panel.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (e.target !== input) return;
    const delta = { ArrowUp: 100, ArrowDown: -100, PageUp: 1000, PageDown: -1000 }[e.key];
    if (delta) { e.preventDefault(); step(e.shiftKey && Math.abs(delta) === 100 ? delta * 10 : delta); input.select(); }
    else if (e.key === 'Enter') { e.preventDefault(); select(input.value); }
  });
  input.addEventListener('input', () => { invalid(''); });
  input.addEventListener('change', () => { if (input.value !== String(monitor.target ?? '')) select(input.value); });
  document.addEventListener('pointerdown', e => { if (!panel.hidden && !panel.contains(e.target) && !bug.contains(e.target)) close(); }, true);
  window.addEventListener('resize', place);
  return { close, refresh, isOpen: () => !panel.hidden };
}
