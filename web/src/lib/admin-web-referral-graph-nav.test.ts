import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { QueryReadError } from './query-read-error.ts';
import { isReferralAdminDetail } from '../types/referrals.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadNodeDetailFetcher(payload: unknown, status = 200) {
  const source = readFileSync(new URL('../components/referrals/GraphNodeDrawer.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const ui = new Proxy({}, { get: (_, key) => String(key) });
  vm.runInNewContext(code, {
    exports,
    require: (id: string) => {
      if (id === '@/lib/query-read-error') return { QueryReadError };
      if (id === '@/components/QueryErrorAlert') return { QueryErrorAlert: () => null };
      if (id === '@/lib/referral-graph-highlight') return { getReferralGraphHighlightLabel: () => null };
      if (id === '@/types/referrals') return { isReferralAdminDetail };
      if (id === '@mantine/core' || id === '@tabler/icons-react') return ui;
      if (id === '@tanstack/react-query') return { useQuery: () => ({}) };
      if (id === 'next/link' || id === 'react/jsx-runtime') return ui;
      throw new Error(`Missing graph drawer mock: ${id}`);
    },
    fetch: async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    }),
    Date,
  });
  return exports.fetchNodeDetail as (fcId: string) => Promise<unknown>;
}

const completeDetail = {
  fcId: 'fc-1',
  name: '테스트 FC',
  phone: '01011112222',
  affiliation: '서울',
  currentCode: {
    id: 'code-1',
    code: 'ABC123',
    isActive: true,
    createdAt: '2026-10-13T00:00:00.000Z',
    disabledAt: null,
  },
  codeHistory: [{
    id: 'code-0',
    code: 'OLD123',
    isActive: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    disabledAt: '2026-10-01T00:00:00.000Z',
  }],
  recentEvents: [{
    id: 'event-1',
    eventType: 'code_rotated',
    createdAt: '2026-10-01T00:00:00.000Z',
    referralCode: 'ABC123',
    metadata: { reason: '운영 요청' },
  }],
};

test('dashboard navigation exposes referral graph as a top-level staff menu item', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(testDir, '../app/dashboard/layout.tsx'), 'utf8');

  assert.match(source, /IconGraph/);
  assert.match(
    source,
    /\{\s*label:\s*'추천인 그래프',\s*icon:\s*IconGraph,\s*href:\s*'\/dashboard\/referrals\/graph'\s*\}/,
  );
});

test('graph node detail rejects HTTP and malformed success responses', async () => {
  await assert.rejects(
    loadNodeDetailFetcher({ error: 'failed' }, 503)('fc-1'),
    (error) => error instanceof QueryReadError && error.status === 503,
  );
  await assert.rejects(
    loadNodeDetailFetcher({ ok: true, detail: { fcId: 'fc-1' } })('fc-1'),
    (error) => error instanceof QueryReadError,
  );
  await assert.rejects(
    loadNodeDetailFetcher({
      ok: true,
      detail: { ...completeDetail, currentCode: { ...completeDetail.currentCode, id: 1 } },
    })('fc-1'),
    (error) => error instanceof QueryReadError,
  );
});

test('graph node detail accepts null and complete detail contracts', async () => {
  assert.equal(await loadNodeDetailFetcher({ ok: true, detail: null })('fc-1'), null);

  assert.deepEqual(
    await loadNodeDetailFetcher({ ok: true, detail: completeDetail })('fc-1'),
    completeDetail,
  );
});

test('shared referral detail guard validates nested code and event contracts at runtime', () => {
  assert.equal(isReferralAdminDetail(completeDetail), true);
  assert.equal(isReferralAdminDetail({
    ...completeDetail,
    currentCode: { ...completeDetail.currentCode, id: 1 },
  }), false);
  assert.equal(isReferralAdminDetail({
    ...completeDetail,
    codeHistory: [{ ...completeDetail.codeHistory[0], isActive: 0 }],
  }), false);
  assert.equal(isReferralAdminDetail({
    ...completeDetail,
    recentEvents: [{ ...completeDetail.recentEvents[0], metadata: [] }],
  }), false);
});
