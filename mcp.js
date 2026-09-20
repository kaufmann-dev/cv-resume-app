import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { atomicWrite, documentSchema } from './document-store.js';
import { projectDocument } from './document-model.js';

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
    server.registerTool('get_document', {
      description: 'Read all shared CV/resume data and its revision. Visibility on parents bounds descendants. Use replace_document to create, update, delete or reorder content.',
      inputSchema: {}
    }, async () => result(store.read()));
    server.registerTool('preview_document', {
      description: 'Read the visible content for one document variant.',
      inputSchema: { variant: z.enum(['cv', 'resume']) }
    }, async ({ variant }) => result(projectDocument(store.read().data, variant)));
    server.registerTool('replace_document', {
      description: 'Save the entire shared document, including additions, edits, deletions, order and visibility. Requires the revision from get_document; stale revisions are rejected. Each section, item, row, author, highlight and tag needs visibility cv, resume or both. Highlights and tags use {text, visibility}; fieldVisibility optionally controls individual scalar fields.',
      inputSchema: { data: documentSchema, revision: z.string() }
    }, async ({ data, revision }) => {
      try { return result(store.write(data, revision)); }
      catch (error) { return { ...result({ error: error.message }), isError: true }; }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) { next(error); }
  });
}
