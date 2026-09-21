import { database } from './helpers/database.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PostgresSessionStore } from '../storage.js';
import request from 'supertest';
import { createApp } from '../server.js';

const TEST_SESSION_SECRET = 'test-session-secret-that-is-longer-than-thirty-two-characters';
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n', 'latin1');

function writeJson(directory, fileName, value) {
  fs.writeFileSync(path.join(directory, fileName), JSON.stringify(value), 'utf8');
}

async function createPdfFixture(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-resume-pdf-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  writeJson(dataDirectory, 'passcodes.json', [{ code: 'viewer-code', expires: '2099-12-31T23:59:59.999Z' }]);
  writeJson(dataDirectory, 'resume.json', { sections: [] });
  writeJson(dataDirectory, 'cv.json', { sections: [] });
  fs.writeFileSync(path.join(dataDirectory, 'resume.pdf'), 'test pdf', 'utf8');
  const { storage } = await database(t, dataDirectory);
  const sessionStore = new PostgresSessionStore(storage.pool);
  t.after(() => sessionStore.close());
  const app = createApp({
    authConfig: { callbackUrl: 'https://resume.kaufmann.dev/auth/callback', postLogoutUrl: 'https://resume.kaufmann.dev/', sessionSecret: TEST_SESSION_SECRET, cookieDomain: undefined },
    oidcService: {
      async createAuthorizationRequest() {
        return { authorizationUrl: new URL('https://identity.example/authorize'), codeVerifier: 'v', state: 's', nonce: 'n' };
      },
      async exchangeCallback() { return { idTokenHint: 'hint' }; },
      createLogoutUrl() { return new URL('https://identity.example/end-session'); }
    },
    sessionStore,
    storage,
    staticDirectory: dataDirectory,
    now: () => Date.now()
  });
  const admin = request.agent(app);
  await admin.get('/auth/login').expect(303);
  await admin.get('/auth/callback?code=test&state=s').expect(303);
  const viewer = request.agent(app);
  await viewer.post('/api/auth/passcode').send({ passcode: 'viewer-code' }).expect(200);
  return { app, storage, dataDirectory, admin, viewer };
}

test('admin uploads replace the downloadable PDF', async t => {
  const { storage, admin } = await createPdfFixture(t);
  const before = await admin.get('/api/pdf').expect(200);
  assert.equal(before.body.exists, true);
  assert.equal(before.body.file, 'resume.pdf');
  assert.equal(before.body.size, Buffer.byteLength('test pdf'));

  const uploaded = await admin.post('/api/pdf')
    .set('Content-Type', 'application/pdf')
    .send(PDF_BYTES)
    .expect(200);
  assert.equal(uploaded.body.success, true);
  assert.equal(uploaded.body.size, PDF_BYTES.length);
  assert.ok(Date.parse(uploaded.body.updatedAt) > 0);
  assert.deepEqual((await storage.readPdf('resume.pdf')).bytes, PDF_BYTES);

  const after = await admin.get('/api/pdf').expect(200);
  assert.equal(after.body.size, PDF_BYTES.length);

  const download = await admin.get('/api/download').expect(200);
  assert.match(download.headers['content-type'], /application\/pdf/);
  assert.deepEqual(download.body, PDF_BYTES);
});

test('non-PDF uploads are rejected without touching the file', async t => {
  const { storage, admin } = await createPdfFixture(t);
  await admin.post('/api/pdf').set('Content-Type', 'application/pdf').send(Buffer.from('not a pdf')).expect(400)
    .expect(res => assert.match(res.body.error, /not a valid PDF/));
  await admin.post('/api/pdf').set('Content-Type', 'text/plain').send('plain text').expect(400)
    .expect(res => assert.match(res.body.error, /Content-Type: application\/pdf/));
  assert.equal((await storage.readPdf('resume.pdf')).bytes.toString('utf8'), 'test pdf');
});

test('oversized uploads are rejected as JSON', async t => {
  const { storage, admin } = await createPdfFixture(t);
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
  oversized.write('%PDF-');
  await admin.post('/api/pdf').set('Content-Type', 'application/pdf').send(oversized).expect(413)
    .expect(res => assert.match(res.body.error, /10 MB/));
  assert.equal((await storage.readPdf('resume.pdf')).bytes.toString('utf8'), 'test pdf');
});

test('PDF metadata and upload require admin access', async t => {
  const { app, viewer } = await createPdfFixture(t);
  await viewer.get('/api/pdf').expect(403);
  await viewer.post('/api/pdf').set('Content-Type', 'application/pdf').send(PDF_BYTES).expect(403);
  await request(app).get('/api/pdf').expect(401);
  await request(app).post('/api/pdf').set('Content-Type', 'application/pdf').send(PDF_BYTES).expect(401);
});
