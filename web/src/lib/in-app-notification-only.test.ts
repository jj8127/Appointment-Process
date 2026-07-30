import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(webRoot, '..');
const readWeb = (relativePath: string) =>
  readFileSync(resolve(webRoot, relativePath), 'utf8');
const readRepo = (relativePath: string) =>
  readFileSync(resolve(repoRoot, relativePath), 'utf8');

test('canonical administrator notification center remains mounted and navigable', () => {
  const layout = readWeb('src/app/dashboard/layout.tsx');
  const bell = readWeb('src/components/DashboardNotificationBell.tsx');

  assert.match(layout, /<DashboardNotificationBell/);
  assert.match(bell, /type:\s*'inbox_list'/);
  assert.match(bell, /type:\s*'inbox_mark_read'/);
  assert.match(bell, /dashboard\/notification-open/);
});

test('compatibility routes authenticate but cannot register or send browser push', () => {
  const subscribeRoute = readWeb('src/app/api/web-push/subscribe/route.ts');
  const adminPushRoute = readWeb('src/app/api/admin/push/route.ts');
  const provider = readWeb('src/lib/web-push.ts');

  assert.match(subscribeRoute, /getVerifiedReadOnlyAdminSession/);
  assert.match(subscribeRoute, /export async function DELETE/);
  assert.match(subscribeRoute, /\.eq\('resident_id', sessionCheck\.session\.residentDigits\)/);
  assert.match(subscribeRoute, /\.eq\('role', sessionCheck\.session\.role\)/);
  assert.match(subscribeRoute, /mode:\s*'in_app_only'/);
  assert.doesNotMatch(subscribeRoute, /\.upsert\(/);

  assert.match(adminPushRoute, /secretAuthOk|serviceRoleAuthOk|apikeyAuthOk/);
  assert.match(adminPushRoute, /mode:\s*'in_app_only'/);
  assert.doesNotMatch(adminPushRoute, /web_push_subscriptions|sendWebPush/);

  assert.match(provider, /mode:\s*'in_app_only'/);
  assert.doesNotMatch(provider, /sendNotification|setVapidDetails|from 'web-push'/);
});

test('server delivery retains Expo mobile fanout and removes all active Web Push fanout', () => {
  const lifecycle = readWeb('src/lib/push-notification-service.ts');
  const notice = readWeb('src/app/dashboard/notifications/actions.ts');
  const combined = `${lifecycle}\n${notice}`;

  assert.match(lifecycle, /https:\/\/exp\.host\/--\/api\/v2\/push\/send/);
  assert.match(notice, /https:\/\/exp\.host\/--\/api\/v2\/push\/send/);
  assert.doesNotMatch(combined, /sendWebPush|web_push_subscriptions/);
});

test('fc-notify keeps administrator Web Push as an accepted local no-op', () => {
  const edge = readRepo('supabase/functions/fc-notify/index.ts');
  const start = edge.indexOf('async function notifyAdminWebPush(');
  const end = edge.indexOf('function getNotificationDeliveryWarning', start);
  const noOp = edge.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(noOp, /ok:\s*true/);
  assert.match(noOp, /sent:\s*0/);
  assert.match(noOp, /failed:\s*0/);
  assert.match(noOp, /noTarget:\s*true/);
  assert.match(noOp, /reason:\s*'in-app-only'/);
  assert.doesNotMatch(noOp, /\bfetch\(/);
  assert.doesNotMatch(noOp, /ADMIN_WEB_URL|ADMIN_PUSH_SECRET/);
});
