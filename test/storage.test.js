import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { initializeStorage, createPool, PostgresSessionStore } from '../storage.js';
import { createDocumentStore } from '../document-store.js';
import { database } from './helpers/database.js';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-storage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, ...await database(t, directory, { initialize: false }) };
}
const write = (directory, file, value) => fs.writeFileSync(path.join(directory, file), JSON.stringify(value));
const key = { id: 'existing', name: 'Existing', createdAt: '2026-01-01', hash: 'a'.repeat(64) };

test('migration imports content, keys, passcodes and exact PDF bytes once, leaving originals intact', async t => {
  const { directory, options, pool } = await fixture(t);
  write(directory, 'document.json', { sections: [] });
  write(directory, 'api-keys.json', [key]);
  write(directory, 'passcodes.json', [{ code: 'existing-code', expires: '2099-01-01' }]);
  const pdf = Buffer.from([37, 80, 68, 70, 45, 0, 255]);
  fs.writeFileSync(path.join(directory, 'resume.pdf'), pdf);
  const storage = await initializeStorage(options);
  assert.deepEqual(await storage.readCollection('keys'), [key]);
  assert.equal((await storage.readCollection('passcodes'))[0].code, 'existing-code');
  assert.deepEqual((await storage.readPdf('resume.pdf')).bytes, pdf);
  await storage.mutateCollection('keys', keys => { keys.length = 0; });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'api-keys.json'))), [key]);
  fs.writeFileSync(path.join(directory, 'document.json'), 'broken');
  await initializeStorage(options);
  assert.deepEqual(await storage.readCollection('keys'), []);
  assert.equal((await pool.query('SELECT * FROM app_migrations')).rowCount, 1);
});

test('volume data takes precedence over old paths, including empty key lists', async t => {
  const { directory, options } = await fixture(t);
  const previous = path.join(directory, 'previous');
  fs.mkdirSync(previous);
  write(previous, 'document.json', { sections: [] });
  write(previous, 'api-keys.json', [key]);
  write(directory, 'api-keys.json', []);
  const storage = await initializeStorage({ ...options, environment: { DATA_DIRECTORY: previous } });
  assert.deepEqual(await storage.readCollection('keys'), []);
});

test('malformed import rolls back the entire migration and retries successfully', async t => {
  const { directory, options, pool } = await fixture(t);
  write(directory, 'cv.json', { sections: [{ id: 'education', title: 'Education', type: 'entries', items: [] }] });
  fs.writeFileSync(path.join(directory, 'passcodes.json'), 'broken');
  await assert.rejects(() => initializeStorage(options));
  assert.equal((await pool.query("SELECT to_regclass('app_document') AS table_name")).rows[0].table_name, null);
  write(directory, 'passcodes.json', []);
  await initializeStorage(options);
  assert.equal((await createDocumentStore(pool).read()).data.sections[0].visibility, 'cv');
});

test('concurrent initialization and writes preserve one migration and reject stale saves', async t => {
  const { options, pool } = await fixture(t);
  const [storage] = await Promise.all([initializeStorage(options), initializeStorage(options)]);
  const store = createDocumentStore(pool);
  const { revision } = await store.read();
  const results = await Promise.allSettled([store.write({ sections: [] }, revision), store.write({ sections: [] }, revision)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  await Promise.all(Array.from({ length: 10 }, (_, index) => storage.mutateCollection('keys', keys => { keys.push({ ...key, id: String(index) }); })));
  assert.equal((await storage.readCollection('keys')).length, 10);
});

test('PostgreSQL sessions survive store recreation, expire, and are destroyed without touch renewal', async t => {
  const { options, pool } = await fixture(t);
  await initializeStorage(options);
  const first = new PostgresSessionStore(pool);
  const second = new PostgresSessionStore(pool);
  t.after(() => { first.close(); second.close(); });
  const data = { cookie: { expires: new Date(Date.now() + 60000).toISOString() }, auth: { kind: 'admin' } };
  await promisify(first.set.bind(first))('saved', data);
  assert.deepEqual(await promisify(second.get.bind(second))('saved'), data);
  await promisify(second.touch.bind(second))('saved', { cookie: { expires: new Date(Date.now() + 120000) } });
  assert.deepEqual(await promisify(first.get.bind(first))('saved'), data);
  await promisify(first.set.bind(first))('expired', { cookie: { expires: new Date(0) } });
  assert.equal(await promisify(second.get.bind(second))('expired'), null);
  await promisify(second.destroy.bind(second))('saved');
  assert.equal(await promisify(first.get.bind(first))('saved'), null);
});

test('DATABASE_URL is required', () => {
  assert.throws(() => createPool({}), /DATABASE_URL/);
});
