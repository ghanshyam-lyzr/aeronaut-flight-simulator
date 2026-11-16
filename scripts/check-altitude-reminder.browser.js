// Run with the browser MCP's browser_run_code_unsafe filename argument against the preview on port 5173.
// A controlled clock accommodates software WebGL; all flight starts and selector actions use the real app.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem('aeronaut-settings', JSON.stringify({ version: 2, quality: 'low', aircraft: 'trainer' }));
    window.__simNow = 1000;
    Object.defineProperty(performance, 'now', { value: () => window.__simNow });
    Object.defineProperty(Event.prototype, 'timeStamp', { get: () => window.__simNow });
    window.__frames = [];
    window.requestAnimationFrame = cb => window.__frames.push(cb);
    window.__step = (n = 1) => {
      for (let i = 0; i < n; i++) { window.__simNow += 250; window.__frames.splice(0).forEach(cb => cb(window.__simNow)); }
    };
  });
  const p = await context.newPage(), errors = [], results = [];
  p.on('pageerror', e => errors.push(e.message));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  try {
    await p.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!window.aeronaut);
    // Keep focus in the field through each transition: its change-on-blur must not re-arm a reset target.
    for (const action of ['reset', 'approachStart', 'runwayStart', 'startLanding', 'startCourse', 'startCrosswind', 'cancelActivity']) {
      await p.locator('#altitude-bug').click({ force: true });
      await p.locator('#altitude-input').fill('4000');
      await p.locator('#altitude-input').press('Enter');
      check(await p.evaluate(() => aeronaut.getAltitudeReminder().target === 4000), `${action}: selected`);
      await p.evaluate(name => aeronaut[name](), action);
      const v = await p.evaluate(() => aeronaut.getAltitudeReminder());
      check(v.target === null && !v.armed && !v.open && v.events === 0, `${action}: stale reminder ${JSON.stringify(v)}`);
      results.push(`${action}: cleared with field focused`);
    }
    await p.locator('#altitude-bug').click({ force: true });
    await p.locator('#altitude-input').fill('4000');
    await p.locator('#altitude-input').press('Enter');
    const before = await p.evaluate(() => aeronaut.getState());
    for (const key of ['w', 'Space', 'r', 'p', 'h', 'g', 'b', '[', 'Shift']) await p.locator('#altitude-input').press(key);
    const after = await p.evaluate(() => aeronaut.getState());
    for (const key of ['autopilot', 'gearDown', 'throttle', 'pitchTrim', 'paused', 'flightTime']) check(before[key] === after[key], `input leaked into ${key}`);
    await p.locator('#altitude-input').press('Escape');
    check(await p.evaluate(() => document.activeElement.id === 'altitude-bug'), 'Escape must refocus chip');
    await p.keyboard.press('Space');
    check(await p.evaluate(() => aeronaut.getAltitudeReminder().open && aeronaut.getState().autopilot === true), 'chip Space must open without toggling assist');
    await p.keyboard.press('Escape');
    // The reminder must coexist with a selected/held heading and leave it unchanged.
    await p.locator('#heading-bug').click({ force: true });
    await p.locator('#heading-input').fill('025'); await p.locator('#heading-input').press('Enter');
    await p.locator('#heading-hold').click({ force: true });
    const heading = await p.evaluate(() => aeronaut.getHeadingSelect());
    await p.locator('#altitude-bug').click({ force: true }); await p.locator('#altitude-sync').click({ force: true });
    check(await p.evaluate(() => document.getElementById('heading-select').hidden), 'selectors must be exclusive');
    const same = await p.evaluate(() => aeronaut.getHeadingSelect());
    check(heading.selected === same.selected && heading.active === same.active, 'reminder changed held heading');
    await p.locator('#altitude-select-close').click({ force: true });
    for (const [width, height] of [[1600, 900], [1280, 800], [390, 844]]) {
      await p.setViewportSize({ width, height });
      await p.waitForTimeout(150); // Let the resize event finish clearing/resizing the WebGL drawing buffer.
      await p.evaluate(() => window.__step());
      await p.locator('#altitude-bug').click({ force: true });
      const boxes = await p.evaluate(() => {
        const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        return { panel: box('#altitude-select'), camera: box('.view-tools'), yoke: box('#touch-yoke'), trim: box('#touch-trim'), mission: box('.mission-panel'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      const overlap = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
      check(!boxes.overflow && boxes.panel.bottom <= height && boxes.panel.x >= 0 && boxes.panel.right <= width, `${width}: overflow`);
      for (const id of ['camera', 'mission', ...(width === 390 ? ['yoke', 'trim'] : [])]) check(!overlap(boxes.panel, boxes[id]), `${width}: selector overlaps ${id}`);
      await p.screenshot({ path: `/tmp/forge-browser/altitude-selector-${width}.png` });
      results.push({ viewport: `${width}×${height}`, ...boxes });
      await p.locator('#altitude-select-close').click({ force: true });
      // Opening the chart suspends the reminder and retains the shared navigation readouts.
      const target = await p.evaluate(() => aeronaut.getAltitudeReminder().target);
      await p.locator('#map-expand').click({ force: true });
      await p.evaluate(() => window.__step());
      const chart = await p.evaluate(() => {
        const d = document.getElementById('main-dialog'), r = d.getBoundingClientRect();
        return { open: d.open, x: r.x, right: r.right, y: r.y, bottom: r.bottom, overflow: d.scrollWidth > d.clientWidth,
          readout: document.getElementById('chart-readout').textContent, help: document.getElementById('chart-help').textContent,
          navigation: aeronaut.getNavigation(), reminder: aeronaut.getAltitudeReminder() };
      });
      check(chart.open && chart.x >= 0 && chart.right <= width && chart.y >= 0 && chart.bottom <= height && !chart.overflow, `${width}: chart overflow`);
      for (const label of ['Track', 'Groundspeed', 'Est. time to field']) check(chart.readout.includes(label), `${width}: missing chart ${label}`);
      for (const key of ['track', 'groundSpeed', 'closingSpeed', 'eteSeconds', 'eteState', 'eteReason']) check(key in chart.navigation, `${width}: missing diagnostic ${key}`);
      check(chart.help.includes('closing speed') && chart.reminder.target === target && !chart.reminder.open && chart.reminder.suppressed === 'suspended', `${width}: chart/reminder coexistence`);
      await p.screenshot({ path: `/tmp/forge-browser/altitude-chart-${width}.png` });
      await p.locator('#chart-readout').scrollIntoViewIfNeeded();
      await p.screenshot({ path: `/tmp/forge-browser/altitude-chart-readout-${width}.png` });
      results.push({ viewport: `${width}×${height}`, chart });
      await p.locator('#main-dialog [data-close]').click({ force: true });
    }
    await p.evaluate(() => aeronaut.setAircraft('helicopter'));
    check(await p.evaluate(() => aeronaut.getAltitudeReminder().target === null), 'aircraft change must clear target');
    await p.locator('#altitude-bug').click({ force: true }); await p.locator('#altitude-sync').click({ force: true });
    check(await p.evaluate(() => aeronaut.getState().autopilot && aeronaut.getAltitudeReminder().phase === 'deviation'), 'helicopter reminder must preserve hover hold');
    check(errors.length === 0, `page errors: ${errors.join('; ')}`);
    return { results, errors };
  } finally { await context.close(); }
}
