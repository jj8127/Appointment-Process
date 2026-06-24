import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildDraftPrMetadata,
  createSentryDailyTriageRunner,
  loadRuntimeEnv,
  parseArgs,
  resolveRuntimeEnvDirs,
  selectCandidateIssue,
} from './sentry-daily-triage.mjs';

function createFetchRecorder(responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected fetch call to ${url}`);
    }
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      async text() {
        return JSON.stringify(next.body);
      },
    };
  };
  return { calls, fetchImpl };
}

test('parseArgs supports dry-run, org, repeated projects, and limits', () => {
  const parsed = parseArgs([
    '--dry-run',
    '--org',
    'custom-org',
    '--project',
    'react-native',
    '--project',
    'garamin-web',
    '--limit',
    '5',
    '--event-limit',
    '3',
  ]);

  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.org, 'custom-org');
  assert.deepEqual(parsed.projects, ['react-native', 'garamin-web']);
  assert.equal(parsed.limit, 5);
  assert.equal(parsed.eventLimit, 3);
});

test('dry-run never requires SENTRY_READ_AUTH_TOKEN or calls Sentry', async () => {
  const { calls, fetchImpl } = createFetchRecorder([]);
  const runner = createSentryDailyTriageRunner({ fetchImpl });

  const result = await runner({
    env: { SENTRY_AUTH_TOKEN: 'upload-only-token' },
    dryRun: true,
  });

  assert.equal(result.status, 'dry-run');
  assert.equal(result.hasReadToken, false);
  assert.equal(result.usesUploadTokenFallback, false);
  assert.deepEqual(result.projects, ['react-native', 'garamin-web']);
  assert.equal(calls.length, 0);
});

test('loadRuntimeEnv reads the primary checkout env when running from a linked worktree', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'sentry-triage-worktree-'));
  const repoDir = join(tempRoot, 'repo');
  const worktreeDir = join(tempRoot, 'worktree');

  try {
    execFileSync('git', ['init', repoDir], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'codex@example.com'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Codex'], { stdio: 'ignore' });
    await writeFile(join(repoDir, 'README.md'), 'fixture\n', 'utf8');
    execFileSync('git', ['-C', repoDir, 'add', 'README.md'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoDir, 'commit', '-m', 'fixture'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoDir, 'worktree', 'add', '-b', 'fixture-worktree', worktreeDir], { stdio: 'ignore' });

    await writeFile(
      join(repoDir, '.env.local'),
      'SENTRY_READ_AUTH_TOKEN=primary-read-token\nSENTRY_ORG=primary-org\n',
      'utf8',
    );
    await writeFile(join(worktreeDir, '.env.local'), 'SENTRY_ORG=worktree-org\n', 'utf8');

    const envDirs = await resolveRuntimeEnvDirs(worktreeDir);
    const env = await loadRuntimeEnv({ cwd: worktreeDir, baseEnv: {} });

    assert.equal(envDirs.length, 2);
    assert.equal(envDirs[0], repoDir);
    assert.equal(envDirs[1], worktreeDir);
    assert.equal(env.SENTRY_READ_AUTH_TOKEN, 'primary-read-token');
    assert.equal(env.SENTRY_ORG, 'worktree-org');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('real triage refuses to fall back to SENTRY_AUTH_TOKEN for reads', async () => {
  const { fetchImpl } = createFetchRecorder([]);
  const runner = createSentryDailyTriageRunner({ fetchImpl });

  await assert.rejects(
    runner({
      env: {
        SENTRY_AUTH_TOKEN: 'upload-only-token',
        SENTRY_ORG: 'hanhwa-lifelab',
      },
    }),
    /SENTRY_READ_AUTH_TOKEN/,
  );
});

test('runner reads organization issues, issue detail, and issue events with the read token only', async () => {
  const issue = {
    id: '122054204',
    shortId: 'REACT-NATIVE-3',
    title: 'TypeError: Object is not a function',
    level: 'fatal',
    count: '38',
    userCount: 20,
    lastSeen: '2026-06-16T01:00:00Z',
    permalink: 'https://hanhwa-lifelab.sentry.io/issues/122054204/',
    project: { slug: 'react-native' },
  };
  const event = {
    id: 'event-1',
    title: issue.title,
    dateCreated: '2026-06-16T01:00:00Z',
    entries: [{ type: 'exception', data: { values: [{ type: 'TypeError', value: 'Object is not a function' }] } }],
  };
  const { calls, fetchImpl } = createFetchRecorder([
    { body: [issue] },
    { body: { ...issue, metadata: { type: 'TypeError', value: 'Object is not a function' } } },
    { body: [event] },
  ]);
  const runner = createSentryDailyTriageRunner({ fetchImpl, now: () => new Date('2026-06-16T02:00:00Z') });

  const result = await runner({
    env: {
      SENTRY_READ_AUTH_TOKEN: 'read-token',
      SENTRY_AUTH_TOKEN: 'upload-token',
      SENTRY_ORG: 'hanhwa-lifelab',
    },
  });

  assert.equal(result.status, 'issue-found');
  assert.equal(result.issue.shortId, 'REACT-NATIVE-3');
  assert.equal(result.draftPr.branch, 'codex/sentry-daily-20260616-react-native-3');
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/api\/0\/organizations\/hanhwa-lifelab\/issues\//);
  assert.match(calls[0].url, /project=react-native/);
  assert.match(calls[0].url, /project=garamin-web/);
  assert.match(calls[0].url, /environment=production/);
  assert.match(calls[0].url, /query=is%3Aunresolved/);
  assert.match(calls[1].url, /\/api\/0\/organizations\/hanhwa-lifelab\/issues\/122054204\//);
  assert.match(calls[2].url, /\/api\/0\/organizations\/hanhwa-lifelab\/issues\/122054204\/events\//);
  for (const call of calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.headers.Authorization, 'Bearer read-token');
    assert.equal(call.init.body, undefined);
  }
});

test('selectCandidateIssue prioritizes fatal issues before noisy error issues', () => {
  const selected = selectCandidateIssue([
    { id: 'error-1', shortId: 'WEB-1', level: 'error', count: '100', userCount: 50, lastSeen: '2026-06-16T01:00:00Z' },
    { id: 'fatal-1', shortId: 'RN-1', level: 'fatal', count: '1', userCount: 1, lastSeen: '2026-06-15T01:00:00Z' },
  ]);

  assert.equal(selected.shortId, 'RN-1');
});

test('buildDraftPrMetadata follows branch, title, and unresolved deployment notes', () => {
  const metadata = buildDraftPrMetadata({
    issue: {
      shortId: 'REACT-NATIVE-3',
      title: 'TypeError: Object is not a function',
      permalink: 'https://hanhwa-lifelab.sentry.io/issues/122054204/',
      project: { slug: 'react-native' },
    },
    latestEvent: {
      id: 'event-1',
      dateCreated: '2026-06-16T01:00:00Z',
    },
    now: new Date('2026-06-16T02:00:00Z'),
  });

  assert.equal(metadata.branch, 'codex/sentry-daily-20260616-react-native-3');
  assert.equal(metadata.title, 'fix(sentry): REACT-NATIVE-3 TypeError: Object is not a function');
  assert.match(metadata.body, /https:\/\/hanhwa-lifelab\.sentry\.io\/issues\/122054204\//);
  assert.match(metadata.body, /Sentry issue status was not changed/);
  assert.match(metadata.body, /Production deploys, EAS Update, native builds, and Sentry resolve are out of scope/);
});
