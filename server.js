import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ABSOLUTE_SESSION_MS,
  IDLE_SESSION_MS,
  OIDC_TRANSACTION_MS,
  createFileSessionStore,
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

function readJsonFile(dataDirectory, fileName) {
  const filePath = path.join(dataDirectory, fileName);

  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: File ${fileName} not found. Returning empty default.`);
    return fileName.includes('passcodes') ? [] : { sections: [] };
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`Error parsing ${fileName}:`, error);
    return fileName.includes('passcodes') ? [] : { sections: [] };
  }
}

function writeJsonFile(dataDirectory, fileName, data) {
  fs.writeFileSync(
    path.join(dataDirectory, fileName),
    JSON.stringify(data, null, 2),
    'utf-8'
  );
}

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
  dataDirectory = __dirname,
  staticDirectory = path.join(__dirname, 'dist'),
  now = () => Date.now()
}) {
  const app = express();
  const getPasscodes = () => readJsonFile(dataDirectory, 'passcodes.json');
  const getDocumentData = (variantId) => {
    const variant = getVariantConfigById(variantId);
    return readJsonFile(dataDirectory, variant.dataFile);
  };
  const getViewerPasscodeAttempt = (request) => {
    const passcode = typeof request.body?.passcode === 'string'
      ? request.body.passcode.trim()
      : '';

    return {
      passcode,
      validation: validateViewerPasscode(getPasscodes(), passcode, now())
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
  app.use(express.json());
  app.use(createSessionMiddleware(authConfig, sessionStore));

  const passcodeRateLimiter = rateLimit({
    windowMs: PASSCODE_RATE_LIMIT_WINDOW_MS,
    limit: PASSCODE_RATE_LIMIT_MAX_FAILURES,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many failed passcode attempts. Try again later.' },
    // Successful codes bypass the limiter, so shared-IP viewers retain access.
    // Failed attempts use the proxy-aware request.ip default key generator.
    skip(request) {
      request.viewerPasscodeAttempt = getViewerPasscodeAttempt(request);
      return request.viewerPasscodeAttempt.validation.ok;
    }
  });

  app.use(async (request, response, next) => {
    const auth = request.session.auth;

    if (!auth) {
      return next();
    }

    const currentTime = now();
    const absoluteExpired = currentTime - auth.createdAt >= ABSOLUTE_SESSION_MS;
    const idleExpired = currentTime - auth.lastActiveAt >= IDLE_SESSION_MS;
    let validation = { ok: true };

    if (auth.kind === 'viewer') {
      validation = validateViewerPasscode(getPasscodes(), auth.passcode, currentTime);
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
  });

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

  function buildSessionResponse(request) {
    const variantId = resolveVariantIdFromRequest(request);
    const response = {
      success: true,
      variant: variantId,
      data: getDocumentData(variantId),
      isAdmin: request.authContext.kind === 'admin'
    };

    if (response.isAdmin) {
      response.resumeData = getDocumentData('resume');
      response.cvData = getDocumentData('cv');
      response.passcodesData = getPasscodes();
    }

    return response;
  }

  app.post('/api/auth/passcode', passcodeRateLimiter, async (request, response, next) => {
    const { passcode, validation } = request.viewerPasscodeAttempt
      ?? getViewerPasscodeAttempt(request);

    if (!validation.ok) {
      return response.status(validation.status).json({ error: validation.error });
    }

    try {
      await regenerateSession(request);
      setAuthenticatedSession(request, { kind: 'viewer', passcode }, now());
      await saveSession(request);
      request.authContext = request.session.auth;
      return response.json(buildSessionResponse(request));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/session', (request, response) => {
    if (!requireAuthenticated(request, response, { userDriven: false })) {
      return;
    }

    response.json(buildSessionResponse(request));
  });

  app.get('/auth/login', async (request, response, next) => {
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
  });

  app.get('/auth/callback', async (request, response, next) => {
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
  });

  app.post('/auth/logout', async (request, response, next) => {
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
  });

  app.get('/api/download', (request, response) => {
    if (!requireAuthenticated(request, response)) {
      return;
    }

    const variant = getVariantConfigById(resolveVariantIdFromRequest(request));

    if (!variant.pdfFile) {
      return response.status(404).send('PDF not configured');
    }

    const pdfPath = path.join(dataDirectory, variant.pdfFile);

    if (!fs.existsSync(pdfPath)) {
      return response.status(404).send('PDF not found');
    }

    response.set({
      'Cache-Control': 'private, no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff'
    });

    return response.download(pdfPath, variant.pdfDownloadName, {
      acceptRanges: true,
      cacheControl: false,
      lastModified: true
    }, (error) => {
      if (!error || response.headersSent || error.code === 'ECONNABORTED') {
        return;
      }

      response.status(error.statusCode || 500).send('Failed to send PDF');
    });
  });

  app.get('/api/data/:variant', (request, response) => {
    if (!requireAdmin(request, response)) return;

    const variantId = request.params.variant;

    if (!DOCUMENT_VARIANT_IDS.has(variantId)) {
      return response.status(400).json({ error: 'Unknown variant' });
    }

    return response.json({ data: getDocumentData(variantId) });
  });

  app.post('/api/save', (request, response) => {
    if (!requireAdmin(request, response)) return;

    const { variant, data } = request.body;

    if (!variant || !data) {
      return response.status(400).json({ error: 'Missing variant or data' });
    }

    if (!DOCUMENT_VARIANT_IDS.has(variant)) {
      return response.status(400).json({ error: 'Unknown variant' });
    }

    try {
      writeJsonFile(dataDirectory, getVariantConfigById(variant).dataFile, data);
      return response.json({ success: true });
    } catch (error) {
      console.error('Failed to save:', error);
      return response.status(500).json({ error: 'Failed to save file' });
    }
  });

  app.get('/api/passcodes', (request, response) => {
    if (!requireAdmin(request, response)) return;
    return response.json({ passcodes: getPasscodes() });
  });

  app.post('/api/passcodes', (request, response) => {
    if (!requireAdmin(request, response)) return;

    const { code, expires } = request.body;

    if (!code || !expires) {
      return response.status(400).json({ error: 'Missing code or expires' });
    }

    const passcodes = getPasscodes();
    passcodes.push({ code, expires });
    writeJsonFile(dataDirectory, 'passcodes.json', passcodes);
    return response.json({ success: true, passcodes });
  });

  app.put('/api/passcodes/:index', (request, response) => {
    if (!requireAdmin(request, response)) return;

    const index = Number.parseInt(request.params.index, 10);
    const passcodes = getPasscodes();

    if (Number.isNaN(index) || index < 0 || index >= passcodes.length) {
      return response.status(400).json({ error: 'Invalid index' });
    }

    const { code, expires } = request.body;

    if (!code || !expires) {
      return response.status(400).json({ error: 'Missing code or expires' });
    }

    passcodes[index] = { code, expires };
    writeJsonFile(dataDirectory, 'passcodes.json', passcodes);
    return response.json({ success: true, passcodes });
  });

  app.delete('/api/passcodes/:index', (request, response) => {
    if (!requireAdmin(request, response)) return;

    const index = Number.parseInt(request.params.index, 10);
    const passcodes = getPasscodes();

    if (Number.isNaN(index) || index < 0 || index >= passcodes.length) {
      return response.status(400).json({ error: 'Invalid index' });
    }

    passcodes.splice(index, 1);
    writeJsonFile(dataDirectory, 'passcodes.json', passcodes);
    return response.json({ success: true, passcodes });
  });

  app.use(express.static(staticDirectory));
  app.get('*', (request, response) => {
    response.sendFile(path.join(staticDirectory, 'index.html'));
  });

  return app;
}

export async function startServer() {
  const authConfig = loadAuthConfig();
  const oidcService = await createOidcService(authConfig);
  const sessionStore = createFileSessionStore(authConfig, __dirname);
  const app = createApp({ authConfig, oidcService, sessionStore });
  const port = Number(process.env.PORT) || 3001;

  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error.message);
    process.exitCode = 1;
  });
}
