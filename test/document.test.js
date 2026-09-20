import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mergeDocuments, createDocumentStore } from '../document-store.js';
import { projectDocument } from '../document-model.js';

const section = items => ({ sections: [{ id: 'work', title: 'Work', type: 'entries', items }] });
test('migration merges matching parents and bullets without losing variant-specific content', () => {
  const cv = section([{ heading: 'Job', highlights: ['Shared', { en: 'CV detail', de: 'Detail' }], tags: ['JS'] }]);
  const resume = section([{ heading: 'Job', highlights: ['Shared', 'Resume detail'], tags: ['JS'] }]);
  const merged = mergeDocuments(cv, resume);
  assert.equal(merged.sections.length, 1);
  assert.equal(merged.sections[0].items.length, 1);
  assert.equal(merged.sections[0].items[0].highlights[0].visibility, 'both');
  assert.deepEqual(projectDocument(merged, 'cv'), cv);
  assert.deepEqual(projectDocument(merged, 'resume'), resume);
});
test('differing content and duplicate occurrences are preserved', () => {
  const cv = section([{ heading: 'Full title', highlights: ['Duplicate', 'Duplicate'] }]);
  const resume = section([{ heading: 'Short title', highlights: ['Duplicate'] }]);
  const merged = mergeDocuments(cv, resume);
  assert.equal(merged.sections[0].items.length, 2);
  assert.deepEqual(projectDocument(merged, 'cv'), cv);
  assert.deepEqual(projectDocument(merged, 'resume'), resume);
  resume.sections[0].title = 'Different heading';
  const separate = mergeDocuments(cv, resume);
  assert.equal(new Set(separate.sections.map(s => s.id)).size, 2);
});
test('parent, field, author, tag and bullet visibility are applied before delivery', () => {
  const data = mergeDocuments(section([{ heading: 'Job', info: 'Private', highlights: ['Secret'], tags: ['Hidden'] }]), { sections: [] });
  const parent = data.sections[0];
  parent.visibility = 'both';
  const entry = parent.items[0];
  entry.visibility = 'both';
  entry.fieldVisibility = { info: 'cv' };
  assert.deepEqual(projectDocument(data, 'resume').sections[0].items, [{ heading: 'Job', highlights: [], tags: [] }]);
  parent.visibility = 'cv';
  assert.deepEqual(projectDocument(data, 'resume'), { sections: [] });
  const publications = mergeDocuments({ sections: [{ id: 'pub', title: 'Pubs', type: 'pub', items: [{ title: 'Paper', year: 2026, authors: [{ name: 'A' }] }] }] }, { sections: [] });
  publications.sections[0].items[0].authors[0].visibility = 'resume';
  assert.deepEqual(projectDocument(publications, 'cv').sections[0].items[0].authors, []);
});
test('migration is one-time, retains originals, and rejects stale or invalid writes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'document-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const original = JSON.stringify(section([{ heading: 'Job' }]));
  fs.writeFileSync(path.join(directory, 'cv.json'), original);
  const store = createDocumentStore(directory);
  const before = store.read();
  assert.equal(fs.readFileSync(path.join(directory, 'cv.json'), 'utf8'), original);
  store.write({ sections: [] }, before.revision);
  assert.throws(() => store.write(before.data, before.revision), /Reload/);
  assert.throws(() => store.write({ sections: [{ visibility: 'invalid' }] }, store.read().revision));
  assert.deepEqual(createDocumentStore(directory).read().data, { sections: [] });
});
test('malformed legacy input cannot create a partial document', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'document-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'cv.json'), '{broken');
  assert.throws(() => createDocumentStore(directory));
  assert.equal(fs.existsSync(path.join(directory, 'document.json')), false);
});

test('legacy publication prose becomes editable shared publication content', () => {
  const merged = mergeDocuments({ sections: [{ id: 'pub', title: 'Publications', type: 'pub', content: { en: 'Paper', de: 'Publikation' } }] }, { sections: [] });
  assert.deepEqual(projectDocument(merged, 'cv').sections[0].items[0].title, { en: 'Paper', de: 'Publikation' });
  assert.equal(merged.sections[0].items[0].visibility, 'cv');
});
