import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Load data
const getPasscodes = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'passcodes.json'), 'utf-8'));
const getResume = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'resume.json'), 'utf-8'));

// Auth endpoint
app.post('/api/auth', (req, res) => {
  const { passcode } = req.body;
  const passcodes = getPasscodes();

  const match = passcodes.find(p => p.code === passcode);

  if (!match) {
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  const now = new Date();
  const expires = new Date(match.expires);

  if (now > expires) {
    return res.status(403).json({ error: 'Passcode has expired' });
  }

  // Return the resume data and a simple success flag
  res.json({ success: true, data: getResume() });
});

// Secure PDF download endpoint
app.get('/api/download', (req, res) => {
  const { passcode } = req.query;
  const passcodes = getPasscodes();
  const match = passcodes.find(p => p.code === passcode);

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
