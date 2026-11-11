# Aeronaut styleguide

## Current UI direction

Alpine Flight — a cinematic browser flight simulator whose landscape dominates a compact, precise flight deck. Adapted from the dealt true-black-flat direction (seed recorded in .taste-skill), with neutral charcoal surfaces and a single chartreuse signal color.

1. Domain: a playable flight simulator for curious pilots; the first impression should be freedom and geographic scale.
2. Tone: cinematic aviation. The world carries the spectacle, while restrained flight instruments preserve visibility.
3. Palette: custom neutral graphite hsl(210 8% 9%), elevated hsl(210 6% 14%), ivory hsl(60 9% 96%), signal hsl(77 88% 67%). Adapt Ocean Deep's alpine context into the 3D water and atmosphere; keep interface colors neutral.
4. Type: DM Sans 400/500/600 for the interface; Barlow Condensed 400/500 for tabular telemetry. Restrict tracked uppercase to aviation instrument markings and wordmark.
5. Layout: full viewport canvas, a 68px top bar, 16px outer gutters, 290px corner mission panel, a compact instrument strip at the bottom. Phone uses a minimal bar, a two-row telemetry grid and touch yoke.
6. Details: 10px panels, 6px controls, one-pixel subdued instrument boundaries, opaque/translucent charcoal without backdrop blur, no ornamental gradients. Animated world and live telemetry; 160ms control transitions.
7. Name: Alpine Flight.

World is procedural; all geographic and aircraft labels describe an original fictional flight environment inspired by the Alps. No photos, downloaded models, or real-time weather data.

Final UI refinement: instrument labels use sentence case at 11px minimum. Brand uses DM Sans; telemetry uses Barlow Condensed. Controls are anchored around the full-screen world. On phones, the menu exposes Explore, Flight log, Controls, and Weather; the camera pulls back to fit the full aircraft wingspan.

Stall warnings use a compact red banner with ivory DM Sans 600 text. Reserve hsl(0 78% 40%) and hsl(0 65% 25%) for the one-second warning flash; reduced-motion mode keeps the banner steady. Position the phone warning below the mission and navigation panels and the separate GEAR banner.

Rendering refinement — Alpine Clarity: the world is lit and hazed as one system. Valley haze pools low and thins with height (peaks stand clear above it) and warms on the sun's side; it is the only fog model, shared by every fogged material. The lake reads its true depth from the terrain function: pale turquoise shelves, a deep teal basin, a thin foam lap at the shore, sky reflection by Fresnel and a restrained sun glint; fine ripples fade with distance so the far water never shimmers. Meadows stay olive with sun-cured patches, never lawn green. The sky is the aircraft's environment light (paint, glass and metal reflect it); terrain and forest keep the hemisphere light, since sampling the sky there costs more than it shows. Low quality drops the shoreline depth.

Helicopter addition — Alpine Hover: retain Alpine Flight's graphite, ivory and chartreuse instruments, DM Sans labels and Barlow Condensed telemetry in the full-world dashboard. The original Laret H4 uses an ivory cabin, rescue-red belly/fin, reflective blue-grey glazing, dark skids and signal-tipped rotors; no aircraft asset is downloaded. Keep narrow dark cabin framing and a low central live instrument pedestal so the alpine view dominates. Phone cyclic, yaw and collective controls use the existing 6px control corners, one-pixel boundaries and quiet transitions. Preserve the one-metre camera near plane.


Aircraft addition — Alpine Flight continues unchanged in the UI. The specifically requested Boeing 737-800 is the exception to the fictional-aircraft convention above. Its original procedural geometry follows the wingleted NG silhouette; ivory paint, deep teal fin/winglets and a narrow coral stripe connect it to the valley and existing fleet without reproducing an airline livery. Keep DM Sans/Barlow and existing instrument density, boundaries, spacing and motion. The larger airframe gets proportional camera distance with centred phone framing. Control surfaces, fan rotation and gear travel supply the motion; no added ornamental effects or interface palette.
