import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const visibilitySchema = z.enum(['cv', 'resume', 'both']);
export const localizedSchema = z.union([z.string(), z.object({ en: z.string().optional(), de: z.string().optional() }).strict()]);
const fieldName = z.enum(['title', 'heading', 'subheading', 'info', 'subinfo', 'label', 'value', 'name', 'bold', 'year', 'institution']);
// Omitted visibility defaults to 'both', matching the editor's treatment of new content.
const defaultVisibility = visibilitySchema.default('both');
const meta = { visibility: defaultVisibility, fieldVisibility: z.record(fieldName, visibilitySchema).optional() };
export const textSchema = z.object({ text: localizedSchema, visibility: defaultVisibility }).strict();
export const authorSchema = z.object({ ...meta, name: z.string(), bold: z.boolean().optional() }).strict();
export const entrySchema = z.object({ ...meta, heading: localizedSchema.optional(), subheading: localizedSchema.optional(), info: localizedSchema.optional(), subinfo: localizedSchema.optional(), highlights: z.array(textSchema).optional(), tags: z.array(textSchema).optional() }).strict();
export const rowSchema = z.object({ ...meta, label: localizedSchema, value: localizedSchema }).strict();
export const pubSchema = z.object({ ...meta, authors: z.array(authorSchema), year: z.union([z.string(), z.number()]), title: localizedSchema, institution: localizedSchema.optional() }).strict();
export const itemSchema = z.union([rowSchema, entrySchema, pubSchema]);
const base = { ...meta, id: z.string().min(1), title: localizedSchema, open: z.boolean().optional() };
export const infoSectionSchema = z.object({ ...base, type: z.literal('info'), rows: z.array(rowSchema) }).strict();
export const entriesSectionSchema = z.object({ ...base, type: z.literal('entries'), items: z.array(entrySchema) }).strict();
export const pubSectionSchema = z.object({ ...base, type: z.literal('pub'), items: z.array(pubSchema) }).strict();
export const sectionSchema = z.discriminatedUnion('type', [infoSectionSchema, entriesSectionSchema, pubSectionSchema]);
export const documentSchema = z.object({ sections: z.array(sectionSchema) }).strict().refine(d => new Set(d.sections.map(s => s.id)).size === d.sections.length, 'Section IDs must be unique');

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
