import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDraftPrMetadata,
  createSentryDailyTriageRunner,
  parseArgs,
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
  assert.match(calls[0].url, /query=is%3Aunresolved\+lastSeen%3A%3E%3D2026-06-24/);
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
