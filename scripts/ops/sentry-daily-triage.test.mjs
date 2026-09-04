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
      headers: { get: () => Object.hasOwn(next, 'link') ? next.link : '<https://sentry.io/?cursor=0:0:0>; rel="next"; results="false"' },
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

test('parseArgs supports explicit last-seen summary reports', () => {
  const parsed = parseArgs([
    '--last-seen-days',
    '7',
    '--summary-only',
  ]);

  assert.equal(parsed.lastSeenDays, 7);
  assert.equal(parsed.summaryOnly, true);
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
  assert.equal(result.statsPeriod, '24h');
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

test('summary-only last-seen report uses a 14d stats window with explicit lastSeen query', async () => {
  const issue = {
    id: '122054204',
    shortId: 'REACT-NATIVE-3',
    title: 'TypeError: Object is not a function',
    level: 'fatal',
    count: '5',
    userCount: 2,
    lastSeen: '2026-06-24T04:43:45Z',
    project: { slug: 'react-native' },
  };
  const { calls, fetchImpl } = createFetchRecorder([{ body: [issue] }]);
  const runner = createSentryDailyTriageRunner({ fetchImpl, now: () => new Date('2026-07-01T02:00:00Z') });

  const result = await runner({
    env: {
      SENTRY_READ_AUTH_TOKEN: 'read-token',
    },
    args: {
      lastSeenDays: 7,
      summaryOnly: true,
    },
  });

  assert.equal(result.status, 'summary');
  assert.equal(result.issueCount, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /statsPeriod=14d/);
  assert.equal(new URL(calls[0].url).searchParams.get('query'), 'is:unresolved level:[fatal,error] lastSeen:>=2026-06-24');
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

const reportNow = () => new Date('2026-09-04T02:00:00.000Z');
const reportEnv = { SENTRY_READ_AUTH_TOKEN: 'fixture-read-token' };
const historicalIssue = { id: '1001', shortId: 'REACT-NATIVE-A', level: 'error', lastSeen: '2026-08-21T02:00:00Z', project: { slug: 'react-native' } };
const nextLink = (cursor) => `<https://sentry.io/?cursor=${cursor}>; rel="next"; results="true"`;

test('daily report fixes KST/UTC bounds and queries production recent plus all-environment unresolved history', async () => {
  const { calls, fetchImpl } = createFetchRecorder([{ body: [] }, { body: [] }, { body: [] }, { body: [historicalIssue] }]);
  const runner = createSentryDailyTriageRunner({ fetchImpl, now: reportNow });
  const result = await runner({ env: reportEnv, args: parseArgs(['--daily-report']) });
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.recentIssueCount, 0);
  assert.equal(result.unresolvedBacklogCount, 1);
  assert.equal(result.serviceResolution, 'NOT_VERIFIED');
  assert.equal(result.plan.window.startKst, '2026-09-03T11:00:00.000+09:00');
  assert.equal(result.plan.window.endKst, '2026-09-04T11:00:00.000+09:00');
  assert.equal(calls.length, 4);
  for (let index = 0; index < calls.length; index += 1) {
    const params = new URL(calls[index].url).searchParams;
    assert.equal(params.get('statsPeriod'), '');
    assert.equal(params.getAll('project').length, 1);
    if (index % 2 === 0) {
      assert.equal(params.get('query'), 'level:[fatal,error] lastSeen:>=2026-09-03T02:00:00.000Z lastSeen:<=2026-09-04T02:00:00.000Z');
      assert.equal(params.get('environment'), 'production');
      assert.equal(params.get('start'), '2026-09-03T02:00:00.000Z');
      assert.equal(params.get('end'), '2026-09-04T02:00:00.000Z');
    } else {
      assert.equal(params.get('query'), 'is:unresolved level:[fatal,error]');
      for (const key of ['start', 'end', 'environment']) assert.equal(params.has(key), false);
    }
  }
});

test('all-time and explicitly empty statsPeriod never fall back to 24h', async () => {
  for (const args of [parseArgs(['--all-time', '--all-environments', '--summary-only']), { statsPeriod: '', summaryOnly: true, environment: '' }]) {
    const { calls, fetchImpl } = createFetchRecorder([{ body: [historicalIssue] }]);
    const result = await createSentryDailyTriageRunner({ fetchImpl })({ env: reportEnv, args });
    const params = new URL(calls[0].url).searchParams;
    assert.equal(params.get('statsPeriod'), '');
    assert.equal(params.has('environment'), false);
    assert.equal(result.issueCount, 1);
  }
});

test('pagination follows all cursors, retains original scope, and deduplicates overlapping pages', async () => {
  const { calls, fetchImpl } = createFetchRecorder([
    { body: [historicalIssue], link: '<https://untrusted.invalid/?cursor=0:1:0>; rel="next"; results="true"' },
    { body: [historicalIssue, { ...historicalIssue, id: '1002' }] },
  ]);
  const result = await createSentryDailyTriageRunner({ fetchImpl })({ env: reportEnv, args: { summaryOnly: true, allTime: true } });
  assert.equal(result.queryStatus, 'COMPLETE');
  assert.equal(result.issueCount, 2);
  assert.deepEqual(result.pages.map((page) => page.count), [1, 1]);
  assert.equal(result.exhausted, true);
  const next = new URL(calls[1].url);
  assert.equal(next.origin, 'https://sentry.io');
  assert.equal(next.searchParams.get('cursor'), '0:1:0');
  assert.equal(next.searchParams.get('statsPeriod'), '');
  assert.equal(next.searchParams.get('environment'), 'production');
});

test('missing pagination evidence, repeated cursors and page caps remain partial with unknown total', async () => {
  for (const fixture of [
    { responses: [{ body: [], link: null }], reason: 'PAGINATION_UNVERIFIED' },
    { responses: [{ body: [], link: nextLink('0:1:0') }, { body: [], link: nextLink('0:1:0') }], reason: 'PAGINATION_CURSOR_REPEATED' },
    { responses: [{ body: [], link: nextLink('0:1:0') }], maxPages: 1, reason: 'PAGE_LIMIT_REACHED' },
  ]) {
    const { fetchImpl } = createFetchRecorder(fixture.responses);
    const result = await createSentryDailyTriageRunner({ fetchImpl })({ env: reportEnv, args: { summaryOnly: true, maxPages: fixture.maxPages } });
    assert.equal(result.status, 'PARTIAL');
    assert.equal(result.issueCount, null);
    assert.equal(result.exhausted, false);
    assert.equal(result.reason, fixture.reason);
  }
});

test('later page failure reports partial evidence and never echoes remote error bodies', async () => {
  const canary = 'private-fixture-error-body';
  const { fetchImpl } = createFetchRecorder([{ body: [historicalIssue], link: nextLink('0:1:0') }, { ok: false, status: 403, body: { detail: canary } }]);
  const result = await createSentryDailyTriageRunner({ fetchImpl })({ env: reportEnv, args: { summaryOnly: true } });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.issueCount, null);
  assert.equal(result.observedIssueCount, 1);
  assert.equal(result.reason, 'SENTRY_HTTP_403');
  assert.equal(JSON.stringify(result).includes(canary), false);
});

test('malformed successful responses are blocked instead of silently treated as zero issues', async () => {
  for (const body of [null, { detail: 'fixture-private-record' }, [null], [{ id: null }]]) {
    const { fetchImpl } = createFetchRecorder([{ body }]);
    const result = await createSentryDailyTriageRunner({ fetchImpl })({ env: reportEnv, args: { summaryOnly: true } });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.issueCount, null);
    assert.equal(result.reason, 'SENTRY_INVALID_ISSUE_LIST');
    assert.equal(JSON.stringify(result).includes('fixture-private-record'), false);
  }
});

test('daily report missing read credentials cannot use upload credentials or report zero', async () => {
  const { calls, fetchImpl } = createFetchRecorder([]);
  const result = await createSentryDailyTriageRunner({ fetchImpl, now: reportNow })({ env: { SENTRY_AUTH_TOKEN: 'upload-only' }, args: { dailyReport: true } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.queries.length, 4);
  assert.equal(result.recentIssueCount, null);
  assert.equal(result.unresolvedBacklogCount, null);
  assert.equal(result.queries.every((query) => query.reason === 'READ_TOKEN_MISSING'), true);
  assert.equal(calls.length, 0);
});

test('a failed project does not skip other project queries or permit an aggregate zero', async () => {
  const { calls, fetchImpl } = createFetchRecorder([{ body: [] }, { ok: false, status: 403, body: {} }, { body: [] }, { body: [] }]);
  const result = await createSentryDailyTriageRunner({ fetchImpl, now: reportNow })({ env: reportEnv, args: { dailyReport: true } });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.recentIssueCount, 0);
  assert.equal(result.unresolvedBacklogCount, null);
  assert.equal(calls.length, 4);
});

test('daily summary excludes raw titles, fallback culprit, users and unsafe links', async () => {
  const canary = 'private-fixture-data';
  const issue = { ...historicalIssue, shortId: null, title: canary, culprit: canary, user: { email: canary }, entries: [{ value: canary }], permalink: `https://untrusted.invalid/${canary}` };
  const { fetchImpl } = createFetchRecorder([{ body: [] }, { body: [issue] }]);
  const result = await createSentryDailyTriageRunner({ fetchImpl, now: reportNow })({ env: reportEnv, args: { dailyReport: true, projects: ['react-native'] } });
  assert.equal(result.unresolvedBacklogCount, 1);
  assert.equal(JSON.stringify(result).includes(canary), false);
});

test('explicit time range is honored and ambiguous scope overrides fail before any request', async () => {
  const { calls, fetchImpl } = createFetchRecorder([{ body: [] }]);
  const runner = createSentryDailyTriageRunner({ fetchImpl });
  await runner({ env: reportEnv, args: parseArgs(['--start', '2026-09-03T02:00:00Z', '--end', '2026-09-04T02:00:00Z', '--summary-only']) });
  assert.equal(new URL(calls[0].url).searchParams.get('statsPeriod'), '');
  for (const args of [
    { start: 'invalid', end: 'invalid' },
    { allTime: true, lastSeenDays: 7 },
    { start: '2026-09-03T02:00:00Z', end: '2026-09-04T02:00:00Z', statsPeriod: '24h' },
    { dailyReport: true, statsPeriod: '24h' },
    { limit: 101 },
  ]) await assert.rejects(runner({ env: reportEnv, args }));
  assert.equal(calls.length, 1);
});

test('daily-report dry-run describes both scopes without making requests', async () => {
  const { calls, fetchImpl } = createFetchRecorder([]);
  const result = await createSentryDailyTriageRunner({ fetchImpl, now: reportNow })({ env: {}, args: parseArgs(['--daily-report', '--dry-run', '--project', 'garamlink-client']) });
  assert.equal(result.status, 'dry-run');
  assert.equal(result.plan.queries.length, 2);
  assert.equal(result.hasReadToken, false);
  assert.equal(calls.length, 0);
});

test('recent issue counts reject historic and future lastSeen returned despite the bounded API query', async () => {
  const recent = { ...historicalIssue, id: '1002', lastSeen: '2026-09-04T01:00:00Z', count: '900' };
  const future = { ...historicalIssue, id: '1003', lastSeen: '2026-09-04T02:00:01Z' };
  const { fetchImpl } = createFetchRecorder([{ body: [historicalIssue, recent, future] }, { body: [historicalIssue, recent, future] }]);
  const result = await createSentryDailyTriageRunner({ fetchImpl, now: reportNow })({ env: reportEnv, args: { dailyReport: true, projects: ['react-native'] } });
  assert.equal(result.recentIssueCount, 1);
  assert.equal(result.unresolvedBacklogCount, 3);
  assert.equal(result.queries[0].excludedOutOfWindow, 2);
  assert.equal(result.queries[0].issues[0].lifetimeEventCount, 900);
  assert.equal(Object.hasOwn(result.queries[0].issues[0], 'count'), false);
});

test('missing timestamp cannot turn a bounded recent query into a verified zero', async () => {
  const { fetchImpl } = createFetchRecorder([{ body: [{ ...historicalIssue, lastSeen: null }] }, { body: [] }]);
  const result = await createSentryDailyTriageRunner({ fetchImpl, now: reportNow })({ env: reportEnv, args: { dailyReport: true, projects: ['react-native'] } });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.recentIssueCount, null);
  assert.equal(result.queries[0].reason, 'SENTRY_MISSING_LAST_SEEN');
});

test('project-scoped results cannot silently count a different project', async () => {
  const { fetchImpl } = createFetchRecorder([{ body: [historicalIssue] }, { body: [] }]);
  const result = await createSentryDailyTriageRunner({ fetchImpl, now: reportNow })({ env: reportEnv, args: { dailyReport: true, projects: ['garamin-web'] } });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.recentIssueCount, null);
  assert.equal(result.queries[0].reason, 'SENTRY_PROJECT_MISMATCH');
});
