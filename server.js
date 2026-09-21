import { createPool, initializeStorage, PostgresSessionStore } from './storage.js';
import { asyncHandler } from './async-handler.js';
import { createDocumentStore } from './document-store.js';
import { projectDocument } from './document-model.js';
import { mountMcp } from './mcp.js';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ABSOLUTE_SESSION_MS,
  IDLE_SESSION_MS,
  OIDC_TRANSACTION_MS,
  createOidcService,
  createSessionMiddleware,
  destroySession,
  loadAuthConfig,
  regenerateSession,
  saveSession
} from './auth.js';
import {
  DEFAULT_VARIANT_ID,
  VARIANT_CONFIGS,
  getVariantConfigById,
  isLocalDevelopmentHostname,
  normalizeHostname,
  resolveVariantId
} from './variant-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOCUMENT_VARIANT_IDS = new Set(Object.keys(VARIANT_CONFIGS));
const PRODUCTION_BROWSER_ORIGINS = new Set([
  'https://resume.kaufmann.dev',
  'https://cv.kaufmann.dev'
]);
export const PASSCODE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const PASSCODE_RATE_LIMIT_MAX_FAILURES = 5;

function isAllowedBrowserOrigin(origin) {
  try {
    const candidate = new URL(origin);
    const normalizedOrigin = candidate.origin;

    if (PRODUCTION_BROWSER_ORIGINS.has(normalizedOrigin)) {
      return true;
    }

    return (
      ['http:', 'https:'].includes(candidate.protocol)
      && isLocalDevelopmentHostname(candidate.hostname)
    );
  } catch {
    return false;
  }
}

const PDF_LIMIT_BYTES = 10 * 1024 * 1024;

function validateViewerPasscode(passcodes, passcode, now) {
  if (!passcode) {
    return { ok: false, status: 401, error: 'Not authenticated' };
  }

  const match = passcodes.find((entry) => entry.code === passcode);

  if (!match) {
    return { ok: false, status: 401, error: 'Invalid passcode' };
  }

  if (match.expires) {
    const expiresAt = new Date(match.expires);

    if (!Number.isNaN(expiresAt.getTime()) && now > expiresAt.getTime()) {
      return { ok: false, status: 403, error: 'Passcode has expired' };
    }
  }

  return { ok: true };
}

function resolveVariantIdFromRequest(request) {
  const requestedVariant = request.body?.variant ?? request.query?.variant;

  if (typeof requestedVariant === 'string' && DOCUMENT_VARIANT_IDS.has(requestedVariant)) {
    return requestedVariant;
  }

  const hostnameCandidates = [
    request.headers['x-forwarded-host'],
    request.headers.origin,
    request.headers.referer,
    request.headers.host
  ];

  for (const candidate of hostnameCandidates) {
    const hostname = normalizeHostname(candidate);

    if (hostname) {
      return resolveVariantId(hostname);
    }
  }

  return DEFAULT_VARIANT_ID;
}

function getSafeReturnUrl(request, authConfig) {
  const requestedReturnUrl = typeof request.query.returnTo === 'string'
    ? request.query.returnTo
    : '';

  if (requestedReturnUrl) {
    try {
      const candidate = new URL(requestedReturnUrl);
      const knownProductionHostname = Object.values(VARIANT_CONFIGS)
        .some((variant) => variant.hostnames.includes(candidate.hostname.toLowerCase()));
      const validProtocol = knownProductionHostname
        ? candidate.protocol === 'https:'
        : ['http:', 'https:'].includes(candidate.protocol);

      if (
        validProtocol
        && (knownProductionHostname || isLocalDevelopmentHostname(candidate.hostname))
      ) {
        candidate.hash = '';
        return candidate.toString();
      }
    } catch {
      // Fall through to a fixed configured origin.
    }
  }

  return new URL('/', authConfig.callbackUrl).toString();
}

function createCallbackUrl(request, configuredCallbackUrl) {
  const callbackUrl = new URL(configuredCallbackUrl);
  const requestUrl = new URL(request.originalUrl, callbackUrl);
  callbackUrl.search = requestUrl.search;
  return callbackUrl;
}

function setAuthenticatedSession(request, auth, now) {
  request.session.auth = {
    ...auth,
    createdAt: now,
    lastActiveAt: now
  };
  request.session.cookie.maxAge = IDLE_SESSION_MS;
}

function markUserActivity(request, now) {
  const absoluteRemaining = request.session.auth.createdAt + ABSOLUTE_SESSION_MS - now;
  request.session.auth.lastActiveAt = now;
  request.session.cookie.maxAge = Math.min(IDLE_SESSION_MS, absoluteRemaining);
}

export function createApp({
  authConfig,
  oidcService,
  sessionStore,
  storage,
  staticDirectory = path.join(__dirname, 'dist'),
  now = () => Date.now()
}) {
  const app = express();
  const getPasscodes = () => storage.readCollection('passcodes');
  const store = createDocumentStore(storage.pool);
  const getViewerPasscodeAttempt = async (request) => {
    const passcode = typeof request.body?.passcode === 'string'
      ? request.body.passcode.trim()
      : '';

    return {
      passcode,
      validation: validateViewerPasscode(await getPasscodes(), passcode, now())
    };
  };

  app.set('trust proxy', 1);
  app.use((request, response, next) => {
    const origin = request.headers.origin;

    if (origin && !isAllowedBrowserOrigin(origin)) {
      return response.status(403).json({ error: 'Request origin is not allowed' });
    }

    return next();
  });
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || isAllowedBrowserOrigin(origin));
    },
    credentials: true
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', (request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  app.use(createSessionMiddleware(authConfig, sessionStore));

  const passcodeRateLimiter = rateLimit({
    windowMs: PASSCODE_RATE_LIMIT_WINDOW_MS,
    limit: PASSCODE_RATE_LIMIT_MAX_FAILURES,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many failed passcode attempts. Try again later.' },
    // Successful codes bypass the limiter, so shared-IP viewers retain access.
    // Failed attempts use the proxy-aware request.ip default key generator.
    async skip(request) {
      request.viewerPasscodeAttempt = await getViewerPasscodeAttempt(request);
      return request.viewerPasscodeAttempt.validation.ok;
    }
  });

  app.use(asyncHandler(async (request, response, next) => {
    const auth = request.session.auth;

    if (!auth) {
      return next();
    }

    const currentTime = now();
    const absoluteExpired = currentTime - auth.createdAt >= ABSOLUTE_SESSION_MS;
    const idleExpired = currentTime - auth.lastActiveAt >= IDLE_SESSION_MS;
    let validation = { ok: true };

    if (auth.kind === 'viewer') {
      validation = validateViewerPasscode(await getPasscodes(), auth.passcode, currentTime);
    } else if (auth.kind !== 'admin' || typeof auth.id_token_hint !== 'string') {
      validation = { ok: false, status: 401, error: 'Not authenticated' };
    }

    if (absoluteExpired || idleExpired || !validation.ok) {
      request.authFailure = validation.ok
        ? { status: 401, error: 'Session has expired' }
        : validation;

      try {
        await destroySession(request);
      } catch (error) {
        return next(error);
      }

      return next();
    }

    request.authContext = auth;
    return next();
  }));

  function authenticationFailure(request, response) {
    const failure = request.authFailure ?? { status: 401, error: 'Not authenticated' };
    return response.status(failure.status).json({ error: failure.error });
  }

  function requireAuthenticated(request, response, { userDriven = true } = {}) {
    if (!request.authContext) {
      authenticationFailure(request, response);
      return false;
    }

    if (userDriven) {
      markUserActivity(request, now());
    }

    return true;
  }

  function requireAdmin(request, response) {
    if (!requireAuthenticated(request, response)) {
      return false;
    }

    if (request.authContext.kind !== 'admin') {
      response.status(403).json({ error: 'Admin access required' });
      return false;
    }

    return true;
  }

  async function buildSessionResponse(request) {
    const variantId = resolveVariantIdFromRequest(request);
    const document = await store.read();
    const response = {
      success: true,
      variant: variantId,
      data: projectDocument(document.data, variantId),
      isAdmin: request.authContext.kind === 'admin'
    };

    if (response.isAdmin) {
      response.document = document;
      response.passcodesData = await getPasscodes();
    }

    return response;
  }

  app.post('/api/auth/passcode', passcodeRateLimiter, asyncHandler(async (request, response, next) => {
    const { passcode, validation } = request.viewerPasscodeAttempt
      ?? await getViewerPasscodeAttempt(request);

    if (!validation.ok) {
      return response.status(validation.status).json({ error: validation.error });
    }

    try {
      await regenerateSession(request);
      setAuthenticatedSession(request, { kind: 'viewer', passcode }, now());
      await saveSession(request);
      request.authContext = request.session.auth;
      return response.json(await buildSessionResponse(request));
    } catch (error) {
      return next(error);
    }
  }));

  app.get('/api/session', asyncHandler(async (request, response) => {
    if (!requireAuthenticated(request, response, { userDriven: false })) {
      return;
    }

    response.json(await buildSessionResponse(request));
  }));

  app.get('/auth/login', asyncHandler(async (request, response, next) => {
    try {
      const authorization = await oidcService.createAuthorizationRequest();
      const returnTo = getSafeReturnUrl(request, authConfig);

      await regenerateSession(request);
      request.session.oidcTransaction = {
        codeVerifier: authorization.codeVerifier,
        state: authorization.state,
        nonce: authorization.nonce,
        createdAt: now(),
        returnTo
      };
      request.session.cookie.maxAge = OIDC_TRANSACTION_MS;
      await saveSession(request);
      return response.redirect(303, authorization.authorizationUrl.toString());
    } catch (error) {
      return next(error);
    }
  }));

  app.get('/auth/callback', asyncHandler(async (request, response, next) => {
    const transaction = request.session.oidcTransaction;

    if (!transaction || now() - transaction.createdAt >= OIDC_TRANSACTION_MS) {
      return response.status(400).send('OIDC login transaction is missing or expired');
    }

    try {
      const result = await oidcService.exchangeCallback(
        createCallbackUrl(request, authConfig.callbackUrl),
        transaction
      );
      const returnTo = transaction.returnTo;

      await regenerateSession(request);
      setAuthenticatedSession(
        request,
        { kind: 'admin', id_token_hint: result.idTokenHint },
        now()
      );
      await saveSession(request);
      return response.redirect(303, returnTo);
    } catch (error) {
      try {
        await destroySession(request);
      } catch (destroyError) {
        return next(destroyError);
      }

      console.error('OIDC callback failed:', error.message);
      return response.status(400).send('OIDC authentication failed');
    }
  }));

  app.post('/auth/logout', asyncHandler(async (request, response, next) => {
    const auth = request.authContext;
    const localReturnUrl = getSafeReturnUrl(request, authConfig);
    const idTokenHint = auth?.kind === 'admin' ? auth.id_token_hint : undefined;

    try {
      await destroySession(request);
    } catch (error) {
      return next(error);
    }

    try {
      const logoutUrl = idTokenHint
        ? oidcService.createLogoutUrl(idTokenHint)
        : undefined;

      return response.redirect(303, logoutUrl?.toString() ?? localReturnUrl);
    } catch (error) {
      return next(error);
    }
  }));

  app.get('/api/download', asyncHandler(async (request, response) => {
    if (!requireAuthenticated(request, response)) {
      return;
    }

    const variant = getVariantConfigById(resolveVariantIdFromRequest(request));

    if (!variant.pdfFile) {
      return response.status(404).send('PDF not configured');
    }

    const pdf = await storage.readPdf(variant.pdfFile);

    if (!pdf) {
      return response.status(404).send('PDF not found');
    }

    response.set({
      'Cache-Control': 'private, no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff'
    });

    return response.attachment(variant.pdfDownloadName).type('application/pdf').send(pdf.bytes);
  }));

  app.get('/api/pdf', asyncHandler(async (request, response) => {
    if (!requireAdmin(request, response)) return;
    const variant = getVariantConfigById(resolveVariantIdFromRequest(request));
    const pdf = await storage.readPdf(variant.pdfFile);
    if (!pdf) return response.json({ file: variant.pdfFile, exists: false });
    return response.json({ file: variant.pdfFile, exists: true, size: pdf.bytes.length, updatedAt: pdf.updatedAt.toISOString() });
  }));

  app.post('/api/pdf',
    (request, response, next) => { if (requireAdmin(request, response)) next(); },
    express.raw({ type: 'application/pdf', limit: PDF_LIMIT_BYTES }),
    asyncHandler(async (request, response) => {
      if (!Buffer.isBuffer(request.body) || !request.body.length) {
        return response.status(400).json({ error: 'Upload a PDF file with Content-Type: application/pdf' });
      }
      if (request.body.subarray(0, 5).toString('latin1') !== '%PDF-') {
        return response.status(400).json({ error: 'Uploaded file is not a valid PDF' });
      }
      const variant = getVariantConfigById(resolveVariantIdFromRequest(request));
      const metadata = await storage.writePdf(variant.pdfFile, request.body);
      return response.json({ success: true, file: variant.pdfFile, ...metadata });
    }));

  app.get('/api/data', asyncHandler(async (request, response) => {
    if (requireAdmin(request, response)) response.json(await store.read());
  }));

  app.post('/api/save', asyncHandler(async (request, response) => {
    if (!requireAdmin(request, response)) return;
    try {
      response.json({ success: true, ...await store.write(request.body.data, request.body.revision) });
    } catch (error) {
      response.status(error.status || (error.name === 'ZodError' ? 400 : 500)).json({ error: error.message });
    }
  }));

  mountMcp(app, { storage, store, requireAdmin });

  app.get('/api/passcodes', asyncHandler(async (request, response) => {
    if (!requireAdmin(request, response)) return;
    return response.json({ passcodes: await getPasscodes() });
  }));

  app.post('/api/passcodes', asyncHandler(async (request, response) => {
    if (!requireAdmin(request, response)) return;

    const { code, expires } = request.body;

    if (!code || !expires) {
      return response.status(400).json({ error: 'Missing code or expires' });
    }

    const passcodes = await storage.mutateCollection('passcodes', entries => { entries.push({ code, expires }); });
    return response.json({ success: true, passcodes });
  }));

  for (const method of ['put', 'delete']) {
    app[method]('/api/passcodes/:index', asyncHandler(async (request, response) => {
      if (!requireAdmin(request, response)) return;
      const index = Number(request.params.index);
      const { code, expires } = request.body ?? {};
      if (method === 'put' && (!code || !expires)) return response.status(400).json({ error: 'Missing code or expires' });
      const passcodes = await storage.mutateCollection('passcodes', entries => {
        if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
          const error = new Error('Invalid index');
          error.status = 400;
          throw error;
        }
        if (method === 'put') entries[index] = { code, expires };
        else entries.splice(index, 1);
      });
      response.json({ success: true, passcodes });
    }));
  }

  app.use((error, request, response, next) => {
    if (error?.type === 'entity.too.large') return response.status(413).json({ error: 'PDF exceeds the 10 MB limit' });
    return next(error);
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    console.error('Request failed:', error.message);
    response.status(error.status || 500).json({ error: error.status ? error.message : 'Request failed' });
  });

  app.use(express.static(staticDirectory));
  app.get('*', (request, response) => {
    response.sendFile(path.join(staticDirectory, 'index.html'));
  });

  return app;
}

export async function startServer() {
  const authConfig = loadAuthConfig();
  const pool = createPool();
  let sessionStore;
  try {
    const storage = await initializeStorage({ pool, baseDirectory: __dirname });
    const oidcService = await createOidcService(authConfig);
    sessionStore = new PostgresSessionStore(pool);
    const app = createApp({ authConfig, oidcService, sessionStore, storage });
    const port = Number(process.env.PORT) || 3001;
    const server = app.listen(port, () => console.log(`Server running on port ${port}`));
    const shutdown = () => {
      sessionStore.close();
      server.close(() => { void pool.end(); });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    return server;
  } catch (error) {
    sessionStore?.close();
    await pool.end();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error.message);
    process.exitCode = 1;
  });
}
