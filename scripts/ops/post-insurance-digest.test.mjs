import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildDigestTitle,
  createPostInsuranceDigestRunner,
  formatDigestContent,
  loadRuntimeEnv,
  parseArgs,
} from './post-insurance-digest.mjs';

const actorEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  BOARD_AUTOMATION_ACTOR_ROLE: 'admin',
  BOARD_AUTOMATION_ACTOR_PHONE: '01012345678',
  BOARD_AUTOMATION_ACTOR_NAME: '자동 브리핑',
};

function createFetchRecorder(responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({
      url,
      body: JSON.parse(init.body ?? '{}'),
    });
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected fetch call to ${url}`);
    }
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      async json() {
        return next.body;
      },
      async text() {
        return JSON.stringify(next.body);
      },
    };
  };
  return { calls, fetchImpl };
}

test('parseArgs accepts inline JSON input and dry-run flag', () => {
  const parsed = parseArgs([
    '--input-json',
    '{"title":"보험 이슈 브리핑 2026.05.16","content":"본문","sourceUrls":["https://example.com/a"]}',
    '--dry-run',
  ]);

  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.digest.title, '보험 이슈 브리핑 2026.05.16');
  assert.equal(parsed.digest.content, '본문');
  assert.deepEqual(parsed.digest.sourceUrls, ['https://example.com/a']);
});

test('formatDigestContent appends short source labels without raw url or disclaimer copy', () => {
  const content = formatDigestContent({
    content: '오늘의 핵심 요약\n- 이슈 1',
    sourceUrls: ['https://example.com/a', 'https://example.com/a', 'https://example.com/b'],
    sourceLabels: ['예시뉴스 - 첫 번째 기사', '예시뉴스 - 두 번째 기사'],
  });

  assert.match(content, /오늘의 핵심 요약/);
  assert.match(content, /출처/);
  assert.match(content, /1\. 예시뉴스 - 첫 번째 기사/);
  assert.match(content, /2\. 예시뉴스 - 두 번째 기사/);
  assert.doesNotMatch(content, /https:\/\/example\.com\/a/);
  assert.doesNotMatch(content, /AI가 요약한 참고용 브리핑/);
});

test('formatDigestContent does not duplicate visible source lines', () => {
  const content = formatDigestContent({
    content: '오늘의 핵심 요약\n- 테스트\n- 출처: 예시뉴스',
    sourceUrls: ['https://example.com/a'],
  });

  assert.match(content, /- 출처: 예시뉴스/);
  assert.doesNotMatch(content, /1\. example\.com/);
  assert.doesNotMatch(content, /https:\/\/example\.com\/a/);
});

test('dry-run validates payload without calling Supabase', async () => {
  const { calls, fetchImpl } = createFetchRecorder([]);
  const runner = createPostInsuranceDigestRunner({ fetchImpl, now: () => new Date('2026-05-16T00:00:00Z') });

  const result = await runner({
    env: actorEnv,
    digest: {
      title: buildDigestTitle(new Date('2026-05-16T00:00:00Z')),
      content: '오늘의 핵심 요약\n- 테스트',
      sourceUrls: ['https://example.com/a'],
    },
    dryRun: true,
  });

  assert.equal(result.status, 'dry-run');
  assert.equal(calls.length, 0);
  assert.equal(result.payload.title, '보험 이슈 브리핑 2026.05.16');
  assert.equal(result.payload.categorySlug, 'insurance-news');
});

test('runner builds default KST digest title when title is omitted', async () => {
  const { fetchImpl } = createFetchRecorder([]);
  const runner = createPostInsuranceDigestRunner({ fetchImpl, now: () => new Date('2026-05-15T23:30:00Z') });

  const result = await runner({
    env: actorEnv,
    digest: {
      content: '오늘의 핵심 요약\n- 테스트',
      sourceUrls: ['https://example.com/a'],
    },
    dryRun: true,
  });

  assert.equal(result.status, 'dry-run');
  assert.equal(result.payload.title, '보험 이슈 브리핑 2026.05.16');
});

test('runner rejects digest without at least one source url', async () => {
  const { fetchImpl } = createFetchRecorder([]);
  const runner = createPostInsuranceDigestRunner({ fetchImpl, now: () => new Date('2026-05-16T00:00:00Z') });

  await assert.rejects(
    runner({
      env: actorEnv,
      digest: {
        content: '오늘의 핵심 요약\n- 테스트',
        sourceUrls: [],
      },
      dryRun: true,
    }),
    /At least one source URL is required/,
  );
});

test('loadRuntimeEnv reads repo env aliases and derives automation actor phone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'insurance-digest-env-'));
  try {
    await writeFile(
      join(dir, '.env'),
      [
        'EXPO_PUBLIC_SUPABASE_URL=https://env.example.supabase.co',
        'EXPO_PUBLIC_SUPABASE_ANON_KEY=expo-anon',
        'EXPO_PUBLIC_ADMIN_PHONES=01011112222,01033334444',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(dir, '.env.local'),
      [
        'NEXT_PUBLIC_SUPABASE_ANON_KEY="next-anon"',
        'BOARD_AUTOMATION_ACTOR_NAME="보험 자동화"',
      ].join('\n'),
      'utf8',
    );

    const env = await loadRuntimeEnv({
      cwd: dir,
      baseEnv: {},
    });

    assert.equal(env.SUPABASE_URL, 'https://env.example.supabase.co');
    assert.equal(env.SUPABASE_ANON_KEY, 'next-anon');
    assert.equal(env.BOARD_AUTOMATION_ACTOR_ROLE, 'admin');
    assert.equal(env.BOARD_AUTOMATION_ACTOR_PHONE, '01011112222');
    assert.equal(env.BOARD_AUTOMATION_ACTOR_NAME, '보험 자동화');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runner uses existing insurance-news category and posts digest', async () => {
  const { calls, fetchImpl } = createFetchRecorder([
    {
      body: {
        ok: true,
        data: [
          { id: 'cat-existing', name: '보험소식', slug: 'insurance-news', sortOrder: 5, isActive: true },
        ],
      },
    },
    { body: { ok: true, data: { items: [] } } },
    { body: { ok: true, data: { id: 'post-1' } } },
  ]);
  const runner = createPostInsuranceDigestRunner({ fetchImpl, now: () => new Date('2026-05-16T00:00:00Z') });

  const result = await runner({
    env: actorEnv,
    digest: {
      title: '보험 이슈 브리핑 2026.05.16',
      content: '오늘의 핵심 요약\n- 테스트',
      sourceUrls: ['https://example.com/a'],
    },
  });

  assert.equal(result.status, 'posted');
  assert.equal(result.postId, 'post-1');
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /board-categories-list$/);
  assert.match(calls[1].url, /board-list$/);
  assert.match(calls[2].url, /board-create$/);
  assert.equal(calls[2].body.categoryId, 'cat-existing');
});

test('runner creates insurance-news category when missing', async () => {
  const { calls, fetchImpl } = createFetchRecorder([
    { body: { ok: true, data: [{ id: 'cat-general', name: '일반', slug: 'general', isActive: true }] } },
    { body: { ok: true, data: { id: 'cat-created' } } },
    { body: { ok: true, data: { items: [] } } },
    { body: { ok: true, data: { id: 'post-2' } } },
  ]);
  const runner = createPostInsuranceDigestRunner({ fetchImpl, now: () => new Date('2026-05-16T00:00:00Z') });

  const result = await runner({
    env: actorEnv,
    digest: {
      title: '보험 이슈 브리핑 2026.05.16',
      content: '오늘의 핵심 요약\n- 테스트',
      sourceUrls: ['https://example.com/a'],
    },
  });

  assert.equal(result.status, 'posted');
  assert.equal(result.categoryId, 'cat-created');
  assert.match(calls[1].url, /board-category-create$/);
  assert.equal(calls[1].body.name, '보험소식');
  assert.equal(calls[1].body.slug, 'insurance-news');
});

test('runner skips when same-day digest already exists', async () => {
  const { calls, fetchImpl } = createFetchRecorder([
    {
      body: {
        ok: true,
        data: [
          { id: 'cat-existing', name: '보험소식', slug: 'insurance-news', sortOrder: 5, isActive: true },
        ],
      },
    },
    {
      body: {
        ok: true,
        data: {
          items: [
            {
              id: 'post-existing',
              title: '보험 이슈 브리핑 2026.05.16',
              categoryId: 'cat-existing',
            },
          ],
        },
      },
    },
  ]);
  const runner = createPostInsuranceDigestRunner({ fetchImpl, now: () => new Date('2026-05-16T00:00:00Z') });

  const result = await runner({
    env: actorEnv,
    digest: {
      title: '보험 이슈 브리핑 2026.05.16',
      content: '오늘의 핵심 요약\n- 테스트',
      sourceUrls: ['https://example.com/a'],
    },
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.existingPostId, 'post-existing');
  assert.equal(calls.length, 2);
});
