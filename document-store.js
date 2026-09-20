import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const visibility = z.enum(['cv', 'resume', 'both']);
const localized = z.union([z.string(), z.object({ en: z.string().optional(), de: z.string().optional() }).strict()]);
const fieldName = z.enum(['title', 'heading', 'subheading', 'info', 'subinfo', 'label', 'value', 'name', 'bold', 'year', 'institution']);
const meta = { visibility, fieldVisibility: z.record(fieldName, visibility).optional() };
const text = z.object({ text: localized, visibility }).strict();
const author = z.object({ ...meta, name: z.string(), bold: z.boolean().optional() }).strict();
const entry = z.object({ ...meta, heading: localized.optional(), subheading: localized.optional(), info: localized.optional(), subinfo: localized.optional(), highlights: z.array(text).optional(), tags: z.array(text).optional() }).strict();
const row = z.object({ ...meta, label: localized, value: localized }).strict();
const pub = z.object({ ...meta, authors: z.array(author), year: z.union([z.string(), z.number()]), title: localized, institution: localized.optional() }).strict();
const base = { ...meta, id: z.string().min(1), title: localized, open: z.boolean().optional() };
export const documentSchema = z.object({ sections: z.array(z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('info'), rows: z.array(row) }).strict(),
  z.object({ ...base, type: z.literal('entries'), items: z.array(entry) }).strict(),
  z.object({ ...base, type: z.literal('pub'), items: z.array(pub) }).strict()
])) }).strict().refine(d => new Set(d.sections.map(s => s.id)).size === d.sections.length, 'Section IDs must be unique');

export function atomicWrite(file, data) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}
const canonical = value => JSON.stringify(value, function (key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});
const children = new Set(['sections', 'items', 'rows', 'highlights', 'tags', 'authors']);
const signature = node => canonical(Object.fromEntries(Object.entries(node).filter(([key]) => !children.has(key) && key !== 'visibility')));
function convert(node, variant, key) {
  if (Array.isArray(node)) return node.map(v => convert(v, variant, key));
  if (['highlights', 'tags'].includes(key)) return { text: node, visibility: variant };
  if (!node || typeof node !== 'object') return node;
  if (key === 'sections' && node.type === 'pub' && !node.items && node.content !== undefined) {
    const { content, ...section } = node;
    node = { ...section, items: [{ title: content, authors: [], year: '' }] };
  }
  return Object.fromEntries([...Object.entries(node).map(([k, v]) => [k, children.has(k) ? convert(v, variant, k) : v]), ['visibility', variant]]);
}
function merge(left, right) {
  const result = structuredClone(left);
  const used = new Set();
  for (const candidate of right) {
    const index = result.findIndex((v, i) => !used.has(i) && signature(v) === signature(candidate));
    if (index < 0) { result.push(structuredClone(candidate)); used.add(result.length - 1); continue; }
    used.add(index);
    const match = result[index];
    match.visibility = 'both';
    for (const key of children) if (match[key] || candidate[key]) match[key] = merge(match[key] || [], candidate[key] || []);
  }
  return result;
}
export function mergeDocuments(cv, resume) {
  const sections = merge(convert(cv.sections, 'cv', 'sections'), convert(resume.sections, 'resume', 'sections'));
  const ids = new Set();
  for (const section of sections) {
    const original = section.id;
    let suffix = 2;
    while (ids.has(section.id)) section.id = `${original}-${suffix++}`;
    ids.add(section.id);
  }
  return documentSchema.parse({ sections });
}
export function createDocumentStore(directory) {
  const file = path.join(directory, 'document.json');
  if (!fs.existsSync(file)) {
    const readLegacy = name => fs.existsSync(path.join(directory, name))
      ? JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) : { sections: [] };
    // Parse both sources before writing anything. Originals remain available for recovery.
    atomicWrite(file, mergeDocuments(readLegacy('cv.json'), readLegacy('resume.json')));
  }
  const read = () => {
    const data = documentSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    return { data, revision: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
  };
  read();
  return { read, write(data, revision) {
    const parsed = documentSchema.parse(data);
    if (revision !== read().revision) {
      const error = new Error('Document changed. Reload before saving.');
      error.status = 409;
      throw error;
    }
    atomicWrite(file, parsed);
    return read();
  } };
}
