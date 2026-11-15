# Runway wind advice

With wind-model (#43) the wind moves the aircraft. This change helps the pilot pick a runway from that same wind. `src/runway-wind.js` projects the wind onto a field's two runway directions and suggests the lower-tailwind direction when it is clearly better. **It never moves anything:** giving, viewing or updating advice changes no runway, flight or mission. Only the pilot's **Use runway NN · into wind** button changes the selection, and it changes only that.

It adds no wind source and no physics. It reads `flight.windSnapshot().config` (the wind the flight is actually in, so an activity's own wind counts too), `flight.sampleWind()`, `windComponents` and the existing `suitability`.

## Where it shows

| Place | What it shows | Wind used |
|---|---|---|
| Explore → airfield detail, under the runway pair | Headline, both runways' components, gust extremes, strong-crosswind note, Use-runway button | Reported (steady) |
| Landing brief, under the aircraft name | The same block, so the switch can be made before Start | Reported (steady) |
| Map panel row, under the destination | Arrow pointing downwind (north-up), `QACB 29`, `Now Head 6 · Cross 6 L kt` | Instantaneous sample |
| Mission card, during a landing | `Wind now Head 6 · Cross 6 L kt` (the map is hidden on phones during missions) | Instantaneous sample |

The live rows describe the **mission's locked field and runway while a landing flies**, even if Explore selects another field. Otherwise they describe the selected runway (`readoutField`).

## Conventions

- Signs follow `windComponents`: headwind is positive into the nose (negative is a tailwind), crosswind is positive from the right. Words say it: "Tailwind 3 kt · crosswind 7 kt from the left"; the short form is "Tail 3 · Cross 7 L kt".
- **Colour is never the only cue.** Chartreuse marks a headwind of at least 2 kt, the danger coral a tailwind of at least 2 kt, ivory everything else. The words always name head/tail and the side.
- Whole knots. A component that rounds to 0 kt reads as "No headwind" or "no crosswind"; a live sample under ½ kt reads "Wind calm" and hides the arrow.
- This is gameplay advice for the arcade model, not aircraft crosswind limits. "Strong crosswind" (15 kt or more, steady or in gusts) is one generic note for every aircraft.

## The advice (`adviseRunway`)

**Which wind.** Advice uses the **reported wind**: the configured direction and steady speed (the 14 in `260° 14G24 kt`; in this model the steady speed is the lull, and gusts only add). It never uses an instantaneous sample, so gusts and veer cannot make it change. Gusts are reported separately as the worst the gusts can bring on the selected runway: peak speed (steady + gust) anywhere within ±veer. For Gusts at Serein 16 that is "crosswind up to 24 kt, tailwind up to 8 kt". The block says "advice uses the steady wind"; the live rows say "Now".

**Verdicts**, from the selected runway's steady headwind *h*:

| Verdict | When | Suggestion |
|---|---|---|
| Calm | steady and peak under ½ kt | none: "Calm · either runway" |
| Into wind | *h* ≥ 2 kt | none |
| Switch | *h* ≤ −2 kt (a tailwind) | the reciprocal, which then has the headwind |
| Crosswind / Light | \|*h*\| < 2 kt | none: "Direct crosswind · little headwind either way" (or "Strong crosswind …"), or "Light wind" |

**No flicker.** Besides ignoring gusts, the bands have hysteresis: a tailwind or headwind band, once entered at 2 kt, holds until the component falls below 1 kt (`windBand`). `main.js` remembers the last band per field and runway. A wind slowly swinging through a direct crosswind with 1° of noise changes the suggestion at most twice per swing; without hysteresis the same swing flips it repeatedly (tested). Ambiguous winds (|*h*| < 2 kt) suggest nothing.

**Suitability.** The suggestion is offered as a button (`canApply`) only when the aircraft is not rated unsuitable for the field, using the same `suitability` as the airfield list. Otherwise the block still shows the components and says no runway is suggested for that aircraft. Both directions of a runway have the same length, width and surface, so suitability never depends on the direction.

**Applying.** `applyAdvice(selection, advice)` selects the recommended runway at the advised field. It does nothing if there is no button-worthy suggestion, or if the selection moved since the advice was given. It never starts, moves or alters a flight or mission. A running mission keeps `landing.field`; the change applies to the next departure or mission, as the existing Explore note says.

## Worked examples

| Field | Wind | Selected | Components | Verdict |
|---|---|---|---|---|
| Verdance Meadow (900 m grass, 440 m) | Breeze 240° 8 kt | 35 (352°) | Tail 3 · Cross 7 L | Switch → 17: Head 3 · Cross 7 R |
| Col de Brume (650 m, 1,142 m) | Breeze 240° 8 kt | 11 (106°) | Tail 6 · Cross 6 R | Switch → 29: Head 6 · Cross 6 L |
| Alpine Field | Breeze 240° 8 kt | 36 | Tail 4 · Cross 7 L | Switch → 18 |
| Serein Lakeside | Gusts 260° 14G24 kt | 16 (162°) | Tail 2 · Cross 14 R; gusts up to 24 kt cross, 8 kt tail | Direct crosswind, strong-crosswind note, no suggestion |
| Col de Brume, Boeing 737-800 | Breeze | 11 | as above | Switch shown, no button: not suited |

## Tests (`tests/runway-wind.test.js`)

- Projections and signs for both directions at every field: head, tail, left, right and 45°, the reciprocal's opposite signs, and agreement with `windComponents`.
- Wording, rounding and tiny components.
- Calm at every field: no suggestion. Tailwind and headwind at every field. The Breeze numbers at Alpine Field.
- Direct, strong and ambiguous crosswinds.
- Stability: a slow swing with noise at 3, 8 and 14 kt, the hysteresis edges, and one suggestion per field through 60 s of Gusts.
- Gust extremes bound every sample over 60 s.
- Suitability gating. Explicit application, stale advice and unsuitable advice. Mission locking with a real `LandingMission`: position, heading and the mission field stay untouched while Explore selects and applies elsewhere.

## Interface checks (headless Chromium, software WebGL)

These were checked against the dev server through `window.aeronaut`. The new diagnostic is `getRunwayWind()`, which returns `{ advice, readout }`. The aircraft was the Mira T2.

- **1600×900, Verdance Meadow, Breeze.** The block reads "Tailwind on runway 35 · runway 17 is into wind" ([verdance-explore-1600.png](runway-wind/verdance-explore-1600.png)). Clicking **Use runway 17 · into wind** selected 17, moved focus to the Runway 17 radio and showed the toast "Runway 17 selected · into wind"; the aircraft position was byte-identical ([verdance-applied-1600.png](runway-wind/verdance-applied-1600.png)).
- **1280×800, Col de Brume (elevated), landing brief.** Runway 11 had a tailwind ([brume-brief-1280.png](runway-wind/brume-brief-1280.png), the button focused). Pressing Enter on the focused button switched the brief to runway 29 (eyebrow "runway 29 · heading 286°"). Focus moved to Start, and the mission stayed idle ([brume-brief-applied-1280.png](runway-wind/brume-brief-applied-1280.png)).
- **Mission locking.** Started the Brume 29 landing, then selected Alpine Field 18. Explore showed "Into wind on runway 18", while the map row and the mission card stayed on `QACB 29 · Now Head 6 · Cross 6 L kt` with the mission still flying ([brume-mission-locked-1280.png](runway-wind/brume-mission-locked-1280.png)).
- **390×844, Serein Lakeside, Gusts.** The direct-crosswind block fits the 358 px dialog ([serein-crosswind-390.png](runway-wind/serein-crosswind-390.png)). The mission card adds one line, "Wind now Tail 1 · Cross 17 R kt", with the map hidden as before ([serein-mission-390.png](runway-wind/serein-mission-390.png)). The map row first overflowed by 20 px, so phones drop its runway label (the row above names the field; the aria-label keeps the runway). It now fits exactly at 140 px ([serein-map-390.png](runway-wind/serein-map-390.png); the pause overlay was hidden in the DOM for that one picture).
- **Lifecycle.**
  - Paused, the live row was unchanged after 3 s, because wind time freezes.
  - Reset restarted wind time and the row kept the selected runway.
  - H hid the map with its row and showed the restore button; restoring brought the row back.
  - Dialogs pause the flight, so the rows freeze under them too.
- **Keyboard and touch.** The Use-runway button is an ordinary 38 px button in the dialog's tab order: Enter and Space work, and a pointer click works as a tap. No real touch device was used, and the flight touch controls are unchanged.
- **Software-WebGL limit.** This VM renders at about 0–1 fps, so flight time ran far slower than wall time. Screenshots of a running flight timed out, so the in-flight pictures were taken paused. The checks measured state and DOM, not frame-paced flying.
