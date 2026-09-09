import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';

/**
 * Tiny forward-only migration runner: applies every *.sql in migrations/ in
 * lexical order, tracked in the schema_migrations table. Idempotent.
 */
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename,
    ),
  );

  for (const file of files) {
    if (done.has(file)) {
      console.log(`= skip ${file}`);
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    console.log(`+ apply ${file}`);
    const client = await pool.connect();
    try {
      await client.query(sql); // each file wraps its own BEGIN/COMMIT
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    } finally {
      client.release();
    }
  }
  console.log('migrations up to date');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
