import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { atomicWrite, documentSchema, sectionSchema, itemSchema, rowSchema, entrySchema, pubSchema } from './document-store.js';
import { projectDocument } from './document-model.js';
import { applyJsonPatch, patchOperationSchema } from './document-patch.js';

const hash = key => createHash('sha256').update(key).digest();
export function mountMcp(app, { dataDirectory, store, requireAdmin }) {
  const file = path.join(dataDirectory, 'api-keys.json');
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const list = () => read().map(({ hash: secret, ...metadata }) => metadata);
  app.get('/api/keys', (req, res) => {
    if (requireAdmin(req, res)) res.json({ keys: list() });
  });
  app.post('/api/keys', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const name = req.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 100) return res.status(400).json({ error: 'Provide a key name (1–100 characters)' });
    const key = `cv_${randomBytes(32).toString('base64url')}`;
    const keys = read();
    keys.push({ id: randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), hash: hash(key).toString('hex') });
    atomicWrite(file, keys);
    res.status(201).json({ key, keys: list() });
  });
  app.delete('/api/keys/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    atomicWrite(file, read().filter(key => key.id !== req.params.id));
    res.json({ keys: list() });
  });
  app.all('/api/mcp', async (req, res, next) => {
    const token = /^Bearer (\S+)$/i.exec(req.headers.authorization || '')?.[1];
    if (!token || !read().some(key => timingSafeEqual(Buffer.from(key.hash, 'hex'), hash(token)))) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Valid API key required' });
    }
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').end();
    const server = new McpServer({ name: 'cv-resume', version: '1.0.0' });
    const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
    const failure = (error, extra) => ({ content: [{ type: 'text', text: JSON.stringify({ error, ...extra }) }], isError: true });
    const formatPath = segments => segments.reduce((out, part) => typeof part === 'number' ? `${out}[${part}]` : out ? `${out}.${part}` : part, '');
    const formatZod = error => {
      const issues = error.issues.map(issue => ({ path: formatPath(issue.path), message: issue.message, code: issue.code }));
      return { message: `Validation failed: ${issues.map(i => i.path ? `${i.path}: ${i.message}` : i.message).join('; ')}`, issues };
    };
    const failWrite = error => {
      if (error?.code === 'STALE_REVISION') return failure(error.message, { currentRevision: error.currentRevision });
      if (error?.name === 'ZodError') {
        const { message, issues } = formatZod(error);
        return failure(message, { issues });
      }
      if (error?.status === 409) return failure(error.message, { currentRevision: store.read().revision });
      return failure(error.message);
    };
    const snapshot = revision => {
      const current = store.read();
      if (revision !== current.revision) {
        const error = new Error('Document changed. Re-read and retry with the current revision.');
        error.code = 'STALE_REVISION';
        error.currentRevision = current.revision;
        throw error;
      }
      return current;
    };
    server.registerTool('get_document', {
      description: 'Read all shared CV/resume data and its revision. Visibility on parents bounds descendants. For cheaper reads use list_sections or get_section; for edits prefer the put/delete tools or patch_document.',
      inputSchema: {}
    }, async () => result(store.read()));
    server.registerTool('preview_document', {
      description: 'Read the visible content for one document variant.',
      inputSchema: { variant: z.enum(['cv', 'resume']) }
    }, async ({ variant }) => result(projectDocument(store.read().data, variant)));
    server.registerTool('list_sections', {
      description: 'List section summaries (id, type, title, visibility, entry/row count) with the current revision. Start here instead of get_document when you only need an overview or a revision.',
      inputSchema: {}
    }, async () => {
      const { data, revision } = store.read();
      return result({ revision, sections: data.sections.map(section => ({
        id: section.id, type: section.type, title: section.title, visibility: section.visibility, count: (section.items || section.rows || []).length
      })) });
    });
    server.registerTool('get_section', {
      description: 'Read one section by id with the current revision. Pass variant to read it as filtered for CV or resume.',
      inputSchema: { sectionId: z.string().min(1), variant: z.enum(['cv', 'resume']).optional() }
    }, async ({ sectionId, variant }) => {
      const { data, revision } = store.read();
      const section = data.sections.find(candidate => candidate.id === sectionId);
      if (!section) return failure(`Section "${sectionId}" not found. Available: ${data.sections.map(s => s.id).join(', ') || '(none)'}`);
      if (!variant) return result({ revision, section });
      const projected = projectDocument({ sections: [section] }, variant).sections[0];
      if (!projected) return failure(`Section "${sectionId}" is not visible in the "${variant}" variant`);
      return result({ revision, section: projected });
    });
    server.registerTool('replace_document', {
      description: 'Save the entire shared document, including additions, edits, deletions, order and visibility. Requires the revision from any read; stale revisions are rejected with the current revision. Omitted visibility defaults to both. Prefer put_section, put_item or patch_document for small changes.',
      inputSchema: { data: documentSchema, revision: z.string() }
    }, async ({ data, revision }) => {
      try { return result(store.write(data, revision)); }
      catch (error) { return failWrite(error); }
    });
    server.registerTool('put_section', {
      description: 'Create or replace one whole section by id (full section value, including its items or rows). New sections go at position (index, "start", or "end"; default "end"); existing sections stay in place unless position moves them. Requires the revision from any read.',
      inputSchema: { revision: z.string(), section: sectionSchema, position: z.union([z.number().int().min(0), z.enum(['start', 'end'])]).optional() }
    }, async ({ revision, section, position }) => {
      try {
        const { data } = snapshot(revision);
        const parsed = sectionSchema.parse(section);
        const sections = structuredClone(data.sections);
        const existing = sections.findIndex(candidate => candidate.id === parsed.id);
        if (existing >= 0 && position === undefined) sections[existing] = parsed;
        else {
          if (existing >= 0) sections.splice(existing, 1);
          const index = position === 'start' ? 0 : position === 'end' || position === undefined ? sections.length : Math.min(position, sections.length);
          sections.splice(index, 0, parsed);
        }
        const written = store.write({ sections }, revision);
        const index = written.data.sections.findIndex(candidate => candidate.id === parsed.id);
        return result({ revision: written.revision, index, section: written.data.sections[index] });
      } catch (error) { return failWrite(error); }
    });
    server.registerTool('delete_section', {
      description: 'Delete one section by id. Requires the revision from any read.',
      inputSchema: { revision: z.string(), sectionId: z.string().min(1) }
    }, async ({ revision, sectionId }) => {
      try {
        const { data } = snapshot(revision);
        const index = data.sections.findIndex(candidate => candidate.id === sectionId);
        if (index < 0) return failure(`Section "${sectionId}" not found. Available: ${data.sections.map(s => s.id).join(', ') || '(none)'}`);
        const sections = structuredClone(data.sections);
        const [deleted] = sections.splice(index, 1);
        const written = store.write({ sections }, revision);
        return result({ revision: written.revision, deleted });
      } catch (error) { return failWrite(error); }
    });
    const itemSchemaFor = section => section.type === 'info' ? rowSchema : section.type === 'pub' ? pubSchema : entrySchema;
    const childKeyFor = section => section.type === 'info' ? 'rows' : 'items';
    server.registerTool('put_item', {
      description: 'Create or replace one whole row/item inside a section (full value: info sections take {label, value}, entries take heading/subheading/info/subinfo/highlights/tags, pub takes {authors, year, title, institution}). Without index the item is appended; with index it replaces that entry (index equal to the length appends). Requires the revision from any read. For single-field edits use patch_document.',
      inputSchema: { revision: z.string(), sectionId: z.string().min(1), item: itemSchema, index: z.number().int().min(0).optional() }
    }, async ({ revision, sectionId, item, index }) => {
      try {
        const { data } = snapshot(revision);
        const found = data.sections.find(candidate => candidate.id === sectionId);
        if (!found) return failure(`Section "${sectionId}" not found. Available: ${data.sections.map(s => s.id).join(', ') || '(none)'}`);
        const parsed = itemSchemaFor(found).parse(item);
        const sections = structuredClone(data.sections);
        const section = sections.find(candidate => candidate.id === sectionId);
        const children = section[childKeyFor(section)];
        const target = index ?? children.length;
        if (target > children.length) return failure(`Index ${target} is out of bounds for section "${sectionId}" (${children.length} ${childKeyFor(section)})`);
        if (target === children.length) children.push(parsed);
        else children[target] = parsed;
        const written = store.write({ sections }, revision);
        const stored = written.data.sections.find(candidate => candidate.id === sectionId)[childKeyFor(section)][target];
        return result({ revision: written.revision, sectionId, index: target, item: stored });
      } catch (error) { return failWrite(error); }
    });
    server.registerTool('delete_item', {
      description: 'Delete one row/item from a section by index. Requires the revision from any read.',
      inputSchema: { revision: z.string(), sectionId: z.string().min(1), index: z.number().int().min(0) }
    }, async ({ revision, sectionId, index }) => {
      try {
        const { data } = snapshot(revision);
        const found = data.sections.find(candidate => candidate.id === sectionId);
        if (!found) return failure(`Section "${sectionId}" not found. Available: ${data.sections.map(s => s.id).join(', ') || '(none)'}`);
        const children = found[childKeyFor(found)];
        if (index >= children.length) return failure(`Index ${index} is out of bounds for section "${sectionId}" (${children.length} ${childKeyFor(found)})`);
        const sections = structuredClone(data.sections);
        const [deleted] = sections.find(candidate => candidate.id === sectionId)[childKeyFor(found)].splice(index, 1);
        const written = store.write({ sections }, revision);
        return result({ revision: written.revision, sectionId, index, deleted });
      } catch (error) { return failWrite(error); }
    });
    server.registerTool('patch_document', {
      description: 'Apply granular RFC 6902 edits (add, remove, replace, move, copy, test) to the document. Paths are JSON Pointers below the root, e.g. "/sections/0/title/en" or "/sections/1/items/0/highlights/-" to append ("-" appends to arrays; "~0" escapes "~", "~1" escapes "/"). Requires the revision from any read; use test ops or dryRun to preview. Returns the new revision plus a per-operation diff, not the full document.',
      inputSchema: { revision: z.string(), operations: z.array(patchOperationSchema).min(1).max(100), dryRun: z.boolean().optional() }
    }, async ({ revision, operations, dryRun }) => {
      try {
        const { data } = snapshot(revision);
        const { patched, changes } = applyJsonPatch(data, operations);
        const parsed = documentSchema.parse(patched);
        if (dryRun) return result({ dryRun: true, revision, changes });
        const written = store.write(parsed, revision);
        return result({ revision: written.revision, changes });
      } catch (error) { return failWrite(error); }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) { next(error); }
  });
}
