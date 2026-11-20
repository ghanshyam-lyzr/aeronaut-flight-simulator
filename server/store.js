import { randomBytes, randomUUID } from 'node:crypto';
import { RULES_VERSION, RUN_LIMITS, RankedRunError, validateAttempt, rankingTuple, boardKey } from '../src/ranked-rules.js';
import { transaction, databaseNow } from './database.js';
import { fail, digest, errorStatus, publicEntry, cursorFor } from './protocol.js';
import { verifyInWorker } from './verifier.js';

export const RATE_LIMITS = Object.freeze({
  profile: { count: 20, milliseconds: 3600000 },
  profileEdit: { count: 30, milliseconds: 600000 },
  attempts: { count: 30, milliseconds: 600000 },
  submissions: { count: 30, milliseconds: 600000 },
  addressAttempts: { count: 120, milliseconds: 600000 },
  addressSubmissions: { count: 60, milliseconds: 600000 },
});

export async function throttle(pool, subject, action, limit) {
  const { rows } = await pool.query(`
    WITH tick AS (SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now)
    INSERT INTO ranked_throttles(subject, action, window_start, count)
    SELECT $1, $2, now - mod(now, $3::bigint), 1 FROM tick
    ON CONFLICT (subject, action) DO UPDATE SET
      count = CASE WHEN ranked_throttles.window_start = EXCLUDED.window_start
        THEN least(ranked_throttles.count, 1000000) + 1 ELSE 1 END,
      window_start = EXCLUDED.window_start
    RETURNING count`, [subject, action, limit.milliseconds]);
  fail(rows[0].count <= limit.count, 429, 'RATE_LIMITED', 'Too many requests; try again later');
}

const trustedAttempt = row => ({ id: row.id, board: row.board, status: row.status,
  issuedAt: Number(row.issued_at), expiresAt: Number(row.expires_at) });

export class RankedStore {
  constructor(pool) { this.pool = pool; }

  async pilot(token) {
    if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
    return (await this.pool.query('SELECT id, display_name FROM ranked_pilots WHERE cookie_hash = $1', [digest(token)])).rows[0] ?? null;
  }

  async profile(pilot, name) {
    if (pilot) {
      await throttle(this.pool, pilot.id, 'profileEdit', RATE_LIMITS.profileEdit);
      const { rows } = await this.pool.query('UPDATE ranked_pilots SET display_name = $2 WHERE id = $1 RETURNING id, display_name', [pilot.id, name]);
      return { pilot: rows[0], token: null };
    }
    const token = randomBytes(32).toString('base64url'), id = randomUUID();
    const { rows } = await this.pool.query(`INSERT INTO ranked_pilots(id, cookie_hash, display_name, created_at)
      VALUES ($1, $2, $3, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) RETURNING id, display_name`, [id, digest(token), name]);
    return { pilot: rows[0], token };
  }

  async issue(pilot, board) {
    await throttle(this.pool, pilot.id, 'attempts', RATE_LIMITS.attempts);
    return transaction(this.pool, async client => {
      // Serialize the per-pilot open-ticket cap across instances and browser tabs.
      await client.query('SELECT id FROM ranked_pilots WHERE id = $1 FOR UPDATE', [pilot.id]);
      const now = await databaseNow(client);
      const { rows } = await client.query(`SELECT count(*) FROM ranked_attempts
        WHERE pilot_id = $1 AND status = 'open' AND expires_at > $2`, [pilot.id, now]);
      fail(Number(rows[0].count) < 8, 429, 'TOO_MANY_ATTEMPTS', 'Finish or cancel an open run before starting another');
      const attempt = { id: randomUUID(), board, status: 'open', issuedAt: now, expiresAt: now + RUN_LIMITS.attemptLifetimeMs };
      await client.query(`INSERT INTO ranked_attempts(id, pilot_id, board_key, board, issued_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)`, [attempt.id, pilot.id, boardKey(board), board, now, attempt.expiresAt]);
      return { attempt, serverNow: now };
    });
  }

  async cancel(pilot, id) {
    await transaction(this.pool, async client => {
      const { rows } = await client.query('SELECT status FROM ranked_attempts WHERE id = $1 AND pilot_id = $2 FOR UPDATE', [id, pilot.id]);
      fail(rows.length === 1, 404, 'NOT_FOUND', 'Run not found');
      if (rows[0].status === 'open') await client.query("UPDATE ranked_attempts SET status = 'cancelled' WHERE id = $1", [id]);
    });
  }

  async submit(pilot, replay, hash) {
    await throttle(this.pool, pilot.id, 'submissions', RATE_LIMITS.submissions);
    return transaction(this.pool, async client => {
      const { rows } = await client.query('SELECT * FROM ranked_attempts WHERE id = $1 AND pilot_id = $2 FOR UPDATE', [replay.attemptId, pilot.id]);
      fail(rows.length === 1, 404, 'NOT_FOUND', 'Run not found');
      const row = rows[0], now = await databaseNow(client);
      if (row.status === 'accepted' && row.replay_hash === hash) {
        const saved = (await client.query('SELECT * FROM ranked_entries WHERE id = $1', [row.id])).rows[0];
        return { status: 200, body: { entry: publicEntry(saved), serverNow: now } };
      }
      const attempt = trustedAttempt(row);
      validateAttempt(attempt, now);
      fail(boardKey(replay.board) === row.board_key, 400, 'BOARD_MISMATCH', 'Replay does not match the issued board');
      // A bounded database-wide semaphore also limits work when the service scales to several instances.
      let slot = false;
      for (let i = 0; i < 2; i++) {
        const result = await client.query('SELECT pg_try_advisory_xact_lock(1634038382, $1) AS locked', [10 + i]);
        if (result.rows[0].locked) { slot = true; break; }
      }
      fail(slot, 503, 'VERIFICATION_BUSY', 'Verification is busy; retry the same replay');
      const result = await verifyInWorker(replay, attempt, now);
      const acceptedAt = await databaseNow(client);
      validateAttempt(attempt, acceptedAt);
      if (!result.ok) {
        const rejection = new RankedRunError(result.code, result.message);
        if (errorStatus(rejection) >= 500) throw rejection;
        // Commit expected rejections. Throwing here would roll back the single-use finalization.
        await client.query("UPDATE ranked_attempts SET status = 'rejected', replay_hash = $2, rejection_code = $3 WHERE id = $1", [row.id, hash, result.code]);
        return { rejection };
      }
      fail(result.boardKey === row.board_key && boardKey(result.board) === row.board_key && result.board.rulesVersion === RULES_VERSION,
        500, 'INVALID_VERIFICATION', 'Invalid verification result');
      const score = rankingTuple(result.board, result.metrics);
      fail(Object.values(result.metrics).flat().every(value => Number.isSafeInteger(value) && value >= 0),
        500, 'INVALID_VERIFICATION', 'Invalid verification metrics');
      const name = (await client.query('SELECT display_name FROM ranked_pilots WHERE id = $1', [pilot.id])).rows[0].display_name;
      const inserted = await client.query(`INSERT INTO ranked_entries(id, pilot_id, board_key, board, display_name, metrics, score, submitted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, [row.id, pilot.id, row.board_key, result.board, name, result.metrics, score, acceptedAt]);
      await client.query(`INSERT INTO ranked_bests(pilot_id, board_key, entry_id, score, submitted_at)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (pilot_id, board_key) DO UPDATE SET
        entry_id = EXCLUDED.entry_id, score = EXCLUDED.score, submitted_at = EXCLUDED.submitted_at
        WHERE (EXCLUDED.score, EXCLUDED.submitted_at, EXCLUDED.entry_id) <
          (ranked_bests.score, ranked_bests.submitted_at, ranked_bests.entry_id)`, [pilot.id, row.board_key, row.id, score, acceptedAt]);
      // A concurrent best update can briefly wait on another transaction; do not accept after that wait expires the ticket.
      validateAttempt(attempt, await databaseNow(client));
      await client.query("UPDATE ranked_attempts SET status = 'accepted', replay_hash = $2 WHERE id = $1", [row.id, hash]);
      return { status: 201, body: { entry: publicEntry(inserted.rows[0]), serverNow: acceptedAt } };
    });
  }

  async leaderboard(board, pilot, limit, afterId) {
    const key = boardKey(board);
    return transaction(this.pool, async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (afterId) fail((await client.query('SELECT 1 FROM ranked_entries WHERE id = $1 AND board_key = $2', [afterId, key])).rowCount,
        400, 'INVALID_CURSOR', 'Cursor entry does not belong to this board');
      const ranked = `SELECT e.*, 1 + (SELECT count(*) FROM ranked_entries better
        WHERE better.board_key = e.board_key AND better.score < e.score) AS rank FROM ranked_entries e`;
      const { rows } = await client.query(`${ranked} WHERE e.board_key = $1
        AND ($2::text IS NULL OR (e.score, e.submitted_at, e.id) >
          (SELECT score, submitted_at, id FROM ranked_entries WHERE id = $2 AND board_key = $1))
        ORDER BY e.score, e.submitted_at, e.id LIMIT $3`, [key, afterId, limit + 1]);
      const best = pilot ? (await client.query(`${ranked} JOIN ranked_bests best ON best.entry_id = e.id
        WHERE best.pilot_id = $1 AND best.board_key = $2`, [pilot.id, key])).rows[0] : null;
      const page = rows.slice(0, limit);
      return { board, boardKey: key, rankingPolicy: 'runs', entries: page.map(row => publicEntry(row, pilot?.id)),
        personalBest: best ? publicEntry(best, pilot.id) : null,
        nextCursor: rows.length > limit ? cursorFor(key, page.at(-1).id) : null, serverNow: await databaseNow(client) };
    });
  }
}
