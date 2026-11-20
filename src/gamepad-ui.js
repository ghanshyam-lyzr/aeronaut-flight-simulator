import { GAMEPAD_DEAD_ZONE } from './gamepad.js';

/** Shared by Controls and Settings; device names are always assigned as text, never interpolated HTML. */
export function gamepadMarkup(settings, rotorcraft) {
  const zone = Math.round(settings.gamepadDeadZone * 100);
  return `<section class="gamepad-settings" aria-labelledby="gamepad-title"><h3 class="dialog-section-title" id="gamepad-title">Controller</h3>
    <div class="settings-row"><div><strong>Gamepad flight controls</strong><p>One standard-mapped controller. Off until you enable it.</p></div><button class="toggle" id="setting-gamepad" role="switch" aria-label="Gamepad flight controls" aria-checked="${settings.gamepadEnabled}"></button></div>
    <div class="gamepad-connection"><strong id="gamepad-device">Checking controller…</strong><p id="gamepad-status" role="status" aria-live="polite"></p></div>
    <div class="settings-slider"><label for="gamepad-dead-zone">Stick dead zone <output id="gamepad-dead-zone-value" for="gamepad-dead-zone">${zone}%</output></label><input id="gamepad-dead-zone" type="range" min="${GAMEPAD_DEAD_ZONE.min * 100}" max="${GAMEPAD_DEAD_ZONE.max * 100}" step="1" value="${zone}" aria-valuetext="${zone}%"/></div>
    <dl class="gamepad-mappings"><div><dt>Left stick ← / →</dt><dd>${rotorcraft ? 'Cyclic left / right' : 'Roll left / right'}</dd></div><div><dt>Left stick ↑ / ↓</dt><dd>${rotorcraft ? 'Cyclic forward / backward' : 'Nose down / up'}</dd></div><div><dt>Right stick ← / →</dt><dd>Yaw left / right</dd></div><div><dt>Right stick ↑ / ↓</dt><dd>Raise / lower ${rotorcraft ? 'collective' : 'throttle'}</dd></div><div><dt>Start / Menu / Options</dt><dd>Pause / resume</dd></div></dl>
    <p class="settings-help">Power changes only while you hold the right stick up or down. Centre it to keep the current setting. Invert pitch and control response apply here too. Keyboard, touch and mouse take priority on each axis while held; use them for brakes, trim and other actions.</p>
    <p class="settings-help">Connect a controller, then press a controller button to make it visible to your browser. After connecting, pausing, editing or switching away, centre both sticks and release Pause before flying. Controls are released while a dialog or field is open or the app is unfocused.</p>
    <p class="settings-help">If access is blocked in the embedded preview, open the app in its own tab with HTTPS and allow gamepad access.</p></section>`;
}

export function updateGamepadUI(root, frame, enabled) {
  const device = root.querySelector('#gamepad-device'), status = root.querySelector('#gamepad-status');
  if (!device || !status) return;
  const labels = {
    unavailable: 'Gamepad API is unavailable in this browser. Try a browser with gamepad support.',
    blocked: 'Gamepad access is blocked. Open the app in its own tab and allow gamepad access.',
    unsupported: 'This controller has no standard mapping. Connect a standard-mapped controller.',
    disconnected: 'No controller detected. Connect one, then press a controller button.',
    disabled: 'Controls off. Enable above to fly with this controller.',
    suspended: 'Connected · input released while this dialog or a field is open, or the app is unfocused.',
    paused: 'Flight paused. Release and press Start / Menu / Options to resume.',
    centering: 'Centre both sticks and release Pause to activate controls.',
    ready: 'Ready to fly.',
  };
  const title = frame.device ? `Connected · ${frame.device.id}` : 'No supported controller connected';
  const message = `${!enabled && frame.status !== 'disabled' ? 'Controls off. ' : ''}${labels[frame.status]}`;
  if (device.textContent !== title) device.textContent = title;
  if (status.textContent !== message) status.textContent = message;
  root.querySelector('#setting-gamepad').disabled = !enabled && ['unavailable', 'blocked'].includes(frame.status);
}
