import { normalizeLandingAttempts, MAX_LANDING_ATTEMPTS } from './landing-history.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const available = value => Number.isFinite(value);
const measure = (value, unit, factor = 1, digits = 1) => available(value) ? `${(value * factor).toFixed(digits)} ${unit}` : 'Unavailable';
const degrees = (value, digits = 1) => measure(value, '°', 180 / Math.PI, digits);
const bool = (value, yes, no) => value === true ? yes : value === false ? no : 'Unavailable';
const label = (item, fallback) => item.name || item.id || fallback;
const date = value => value ? new Date(value).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : 'Unknown date';
const tile = (title, value) => `<div><dt>${escape(title)}</dt><dd>${escape(value)}</dd></div>`;
const signed = (value, unit, positive, negative, factor = 1) => available(value) ? `${measure(Math.abs(value), unit, factor)}${value ? ` ${value > 0 ? positive : negative}` : ''}` : 'Unavailable';
const formatWind = wind => {
  const c = wind.config;
  if (![c.direction, c.speed, c.gust].every(available)) return 'Unavailable';
  if (!c.speed && !c.gust) return 'Calm · 0 kt';
  return `${Math.round(c.direction * 180 / Math.PI) % 360 || 360}° from · ${measure(c.speed, 'kt', 1.94384)}${c.gust ? `, gusts ${measure(c.speed + c.gust, 'kt', 1.94384)}` : ''}${wind.transitioning ? ' · blending' : ''}`;
};

function attemptRow(entry) {
  const e = entry, t = e.touchdown, s = e.setup, f = e.field;
  const outcome = e.outcome === 'success' ? 'Completed' : 'Not completed';
  const reason = e.reason || (e.outcome === 'success' ? 'Safe touchdown and controlled rollout.' : 'No completion reason recorded.');
  return `<details class="attempt-row"><summary><span class="attempt-heading"><strong>${escape(label(e.aircraft, 'Unknown aircraft'))}</strong><span>${escape(label(f, 'Unknown airfield'))} · runway ${escape(f.runway || 'unavailable')} · ${e.exercise === 'crosswind' ? 'Crosswind practice' : 'Landing mission'}</span><time${e.finishedAt ? ` datetime="${escape(e.finishedAt)}"` : ''}>${escape(date(e.finishedAt))}</time></span><span class="attempt-result ${e.outcome === 'success' ? 'completed' : ''}">${outcome}<span>${t ? `Sink ${measure(t.sink, 'fpm', 196.85, 0)}` : 'No touchdown recorded'}</span><span class="attempt-expand">Review details</span></span></summary>
    <div class="attempt-details"><p class="attempt-reason">${escape(reason)}</p><dl class="attempt-metrics">
    ${tile('Touchdown sink', measure(t?.sink, 'fpm', 196.85, 0))}${tile('Touchdown speed', measure(t?.speed, 'kt', 1.94384))}
    ${tile('Centreline offset', signed(t?.cross, 'm', 'right', 'left'))}${tile('Runway alignment error', measure(t?.alignment, '°'))}
    ${tile('From runway threshold', measure(t?.along, 'm'))}${tile('Touchdown at flight time', measure(t?.time, 's'))}
    ${tile('Touchdown bank', signed(t?.bank, '°', 'right', 'left', 180 / Math.PI))}${tile('Touchdown pitch', signed(t?.pitch, '°', 'nose up', 'nose down', 180 / Math.PI))}
    ${tile('Gear at touchdown', bool(t?.gearDown, 'Down / fixed', 'Retracted'))}${tile('Flaps at touchdown', measure(t?.flaps, '°', 15, 0))}
    ${e.exercise === 'crosswind' ? tile('Mean crab on final', signed(e.feedback.crab, '°', 'right', 'left', 180 / Math.PI)) + tile('Threshold offset', signed(e.feedback.thresholdCross, 'm', 'right', 'left')) : ''}
    </dl><h4>Attempt setup</h4><dl class="attempt-setup">
    ${tile('Started', date(e.startedAt))}${tile('Flight duration', measure(e.elapsed, 's'))}
    ${tile('Wind at start', formatWind(e.windStart))}${tile('Wind at finish', formatWind(e.windEnd))}
    ${tile('Wind seed / veer at start', `${measure(e.windStart.config.seed, '', 1, 0).trim()} / ${degrees(e.windStart.config.veer)}`)}
    ${tile('Runway', `${measure(f.runwayLength, 'm', 1, 0)} × ${measure(f.runwayWidth, 'm', 1, 0)} · ${f.surface || 'surface unavailable'}`)}
    ${tile('Runway heading / elevation', `${degrees(f.heading)} / ${measure(f.elevation, 'ft MSL', 3.28084, 0)}`)}
    ${tile('Initial airspeed / target', `${measure(s.speed, 'kt', 1.94384)} / ${measure(s.targetSpeed, 'kt', 1.94384)}`)}
    ${tile('Initial gear / flaps', `${bool(s.gearDown, 'Down / fixed', 'Retracted')} / ${measure(s.flaps, '°', 15, 0)}`)}
    ${tile('Initial power / assist', `${measure(s.throttle, '%', 100, 0)} / ${bool(s.autopilot, 'On', 'Off')}`)}
    ${tile('Initial height / pitch / bank', `${measure(s.position.y, 'ft MSL', 3.28084, 0)} / ${degrees(s.pitch)} / ${degrees(s.bank)}`)}
    ${tile('Initial heading / trim', `${degrees(s.heading)} / ${degrees(s.pitchTrim)}`)}
    ${tile('Touchdown limits', `${measure(s.maxSink, 'fpm sink', 196.85, 0)} / ${measure(s.maxSpeed, 'kt', 1.94384)}`)}
    ${tile('Light preset at start', s.weather || 'Unavailable')}
    </dl></div></details>`;
}

export function landingHistoryRows(entries, { aircraft = '', airfield = '' } = {}) {
  const all = normalizeLandingAttempts(entries), filtered = all.filter(e => (!aircraft || e.aircraft.id === aircraft) && (!airfield || e.field.id === airfield));
  return { count: `${filtered.length} of ${all.length} attempts`, markup: filtered.length ? filtered.map(attemptRow).join('')
    : `<div class="empty-log">${all.length ? 'No attempts match these filters. Choose all aircraft or all airfields to see more.' : 'No finished landing attempts yet. Complete a landing mission or crosswind practice to start your history. Attempts that end before touchdown still appear with their outcome.'}</div>` };
}
export function landingHistoryMarkup(history) {
  const entries = normalizeLandingAttempts(history.entries);
  const options = key => [...new Map(entries.filter(e => e[key].id).map(e => [e[key].id, label(e[key], 'Unknown')])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => `<option value="${escape(id)}">${escape(name)}</option>`).join('');
  const rows = landingHistoryRows(entries);
  return `<section class="landing-history" aria-labelledby="landing-history-title"><h3 id="landing-history-title">Landing history <span>Local to this browser</span></h3>
    <p class="history-note">Your last ${MAX_LANDING_ATTEMPTS} finished landing and crosswind attempts. Separate from public rankings; these observations are not verified scores.</p>
    ${history.persisted === false ? '<p class="history-storage" role="status">Browser storage is unavailable or full. New attempts remain here for this session; they may be lost when you reload.</p>' : ''}
    <div class="history-filters"><div><label for="history-aircraft">Aircraft</label><select id="history-aircraft" data-history-filter="aircraft"><option value="">All aircraft</option>${options('aircraft')}</select></div><div><label for="history-airfield">Airfield</label><select id="history-airfield" data-history-filter="airfield"><option value="">All airfields</option>${options('field')}</select></div></div>
    <p class="history-count" data-history-count role="status">${rows.count}</p><div data-history-rows>${rows.markup}</div></section>`;
}
export function mountLandingHistory(root, history) {
  const filters = root.querySelectorAll('[data-history-filter]');
  for (const select of filters) select.onchange = () => {
    const values = Object.fromEntries([...filters].map(control => [control.dataset.historyFilter, control.value]));
    const rows = landingHistoryRows(history.entries, values);
    root.querySelector('[data-history-rows]').innerHTML = rows.markup;
    root.querySelector('[data-history-count]').textContent = rows.count;
  };
}
