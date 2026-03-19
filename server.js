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
const PORT = 3001;

app.use(cors());
app.use(express.json());

function readJsonFile(fileName) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, fileName), 'utf-8'));
}

function getPasscodes() {
  return readJsonFile('passcodes.json');
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
  const passcodes = getPasscodes();
  const match = passcodes.find((entry) => entry.code === passcode);

  if (!match) {
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  const now = new Date();
  const expires = new Date(match.expires);

  if (now > expires) {
    return res.status(403).json({ error: 'Passcode has expired' });
  }

  const variant = getVariantForRequest(req);

  return res.json({
    success: true,
    variant: variant.id,
    data: getDocumentData(variant.id)
  });
});

app.get('/api/download', (req, res) => {
  const { passcode } = req.query;
  const passcodes = getPasscodes();
  const match = passcodes.find((entry) => entry.code === passcode);

  if (!match || new Date() > new Date(match.expires)) {
    return res.status(403).send('Unauthorized');
  }

  const variant = getVariantForRequest(req);
  const pdfFile = variant.pdfFile;

  if (!pdfFile) {
    return res.status(404).send('PDF not configured');
  }

  const pdfPath = path.join(__dirname, pdfFile);

  if (fs.existsSync(pdfPath)) {
    return res.download(pdfPath, variant.pdfDownloadName);
  }

  return res.status(404).send('PDF not found');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
