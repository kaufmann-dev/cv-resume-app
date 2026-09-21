import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import session from 'express-session';
import { z } from 'zod';
import { documentSchema, mergeDocuments } from './document-store.js';

const passcodesSchema = z.array(z.object({ code: z.string().min(1), expires: z.string().optional() }));
const keysSchema = z.array(z.object({ id: z.string(), name: z.string(), createdAt: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/) }));

export async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Files are read only during the first database initialization, never at runtime.
export function readMigrationData({ baseDirectory, directory = '/data', environment = process.env }) {
  const sources = [...new Set([directory, environment.DATA_DIRECTORY, path.join(baseDirectory, 'data'), baseDirectory].filter(Boolean))];
  const find = name => sources.map(source => path.join(source, name)).find(file => fs.existsSync(file));
  const json = (name, fallback) => {
    const file = find(name);
    return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  };
  const document = documentSchema.parse(find('document.json')
    ? json('document.json')
    : mergeDocuments(json('cv.json', { sections: [] }), json('resume.json', { sections: [] })));
  const pdf = find('resume.pdf');
  return {
    document,
    passcodes: passcodesSchema.parse(json('passcodes.json', [])),
    keys: keysSchema.parse(json('api-keys.json', [])),
    pdf: pdf ? { bytes: fs.readFileSync(pdf), updatedAt: fs.statSync(pdf).mtime } : null
  };
}

export async function initializeStorage({ pool, ...options }) {
  await transaction(pool, async client => {
    // Serialize first startup across replicas, including transactional DDL.
    await client.query('SELECT pg_advisory_xact_lock(732194601)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_migrations (version integer PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS app_document (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL, revision text NOT NULL);
      CREATE TABLE IF NOT EXISTS app_collections (name text PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS app_pdf (name text PRIMARY KEY, bytes bytea NOT NULL, updated_at timestamptz NOT NULL);
      CREATE TABLE IF NOT EXISTS app_sessions (sid text PRIMARY KEY, data jsonb NOT NULL, expires_at timestamptz NOT NULL);
      CREATE INDEX IF NOT EXISTS app_sessions_expiry ON app_sessions (expires_at);
    `);
    if ((await client.query('SELECT version FROM app_migrations WHERE version = 1')).rowCount) return;
    const data = readMigrationData(options);
    await client.query('INSERT INTO app_document VALUES (1, $1, $2)', [JSON.stringify(data.document), randomUUID()]);
    for (const [name, value] of [['passcodes', data.passcodes], ['keys', data.keys]]) {
      await client.query('INSERT INTO app_collections VALUES ($1, $2)', [name, JSON.stringify(value)]);
    }
    if (data.pdf) await client.query('INSERT INTO app_pdf VALUES ($1, $2, $3)', ['resume.pdf', data.pdf.bytes, data.pdf.updatedAt]);
    await client.query('INSERT INTO app_migrations (version) VALUES (1)');
  });
  console.log('PostgreSQL storage ready; initial data import complete');
  return createStorage(pool);
}

export function createPool(environment = process.env) {
  const connectionString = environment.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('Missing required environment variable: DATABASE_URL');
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 10000 });
  pool.on('error', error => console.error('PostgreSQL idle connection error:', error.message));
  return pool;
}

export function createStorage(pool) {
  return {
    pool,
    async readCollection(name) {
      const { rows } = await pool.query('SELECT data FROM app_collections WHERE name = $1', [name]);
      return rows[0].data;
    },
    async mutateCollection(name, change) {
      return transaction(pool, async client => {
        const { rows } = await client.query('SELECT data FROM app_collections WHERE name = $1 FOR UPDATE', [name]);
        const data = rows[0].data;
        change(data);
        await client.query('UPDATE app_collections SET data = $2 WHERE name = $1', [name, JSON.stringify(data)]);
        return data;
      });
    },
    async readPdf(name) {
      const { rows } = await pool.query('SELECT bytes, updated_at AS "updatedAt" FROM app_pdf WHERE name = $1', [name]);
      return rows[0];
    },
    async writePdf(name, bytes) {
      const { rows } = await pool.query(`INSERT INTO app_pdf VALUES ($1, $2, clock_timestamp())
        ON CONFLICT (name) DO UPDATE SET bytes = EXCLUDED.bytes, updated_at = EXCLUDED.updated_at
        RETURNING octet_length(bytes) AS size, updated_at AS "updatedAt"`, [name, bytes]);
      return rows[0];
    }
  };
}

export class PostgresSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
    this.timer = setInterval(() => {
      pool.query('DELETE FROM app_sessions WHERE expires_at <= now()').catch(error => console.error('Session cleanup failed:', error.message));
    }, 60 * 60 * 1000);
    this.timer.unref();
  }
  get(sid, callback) {
    this.pool.query('SELECT data FROM app_sessions WHERE sid = $1 AND expires_at > now()', [sid])
      .then(({ rows }) => callback(null, rows[0]?.data ?? null), callback);
  }
  set(sid, data, callback) {
    this.pool.query(`INSERT INTO app_sessions VALUES ($1, $2, $3)
      ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    [sid, JSON.stringify(data), data.cookie.expires])
      .then(() => callback?.(), error => callback?.(error));
  }
  destroy(sid, callback) {
    this.pool.query('DELETE FROM app_sessions WHERE sid = $1', [sid]).then(() => callback?.(), error => callback?.(error));
  }
  // Only explicit user activity renews sessions; background polling must not.
  touch(_sid, _data, callback) { callback?.(); }
  close() { clearInterval(this.timer); }
}
