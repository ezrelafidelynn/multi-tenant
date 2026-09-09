import pg from 'pg';
import pgvector from 'pgvector/pg';
import { config } from './config.js';

/**
 * Single pool for the whole process. `pgvector` registers the `vector` type so
 * `number[]` params bind correctly and `vector` columns parse back to `number[]`.
 */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('connect', (client) => {
  pgvector.registerType(client).catch((err: unknown) => {
    console.error('pgvector.registerType failed', err);
  });
});

export type Tx = pg.PoolClient;

/**
 * Run `fn` inside a transaction that is pinned to a single tenant.
 *
 *   SET LOCAL app.current_org = '<uuid>'
 *
 * powers the Row-Level Security policies in 001_init.sql. Every tenant-scoped
 * query in the app goes through here, so even a query that forgets its explicit
 * `WHERE organization_id = $1` cannot leak across tenants.
 */
export async function withTenant<T>(
  organizationId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // set_config(..., true) => local to this transaction; parameterised, no SQLi.
    await client.query("SELECT set_config('app.current_org', $1, true)", [organizationId]);
    await client.query(`SET LOCAL hnsw.ef_search = ${config.retrieval.hnswEfSearch}`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Non-tenant query helper (auth lookups, migrations, health checks). */
export function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return pool.query<R>(text, params as never[]);
}
