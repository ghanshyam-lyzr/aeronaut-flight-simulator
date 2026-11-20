import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

export function createPool(connectionString = process.env.DATABASE_URL, options = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is required; start PostgreSQL before starting the service');
  const pool = new pg.Pool({ connectionString, max: 12, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, statement_timeout: 30000, idle_in_transaction_session_timeout: 45000, ...options });
  pool.on('error', () => console.error('PostgreSQL pool connection failed'));
  return pool;
}

export async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '3s'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function migrate(pool) {
  await transaction(pool, async client => {
    // All instances serialize schema changes, including the first creation of the migration ledger.
    await client.query('SELECT pg_advisory_xact_lock(1634038382, 1)');
    await client.query('CREATE TABLE IF NOT EXISTS ranked_migrations (name text PRIMARY KEY)');
    const directory = new URL('./migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(name => /^\d+[-\w]+\.sql$/.test(name)).sort()) {
      if ((await client.query('SELECT 1 FROM ranked_migrations WHERE name = $1', [name])).rowCount) continue;
      await client.query(await readFile(new URL(name, directory), 'utf8'));
      await client.query('INSERT INTO ranked_migrations(name) VALUES ($1)', [name]);
    }
  });
}

export async function databaseNow(client) {
  const { rows } = await client.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now');
  return Number(rows[0].now);
}
