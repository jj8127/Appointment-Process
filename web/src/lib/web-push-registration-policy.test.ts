import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) =>
  readFileSync(resolve(sourceRoot, relativePath), 'utf8');

test('administrator layout retires old system-notification state without mounting a registrar', () => {
  const layout = read('app/layout.tsx');
  const retirer = read('components/SystemNotificationRetirer.tsx');
  const retirement = read('lib/system-notification-retirement.ts');

  assert.match(layout, /<SystemNotificationRetirer \/>/);
  assert.doesNotMatch(layout, /WebPushRegistrar/);
  assert.match(retirer, /retireBrowserSystemNotifications/);
  assert.match(retirement, /method:\s*'DELETE'/);
  assert.match(retirement, /pushManager[\s\S]*?getSubscription/);
  assert.match(retirement, /subscription\?\.unsubscribe/);
  assert.match(retirement, /registration\.getNotifications/);
  assert.doesNotMatch(retirement, /requestPermission|showNotification|new Notification/);
  assert.doesNotMatch(retirement, /method:\s*'POST'/);
});

test('dashboard and settings expose no browser notification controls', () => {
  const dashboard = read('app/dashboard/page.tsx');
  const settings = read('app/dashboard/settings/page.tsx');
  const source = `${dashboard}\n${settings}`;

  assert.doesNotMatch(source, /registerWebPushSubscription|handleWebPushSettings/);
  assert.doesNotMatch(source, /handleBrowserNotificationTest|Notification\.requestPermission/);
  assert.doesNotMatch(source, /showNotification|new Notification/);
});
