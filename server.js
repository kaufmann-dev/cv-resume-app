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

function parseRangeHeader(rangeHeader, fileSize) {
  if (!rangeHeader) return null;

  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
  if (!match) return null;

  const rawStart = match[1];
  const rawEnd = match[2];

  let start = rawStart === '' ? null : Number(rawStart);
  let end = rawEnd === '' ? null : Number(rawEnd);

  if ((start != null && Number.isNaN(start)) || (end != null && Number.isNaN(end))) {
    return null;
  }

  if (start == null && end == null) {
    return null;
  }

  if (start == null) {
    const suffixLength = end;

    if (!suffixLength || suffixLength < 0) {
      return null;
    }

    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    if (end == null || end >= fileSize) {
      end = fileSize - 1;
    }
  }

  if (start < 0 || end < start || start >= fileSize) {
    return 'invalid';
  }

  return { start, end };
}

function setPdfResponseHeaders(res, downloadName, options) {
  const {
    totalSize,
    start = null,
    end = null,
    partial = false
  } = options;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (partial) {
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Content-Length', end - start + 1);
  } else {
    res.setHeader('Content-Length', totalSize);
  }
}

function streamPdfFile(req, res, pdfPath, downloadName) {
  const stat = fs.statSync(pdfPath);
  const totalSize = stat.size;
  const requestedRange = parseRangeHeader(req.headers.range, totalSize);

  if (requestedRange === 'invalid') {
    res.setHeader('Content-Range', `bytes */${totalSize}`);
    return res.status(416).end();
  }

  if (requestedRange) {
    const { start, end } = requestedRange;
    setPdfResponseHeaders(res, downloadName, {
      totalSize,
      start,
      end,
      partial: true
    });
    res.status(206);

    if (req.method === 'HEAD') {
      return res.end();
    }

    const stream = fs.createReadStream(pdfPath, { start, end });
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).send('Failed to read PDF');
      } else {
        res.destroy();
      }
    });

    res.flushHeaders();
    return stream.pipe(res);
  }

  setPdfResponseHeaders(res, downloadName, { totalSize });
  res.status(200);

  if (req.method === 'HEAD') {
    return res.end();
  }

  const stream = fs.createReadStream(pdfPath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).send('Failed to read PDF');
    } else {
      res.destroy();
    }
  });

  res.flushHeaders();
  return stream.pipe(res);
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

  return streamPdfFile(req, res, pdfPath, variant.pdfDownloadName);
}

app.head('/api/download', handleDownloadRequest);
app.get('/api/download', handleDownloadRequest);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
