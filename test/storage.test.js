import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initializeStorage } from '../storage.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baseDirectory = path.join(root, 'app');
  const directory = path.join(root, 'data');
  fs.mkdirSync(baseDirectory);
  return { baseDirectory, directory, environment: {} };
}
const write = (dir, file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));

test('migration copies content, keys, passcodes, PDF and sessions while retaining mount sources', t => {
  const options = fixture(t);
  write(options.baseDirectory, 'document.json', { sections: [] });
  write(options.baseDirectory, 'api-keys.json', [{ id: 'existing', hash: 'existing-hash' }]);
  write(options.baseDirectory, 'passcodes.json', [{ code: 'existing-code' }]);
  fs.writeFileSync(path.join(options.baseDirectory, 'resume.pdf'), 'pdf');
  fs.mkdirSync(path.join(options.baseDirectory, '.sessions'));
  fs.writeFileSync(path.join(options.baseDirectory, '.sessions/session.json'), 'encrypted-session-bytes');
  initializeStorage(options);
  for (const file of ['document.json', 'api-keys.json', 'passcodes.json', 'resume.pdf']) {
    assert.deepEqual(fs.readFileSync(path.join(options.directory, file)), fs.readFileSync(path.join(options.baseDirectory, file)));
  }
  assert.equal(fs.readFileSync(path.join(options.directory, 'sessions/session.json'), 'utf8'), 'encrypted-session-bytes');
  write(options.directory, 'api-keys.json', []);
  fs.unlinkSync(path.join(options.directory, 'sessions/session.json'));
  initializeStorage(options);
  assert.equal(fs.readFileSync(path.join(options.directory, 'api-keys.json'), 'utf8'), '[]');
  assert.equal(fs.existsSync(path.join(options.directory, 'sessions/session.json')), false);
});

test('previous environment paths migrate once and existing volume files take precedence', t => {
  const options = fixture(t);
  const previous = path.join(options.baseDirectory, 'previous');
  fs.mkdirSync(previous);
  fs.mkdirSync(options.directory);
  write(previous, 'document.json', { sections: [] });
  write(previous, 'api-keys.json', [{ id: 'old' }]);
  write(options.directory, 'api-keys.json', [{ id: 'current' }]);
  const oldSessions = path.join(previous, 'old-sessions');
  fs.mkdirSync(oldSessions);
  write(oldSessions, 'saved.json', { value: 1 });
  options.environment = { DATA_DIRECTORY: previous, SESSION_STORE_PATH: oldSessions };
  initializeStorage(options);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(options.directory, 'api-keys.json'))), [{ id: 'current' }]);
  assert.ok(fs.existsSync(path.join(options.directory, 'sessions/saved.json')));
});

test('legacy documents merge inside the volume and malformed input leaves migration incomplete', t => {
  const options = fixture(t);
  write(options.baseDirectory, 'cv.json', { sections: [{ id: 'education', title: 'Education', type: 'entries', items: [] }] });
  fs.writeFileSync(path.join(options.baseDirectory, 'passcodes.json'), 'broken');
  assert.throws(() => initializeStorage(options));
  assert.equal(fs.existsSync(path.join(options.directory, '.storage-migrated')), false);
  write(options.baseDirectory, 'passcodes.json', []);
  initializeStorage(options);
  const document = JSON.parse(fs.readFileSync(path.join(options.directory, 'document.json')));
  assert.equal(document.sections[0].visibility, 'cv');
  assert.ok(fs.existsSync(path.join(options.directory, '.storage-migrated')));
});
