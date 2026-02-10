import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nextDir = path.join(__dirname, '..', '.next');

try {
  fs.rmSync(nextDir, { recursive: true, force: true });
} catch (err) {
  // Best-effort cleanup; build can proceed if folder doesn't exist.
  console.warn('[clean-next] failed to remove .next:', err);
}

