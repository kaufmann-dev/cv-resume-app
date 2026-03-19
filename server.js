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

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

function readJsonFile(fileName) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, fileName), 'utf-8'));
}

function getPasscodes() {
  return readJsonFile('passcodes.json');
}

function validatePasscode(passcode) {
  const passcodes = getPasscodes();
  const match = passcodes.find((entry) => entry.code === passcode);

  if (!match) {
    return { ok: false, status: 401, error: 'Invalid passcode' };
  }

  if (new Date() > new Date(match.expires)) {
    return { ok: false, status: 403, error: 'Passcode has expired' };
  }

  return { ok: true, match };
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
  const { passcode } = req.body ?? {};
  const validation = validatePasscode(passcode);

  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }

  const variant = getVariantForRequest(req);

  return res.json({
    success: true,
    variant: variant.id,
    data: getDocumentData(variant.id)
  });
});

function handleDownloadRequest(req, res) {
  const { passcode } = req.query;
  const validation = validatePasscode(passcode);

  if (!validation.ok) {
    return res.status(validation.status).send(validation.error);
  }

  const variant = getVariantForRequest(req);
  const pdfFile = variant.pdfFile;

  if (!pdfFile) {
    return res.status(404).send('PDF not configured');
  }

  const pdfPath = path.join(__dirname, pdfFile);

  if (!fs.existsSync(pdfPath)) {
    return res.status(404).send('PDF not found');
  }

  return res.sendFile(pdfPath, {
    acceptRanges: true,
    cacheControl: false,
    lastModified: true,
    headers: {
      'Content-Disposition': `attachment; filename="${variant.pdfDownloadName}"`,
      'Content-Type': 'application/pdf',
      'Cache-Control': 'private, no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff'
    }
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

app.head('/api/download', handleDownloadRequest);
app.get('/api/download', handleDownloadRequest);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
