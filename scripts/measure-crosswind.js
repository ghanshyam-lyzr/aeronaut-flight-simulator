// Crosswind practice with ordinary inputs (tests/crosswind-pilot.js through FlightInputs), at several frame rates.
// Run: node scripts/measure-crosswind.js — deterministic; the numbers in docs/crosswind-practice.md come from it.
import { setup, flyApproach } from '../tests/crosswind-pilot.js';
import { PRACTICE, practiceBrief } from '../src/crosswind-practice.js';
import { FLEET } from '../src/fleet.js';
import { KNOT } from '../src/wind.js';

const kt = v => (v / KNOT).toFixed(1), deg = r => (r * 180 / Math.PI).toFixed(1);
for (const id of ['trainer', 'jet']) {
  const b = practiceBrief(FLEET[id]);
  console.log(`${FLEET[id].name}: wind ${b.report}, crosswind ${kt(b.crosswind)} kt from the ${b.side} (gusts ${kt(b.gustCrosswind)}), headwind ${kt(b.headwind)} kt, approach ${kt(b.speed)} kt, crab ${deg(b.crab)}°`);
}
const rows = [];
for (const id of ['trainer', 'jet']) for (const [label, opts] of [['crab + straighten at 10 ft', {}], ['following the live cue', { followCue: true }], ['following the live cue, yoke only', { followCue: true, rudder: false }], ['straighten at 8 m (too early)', { straighten: 8 }], ['crab, never straightened', { straighten: null }], ['crab, not straightened or steered', { straighten: null, steer: false }], ['touch yoke only (no rudder)', { rudder: false }], ['uncorrected', { correct: false }],
  ['crab + straighten at 10 ft, 30 fps', { rate: 30 }], ['crab + straighten at 10 ft, 20 fps', { rate: 20 }], ['crab + straighten at 10 ft, 10 fps', { rate: 10 }]]) {
  const x = setup(id); x.activities.startCrosswind(x.flight);
  const r = flyApproach(x, opts), t = r.touchdown, fb = r.feedback;
  rows.push({ aircraft: FLEET[id].name, pilot: label, result: r.status === 'success' ? 'success' : r.reason,
    'crab on final °': fb.crab === null ? '—' : deg(fb.crab), 'threshold offset m': fb.thresholdCross === null ? '—' : fb.thresholdCross.toFixed(1),
    'touchdown along m': t ? t.along.toFixed(0) : '—', 'touchdown offset m': t ? t.cross.toFixed(1) : '—', 'touchdown crab °': fb.touchdownCrab === null ? '—' : deg(fb.touchdownCrab),
    'sink fpm': t ? Math.round(t.sink * 196.85) : '—', 'touchdown kt': t ? kt(t.speed) : '—', 'stop along m': r.end.along.toFixed(0), 'max offset m': r.maxOffset.toFixed(1) });
  x.activities.cancel();
}
console.table(rows);
console.log(`Practice wind: ${JSON.stringify(PRACTICE.wind)}`);
