import { boardKey, RANK_METRICS } from './ranked-rules.js';

export const ACTIVITY_NAMES = Object.freeze({ landing: 'Precision landing', course: 'Checkpoint course', crosswind: 'Crosswind practice', recovery: 'Stall recovery' });
export const METRICS = Object.freeze({
  elapsedMs: { label: 'Elapsed', unit: 's' }, sinkMmPerSecond: { label: 'Touchdown sink', unit: 'm/s' },
  centrelineMm: { label: 'Centreline offset', unit: 'm' }, alignmentMilliDegrees: { label: 'Alignment error', unit: '°' },
  heightLostMm: { label: 'Height lost', unit: 'm' }, recoveryMs: { label: 'Recovery time', unit: 's' },
  touchdownAlongMm: { label: 'From threshold', unit: 'm' }, speedMmPerSecond: { label: 'Touchdown speed', unit: 'm/s' },
  attemptMs: { label: 'Attempt duration', unit: 's' },
});
export const metricText = value => (value / 1000).toFixed(3);
export const scoreFields = board => RANK_METRICS[board.activity];
export const extraFields = board => ['landing', 'crosswind'].includes(board.activity)
  ? ['touchdownAlongMm', 'speedMmPerSecond', 'elapsedMs'] : board.activity === 'recovery' ? ['attemptMs'] : [];

// Prefer the existing selection within the new valid options; never change the live aircraft/airfield.
export function chooseBoard(boards, current = {}, changed = {}) {
  const matches = boards.filter(board => Object.entries(changed).every(([key, value]) => board[key] === value));
  const fields = ['activity', 'aircraft', 'course', 'airport', 'runway', 'setup'];
  return matches.map((board, index) => ({ board, index, score: fields.reduce((sum, key, i) => sum + (board[key] === current[key] ? 2 ** (fields.length - i) : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.board ?? null;
}

/** A single browse lifetime; every filter/page change invalidates the previous response, even if fetch ignores abort. */
export function createLeaderboardModel(client, onChange) {
  const state = { boards: [], board: null, entries: [], personalBest: null, nextCursor: null, rankingPolicy: 'runs', status: 'loading', error: null, profile: null, profileStatus: 'loading', profileError: null };
  let open = false, generation = 0, pageRequest = null, catalogRequest = null, profileRequest = null, profileGeneration = 0;
  const emit = () => { if (open) onChange(state); };
  const cancelPage = () => { generation++; pageRequest?.abort(); };
  const model = {
    state,
    async mount(preferred) {
      open = true;
      model.loadProfile();
      await model.loadBoards(preferred);
    },
    unmount() { open = false; cancelPage(); catalogRequest?.abort(); profileRequest?.abort(); profileGeneration++; },
    async loadBoards(preferred = state.board ?? {}) {
      catalogRequest?.abort(); cancelPage();
      const request = catalogRequest = new AbortController();
      Object.assign(state, { status: 'loading', error: null, entries: [], personalBest: null, nextCursor: null, board: null }); emit();
      try {
        const catalog = await client.boards({ signal: request.signal });
        if (!open || catalogRequest !== request) return;
        state.boards = catalog.boards.map(item => item.board);
        state.board = chooseBoard(state.boards, preferred);
        if (state.board) await model.loadPage();
        else { state.status = 'no-boards'; emit(); }
      } catch (error) { if (open && catalogRequest === request && error.name !== 'AbortError') { state.error = error; state.status = 'catalog-error'; emit(); } }
    },
    select(field, value) {
      const next = chooseBoard(state.boards, state.board, { [field]: value, ...(field === 'activity' ? {} : { activity: state.board.activity }) });
      if (!next || boardKey(next) === boardKey(state.board)) return;
      state.board = next; model.loadPage();
    },
    async loadPage(append = false) {
      if (!state.board || append && (!state.nextCursor || state.status === 'loading-more')) return;
      cancelPage();
      const seq = generation, request = pageRequest = new AbortController(), board = state.board;
      const cursor = append ? state.nextCursor : undefined;
      Object.assign(state, { status: append ? 'loading-more' : 'loading', error: null });
      if (!append) Object.assign(state, { entries: [], personalBest: null, nextCursor: null }); emit();
      try {
        const page = await client.leaderboard(board, { signal: request.signal, cursor });
        if (!open || seq !== generation) return;
        // Reject repeated pages instead of displaying duplicates or an endless Load more button.
        const seen = new Set(append ? state.entries.map(row => row.id) : []);
        if (page.entries.some(row => { if (seen.has(row.id)) return true; seen.add(row.id); return false; }) || page.nextCursor && (page.nextCursor === cursor || !page.entries.length)) {
          throw Object.assign(new Error('Invalid page'), { code: 'INVALID_RESPONSE' });
        }
        Object.assign(state, { entries: append ? [...state.entries, ...page.entries] : page.entries,
          personalBest: page.personalBest ?? null, nextCursor: page.nextCursor, rankingPolicy: page.rankingPolicy ?? 'runs', status: 'ready' }); emit();
      } catch (error) { if (open && seq === generation && error.name !== 'AbortError') { state.error = error; state.status = append ? 'page-error' : 'error'; emit(); } }
    },
    async loadProfile(displayName) {
      profileRequest?.abort();
      const seq = ++profileGeneration, request = profileRequest = new AbortController();
      state.profileStatus = displayName === undefined ? 'loading' : 'saving'; state.profileError = null; emit();
      try {
        const profile = displayName === undefined ? await client.profile({ signal: request.signal }) : await client.saveProfile(displayName, { signal: request.signal });
        if (!open || seq !== profileGeneration) return;
        state.profile = profile; state.profileStatus = displayName === undefined ? 'ready' : 'saved'; emit();
        if (displayName !== undefined && state.board) await model.loadPage();
      } catch (error) { if (open && seq === profileGeneration && error.name !== 'AbortError') { state.profileError = error; state.profileStatus = 'error'; emit(); } }
    },
  };
  return model;
}
