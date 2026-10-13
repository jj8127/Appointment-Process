import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

import { QueryReadError } from './query-read-error.ts';
import { requireMutationSuccess } from './user-intent-policy.ts';
import { isInboxNotificationPayload } from './inbox-notification-contract.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadBellInboxClient(fetchImpl: typeof fetch) {
  const source = `${read('src/components/DashboardNotificationBell.tsx')}
export const __testInvokeInboxMarkAllRead = invokeInboxMarkAllRead;
export const __testInvokeInboxUnreadCount = invokeInboxUnreadCount;`;
  const code = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const noopComponent = () => null;

  vm.runInNewContext(code, {
    exports,
    fetch: fetchImpl,
    require: (id: string) => {
      if (id === '@/components/QueryErrorAlert') return { QueryErrorAlert: noopComponent };
      if (id === '@/lib/query-read-error') return { QueryReadError };
      if (id === '@/lib/user-intent-policy') return { requireMutationSuccess };
      if (id === '@/lib/inbox-notification-contract') return { isInboxNotificationPayload };
      if (id === '@/lib/notification-target') {
        return {
          parseNotificationTargetV1: () => null,
        };
      }
      if (id === '@/lib/sensitive-text') return { redactSensitiveText: (value: unknown) => value };
      if (id === '@mantine/notifications') return { notifications: { show() {} } };
      if (id === '@mantine/core' || id === '@tabler/icons-react') {
        return new Proxy({}, { get: () => noopComponent });
      }
      if (id === '@tanstack/react-query') {
        return { useMutation: () => ({}), useQuery: () => ({}), useQueryClient: () => ({}) };
      }
      if (id === 'next/navigation') return { useRouter: () => ({}) };
      if (id === 'react') return { useMemo: () => null, useState: () => [false, () => {}] };
      if (id === 'react/jsx-runtime') return { Fragment: 'fragment', jsx: () => null, jsxs: () => null };
      throw new Error(`Unexpected bell dependency ${id}`);
    },
  });

  return {
    markAll: exports.__testInvokeInboxMarkAllRead as () => Promise<unknown>,
    unreadCount: exports.__testInvokeInboxUnreadCount as (
      body: Record<string, unknown>,
    ) => Promise<number>,
  };
}

const proxyResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, data }),
}) as Response;

test('Bell uses backend receipts and never guesses a destination from text or legacy URLs', () => {
  const source = read('src/components/DashboardNotificationBell.tsx');
  assert.doesNotMatch(source, /useLocalStorage|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /target_url.*router|title.*includes|body.*includes|normalizeTargetUrl/i);
  assert.match(source, /parseNotificationTargetV1\(item\.target\)/);
  assert.match(source, /dashboard\/notification-open/);
  assert.doesNotMatch(source, /markSeen|seenIdList/);
});

test('Bell accepts only a complete, coherent inbox mark-all receipt', async () => {
  for (const receipt of [
    { ok: true, authorized: true, changed: true, state: 'read', updated: 231, matched: 250 },
    { ok: true, authorized: true, changed: false, state: 'already_read', updated: 0, matched: 250 },
  ]) {
    const client = loadBellInboxClient(async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        type: 'inbox_mark_all_read',
      });
      return proxyResponse(receipt);
    });
    assert.deepEqual(
      JSON.parse(JSON.stringify(await client.markAll())),
      receipt,
    );
  }
});

test('Bell rejects partial or contradictory 2xx inbox mark-all receipts', async () => {
  for (const receipt of [
    { ok: true },
    { ok: true, authorized: false, changed: true, state: 'read', updated: 1, matched: 1 },
    { ok: true, authorized: true, changed: 'yes', state: 'read', updated: 1, matched: 1 },
    { ok: true, authorized: true, changed: true, state: 'dismissed', updated: 1, matched: 1 },
    { ok: true, authorized: true, changed: true, state: 'read', updated: -1, matched: 1 },
    { ok: true, authorized: true, changed: true, state: 'read', updated: 1.5, matched: 2 },
    { ok: true, authorized: true, changed: true, state: 'read', updated: 2, matched: 1 },
    { ok: true, authorized: true, changed: true, state: 'read', updated: 1, matched: -1 },
    { ok: true, authorized: true, changed: true, state: 'already_read', updated: 1, matched: 1 },
    { ok: true, authorized: true, changed: false, state: 'already_read', updated: 1, matched: 1 },
  ]) {
    const client = loadBellInboxClient(async () => proxyResponse(receipt));
    await assert.rejects(
      client.markAll(),
      /읽음 처리 결과를 확인하지 못했습니다/,
    );
  }
});

test('Bell accepts exact unread counts above the list limit and rejects malformed counts', async () => {
  const accepted = loadBellInboxClient(async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { type: 'inbox_unread_count' });
    return proxyResponse({ ok: true, count: 237 });
  });
  assert.equal(await accepted.unreadCount({ type: 'inbox_unread_count' }), 237);

  for (const data of [
    { ok: true },
    { ok: true, count: null },
    { ok: true, count: -1 },
    { ok: true, count: 1.5 },
    { ok: false, count: 237 },
  ]) {
    const rejected = loadBellInboxClient(async () => proxyResponse(data));
    await assert.rejects(
      rejected.unreadCount({ type: 'inbox_unread_count' }),
      QueryReadError,
    );
  }
});

test('service worker remains network-only and retires browser notification state', () => {
  const source = read('public/sw.js');
  assert.match(source, /pushManager\.getSubscription/);
  assert.match(source, /subscription\.unsubscribe/);
  assert.match(source, /registration\.getNotifications/);
  assert.match(source, /notification\.close/);
  assert.doesNotMatch(source, /addEventListener\(['"]push['"]/);
  assert.doesNotMatch(source, /addEventListener\(['"]notificationclick['"]/);
  assert.doesNotMatch(source, /showNotification/);
});

test('auth resume uses one signed HttpOnly identifier and no arbitrary returnTo', () => {
  const prepare = read('src/app/api/notification-open/prepare/route.ts');
  const resume = read('src/app/api/notification-open/resume/route.ts');
  const auth = read('src/app/auth/page.tsx');
  assert.match(prepare, /createNotificationOpenToken/);
  assert.match(prepare, /httpOnly:\s*true/);
  assert.match(resume, /verifyNotificationOpenToken/);
  assert.match(resume, /maxAge:\s*0/);
  assert.doesNotMatch(`${prepare}\n${resume}\n${auth}`, /returnTo|redirectUrl|callbackUrl/);
});

test('destination acknowledgement occurs only after a ready event', () => {
  const acknowledger = read('src/components/NotificationReadAcknowledger.tsx');
  assert.match(acknowledger, /notification-destination-ready/);
  assert.match(acknowledger, /inbox_get/);
  assert.match(acknowledger, /inbox_mark_read/);
  assert.match(acknowledger, /expected\.pathname !== pathname/);
});

test('notification open fails visibly on network rejection or timeout and preserves unread state', () => {
  const source = read('src/app/dashboard/notification-open/[id]/page.tsx');
  assert.match(source, /AbortSignal\.timeout\(NOTIFICATION_OPEN_TIMEOUT_MS\)/);
  assert.match(source, /catch \{[\s\S]*?setState\('unavailable'\)/);
  assert.match(source, /대상을 열 수 없음/);
  assert.match(source, /다시 시도/);
  assert.match(source, /읽음 처리되지 않았습니다/);
  assert.doesNotMatch(source, /inbox_mark_read/);
});
