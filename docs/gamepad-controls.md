# Gamepad flight controls

Enable **Gamepad flight controls** in **All controls** or **Settings → Controller**. The preference is off by default. The browser must expose a standard-mapped controller; device-specific flight sticks and remapping are outside this feature. Connect it, press a controller button if needed, then center both sticks and release Pause.

The left stick rolls left/right and pitches nose down/up (cyclic forward/back on helicopters). The right stick yaws left/right and raises/lowers throttle or collective while held up/down. Centering leaves power where it is. Start / Menu / Options pauses and resumes once per press. The same pitch inversion and response settings apply. Brakes, trim, gear, flaps and assist retain their keyboard/touch controls.

Stick dead zone defaults to 15%, can be set from 5–35%, and scales the remaining travel smoothly to full authority. One controller stays selected while connected; a replacement must first be neutral. Unsupported mappings, missing API support and blocked access are explained in the controller section. If an embedded preview blocks access, open the HTTPS app in its own tab and allow gamepad access.

Keyboard, touch and mouse take priority separately on each axis while held, including a centered held touch yoke or opposing keys. Other axes remain available on the controller. Disconnects, disable, dialogs, editing a field, hidden tabs, window blur, pause, resets and aircraft changes release gamepad input. Resume requires neutral sticks, so an old held command cannot restart unexpectedly. The Pause button must be released before another press can toggle it.

All continuous controls pass through the existing `FlightInputs` response ramp and normalized physics slices. Controller input never writes absolute power, changes physics or turns assist on. Existing manual-takeover thresholds and activity eligibility rules remain unchanged. `RunRecorder.step` can receive the same actual slices as any other input; this feature does not add a ranked service or change ranked rules.

## Verification

`npm test` includes simulated standard-controller samples in `tests/gamepad.test.js`: proportional axes, bounded dead zone, neutral power, response shaping, held Pause edges, reconnect and interruption arming, missing/blocked/unsupported APIs, one-controller selection, manual arbitration, keyboard tap responsiveness, settings validation and actual ranked recorder slices.

For a live app check, open the preview in a browser with focus and run:

```js
await (await import('/scripts/check-gamepad-browser.js')).checkGamepadBrowser()
```

This uses simulated `navigator.getGamepads()` data and synthetic keyboard/lifecycle events against the rendered application. It checks actual fixed-wing and helicopter power, keyboard takeover, pause/clock behavior, disconnects, fields, blur, visibility and both controller settings entries. It restores the API override and original enabled/quality preferences, and leaves the flight paused.

Responsive visual QA uses 1600×900, 1280×800 and 390×844 viewports. The Controller section, device name wrapping, mapping rows, range, switch, sticky close control and scroll behavior fit without horizontal overflow. Screenshots label the test controller as simulated.

No physical controller was available in this environment. Browser/device-specific mappings, connection gestures and embedded-preview permissions still need a physical-device check; simulated API and lifecycle checks do not establish those.
