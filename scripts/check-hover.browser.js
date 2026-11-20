// Run via browser MCP browser_run_code_unsafe's filename argument against port 5173.
// Controls use the real app handlers. A controlled clock and reduced pixel ratio accommodate software WebGL.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.25 });
  await context.addInitScript(() => {
    localStorage.setItem('aeronaut-settings', JSON.stringify({ version: 2, quality: 'low', aircraft: 'jet' }));
    window.__simNow = 1000; window.__frames = [];
    Object.defineProperty(performance, 'now', { value: () => window.__simNow });
    Object.defineProperty(Event.prototype, 'timeStamp', { get: () => window.__simNow });
    window.requestAnimationFrame = cb => window.__frames.push(cb);
    window.__step = (n = 1) => {
      for (let i = 0; i < n; i++) { window.__simNow += 100; window.__frames.splice(0).forEach(cb => cb(window.__simNow)); }
    };
  });
  const p = await context.newPage(), errors = [], checks = [];
  p.on('pageerror', e => errors.push(e.message));
  const check = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
  try {
    await p.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!window.aeronaut, null, { polling: 100 });
    // Real rendering is checked in the three viewport captures. Avoid re-drawing the full landscape hundreds
    // of times in this accelerated input/lifecycle probe; physics, DOM, handlers and frame scheduling still run.
    await p.evaluate(() => {
      const gl = document.querySelector('#world canvas').getContext('webgl2');
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) gl[name] = () => {};
    });
    await p.evaluate(() => aeronaut.setWind('gusts'));
    await p.locator('[data-dialog="explore"]').click({ force: true });
    await p.locator('#explore-hover').click({ force: true });
    check(await p.evaluate(() => aeronaut.getAircraft().id === 'jet' && !document.getElementById('start-hover')), 'brief preserves unsupported aircraft');
    await p.locator('#hover-aircraft').click({ force: true });
    await p.locator('#start-hover').click({ force: true });
    check(await p.evaluate(() => aeronaut.getHover().activity === 'hover' && aeronaut.getHover().targetVisible && !aeronaut.getState().autopilot), 'explicit switch and manual start');
    await p.evaluate(() => __step(10));
    check(await p.evaluate(() => aeronaut.getHover().holdTime === 0), 'hands-off earns no hold');
    await p.evaluate(() => aeronaut.setPaused(true));
    const frozen = await p.evaluate(() => JSON.stringify(aeronaut.getHover()));
    await p.evaluate(() => __step(10));
    check(await p.evaluate(() => JSON.stringify(aeronaut.getHover())) === frozen, 'pause freezes measurements and time');
    await p.evaluate(() => aeronaut.setPaused(false));
    await p.locator('[data-dialog="environment"]').click({ force: true });
    await p.locator('[data-wind="breeze"]').click({ force: true });
    const dialog = await p.evaluate(() => JSON.stringify(aeronaut.getHover()));
    await p.evaluate(() => __step(10));
    check(await p.evaluate(() => JSON.stringify(aeronaut.getHover())) === dialog, 'dialog freezes measurements and time');
    await p.locator('[data-close]').first().click({ force: true });
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const hidden = await p.evaluate(() => JSON.stringify(aeronaut.getHover()));
    await p.evaluate(() => __step(10));
    check(await p.evaluate(() => JSON.stringify(aeronaut.getHover())) === hidden, 'controlled hidden-tab probe freezes the attempt');
    await p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    for (const source of ['settings', 'button', 'keyboard']) {
      if (source === 'settings') {
        await p.locator('[data-dialog="settings"]').click({ force: true });
        await p.locator('#setting-assist').click({ force: true });
        await p.locator('[data-close]').first().click({ force: true });
      } else if (source === 'button') await p.locator('#take-control').click({ force: true });
      else await p.keyboard.press('Space');
      check(await p.evaluate(() => aeronaut.getHover().status === 'failed' && /assist was used/.test(aeronaut.getHover().reason)), `${source} assist fails immediately`);
      await p.locator('#landing-result-retry').click({ force: true });
    }
    await p.evaluate(() => __step(5)); await p.keyboard.press('r');
    check(await p.evaluate(() => aeronaut.getHover().elapsed === 0 && aeronaut.getHover().holdTime === 0 && !aeronaut.getState().autopilot), 'R retries the same manual setup');
    const result = await p.evaluate(async () => {
      const { FLEET } = await import('/src/fleet.js'), f = FLEET.helicopter.flight, held = new Set();
      const clamp = (v, n = 1) => Math.max(-n, Math.min(n, v));
      for (let frame = 0; frame < 900 && aeronaut.getHover().status === 'flying'; frame++) {
        const a = aeronaut.getHover(), s = aeronaut.getState(), t = a.target, v = s.velocity;
        const c = Math.cos(s.heading), h = Math.sin(s.heading), level = f.levelRate ?? 1.6;
        const ax = clamp((t.x - s.position[0]) * 0.2 - v.x * 0.9, 1.5), az = clamp((t.z - s.position[2]) * 0.2 - v.z * 0.9, 1.5);
        const pitch = ((Math.atan2(-h * ax + c * az, 9.81) - s.pitch) * 3 + level * s.pitch) / f.pitchRate;
        const roll = ((Math.atan2(c * ax + h * az, 9.81) - s.bank) * 3 + level * s.bank) / f.rollRate;
        const yaw = Math.atan2(Math.sin(t.heading - s.heading), Math.cos(t.heading - s.heading)) * 1.5 / f.yawRate;
        const collective = f.hoverCollective * (1 + clamp((t.y - s.position[1]) * 0.5 - v.y * 1.1, 1.5) / 9.81);
        const want = new Set();
        for (const [value, dead, minus, plus] of [[pitch, 0.015, 'KeyW', 'KeyS'], [roll, 0.015, 'KeyA', 'KeyD'], [yaw, 0.1, 'KeyQ', 'KeyE'], [collective - s.throttle, 0.003, 'ControlLeft', 'ShiftLeft']]) {
          if (Math.abs(value) > dead) want.add(value > 0 ? plus : minus);
        }
        for (const code of held) if (!want.has(code)) window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
        for (const code of want) if (!held.has(code)) window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        held.clear(); for (const code of want) held.add(code);
        __step();
      }
      for (const code of held) window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      __step(2); return { hover: aeronaut.getHover(), assist: aeronaut.getState().autopilot, engine: aeronaut.getEngine() };
    });
    check(result.hover.status === 'success' && result.hover.holdTime === 10 && !result.assist, 'normal keyboard input completes a ten-second manual hold');
    check(await p.locator('#landing-result').isVisible(), 'measured result is visible');
    await p.locator('#landing-result-exit').click({ force: true });
    check(await p.evaluate(() => aeronaut.getHover().status === 'idle' && aeronaut.getWind().config.id === 'breeze'), 'exit restores later Weather choice');
    await p.evaluate(() => { aeronaut.startHover(); aeronaut.startLanding(); });
    check(await p.evaluate(() => aeronaut.getHover().status === 'idle' && aeronaut.getMission().status !== 'idle' && aeronaut.getWind().config.id === 'breeze'), 'landing replaces hover and restores wind');
    await p.evaluate(() => { aeronaut.startHover(); aeronaut.setAircraft('trainer'); });
    check(await p.evaluate(() => aeronaut.getHover().status === 'idle' && aeronaut.getMission().status === 'idle' && aeronaut.getWind().config.id === 'breeze'), 'aircraft switch cancels the challenge');
    check(errors.length === 0, `no browser errors: ${errors.join(', ')}`);
    return { checks, result };
  } finally { await context.close(); }
}
