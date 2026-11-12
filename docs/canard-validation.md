# Neris P2 canard pusher — validation

Original procedural aircraft, id `canard`: metadata in `src/canard-type.js`, airframe and front-seat deck in `src/canard.js`, tests in `tests/canard.test.js`. No downloaded models, textures or new dependencies.

## Design

- Long glazed tandem canopy reaching almost to the nose; slender hull narrowing into a cowled engine bay.
- Forward canard (3.9 m) with full-span elevators that lower their trailing edges to raise the nose — the opposite sign to a tailplane elevator. There is no rear horizontal tail.
- Aft swept main wing (8.4 m span) with leading-edge strakes and outboard ailerons; twin wingtip fins carry the two rudders.
- One three-blade pusher propeller behind the cowl, the aftmost part of the airframe, about 0.9 m above the runway when parked.
- Fixed tricycle gear with spats; no flaps. The flaps and gear buttons are disabled with their existing "no flaps" / "fixed gear" labels, and no gear horn sounds.
- Piston propeller sound bus (the same mix as the other piston singles).

## Handling (arcade tuning, not operating data)

Cruise 156 kt at 72% power; rotate 68 kt; 78 kt approach at about 22% power on a 3° path; stall 58 kt. Speed changes are slower than the other piston singles (`speedRate` 0.18), so at idle from cruise it flies about twice as long before the stall. The forewing stall drops the nose and full power recovers it. Pitch (−29°/+24°) and bank (58°) stay limited; short key taps stay small at 10–120 Hz.

## Automated checks

`npm test` (201 tests) and `npm run build` pass. `tests/canard.test.js` covers registration and truthful help text, the dynamic roster count, cruise/reset, a real-runway takeoff with normal key inputs, stall and recovery, the idle glide, fixed gear and no flaps, a hard-landing failure and retry, key taps, the canard layout and ground clearances, surface signs, propeller speed, the cockpit and disposal, and audio routing. The shared landing-mission suite also flies the Neris P2 automatically through approach, flare, touchdown and rollout on the real terrain.

## Browser checks

Through `forge serve` (Vite dev on 0.0.0.0:5173), headless Chromium with **software WebGL** (about 1 FPS, so these checks say nothing about frame rate on real hardware): roster selection through the real Explore dialog ("11 to fly" on main), chase, orbit, cockpit, runway start and landing-mission start at 1600×900; cockpit at 1280×800; chase and cockpit at 390×844. Switching Mira T2 → Neris P2 → Silex A3 → Neris P2, reloading the page, the saved choice and the flight-log name all worked. No console errors. A full landing was not flown by hand in the browser; the automated test pilot covers it.
