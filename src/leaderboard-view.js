import './leaderboard.css';
import { FLEET } from './fleet.js';
import { AIRPORTS } from './airports.js';
import { COURSE } from './checkpoint-course.js';
import { RULES_VERSION } from './ranked-rules.js';
import { createRankedClient } from './ranked-client.js';
import { ACTIVITY_NAMES, METRICS, metricText, scoreFields, extraFields, createLeaderboardModel } from './leaderboard-model.js';

// All server-provided names/ids go through text escaping, including attribute values.
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fieldName = id => AIRPORTS.find(field => field.id === id)?.name ?? id;
const setupNames = { calm: 'Calm', breeze: 'Breeze · 240° / 8 kt', gusts: 'Gusts · 260° / 14–24 kt', 'crosswind-practice': '080° / 9–12 kt · fixed gusts', 'stall-recovery': 'Calm · fixed recovery setup' };
const valueMarkup = (key, value) => `${metricText(value)}<small>${METRICS[key].unit}</small>`;
const statusText = error => {
  if (error?.code === 'UNSUPPORTED_RULES') return 'These rankings use a different rules version. Reload the simulator to check for an update.';
  if (error?.code === 'TIMEOUT') return 'The leaderboard service took too long to respond. Try again when your connection is ready.';
  if (error?.status === 429) return 'The leaderboard service is busy. Please wait a moment before retrying.';
  if (error?.code === 'INVALID_RESPONSE') return 'The service returned an unreadable board. No scores from that response are shown.';
  return 'The online leaderboard service could not be reached. Your flight is still here; you can retry or close this panel.';
};
export const leaderboardMarkup = () => `<div class="dialog-head"><div><span class="lb-eyebrow">Alpine Flight · online</span><h2 id="leaderboard-title">Leaderboards</h2></div><button class="icon-btn" data-close aria-label="Close leaderboards"><i data-lucide="x"></i></button></div>
  <div class="dialog-body lb-body">
    <p class="lb-intro">Fly the same setup. Compare the actual measurements.<span>Your flight pauses here. Close to resume it.</span></p>
    <div class="lb-filters" id="lb-filters" aria-label="Leaderboard filters"></div>
    <section class="lb-board" aria-labelledby="lb-board-title"><div class="lb-board-heading"><div><span class="lb-eyebrow" id="lb-board-caption">Public rankings</span><h3 id="lb-board-title">Finding boards…</h3></div><button class="lb-button" id="lb-refresh" hidden>Refresh</button></div>
      <p class="lb-ranking" id="lb-ranking"></p><div id="lb-personal"></div>
      <div id="lb-results" aria-busy="true"></div><div class="lb-feedback" id="lb-feedback" role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="lb-page-actions"><button class="lb-button" id="lb-retry" hidden>Retry</button><button class="lb-button" id="lb-more" hidden>Load more results</button><span id="lb-count"></span></div>
    </section>
    <div class="lb-support"><section class="lb-profile" aria-labelledby="lb-profile-title"><h3 id="lb-profile-title">Your pilot name</h3><p id="lb-profile-note">A public display name for this browser’s anonymous profile. This is not a verified account. Names can be shared by different pilots; clearing browser cookies loses access to this profile.</p>
      <form id="lb-profile-form"><label for="lb-name">Public display name</label><div class="lb-profile-entry"><input id="lb-name" name="displayName" type="text" maxlength="40" autocomplete="nickname" spellcheck="false" required aria-describedby="lb-profile-note lb-profile-status" placeholder="Choose a pilot name"/><button class="lb-button" id="lb-save" type="submit">Save name</button></div></form><p id="lb-profile-status" role="status" aria-live="polite"></p><p class="lb-name-note">Name changes apply to future runs. Accepted runs keep their submitted name.</p><button class="lb-text-button" id="lb-profile-retry" hidden>Retry profile connection</button>
    </section><details class="lb-rules"><summary>Ranked setup & eligibility</summary><p>Each board fixes the aircraft, activity, course or airfield, runway and wind. Ranked attempts start from the prescribed position, speed, power, gear and flaps, with neutral trim and assist off. Browsing these boards changes none of your flight settings.</p><p>Only a completed, server-verified manual run qualifies. Flight assist, hover hold and heading hold are forbidden throughout. Changing the aircraft or setup, resetting, crashing or cancelling ends eligibility. A landing includes the controlled, stopped two-second rollout; touchdown alone does not qualify.</p><p>Pauses and dialogs stop simulation time; the server attempt still expires after one hour. Runs are limited to ten minutes of simulation. Ordinary local runs are not retroactively ranked. This panel browses results and edits your profile; it does not start or submit attempts.</p><p>Lower measurements rank first, in the order shown. All ranking values use three decimals. Equal score tuples share a rank (1, 1, 3); server acceptance time then entry ID orders tied rows. Each accepted run is listed unless the board explicitly says best per pilot. These are arcade-simulator results, not real-world pilot qualifications or proof of human authorship.</p><small>${RULES_VERSION}</small></details></div>
  </div>`;

export function createLeaderboardView({ client = createRankedClient() } = {}) {
  let root = null, model = null, lastBoard = null, draft = '', profileSeen = false, lastProfile = null, lastRows = null, lastBest = null;
  const find = id => root.querySelector(`#${id}`);
  async function followRequest(request, target) {
    await request;
    // Hiding/disabling an action can move native focus to body. Respect any new control the pilot chose meanwhile.
    if (root && document.activeElement === document.body) { const node = find(target()); node.tabIndex = -1; node.focus({ preventScroll: true }); }
  }
  function filters(state) {
    const node = find('lb-filters'), focused = document.activeElement?.id;
    if (!state.board) { node.innerHTML = ''; return; }
    const board = state.board, rows = state.boards.filter(item => item.activity === board.activity), sameAircraft = rows.filter(item => item.aircraft === board.aircraft);
    const select = (field, label, boards, describe) => {
      const values = [...new Set(boards.map(item => item[field]))];
      return `<label for="lb-${field}">${label}<select id="lb-${field}" data-filter="${field}">${values.map(value => `<option value="${escape(value)}"${value === board[field] ? ' selected' : ''}>${escape(describe(value))}</option>`).join('')}</select></label>`;
    };
    node.innerHTML = select('activity', 'Activity', state.boards, id => ACTIVITY_NAMES[id])
      + select('aircraft', 'Aircraft', rows, id => FLEET[id].name)
      + (board.course ? select('course', 'Course', sameAircraft, id => id === COURSE.id ? COURSE.name : id) : '')
      + (board.airport ? select('airport', 'Airfield', sameAircraft, fieldName) + select('runway', 'Runway', sameAircraft.filter(item => item.airport === board.airport), id => id) : '')
      + select('setup', 'Prescribed wind', sameAircraft.filter(item => item.airport === board.airport && item.runway === board.runway && item.course === board.course), id => setupNames[id] ?? id);
    node.querySelectorAll('select').forEach(select => select.onchange = () => model.select(select.dataset.filter, select.value));
    if (focused?.startsWith('lb-')) root.querySelector(`#${focused}`)?.focus({ preventScroll: true });
  }
  function results(state) {
    const { board, entries, personalBest } = state, node = find('lb-results');
    node.setAttribute('aria-busy', ['loading', 'loading-more'].includes(state.status));
    find('lb-refresh').hidden = !board;
    find('lb-refresh').disabled = ['loading', 'loading-more'].includes(state.status);
    find('lb-board-caption').textContent = 'Public rankings · every accepted run';
    find('lb-board-title').textContent = board ? (board.course ? COURSE.name : board.airport ? `${fieldName(board.airport)} · runway ${board.runway}` : 'Mira T2 · stall recovery') : 'Online leaderboards';
    const fields = board ? scoreFields(board) : [];
    find('lb-ranking').textContent = board ? `${ACTIVITY_NAMES[board.activity]} · ${FLEET[board.aircraft].name} · ${setupNames[board.setup]}. Lower is better: ${fields.map((key, i) => `${i + 1}. ${METRICS[key].label.toLowerCase()} (${METRICS[key].unit})`).join(' → ')}.` : '';
    const personal = find('lb-personal');
    personal.innerHTML = board && state.status === 'ready' ? personalBest
      ? `<div class="lb-best"><span>Your personal best <b>#${personalBest.rank}</b></span><strong>${fields.map(key => valueMarkup(key, personalBest.metrics[key])).join('<span> / </span>')}</strong></div>`
      : `<p class="lb-personal-note">${['loading', 'error'].includes(state.profileStatus) ? 'Connect your browser profile to see your personal best.' : 'No ranked result for this browser on this board yet.'}</p>` : '';
    if (entries.length && (entries !== lastRows || personalBest !== lastBest)) {
      node.innerHTML = `<table class="lb-table"><caption class="lb-sr-only">${escape(ACTIVITY_NAMES[board.activity])} rankings. ${fields.map(key => `${METRICS[key].label} in ${METRICS[key].unit}`).join(', ')}. Lower is better.</caption><thead><tr><th scope="col">Rank</th><th scope="col">Pilot</th>${fields.map((key, i) => `<th scope="col">${i + 1}. ${METRICS[key].label}<small>${METRICS[key].unit}</small></th>`).join('')}</tr></thead><tbody>${entries.map(row => {
        const own = row.isOwn === true || row.id === personalBest?.id;
        const details = extraFields(board).map(key => `${METRICS[key].label}: ${metricText(row.metrics[key])} ${METRICS[key].unit}`);
        if (board.activity === 'course') details.push(`Gate splits (elapsed): ${row.metrics.splitsMs.map((value, index) => `${index + 1}: ${metricText(value)} s`).join(' · ')}`);
        details.push(`Accepted ${new Date(row.submittedAt).toISOString().slice(0, 10)} UTC`);
        return `<tr${own ? ' class="lb-own"' : ''}><td class="lb-rank"><span class="lb-sr-only">Rank </span>${row.rank}</td><th scope="row" class="lb-pilot"><span>${escape(row.displayName)}</span>${own ? `<small>${row.id === personalBest?.id ? 'Your personal best' : 'Your run'}</small>` : ''}<details><summary>Run details</summary><p>${escape(details.join(' · '))}</p></details></th>${fields.map(key => `<td class="lb-value"><span class="lb-mobile-metric">${METRICS[key].label}</span><strong>${valueMarkup(key, row.metrics[key])}</strong></td>`).join('')}</tr>`;
      }).join('')}</tbody></table>`;
    } else if (!entries.length) node.innerHTML = '';
    lastRows = entries; lastBest = personalBest;
    const feedback = find('lb-feedback');
    feedback.classList.toggle('lb-error', !!state.error);
    feedback.innerHTML = state.error ? `<strong>${state.status === 'page-error' ? 'More results could not load' : 'Rankings unavailable'}</strong><p>${statusText(state.error)}</p><small>Code: ${escape(state.error.code ?? 'REQUEST_FAILED')}</small>`
      : state.status === 'no-boards' ? '<strong>No boards available</strong><p>The service has no supported boards for this simulator yet.</p>'
        : state.status === 'loading' ? '<strong>Loading rankings…</strong><p>Requesting verified scores from the online service.</p>'
          : state.status === 'loading-more' ? 'Loading more results…'
            : !entries.length ? '<strong>No ranked runs yet</strong><p>No accepted runs have been returned for this exact setup.</p>' : '';
    feedback.hidden = !feedback.innerHTML;
    find('lb-retry').hidden = !state.error;
    find('lb-more').hidden = !state.nextCursor || state.status === 'page-error';
    find('lb-more').disabled = state.status === 'loading-more';
    find('lb-more').textContent = state.status === 'loading-more' ? 'Loading…' : 'Load more results';
    find('lb-count').textContent = entries.length ? `${entries.length} ${entries.length === 1 ? 'result' : 'results'} shown${state.nextCursor ? '' : ' · end of board'}` : '';
    if (root.contains(document.activeElement) && document.activeElement.hidden) {
      const target = entries.length ? find('lb-count') : feedback;
      target.tabIndex = -1; target.focus({ preventScroll: true });
    }
  }
  function profile(state) {
    const field = find('lb-name'), loading = ['loading', 'saving'].includes(state.profileStatus);
    if (!profileSeen && state.profile && !draft) { draft = state.profile.displayName; field.value = draft; profileSeen = true; }
    if (state.profileStatus === 'saved' && state.profile !== lastProfile) { draft = state.profile.displayName; field.value = draft; }
    lastProfile = state.profile;
    find('lb-save').disabled = loading;
    find('lb-save').textContent = state.profileStatus === 'saving' ? 'Saving…' : 'Save name';
    find('lb-profile-status').textContent = state.profileError ? state.profileError.status === 400 ? 'Choose a valid pilot name, then save again.' : 'Profile unavailable. Your name has not been saved; retry the connection.' : state.profileStatus === 'loading' ? 'Connecting to your browser profile…' : state.profileStatus === 'saving' ? 'Saving your public name…' : state.profileStatus === 'saved' ? `Saved as ${state.profile.displayName}.` : state.profile ? `Connected as ${state.profile.displayName}.` : 'Save a name to create this browser’s anonymous profile.';
    find('lb-profile-retry').hidden = !state.profileError;
  }
  return {
    mount(element, preferred = {}) {
      root = element; draft = ''; profileSeen = false; lastBoard = null; lastProfile = null; lastRows = null; lastBest = null;
      model = createLeaderboardModel(client, state => {
        if (state.board !== lastBoard || !state.board) { filters(state); lastBoard = state.board; }
        results(state); profile(state);
      });
      find('lb-name').oninput = event => { draft = event.target.value; event.target.setCustomValidity(''); };
      find('lb-profile-form').onsubmit = event => { event.preventDefault(); const name = draft.trim(); if (!name) { find('lb-name').setCustomValidity('Enter a public pilot name.'); find('lb-name').reportValidity(); return; } followRequest(model.loadProfile(name), () => 'lb-save'); };
      find('lb-profile-retry').onclick = () => followRequest(model.loadProfile(), () => 'lb-save');
      find('lb-refresh').onclick = () => model.loadPage();
      const resultFocus = () => model.state.entries.length ? 'lb-count' : 'lb-feedback';
      find('lb-retry').onclick = () => followRequest(model.state.status === 'catalog-error' ? model.loadBoards(preferred) : model.loadPage(model.state.status === 'page-error'), resultFocus);
      find('lb-more').onclick = () => followRequest(model.loadPage(true), resultFocus);
      model.mount(preferred);
    },
    unmount() { model?.unmount(); model = null; root = null; },
  };
}
