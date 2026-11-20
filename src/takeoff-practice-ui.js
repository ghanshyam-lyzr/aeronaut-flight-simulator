import { TAKEOFF, takeoffAvailability } from './takeoff-practice.js';

const kt = v => Math.round(v * 1.94384), ft = v => Math.max(0, Math.round(v * 3.28084));
export const alignmentText = a => `${Math.abs(a * 180 / Math.PI).toFixed(1)}° ${Math.abs(a) < 0.00087 ? 'on heading' : a > 0 ? 'right' : 'left'}`;

/** Body of the existing dialog, with the existing semantic panel/button/telemetry styles. */
export function takeoffBrief(type) {
  const fit = takeoffAvailability(type);
  return `<div class="dialog-body landing-brief"><span class="landing-eyebrow">Alpine Field · runway 36 · calm air · manual flight</span><h3>Mira T2 · takeoff practice</h3>` + (fit.available
    ? `<p>Start stopped on the centreline, 100 m past the threshold, with idle power, fixed gear, flaps retracted and neutral trim. Your destination stays selected; your wind returns when you leave.</p>
    <ol><li><strong>Accelerate.</strong> Hold Shift / + for full power and release B / Brake. Keep straight with small Q / E, A / D or sideways yoke inputs.</li><li><strong>Lift off near 60 kt.</strong> Tap S / ↓ or pull the yoke gently back. Once airborne, ease off and aim for a 5–10° nose attitude.</li><li><strong>Hold the climb.</strong> Reach 150 ft above the runway, then climb for 3 continuous seconds at 62–126 kt. Keep power at least 80%, nose 2–18° up, bank within 15°, heading within 20° of 360°, and climb at least 200 ft/min.</li></ol>
    <p class="dialog-note">Manual throughout: assist, a crash, leaving the runway before liftoff, touching down again or 90 seconds without the climb ends the attempt. Keep flaps retracted. Pause, dialogs and a hidden tab freeze progress. R / Retry repeats the start; Free flight restores your wind.</p>
    <p class="dialog-note">Local arcade practice, not certified aircraft limits. Feedback measures distance rolled from the starting point to liftoff, airspeed, nose alignment and centreline offset at liftoff.</p>
    <button class="primary-btn" id="start-takeoff">Start Mira T2 takeoff <i data-lucide="arrow-up-right"></i></button>`
    : `<p class="mission-caution unavailable" role="note"><i data-lucide="plane"></i><span>${fit.reason}.</span></p><p>Your ${type.name} stays selected until you switch.</p><button class="secondary-btn" id="takeoff-aircraft">Switch to the Mira T2 <i data-lucide="plane"></i></button><button class="primary-btn" data-next-dialog="explore">Back to Explore <i data-lucide="arrow-up-right"></i></button>`) + '</div>';
}

export function takeoffReadings(takeoff, state, options) {
  const at = takeoff.snapshot(), r = TAKEOFF;
  return { phase: !at.liftoff ? '1 / 3 · Accelerate and rotate near 60 kt' : at.phase === 'hold' ? '3 / 3 · Hold this climb' : '2 / 3 · Climb to 150 ft',
    progress: `${Math.min(r.stableSeconds, at.stableTime).toFixed(1)} / 3 s`,
    height: `${ft(takeoff.height(state))} / 150 ft`, cue: takeoff.guidance(state, options),
    objective: !at.liftoff ? `${Math.round(state.throttle * 100)}% power · ${kt(state.airspeed)} kt · ${Math.round(at.groundDistance)} m rolled`
      : `${kt(state.airspeed)} kt · nose ${Math.round(state.pitch * 180 / Math.PI)}° · ${alignmentText(takeoff.alignment(state))}` };
}

export function takeoffResult(takeoff) {
  const r = takeoff.result, l = r.liftoff, success = takeoff.status === 'success';
  const side = l && Math.abs(l.cross) < .05 ? 'on centre' : l?.cross > 0 ? 'right' : 'left';
  return { title: success ? 'A clean departure.' : 'Try the takeoff again.',
    reason: success ? 'Manual liftoff on runway 36, followed by 3 continuous seconds of controlled climb above 150 ft. Keep using small pitch corrections as speed builds.'
      : `${takeoff.reason}. Retry starts stopped in the same calm setup.`,
    metrics: `<div><dt>${l ? 'Takeoff ground roll' : 'Ground roll · no liftoff'}</dt><dd>${Math.round(r.groundDistance)} <small>m</small></dd></div><div><dt>Liftoff airspeed</dt><dd>${l ? `${kt(l.speed)} <small>kt</small>` : 'Not recorded'}</dd></div><div><dt>Liftoff nose alignment</dt><dd>${l ? alignmentText(l.alignment) : 'Not recorded'}</dd></div><div><dt>Liftoff centreline offset</dt><dd>${l ? `${Math.abs(l.cross).toFixed(1)} <small>m · ${side}</small>` : 'Not recorded'}</dd></div>` };
}
