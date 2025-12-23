import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, 'database.db'));
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Auth endpoint
app.post('/api/auth', (req, res) => {
  const { passcode } = req.body;

  const match = db.prepare('SELECT * FROM passcodes WHERE code = ?').get(passcode);

  if (!match) {
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  const now = new Date();
  const expires = new Date(match.expires);

  if (now > expires) {
    return res.status(403).json({ error: 'Passcode has expired' });
  }

  // Get resume data (all languages for simplicity, or we could filter here)
  const rows = db.prepare('SELECT lang, content FROM resume').all();
  const resumeData = {};
  rows.forEach(row => {
    resumeData[row.lang] = JSON.parse(row.content);
  });

  // Return the resume data and a simple success flag
  res.json({ success: true, data: resumeData });
});

// Secure PDF download endpoint
app.get('/api/download', (req, res) => {
  const { passcode } = req.query;

  const match = db.prepare('SELECT * FROM passcodes WHERE code = ?').get(passcode);

  if (!match || new Date() > new Date(match.expires)) {
    return res.status(403).send('Unauthorized');
  }

  const pdfPath = path.join(__dirname, 'resume.pdf');
  if (fs.existsSync(pdfPath)) {
    res.download(pdfPath, 'David_Kaufmann_Resume.pdf');
  } else {
    res.status(404).send('PDF not found');
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
