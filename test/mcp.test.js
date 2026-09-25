import { database } from './helpers/database.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PostgresSessionStore } from '../storage.js';
import request from 'supertest';
import { createApp } from '../server.js';
import { applyJsonPatch } from '../document-patch.js';

const TEST_SESSION_SECRET = 'test-session-secret-that-is-longer-than-thirty-two-characters';

function writeJson(directory, fileName, value) {
  fs.writeFileSync(path.join(directory, fileName), JSON.stringify(value), 'utf8');
}

async function createMcpFixture(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-resume-mcp-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  writeJson(dataDirectory, 'passcodes.json', []);
  writeJson(dataDirectory, 'resume.json', { sections: [] });
  writeJson(dataDirectory, 'cv.json', { sections: [
    { id: 'experience', title: 'Experience', type: 'entries', items: [{ heading: 'Job A', highlights: ['Did things'], tags: ['JS'] }] },
    { id: 'personal', title: 'Personal', type: 'info', rows: [{ label: 'Location', value: 'Berlin' }] },
    { id: 'pubs', title: 'Publications', type: 'pub', items: [{ title: 'Paper', year: 2026, authors: [{ name: 'A. Uthor' }] }] }
  ] });
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
  const created = await admin.post('/api/keys').send({ name: 'mcp-test' }).expect(201);
  const rpc = (method, params = {}) => request(app).post('/api/mcp')
    .set('Authorization', `Bearer ${created.body.key}`).set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method, params });
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }).expect(200);
  const call = async (name, args) => {
    const response = await rpc('tools/call', { name, arguments: args }).expect(200);
    if (response.body.error) return { protocolError: response.body.error.message };
    const text = response.body.result.content[0].text;
    let body;
    try { body = JSON.parse(text); } catch { body = undefined; }
    return { isError: !!response.body.result.isError, body, text, structuredContent: response.body.result.structuredContent };
  };
  return { app, storage, dataDirectory, rpc, call };
}

test('tools/list exposes the granular editing tools', async t => {
  const { rpc } = await createMcpFixture(t);
  const tools = await rpc('tools/list').expect(200);
  assert.deepEqual(tools.body.result.tools.map(tool => tool.name).sort(), [
    'delete_item', 'delete_section', 'get_document', 'get_section', 'list_sections',
    'patch_document', 'preview_document', 'put_item', 'put_section', 'replace_document'
  ]);
});

test('tools/list advertises output schemas and read-only hints', async t => {
  const { rpc } = await createMcpFixture(t);
  const tools = await rpc('tools/list').expect(200);
  const byName = Object.fromEntries(tools.body.result.tools.map(tool => [tool.name, tool]));
  for (const name of ['delete_item', 'delete_section', 'get_document', 'get_section', 'list_sections', 'patch_document', 'preview_document', 'put_item', 'put_section', 'replace_document']) {
    assert.ok(byName[name].outputSchema, `${name} advertises an output schema`);
  }
  assert.equal(byName.get_document.annotations.readOnlyHint, true);
  assert.equal(byName.preview_document.annotations.readOnlyHint, true);
  assert.equal(byName.delete_section.annotations.destructiveHint, true);
  assert.equal(byName.put_section.annotations?.readOnlyHint ?? false, false);
});

test('JSON results also carry the same typed structured content', async t => {
  const { call } = await createMcpFixture(t);
  const listed = await call('list_sections', {});
  assert.equal(listed.isError, false);
  assert.deepEqual(listed.structuredContent, listed.body);
  const preview = await call('preview_document', { variant: 'cv' });
  assert.equal(preview.isError, false);
  assert.deepEqual(preview.structuredContent, preview.body);
});

test('preview_document renders markdown without losing structured data', async t => {
  const { call } = await createMcpFixture(t);
  const preview = await call('preview_document', { variant: 'cv', format: 'markdown' });
  assert.equal(preview.isError, false);
  assert.equal(preview.body, undefined);
  assert.ok(preview.text.includes('## Experience'));
  assert.ok(preview.text.includes('### Job A'));
  assert.ok(preview.text.includes('- Did things'));
  assert.ok(preview.text.includes('Tags: JS'));
  assert.ok(preview.text.includes('- **Location:** Berlin'));
  assert.ok(preview.text.includes('- A. Uthor (2026). *Paper*.'));
  assert.deepEqual(preview.structuredContent.sections.map(s => s.id), ['experience', 'personal', 'pubs']);
  const invalid = await call('preview_document', { variant: 'cv', format: 'yaml' });
  assert.equal(invalid.isError, true);
  assert.match(invalid.text, /'json' \| 'markdown'/);
});

test('get_section renders one section as markdown with locale', async t => {
  const { call } = await createMcpFixture(t);
  const { body: { revision } } = await call('list_sections', {});
  const localized = await call('put_section', { revision, section: { id: 'about', title: { en: 'About', de: 'Über' }, type: 'info', rows: [{ label: { en: 'City', de: 'Stadt' }, value: 'Berlin' }] } });
  assert.equal(localized.isError, false);
  const german = await call('get_section', { sectionId: 'about', format: 'markdown', locale: 'de' });
  assert.equal(german.isError, false);
  assert.equal(german.text, '## Über\n\n- **Stadt:** Berlin\n');
  assert.equal(german.structuredContent.revision, localized.body.revision);
  const english = await call('get_section', { sectionId: 'about', format: 'markdown' });
  assert.equal(english.text, '## About\n\n- **City:** Berlin\n');
  const hidden = await call('get_section', { sectionId: 'experience', variant: 'resume', format: 'markdown' });
  assert.equal(hidden.isError, true);
  assert.match(hidden.body.error, /not visible in the "resume" variant/);
});

test('list_sections and get_section read without the full document', async t => {
  const { call } = await createMcpFixture(t);
  const listed = await call('list_sections', {});
  assert.equal(listed.isError, false);
  assert.equal(typeof listed.body.revision, 'string');
  assert.deepEqual(listed.body.sections.map(s => s.id), ['experience', 'personal', 'pubs']);
  assert.deepEqual(listed.body.sections[0], { id: 'experience', type: 'entries', title: 'Experience', visibility: 'cv', count: 1 });
  assert.equal(listed.body.data, undefined);

  const single = await call('get_section', { sectionId: 'personal' });
  assert.equal(single.isError, false);
  assert.equal(single.body.revision, listed.body.revision);
  assert.equal(single.body.section.rows[0].value, 'Berlin');

  const missing = await call('get_section', { sectionId: 'nope' });
  assert.equal(missing.isError, true);
  assert.match(missing.body.error, /not found/);

  const hidden = await call('get_section', { sectionId: 'experience', variant: 'resume' });
  assert.equal(hidden.isError, true);
  assert.match(hidden.body.error, /not visible in the "resume" variant/);
  const shown = await call('get_section', { sectionId: 'experience', variant: 'cv' });
  assert.equal(shown.isError, false);
  assert.equal(shown.body.section.items[0].heading, 'Job A');
});

test('put_section creates, updates and moves one section', async t => {
  const { call } = await createMcpFixture(t);
  const { body: { revision } } = await call('list_sections', {});
  const created = await call('put_section', { revision, section: { id: 'skills', title: 'Skills', type: 'entries', items: [] } });
  assert.equal(created.isError, false);
  assert.equal(created.body.section.visibility, 'both');
  assert.equal(created.body.index, 3);

  const moved = await call('put_section', {
    revision: created.body.revision,
    section: { ...created.body.section, title: 'Top Skills' },
    position: 'start'
  });
  assert.equal(moved.isError, false);
  assert.equal(moved.body.index, 0);
  assert.equal(moved.body.section.title, 'Top Skills');

  const listed = await call('list_sections', {});
  assert.deepEqual(listed.body.sections.map(s => s.id), ['skills', 'experience', 'personal', 'pubs']);

  const duplicate = await call('put_section', { revision: listed.body.revision, section: { id: 'skills', title: 'Again', type: 'info', rows: [] } });
  assert.equal(duplicate.isError, false);
  assert.deepEqual((await call('list_sections', {})).body.sections.map(s => s.id).filter(id => id === 'skills'), ['skills']);
});

test('delete_section removes one section', async t => {
  const { call } = await createMcpFixture(t);
  const { body: { revision } } = await call('list_sections', {});
  const deleted = await call('delete_section', { revision, sectionId: 'personal' });
  assert.equal(deleted.isError, false);
  assert.equal(deleted.body.deleted.id, 'personal');
  assert.deepEqual((await call('list_sections', {})).body.sections.map(s => s.id), ['experience', 'pubs']);
  const missing = await call('delete_section', { revision: deleted.body.revision, sectionId: 'personal' });
  assert.equal(missing.isError, true);
  assert.match(missing.body.error, /not found/);
});

test('put_item appends and replaces rows, entries and publications', async t => {
  const { call } = await createMcpFixture(t);
  let revision = (await call('list_sections', {})).body.revision;

  const appended = await call('put_item', { revision, sectionId: 'experience', item: { heading: 'Job B' } });
  assert.equal(appended.isError, false);
  assert.equal(appended.body.index, 1);
  assert.equal(appended.body.item.visibility, 'both');
  revision = appended.body.revision;

  const replaced = await call('put_item', { revision, sectionId: 'experience', index: 0, item: { heading: 'Job A+', highlights: [{ text: 'New', visibility: 'cv' }] } });
  assert.equal(replaced.isError, false);
  assert.equal(replaced.body.item.heading, 'Job A+');
  revision = replaced.body.revision;

  const row = await call('put_item', { revision, sectionId: 'personal', item: { label: 'Email', value: 'a@b.c' } });
  assert.equal(row.isError, false);
  assert.equal(row.body.index, 1);
  revision = row.body.revision;

  const pub = await call('put_item', {
    revision, sectionId: 'pubs', index: 0,
    item: { authors: [{ name: 'A. Uthor', bold: true }], year: 2026, title: 'Paper v2' }
  });
  assert.equal(pub.isError, false);
  assert.equal(pub.body.item.authors[0].visibility, 'both');
  revision = pub.body.revision;

  const mismatch = await call('put_item', { revision, sectionId: 'personal', item: { heading: 'Not a row' } });
  assert.equal(mismatch.isError, true);
  assert.match(mismatch.body.error, /label/);

  const outOfBounds = await call('put_item', { revision, sectionId: 'personal', index: 9, item: { label: 'X', value: 'Y' } });
  assert.equal(outOfBounds.isError, true);
  assert.match(outOfBounds.body.error, /out of bounds/);
});

test('delete_item removes one entry by index', async t => {
  const { call } = await createMcpFixture(t);
  const { body: { revision } } = await call('list_sections', {});
  const deleted = await call('delete_item', { revision, sectionId: 'experience', index: 0 });
  assert.equal(deleted.isError, false);
  assert.equal(deleted.body.deleted.heading, 'Job A');
  assert.equal((await call('get_section', { sectionId: 'experience' })).body.section.items.length, 0);
  const missing = await call('delete_item', { revision: deleted.body.revision, sectionId: 'experience', index: 0 });
  assert.equal(missing.isError, true);
  assert.match(missing.body.error, /out of bounds/);
});

test('patch_document edits surgically and previews with dryRun', async t => {
  const { call } = await createMcpFixture(t);
  const { body: { revision } } = await call('list_sections', {});

  const preview = await call('patch_document', {
    revision, dryRun: true,
    operations: [
      { op: 'replace', path: '/sections/0/items/0/heading', value: 'Dry run' },
      { op: 'add', path: '/sections/0/items/0/highlights/-', value: { text: 'Extra', visibility: 'both' } }
    ]
  });
  assert.equal(preview.isError, false);
  assert.equal(preview.body.dryRun, true);
  assert.equal(preview.body.revision, revision);
  assert.equal(preview.body.changes[0].before, 'Job A');
  assert.equal(preview.body.changes[0].after, 'Dry run');
  assert.equal((await call('get_section', { sectionId: 'experience' })).body.section.items[0].heading, 'Job A');

  const applied = await call('patch_document', {
    revision,
    operations: [
      { op: 'test', path: '/sections/0/items/0/heading', value: 'Job A' },
      { op: 'replace', path: '/sections/0/items/0/heading', value: { en: 'Job A', de: 'Arbeit A' } },
      { op: 'move', from: '/sections/0', path: '/sections/2' }
    ]
  });
  assert.equal(applied.isError, false);
  assert.notEqual(applied.body.revision, revision);
  assert.equal(applied.body.data, undefined);
  assert.deepEqual((await call('list_sections', {})).body.sections.map(s => s.id), ['personal', 'pubs', 'experience']);
  assert.deepEqual((await call('get_section', { sectionId: 'experience' })).body.section.items[0].heading, { en: 'Job A', de: 'Arbeit A' });
});

test('patch errors name the failing operation and path', async t => {
  const { call } = await createMcpFixture(t);
  const { body: { revision } } = await call('list_sections', {});

  const badPointer = await call('patch_document', { revision, operations: [{ op: 'remove', path: '/sections/9' }] });
  assert.equal(badPointer.isError, true);
  assert.match(badPointer.body.error, /operation #1.*out of bounds/);

  const failedTest = await call('patch_document', { revision, operations: [{ op: 'test', path: '/sections/0/id', value: 'wrong' }] });
  assert.equal(failedTest.isError, true);
  assert.match(failedTest.body.error, /test failed/);

  const invalid = await call('patch_document', { revision, operations: [{ op: 'add', path: '/sections/-', value: { id: 'broken' } }] });
  assert.equal(invalid.isError, true);
  assert.match(invalid.body.error, /Validation failed/);
  assert.ok(invalid.body.issues.length > 0);
});

test('stale revisions are rejected with the current revision', async t => {
  const { call } = await createMcpFixture(t);
  const first = (await call('list_sections', {})).body.revision;
  const applied = await call('patch_document', { revision: first, operations: [{ op: 'replace', path: '/sections/0/title', value: 'Changed' }] });
  assert.equal(applied.isError, false);

  for (const args of [
    { tool: 'put_section', args: { revision: first, section: { id: 'late', title: 'Late', type: 'entries', items: [] } } },
    { tool: 'patch_document', args: { revision: first, operations: [{ op: 'replace', path: '/sections/0/title', value: 'Late' }] } },
    { tool: 'replace_document', args: { revision: first, data: { sections: [] } } }
  ]) {
    const stale = await call(args.tool, args.args);
    assert.equal(stale.isError, true);
    assert.match(stale.body.error, /Document changed/);
    assert.equal(stale.body.currentRevision, applied.body.revision);
  }
});

test('stray keys are rejected with a precise message', async t => {
  const { call } = await createMcpFixture(t);
  const { body: { revision } } = await call('list_sections', {});
  const stray = await call('patch_document', {
    revision, dryRun: true,
    operations: [{ op: 'add', path: '/sections/0/items/0/highlights/-', value: { text: 'X', visibilty: 'both' } }]
  });
  assert.equal(stray.isError, true);
  assert.match(stray.body.error, /visibilty/);
});

test('applyJsonPatch implements move, copy and pointer escapes', () => {
  const document = { sections: [{ id: 'a~b/c', items: [1, 2] }] };
  const escaped = applyJsonPatch(document, [{ op: 'test', path: '/sections/0/id', value: 'a~b/c' }]);
  assert.equal(escaped.changes.length, 1);
  const copied = applyJsonPatch(document, [{ op: 'copy', from: '/sections/0/items/0', path: '/sections/0/items/-' }]);
  assert.deepEqual(copied.patched.sections[0].items, [1, 2, 1]);
  const moved = applyJsonPatch(document, [{ op: 'move', from: '/sections/0/items/0', path: '/sections/0/items/1' }]);
  assert.deepEqual(moved.patched.sections[0].items, [2, 1]);
  assert.throws(() => applyJsonPatch(document, [{ op: 'remove', path: 'sections/0' }]), /must start with "\/"/);
  assert.throws(() => applyJsonPatch(document, [{ op: 'remove', path: '/sections/0/items/01' }]), /not a valid array index/);
  assert.throws(() => applyJsonPatch(document, [{ op: 'remove', path: '/sections/0/items/-' }]), /only valid for "add"/);
});
