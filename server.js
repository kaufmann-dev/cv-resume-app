import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_VARIANT_ID,
  getVariantConfigById,
  isKnownVariant,
  normalizeHostname,
  resolveVariantId
} from './variant-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_COOKIE_NAME = 'kaufmann_dev_session';

const app = express();
const PORT = Number(process.env.PORT) || 3002;

app.set('trust proxy', true);
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

function readJsonFile(fileName) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, fileName), 'utf-8'));
}

function getPasscodes() {
  return readJsonFile('passcodes.json');
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    String(cookieHeader)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf('=');

        if (separatorIndex === -1) {
          return [part, ''];
        }

        const key = part.slice(0, separatorIndex);
        const value = decodeURIComponent(part.slice(separatorIndex + 1));
        return [key, value];
      })
  );
}

function getRequestHostname(req) {
  const hostnameCandidates = [
    req.headers['x-forwarded-host'],
    req.headers.host,
    req.headers.origin,
    req.headers.referer
  ];

  for (const candidate of hostnameCandidates) {
    const hostname = normalizeHostname(candidate);

    if (hostname) {
      return hostname;
    }
  }

  return '';
}

function getSessionCookieDomain(req) {
  const hostname = getRequestHostname(req);

  if (hostname === 'kaufmann.dev' || hostname.endsWith('.kaufmann.dev')) {
    return '.kaufmann.dev';
  }

  return undefined;
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();

  return req.secure || forwardedProto === 'https';
}

function getBaseSessionCookieOptions(req) {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  };

  const domain = getSessionCookieDomain(req);

  if (domain) {
    options.domain = domain;
  }

  if (isSecureRequest(req)) {
    options.secure = true;
  }

  return options;
}

function setSessionCookie(res, req, passcode, expiresAt) {
  res.cookie(SESSION_COOKIE_NAME, passcode, {
    ...getBaseSessionCookieOptions(req),
    expires: expiresAt
  });
}

function clearSessionCookie(res, req) {
  res.clearCookie(SESSION_COOKIE_NAME, getBaseSessionCookieOptions(req));
}

function readSessionPasscode(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] ?? '';
}

function resolvePasscodeFromRequest(req) {
  const bodyPasscode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
  const queryPasscode = typeof req.query?.passcode === 'string' ? req.query.passcode.trim() : '';
  const cookiePasscode = readSessionPasscode(req).trim();

  if (bodyPasscode) {
    return { passcode: bodyPasscode, source: 'body' };
  }

  if (queryPasscode) {
    return { passcode: queryPasscode, source: 'query' };
  }

  if (cookiePasscode) {
    return { passcode: cookiePasscode, source: 'cookie' };
  }

  return { passcode: '', source: 'none' };
}

function validatePasscode(passcode) {
  if (!passcode) {
    return { ok: false, status: 401, error: 'Not authenticated' };
  }

  const passcodes = getPasscodes();
  const match = passcodes.find((entry) => entry.code === passcode);

  if (!match) {
    return { ok: false, status: 401, error: 'Invalid passcode' };
  }

  const expiresAt = new Date(match.expires);

  if (new Date() > expiresAt) {
    return { ok: false, status: 403, error: 'Passcode has expired' };
  }

  return { ok: true, match, expiresAt };
}

function resolveVariantIdFromRequest(req) {
  const requestedVariant = req.body?.variant ?? req.query?.variant;

  if (typeof requestedVariant === 'string' && isKnownVariant(requestedVariant)) {
    return requestedVariant;
  }

  const hostnameCandidates = [
    req.headers['x-forwarded-host'],
    req.headers.origin,
    req.headers.referer,
    req.headers.host
  ];

  for (const candidate of hostnameCandidates) {
    const hostname = normalizeHostname(candidate);

    if (hostname) {
      return resolveVariantId(hostname);
    }
  }

  return DEFAULT_VARIANT_ID;
}

function getVariantForRequest(req) {
  return getVariantConfigById(resolveVariantIdFromRequest(req));
}

function getDocumentData(variantId) {
  const variant = getVariantConfigById(variantId);
  return readJsonFile(variant.dataFile);
}

app.post('/api/auth', (req, res) => {
  const { passcode, source } = resolvePasscodeFromRequest(req);
  const validation = validatePasscode(passcode);

  if (!validation.ok) {
    if (source === 'cookie') {
      clearSessionCookie(res, req);
    }

    return res.status(validation.status).json({ error: validation.error });
  }

  setSessionCookie(res, req, passcode, validation.expiresAt);

  const variant = getVariantForRequest(req);
  const isAdmin = validation.match.isAdmin === true;

  const response = {
    success: true,
    variant: variant.id,
    data: getDocumentData(variant.id),
    isAdmin
  };

  if (isAdmin) {
    response.resumeData = getDocumentData('resume');
    response.cvData = getDocumentData('cv');
  }

  return res.json(response);
});

function handleDownloadRequest(req, res) {
  const { passcode, source } = resolvePasscodeFromRequest(req);
  const validation = validatePasscode(passcode);

  if (!validation.ok) {
    if (source === 'cookie') {
      clearSessionCookie(res, req);
    }

    return res.status(validation.status).send(validation.error);
  }

  setSessionCookie(res, req, passcode, validation.expiresAt);

  const variant = getVariantForRequest(req);
  const pdfFile = variant.pdfFile;

  if (!pdfFile) {
    return res.status(404).send('PDF not configured');
  }

  const pdfPath = path.join(__dirname, pdfFile);

  if (!fs.existsSync(pdfPath)) {
    return res.status(404).send('PDF not found');
  }

  res.set({
    'Cache-Control': 'private, no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff'
  });

  return res.download(pdfPath, variant.pdfDownloadName, {
    acceptRanges: true,
    cacheControl: false,
    lastModified: true
  }, (error) => {
    if (!error || res.headersSent) {
      return;
    }

    if (error.code === 'ECONNABORTED') {
      return;
    }

    res.status(error.statusCode || 500).send('Failed to send PDF');
  });
}

app.get('/api/download', handleDownloadRequest);

function requireAdmin(req, res) {
  const { passcode, source } = resolvePasscodeFromRequest(req);
  const validation = validatePasscode(passcode);

  if (!validation.ok) {
    if (source === 'cookie') {
      clearSessionCookie(res, req);
    }
    res.status(validation.status).json({ error: validation.error });
    return false;
  }

  if (validation.match.isAdmin !== true) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }

  return true;
}

app.get('/api/data/:variant', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const variantId = req.params.variant;

  if (!isKnownVariant(variantId)) {
    return res.status(400).json({ error: 'Unknown variant' });
  }

  return res.json({ data: getDocumentData(variantId) });
});

app.post('/api/save', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { variant, data } = req.body;

  if (!variant || !data) {
    return res.status(400).json({ error: 'Missing variant or data' });
  }

  if (!isKnownVariant(variant)) {
    return res.status(400).json({ error: 'Unknown variant' });
  }

  const variantConfig = getVariantConfigById(variant);
  const filePath = path.join(__dirname, variantConfig.dataFile);

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return res.json({ success: true });
  } catch (error) {
    console.error('Failed to save:', error);
    return res.status(500).json({ error: 'Failed to save file' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
