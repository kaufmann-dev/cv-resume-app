import { database } from './helpers/database.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mergeDocuments, createDocumentStore } from '../document-store.js';
import { projectDocument, renderMarkdown } from '../document-model.js';

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
test('migration is one-time, retains originals, and rejects stale or invalid writes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'document-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const original = JSON.stringify(section([{ heading: 'Job' }]));
  fs.writeFileSync(path.join(directory, 'cv.json'), original);
  const { pool } = await database(t, directory);
  const store = createDocumentStore(pool);
  const before = await store.read();
  assert.equal(fs.readFileSync(path.join(directory, 'cv.json'), 'utf8'), original);
  await store.write({ sections: [] }, before.revision);
  await assert.rejects(() => store.write(before.data, before.revision), /Reload/);
  await assert.rejects(() => store.write({ sections: [{ visibility: 'invalid' }] }, before.revision));
  assert.deepEqual((await createDocumentStore(pool).read()).data, { sections: [] });
});
test('malformed legacy input cannot create a partial document', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'document-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'cv.json'), '{broken');
  await assert.rejects(() => database(t, directory));
  assert.equal(fs.existsSync(path.join(directory, 'document.json')), false);
});

test('legacy publication prose becomes editable shared publication content', () => {
  const merged = mergeDocuments({ sections: [{ id: 'pub', title: 'Publications', type: 'pub', content: { en: 'Paper', de: 'Publikation' } }] }, { sections: [] });
  assert.deepEqual(projectDocument(merged, 'cv').sections[0].items[0].title, { en: 'Paper', de: 'Publikation' });
  assert.equal(merged.sections[0].items[0].visibility, 'cv');
});
test('renderMarkdown formats info, entries and publication sections', () => {
  const markdown = renderMarkdown({ sections: [
    { id: 'personal', title: 'Personal', type: 'info', rows: [{ label: 'Location', value: 'Berlin' }] },
    { id: 'work', title: 'Work', type: 'entries', items: [{ heading: 'Job', subheading: 'Role', info: 'Berlin', subinfo: '2020-2024', highlights: ['Did things'], tags: ['JS', 'Node'] }] },
    { id: 'pubs', title: 'Pubs', type: 'pub', items: [{ authors: [{ name: 'A. Uthor' }, { name: 'B. Bold', bold: true }], year: 2026, title: 'Paper', institution: 'Conf' }] }
  ] });
  assert.equal(markdown, [
    '## Personal',
    '',
    '- **Location:** Berlin',
    '',
    '## Work',
    '',
    '### Job',
    '*Role*',
    'Berlin',
    '2020-2024',
    '- Did things',
    'Tags: JS, Node',
    '',
    '## Pubs',
    '',
    '- A. Uthor, **B. Bold** (2026). *Paper*. Conf.',
    ''
  ].join('\n'));
});
test('renderMarkdown localizes text, falls back and unwraps raw bullets', () => {
  const document = { sections: [{ id: 'work', title: { en: 'Work', de: 'Arbeit' }, type: 'entries', items: [{
    heading: { en: 'Job', de: 'Stelle' },
    highlights: [{ text: { en: 'Shipped', de: 'Geliefert' }, visibility: 'both' }, 'Plain'],
    tags: [{ text: 'JS', visibility: 'cv' }]
  }] }] };
  assert.equal(renderMarkdown(document, 'de'), '## Arbeit\n\n### Stelle\n- Geliefert\n- Plain\nTags: JS\n');
  assert.equal(renderMarkdown(document), '## Work\n\n### Job\n- Shipped\n- Plain\nTags: JS\n');
  assert.equal(renderMarkdown({ sections: [{ id: 'a', title: { en: 'Only EN' }, type: 'entries', items: [] }] }, 'de'), '## Only EN\n');
  assert.equal(renderMarkdown({ sections: [] }), '');
});
