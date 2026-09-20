import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import session from 'express-session';
import request from 'supertest';
import {
  ABSOLUTE_SESSION_MS,
  IDLE_SESSION_MS,
  createOidcService,
  loadAuthConfig
} from '../auth.js';
import {
  PASSCODE_RATE_LIMIT_MAX_FAILURES,
  createApp
} from '../server.js';

const TEST_SESSION_SECRET = 'test-session-secret-that-is-longer-than-thirty-two-characters';

function writeJson(directory, fileName, value) {
  fs.writeFileSync(path.join(directory, fileName), JSON.stringify(value), 'utf8');
}

function createFixture(authConfigOverrides = {}) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-resume-auth-'));
  writeJson(dataDirectory, 'passcodes.json', [
    { code: 'viewer-code', expires: '2099-12-31T23:59:59.999Z' },
    { code: 'expired-code', expires: '2000-01-01T00:00:00.000Z' }
  ]);
  writeJson(dataDirectory, 'resume.json', { sections: [{ id: 'resume', title: 'Resume', type: 'entries', items: [] }] });
  writeJson(dataDirectory, 'cv.json', { sections: [{ id: 'cv', title: 'CV', type: 'entries', items: [] }] });
  fs.writeFileSync(path.join(dataDirectory, 'resume.pdf'), 'test pdf', 'utf8');

  let currentTime = Date.parse('2026-01-01T00:00:00.000Z');
  const oidcCalls = { exchanged: [], logoutHints: [] };
  const oidcService = {
    async createAuthorizationRequest() {
      return {
        authorizationUrl: new URL('https://identity.example/authorize?flow=oidc'),
        codeVerifier: 'pkce-verifier',
        state: 'state-value',
        nonce: 'nonce-value'
      };
    },
    async exchangeCallback(callbackUrl, transaction) {
      oidcCalls.exchanged.push({ callbackUrl, transaction });
      return { idTokenHint: 'raw-id-token' };
    },
    createLogoutUrl(idTokenHint) {
      oidcCalls.logoutHints.push(idTokenHint);
      const logoutUrl = new URL('https://identity.example/end-session');
      logoutUrl.searchParams.set('id_token_hint', idTokenHint);
      logoutUrl.searchParams.set(
        'post_logout_redirect_uri',
        'https://resume.kaufmann.dev/'
      );
      return logoutUrl;
    }
  };
  const authConfig = {
    callbackUrl: 'https://resume.kaufmann.dev/auth/callback',
    postLogoutUrl: 'https://resume.kaufmann.dev/',
    sessionSecret: TEST_SESSION_SECRET,
    cookieDomain: undefined,
    ...authConfigOverrides
  };
  const app = createApp({
    authConfig,
    oidcService,
    sessionStore: new session.MemoryStore(),
    dataDirectory,
    staticDirectory: dataDirectory,
    now: () => currentTime
  });

  return {
    app,
    dataDirectory,
    oidcCalls,
    get now() {
      return currentTime;
    },
    set now(value) {
      currentTime = value;
    }
  };
}

function sessionCookie(response) {
  return response.headers['set-cookie']?.find((cookie) => (
    cookie.startsWith('cv_resume_session=')
  ));
}

function createOidcClientStub() {
  const discoveryCalls = [];
  const allowInsecureRequests = () => {};
  const client = {
    allowInsecureRequests,
    ClientSecretPost(clientSecret) {
      return { method: 'post', clientSecret };
    },
    ClientSecretBasic(clientSecret) {
      return { method: 'basic', clientSecret };
    },
    async discovery(...args) {
      discoveryCalls.push(args);
      return {
        serverMetadata() {
          return {
            end_session_endpoint: 'https://identity.example/end-session',
            code_challenge_methods_supported: ['S256']
          };
        }
      };
    }
  };

  return { client, discoveryCalls };
}

test('viewer sessions use opaque cookies and enforce expiry and immediate revocation', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.dataDirectory, { recursive: true, force: true }));
  const viewer = request.agent(fixture.app);

  const expiredLogin = await viewer
    .post('/api/auth/passcode')
    .send({ passcode: 'expired-code', variant: 'resume' });
  assert.equal(expiredLogin.status, 403);

  const login = await viewer
    .post('/api/auth/passcode')
    .send({ passcode: 'viewer-code', variant: 'cv' });
  assert.equal(login.status, 200);
  assert.equal(login.body.isAdmin, false);
  assert.equal(login.body.variant, 'cv');

  const cookie = sessionCookie(login);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /viewer-code/);

  const restored = await viewer.get('/api/session?variant=resume');
  assert.equal(restored.status, 200);
  assert.equal(restored.body.variant, 'resume');
  assert.equal(sessionCookie(restored), undefined);

  writeJson(fixture.dataDirectory, 'passcodes.json', []);
  const revoked = await viewer.get('/api/session?variant=resume');
  assert.equal(revoked.status, 401);
  assert.equal(revoked.body.error, 'Invalid passcode');
});

test('failed passcode attempts are proxy-safe rate limited without blocking valid codes', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.dataDirectory, { recursive: true, force: true }));
  const clientAddress = '198.51.100.20';

  for (let attempt = 0; attempt < PASSCODE_RATE_LIMIT_MAX_FAILURES; attempt += 1) {
    await request(fixture.app)
      .post('/api/auth/passcode')
      .set('X-Forwarded-For', `192.0.2.${attempt + 1}, ${clientAddress}`)
      .send({ passcode: `wrong-${attempt}` })
      .expect(401);
  }

  const limited = await request(fixture.app)
    .post('/api/auth/passcode')
    .set('X-Forwarded-For', `192.0.2.200, ${clientAddress}`)
    .send({ passcode: 'still-wrong' });

  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'Too many failed passcode attempts. Try again later.');
  assert.match(limited.headers['retry-after'], /^\d+$/);

  await request(fixture.app)
    .post('/api/auth/passcode')
    .set('X-Forwarded-For', `192.0.2.201, ${clientAddress}`)
    .send({ passcode: 'viewer-code' })
    .expect(200);

  await request(fixture.app)
    .post('/api/auth/passcode')
    .set('X-Forwarded-For', '198.51.100.21')
    .send({ passcode: 'wrong-from-another-client' })
    .expect(401);
});

test('OIDC callback regenerates an admin session and RP logout destroys it', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.dataDirectory, { recursive: true, force: true }));
  const admin = request.agent(fixture.app);

  const login = await admin
    .get('/auth/login')
    .query({ returnTo: 'https://cv.kaufmann.dev/' });
  assert.equal(login.status, 303);
  assert.equal(login.headers.location, 'https://identity.example/authorize?flow=oidc');
  const transactionCookie = sessionCookie(login);

  const callback = await admin.get('/auth/callback?code=code-value&state=state-value');
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.location, 'https://cv.kaufmann.dev/');
  const adminCookie = sessionCookie(callback);
  assert.notEqual(adminCookie.split(';')[0], transactionCookie.split(';')[0]);
  assert.doesNotMatch(adminCookie, /raw-id-token/);
  assert.equal(fixture.oidcCalls.exchanged.length, 1);
  assert.equal(
    fixture.oidcCalls.exchanged[0].callbackUrl.toString(),
    'https://resume.kaufmann.dev/auth/callback?code=code-value&state=state-value'
  );
  assert.deepEqual(
    {
      codeVerifier: fixture.oidcCalls.exchanged[0].transaction.codeVerifier,
      state: fixture.oidcCalls.exchanged[0].transaction.state,
      nonce: fixture.oidcCalls.exchanged[0].transaction.nonce
    },
    { codeVerifier: 'pkce-verifier', state: 'state-value', nonce: 'nonce-value' }
  );

  const restored = await admin.get('/api/session?variant=cv');
  assert.equal(restored.status, 200);
  assert.equal(restored.body.isAdmin, true);
  assert.deepEqual(restored.body.passcodesData, [
    { code: 'viewer-code', expires: '2099-12-31T23:59:59.999Z' },
    { code: 'expired-code', expires: '2000-01-01T00:00:00.000Z' }
  ]);

  const listedPasscodes = await admin.get('/api/passcodes');
  assert.equal(listedPasscodes.status, 200);
  const createdPasscode = await admin
    .post('/api/passcodes')
    .send({ code: 'managed-code', expires: '2099-01-01T00:00:00.000Z' });
  assert.equal(createdPasscode.status, 200);
  const updatedPasscode = await admin
    .put('/api/passcodes/2')
    .send({ code: 'managed-code-updated', expires: '2099-02-01T00:00:00.000Z' });
  assert.equal(updatedPasscode.status, 200);
  const deletedPasscode = await admin.delete('/api/passcodes/2');
  assert.equal(deletedPasscode.status, 200);

  const logout = await admin.post('/auth/logout');
  assert.equal(logout.status, 303);
  const logoutUrl = new URL(logout.headers.location);
  assert.equal(logoutUrl.origin, 'https://identity.example');
  assert.equal(logoutUrl.searchParams.get('id_token_hint'), 'raw-id-token');
  assert.equal(
    logoutUrl.searchParams.get('post_logout_redirect_uri'),
    'https://resume.kaufmann.dev/'
  );
  assert.deepEqual(fixture.oidcCalls.logoutHints, ['raw-id-token']);

  const afterLogout = await admin.get('/api/session');
  assert.equal(afterLogout.status, 401);
});

test('passive restore does not extend idle time, while user actions do', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.dataDirectory, { recursive: true, force: true }));
  const viewer = request.agent(fixture.app);
  const createdAt = fixture.now;

  await viewer.post('/api/auth/passcode').send({ passcode: 'viewer-code' }).expect(200);
  fixture.now = createdAt + IDLE_SESSION_MS - 1;
  await viewer.get('/api/session').expect(200);
  fixture.now = createdAt + IDLE_SESSION_MS;
  await viewer.get('/api/session').expect(401);

  fixture.now = createdAt + IDLE_SESSION_MS + 1;
  const activeViewer = request.agent(fixture.app);
  await activeViewer.post('/api/auth/passcode').send({ passcode: 'viewer-code' }).expect(200);
  const secondCreatedAt = fixture.now;
  fixture.now = secondCreatedAt + IDLE_SESSION_MS - 1;
  await activeViewer.get('/api/download?variant=resume').expect(200);
  fixture.now = secondCreatedAt + IDLE_SESSION_MS + 1;
  await activeViewer.get('/api/session').expect(200);
});

test('absolute lifetime ends active sessions at seven days', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.dataDirectory, { recursive: true, force: true }));
  const viewer = request.agent(fixture.app);
  const createdAt = fixture.now;

  await viewer.post('/api/auth/passcode').send({ passcode: 'viewer-code' }).expect(200);

  for (let elapsed = IDLE_SESSION_MS - 1; elapsed < ABSOLUTE_SESSION_MS; elapsed += IDLE_SESSION_MS - 1) {
    fixture.now = createdAt + elapsed;
    await viewer.get('/api/download?variant=resume').expect(200);
  }

  fixture.now = createdAt + ABSOLUTE_SESSION_MS;
  await viewer.get('/api/session').expect(401);
});

test('viewer logout is local and does not call the provider', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.dataDirectory, { recursive: true, force: true }));
  const viewer = request.agent(fixture.app);

  await viewer.post('/api/auth/passcode').send({ passcode: 'viewer-code' }).expect(200);
  const logout = await viewer
    .post('/auth/logout')
    .query({ returnTo: 'https://cv.kaufmann.dev/' });

  assert.equal(logout.status, 303);
  assert.equal(logout.headers.location, 'https://cv.kaufmann.dev/');
  assert.deepEqual(fixture.oidcCalls.logoutHints, []);
  await viewer.get('/api/session').expect(401);
});

test('HTTPS production requests set a secure shared-subdomain cookie', async (t) => {
  const fixture = createFixture({ cookieDomain: '.kaufmann.dev' });
  t.after(() => fs.rmSync(fixture.dataDirectory, { recursive: true, force: true }));

  const login = await request(fixture.app)
    .post('/api/auth/passcode')
    .set('Host', 'resume.kaufmann.dev')
    .set('X-Forwarded-Proto', 'https')
    .send({ passcode: 'viewer-code' });
  const cookie = sessionCookie(login);

  assert.equal(login.status, 200);
  assert.match(cookie, /Domain=\.kaufmann\.dev/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});

test('production auth configuration requires the fixed shared-domain settings', () => {
  const environment = {
    NODE_ENV: 'production',
    OIDC_ISSUER_URL: 'https://identity.example/',
    OIDC_CLIENT_ID: 'client-id',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_CALLBACK_URL: 'https://resume.kaufmann.dev/auth/callback',
    OIDC_POST_LOGOUT_URL: 'https://resume.kaufmann.dev/',
    SESSION_SECRET: TEST_SESSION_SECRET,
    SESSION_COOKIE_DOMAIN: '.kaufmann.dev'
  };

  assert.equal(loadAuthConfig(environment).cookieDomain, '.kaufmann.dev');
  assert.throws(
    () => loadAuthConfig({ ...environment, SESSION_COOKIE_DOMAIN: '.example.com' }),
    /SESSION_COOKIE_DOMAIN must be \.kaufmann\.dev/
  );
  assert.throws(
    () => loadAuthConfig({ ...environment, OIDC_CALLBACK_URL: 'https://cv.kaufmann.dev/auth/callback' }),
    /registered production callback URL/
  );
});

test('auth configuration accepts HTTP only for strict loopback URLs', () => {
  const environment = {
    NODE_ENV: 'development',
    OIDC_ISSUER_URL: 'https://identity.example/realms/admin',
    OIDC_CLIENT_ID: 'client-id',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_CALLBACK_URL: 'https://app.example/auth/callback',
    OIDC_POST_LOGOUT_URL: 'https://app.example/',
    SESSION_SECRET: TEST_SESSION_SECRET
  };

  const loopbackConfig = loadAuthConfig({
    ...environment,
    OIDC_ISSUER_URL: 'http://127.0.0.2:8080/realms/admin',
    OIDC_CALLBACK_URL: 'http://localhost:3001/auth/callback',
    OIDC_POST_LOGOUT_URL: 'http://[::1]:5173/'
  });

  assert.equal(loopbackConfig.issuerUrl, 'http://127.0.0.2:8080/realms/admin');
  assert.equal(loopbackConfig.callbackUrl, 'http://localhost:3001/auth/callback');
  assert.equal(loopbackConfig.postLogoutUrl, 'http://[::1]:5173/');

  for (const [name, value] of [
    ['OIDC_ISSUER_URL', 'http://identity.example/'],
    ['OIDC_CALLBACK_URL', 'http://app.example/auth/callback'],
    ['OIDC_POST_LOGOUT_URL', 'http://app.example/']
  ]) {
    assert.throws(
      () => loadAuthConfig({ ...environment, [name]: value }),
      new RegExp(`${name} must use HTTPS unless it targets a loopback host`)
    );
  }
});

test('auth configuration rejects ambiguous or overbroad OIDC URLs', () => {
  const environment = {
    OIDC_ISSUER_URL: 'https://identity.example/realms/admin',
    OIDC_CLIENT_ID: 'client-id',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_CALLBACK_URL: 'https://app.example/auth/callback',
    OIDC_POST_LOGOUT_URL: 'https://app.example/',
    SESSION_SECRET: TEST_SESSION_SECRET
  };
  const invalidValues = [
    ['OIDC_ISSUER_URL', 'https://user:secret@identity.example/', /must not include credentials/],
    ['OIDC_ISSUER_URL', 'https://@identity.example/', /must not include credentials/],
    ['OIDC_ISSUER_URL', 'https://identity.example/realms/admin?', /query or fragment/],
    ['OIDC_CALLBACK_URL', 'https://app.example/auth/callback#', /query or fragment/],
    ['OIDC_ISSUER_URL', 'https://identity.example\\@malicious.example/', /backslashes/],
    ['OIDC_CALLBACK_URL', 'https://app.example/not-the-callback', /\/auth\/callback path/],
    ['OIDC_POST_LOGOUT_URL', 'https://app.example/signed-out', /origin-only/]
  ];

  for (const [name, value, expectedError] of invalidValues) {
    assert.throws(
      () => loadAuthConfig({ ...environment, [name]: value }),
      expectedError
    );
  }
});

test('OIDC discovery permits insecure requests only for validated loopback issuers', async () => {
  const secureStub = createOidcClientStub();
  await createOidcService({
    issuerUrl: 'https://identity.example/realms/admin',
    clientId: 'client-id',
    clientSecret: 'client-secret'
  }, secureStub.client);
  assert.deepEqual(
    secureStub.discoveryCalls[0][3],
    { method: 'post', clientSecret: 'client-secret' }
  );

  const loopbackStub = createOidcClientStub();
  await createOidcService({
    issuerUrl: 'http://localhost:8080/realms/admin',
    clientId: 'client-id',
    clientSecret: 'client-secret'
  }, loopbackStub.client);
  assert.deepEqual(
    loopbackStub.discoveryCalls[0][3],
    { method: 'post', clientSecret: 'client-secret' }
  );
  assert.deepEqual(
    loopbackStub.discoveryCalls[0][4],
    { execute: [loopbackStub.client.allowInsecureRequests] }
  );

  const remoteHttpStub = createOidcClientStub();
  await assert.rejects(
    createOidcService({
      issuerUrl: 'http://identity.example/realms/admin',
      clientId: 'client-id',
      clientSecret: 'client-secret'
    }, remoteHttpStub.client),
    /must use HTTPS unless it targets a loopback host/
  );
  assert.equal(remoteHttpStub.discoveryCalls.length, 0);
});

test('browser requests are limited to the two production sites and local development', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.dataDirectory, { recursive: true, force: true }));

  await request(fixture.app)
    .post('/api/auth/passcode')
    .set('Origin', 'https://malicious.example')
    .send({ passcode: 'viewer-code' })
    .expect(403);

  await request(fixture.app)
    .post('/api/auth/passcode')
    .set('Origin', 'https://resume.kaufmann.dev')
    .send({ passcode: 'viewer-code' })
    .expect(200)
    .expect('Access-Control-Allow-Origin', 'https://resume.kaufmann.dev');

  await request(fixture.app)
    .post('/api/auth/passcode')
    .set('Origin', 'http://localhost:5173')
    .send({ passcode: 'viewer-code' })
    .expect(200)
    .expect('Access-Control-Allow-Origin', 'http://localhost:5173');
});

test('shared editor data and MCP writes require the correct credentials and revision', async t => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.dataDirectory, { recursive: true, force: true }));
  const admin = request.agent(fixture.app);
  const viewer = request.agent(fixture.app);
  await viewer.post('/api/auth/passcode').send({ passcode: 'viewer-code' }).expect(200);
  await viewer.get('/api/data').expect(403);
  await viewer.get('/api/keys').expect(403);
  await viewer.post('/api/keys').send({ name: 'Denied' }).expect(403);
  await viewer.post('/api/save').send({}).expect(403);
  await request(fixture.app).post('/api/mcp').send({}).expect(401);
  await admin.get('/auth/login').expect(303);
  await admin.get('/auth/callback?code=test&state=state-value').expect(303);
  const created = await admin.post('/api/keys').send({ name: 'Test MCP' }).expect(201);
  const { key, keys } = created.body;
  assert.equal(keys[0].hash, undefined);
  assert.ok(!fs.readFileSync(path.join(fixture.dataDirectory, 'api-keys.json'), 'utf8').includes(key));
  const listed = await admin.get('/api/keys').expect(200);
  assert.equal(listed.body.key, undefined);
  const rpc = (method, params = {}) => request(fixture.app).post('/api/mcp')
    .set('Authorization', `Bearer ${key}`).set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method, params });
  const initialized = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }).expect(200);
  assert.equal(initialized.body.result.serverInfo.name, 'cv-resume');
  const tools = await rpc('tools/list').expect(200);
  assert.equal(tools.body.result.tools.length, 10);
  const read = await rpc('tools/call', { name: 'get_document', arguments: {} }).expect(200);
  const document = JSON.parse(read.body.result.content[0].text);
  const updated = await rpc('tools/call', { name: 'replace_document', arguments: { data: { sections: [] }, revision: document.revision } }).expect(200);
  assert.ok(!updated.body.result.isError);
  await admin.post('/api/save').send(document).expect(409);
  const current = await admin.get('/api/data').expect(200);
  assert.deepEqual(current.body.data, { sections: [] });
  await admin.post('/api/save').send({ data: document.data, revision: current.body.revision }).expect(200);
  const preview = await rpc('tools/call', { name: 'preview_document', arguments: { variant: 'cv' } }).expect(200);
  assert.equal(JSON.parse(preview.body.result.content[0].text).sections[0].id, 'cv');
  const viewerData = await viewer.get('/api/session?variant=resume').expect(200);
  assert.equal(viewerData.body.document, undefined);
  assert.deepEqual(viewerData.body.data.sections.map(s => s.id), ['resume']);
  await admin.post('/api/save').send({ data: { sections: 'wrong' }, revision: document.revision }).expect(400);
  await admin.delete(`/api/keys/${keys[0].id}`).expect(200);
  await rpc('tools/list').expect(401);
});
