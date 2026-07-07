#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const ZERO_SHA = /^0{40}$/;

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tryGit(args) {
  try {
    return runGit(args);
  } catch {
    return '';
  }
}

function resolveNewBranchBase(localSha) {
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    if (!tryGit(['rev-parse', '--verify', candidate])) continue;
    const mergeBase = tryGit(['merge-base', localSha, candidate]);
    if (mergeBase) return mergeBase;
  }
  return `${localSha}^`;
}

function parsePushRefs(input) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    })
    .filter((ref) => ref.localSha && !ZERO_SHA.test(ref.localSha));
}

function runGovernance(baseSha, headSha, label) {
  console.log(`[pre-push-governance] ${label}: ${baseSha}..${headSha}`);
  try {
    execFileSync(process.execPath, ['scripts/ci/check-governance.mjs'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
      },
    });
  } catch (error) {
    process.exit(typeof error.status === 'number' ? error.status : 1);
  }
}

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdin += chunk;
});

process.stdin.on('end', () => {
  const refs = parsePushRefs(stdin);
  if (refs.length === 0) {
    const headSha = runGit(['rev-parse', 'HEAD']);
    const baseSha = tryGit(['rev-parse', 'HEAD~1']) || `${headSha}^`;
    runGovernance(baseSha, headSha, 'HEAD');
    return;
  }

  for (const ref of refs) {
    const baseSha = ref.remoteSha && !ZERO_SHA.test(ref.remoteSha)
      ? ref.remoteSha
      : resolveNewBranchBase(ref.localSha);
    runGovernance(baseSha, ref.localSha, `${ref.localRef} -> ${ref.remoteRef}`);
  }
});
