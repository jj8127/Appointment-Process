import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nextDir = path.join(__dirname, '..', '.next');

function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  } catch (err) {
    // Windows can hold locks on files under `.next` and cause EPERM. `cmd rmdir`
    // is often more reliable than Node fs for nuking large trees.
    if (process.platform === 'win32') {
      try {
        execFileSync('cmd.exe', ['/c', 'rmdir', '/s', '/q', dir], { stdio: 'ignore' });
        return;
      } catch (rmErr) {
        throw rmErr;
      }
    }
    throw err;
  }
}

if (!fs.existsSync(nextDir)) {
  process.exit(0);
}

// On Windows, deleting `.next` while a dev server is running can partially delete
// files and break subsequent runs. Use a move-then-delete strategy to avoid
// leaving `.next` in a corrupt state.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const movedDir = `${nextDir}__old__${stamp}`;

try {
  fs.renameSync(nextDir, movedDir);
} catch (err) {
  // If rename fails on Windows, fall back to hard delete instead of leaving the
  // app in a broken state (e.g. missing routes-manifest.json).
  try {
    removeDir(nextDir);
    process.exit(0);
  } catch (rmErr) {
    console.error('[clean-next] failed to move/remove .next. Is the Next dev server running?', err);
    console.error('[clean-next] remove error:', rmErr);
    process.exit(1);
  }
}

try {
  removeDir(movedDir);
} catch (err) {
  // Best-effort cleanup; we already moved `.next` out of the way.
  console.warn('[clean-next] moved .next but failed to delete old dir:', err);
}
