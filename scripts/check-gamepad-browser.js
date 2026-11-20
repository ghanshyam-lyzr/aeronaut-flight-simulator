// Run in the app's browser console (or Playwright page.evaluate):
// await (await import('/scripts/check-gamepad-browser.js')).checkGamepadBrowser()
// All controller samples and lifecycle events below are simulated; no physical device is required.
export async function checkGamepadBrowser() {
  const api = window.aeronaut, $ = id => document.getElementById(id);
  const original = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
  const pad = { connected: true, mapping: 'standard', id: 'Simulated standard controller · browser QA', index: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  let pads = [pad];
  const passed = [];
  // Wait for real polling/physics frames as well as elapsed time: software WebGL can delay a frame past a timer.
  const wait = (ms = 150) => new Promise(resolve => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), ms));
  const check = (condition, message) => { if (!condition) throw new Error(message); passed.push(message); };
  const idle = () => { pad.axes.fill(0); pad.buttons[9].pressed = false; };
  const close = () => { if ($('main-dialog').open) $('main-dialog').close(); $('world').focus(); };
  const open = kind => document.querySelector(`[data-dialog="${kind}"]`).click();
  const key = (type, code) => document.activeElement.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  const neutral = () => Object.values(api.getControls()).every(value => value === 0);
  const enable = value => { if (api.getSettings().gamepadEnabled !== value) $('setting-gamepad').click(); };
  const oldEnabled = api.getSettings().gamepadEnabled;
  const oldQuality = api.getSettings().quality;
  try {
    api.setQuality('low');
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
    close(); api.cancelActivity(); api.setAircraft('trainer'); api.startCourse();
    open('controls'); enable(false); await wait();
    pad.axes[0] = 1; close(); await wait();
    check(neutral(), 'Opt-out keeps simulated held controls neutral');
    open('controls'); enable(true); await wait();
    check(api.getGamepad().status === 'suspended', 'Controls dialog reports a connected, suspended controller');
    close(); await wait();
    check(neutral() && api.getGamepad().status === 'centering', 'Opt-in with a held stick requires centering');
    idle(); await wait();
    const power = api.getState().throttle;
    await wait(300);
    check(api.getState().throttle === power && neutral(), 'Centered sticks preserve aircraft power');
    pad.axes[0] = 0.575; pad.axes[3] = -0.575; await wait(500);
    const zone = api.getSettings().gamepadDeadZone, expectedRoll = (0.575 - zone) / (1 - zone);
    check(api.getControls().roll > 0 && api.getControls().roll <= expectedRoll + 1e-9 && api.getState().throttle > power,
      'Analog roll and rate-based power reach the actual flight pipeline');
    key('keydown', 'KeyA'); await wait(180);
    check(api.getControls().roll < 0, 'Opposite keyboard input takes priority over held gamepad roll');
    key('keydown', 'KeyD'); await wait();
    check(api.getControls().roll === 0, 'Opposing held keys own the roll axis at neutral');
    key('keyup', 'KeyA'); key('keyup', 'KeyD');
    idle(); await wait();
    pad.buttons[9].pressed = true; await wait(300);
    check(api.getState().paused, 'Start pauses the flight');
    const pausedTime = api.getState().flightTime; await wait(300);
    check(api.getState().paused && api.getState().flightTime === pausedTime, 'Held Start does not repeat and pause freezes the flight clock');
    pad.buttons[9].pressed = false; await wait(); pad.buttons[9].pressed = true; await wait();
    check(!api.getState().paused, 'A released and re-pressed Start resumes');
    idle(); await wait(); pad.axes[0] = 1; await wait(250);
    key('keydown', 'KeyA');
    pads = [];
    const disconnected = new Event('gamepaddisconnected');
    Object.defineProperty(disconnected, 'gamepad', { value: pad });
    window.dispatchEvent(disconnected);
    await wait(250);
    check(api.getControls().roll < 0, 'Disconnect preserves a held keyboard takeover');
    key('keyup', 'KeyA'); await wait();
    check(api.getGamepad().status === 'disconnected' && neutral(), 'Disconnect releases the real input pipeline');
    pads = [pad]; await wait();
    check(neutral() && api.getGamepad().status === 'centering', 'Reconnect never restores a held stick');
    idle(); await wait();
    $('heading-bug').click(); $('heading-input').focus();
    const heading = api.getState().selectedHeading;
    pad.axes[0] = 1; pad.buttons[9].pressed = true; key('keydown', 'KeyP'); key('keyup', 'KeyP'); await wait();
    check(neutral() && !api.getState().paused && api.getState().selectedHeading === heading,
      'Editing heading blocks gamepad and flight keyboard actions');
    $('heading-select-close').click(); $('world').focus(); await wait();
    check(neutral(), 'Closing a field still requires neutral controls');
    idle(); await wait(); pad.axes[2] = 1; await wait(250);
    window.dispatchEvent(new Event('blur'));
    check(neutral(), 'Window blur immediately clears held input');
    await wait(); check(neutral(), 'Held sticks cannot re-arm after blur');
    idle(); await wait(); pad.axes[0] = 1; await wait(250);
    document.dispatchEvent(new Event('visibilitychange'));
    check(neutral(), 'Visibility interruption immediately clears held input');
    await wait(); check(neutral(), 'Held sticks cannot re-arm after a visibility interruption');
    open('settings'); enable(false); close(); await wait();
    check(neutral(), 'Disabling in Settings releases the controller');
    open('controls'); pads = [{ ...pad, mapping: '' }]; await wait();
    check($('gamepad-status').textContent.includes('no standard mapping'), 'Unsupported mapping is explained in Controls');
    pads = [pad]; idle(); enable(true); close();
    api.cancelActivity(); api.setAircraft('helicopter'); api.approachStart(); await wait();
    const collective = api.getState().throttle;
    pad.axes[3] = -0.575; await wait(400);
    check(api.getState().throttle > collective && !api.getState().autopilot,
      'Helicopter collective uses the existing manual rate command');
    idle(); await wait(); const heldCollective = api.getState().throttle; await wait(250);
    check(api.getState().throttle === heldCollective, 'Centered stick holds collective constant');
    open('controls');
    check(document.querySelector('.gamepad-mappings').textContent.includes('collective'), 'Mappings use helicopter labels');
    return { kind: 'simulated-browser-verification', physicalControllerTested: false, passed };
  } finally {
    idle();
    open('controls'); enable(oldEnabled); close(); api.setPaused(true);
    api.setQuality(oldQuality);
    if (original) Object.defineProperty(navigator, 'getGamepads', original);
    else delete navigator.getGamepads;
  }
}
