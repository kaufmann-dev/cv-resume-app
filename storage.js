import fs from 'node:fs';
import path from 'node:path';
import { createDocumentStore } from './document-store.js';

export const DATA_DIRECTORY = '/data';
const FILES = ['document.json', 'cv.json', 'resume.json', 'passcodes.json', 'api-keys.json', 'resume.pdf'];

// Copy rather than rename: old files may still be bind-mounted during migration.
// Existing destination files always win, including intentionally empty key lists.
function copyMissing(source, destination, validateJson = true) {
  if (fs.existsSync(destination) || !fs.existsSync(source)) return;
  if (!fs.statSync(source).isFile()) throw new Error(`Expected a file: ${source}`);
  const bytes = fs.readFileSync(source);
  if (validateJson && source.endsWith('.json')) JSON.parse(bytes.toString('utf8'));
  const temporary = `${destination}.migration-tmp`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, destination);
  console.log(`Migrated ${path.basename(source)} to ${destination}`);
}

export function initializeStorage({ baseDirectory, environment = process.env, directory = DATA_DIRECTORY }) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const sessions = path.join(directory, 'sessions');
  fs.mkdirSync(sessions, { recursive: true, mode: 0o700 });
  const marker = path.join(directory, '.storage-migrated');
  if (!fs.existsSync(marker)) {
    const sources = [...new Set([
      ...(environment.DATA_DIRECTORY ? [path.resolve(environment.DATA_DIRECTORY)] : []),
      path.join(baseDirectory, 'data'),
      baseDirectory
    ])].filter(source => path.resolve(source) !== path.resolve(directory));
    for (const source of sources) {
      for (const name of FILES) copyMissing(path.join(source, name), path.join(directory, name));
    }
    const sessionSources = [...new Set([
      ...(environment.SESSION_STORE_PATH ? [path.resolve(baseDirectory, environment.SESSION_STORE_PATH)] : []),
      ...sources.flatMap(source => [path.join(source, '.sessions'), path.join(source, 'sessions')])
    ])].filter(source => path.resolve(source) !== path.resolve(sessions));
    for (const source of sessionSources) {
      if (!fs.existsSync(source)) continue;
      for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.json')) copyMissing(path.join(source, entry.name), path.join(sessions, entry.name), false);
      }
    }
    // Validate/import the document before recording successful migration.
    createDocumentStore(directory);
    fs.writeFileSync(marker, new Date().toISOString() + '\n', { mode: 0o600 });
    console.log(`Storage migration complete. All persistent data is now in ${directory}`);
  }
  return directory;
}
