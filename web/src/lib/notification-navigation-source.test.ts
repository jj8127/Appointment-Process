import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('Bell uses backend receipts and never guesses a destination from text or legacy URLs', () => {
  const source = read('src/components/DashboardNotificationBell.tsx');
  assert.doesNotMatch(source, /useLocalStorage|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /target_url.*router|title.*includes|body.*includes|normalizeTargetUrl/i);
  assert.match(source, /parseNotificationTargetV1\(item\.target\)/);
  assert.match(source, /dashboard\/notification-open/);
  assert.doesNotMatch(source, /markSeen|seenIdList/);
});

test('service worker accepts only notificationId plus strict target v1', () => {
  const source = read('public/sw.js');
  assert.match(source, /isNotificationTargetV1/);
  assert.match(source, /notificationId/);
  assert.match(source, /api\/notification-open\/prepare/);
  assert.doesNotMatch(source, /data\.url|targetName|target_url|normalizeNotificationTargetUrl/);
  assert.doesNotMatch(source, /startsWith\('http|startsWith\(\"http/);
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
