import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { initializeStorage } from '../../storage.js';

export async function database(t, directory, { initialize = true } = {}) {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL database to run integration tests');
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  const options = { pool, baseDirectory: directory, directory, environment: {} };
  return { pool, options, storage: initialize ? await initializeStorage(options) : undefined };
}
