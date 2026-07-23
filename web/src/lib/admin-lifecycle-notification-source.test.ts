import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath: string) =>
  readFileSync(path.join(sourceRoot, relativePath), 'utf8');

test('legacy admin notification paths use the structured delivery result', () => {
  const routeSource = readSource('app/api/admin/fc/route.ts');
  const docsSource = readSource('app/dashboard/docs/actions.ts');
  const appointmentSource = readSource('app/dashboard/appointment/actions.ts');
  const dashboardSource = readSource('app/dashboard/page.tsx');

  assert.match(routeSource, /notificationResponse\(notificationResult\)/);
  assert.doesNotMatch(routeSource, /skipNotificationInsert:\s*true/);
  assert.match(docsSource, /warning:\s*notificationWarning/);
  assert.match(appointmentSource, /warning:\s*notificationWarning/);
  assert.match(dashboardSource, /notificationResult\.success/);
});

test('push delivery logs only privacy-safe aggregate fields', () => {
  const serviceSource = readSource('lib/push-notification-service.ts');
  const webPushSource = readSource('lib/web-push.ts');
  const actionSource = readSource('app/actions.ts');

  assert.match(serviceSource, /expoAccepted:\s*result\.expo\.accepted/);
  assert.match(serviceSource, /expoRejected:\s*result\.expo\.rejected/);
  assert.match(serviceSource, /webSent:\s*result\.web\.sent/);
  assert.match(serviceSource, /webFailed:\s*result\.web\.failed/);
  assert.doesNotMatch(actionSource, /title:\s*payload\.title/);
  assert.doesNotMatch(actionSource, /body:\s*payload\.body/);
  assert.doesNotMatch(serviceSource, /logger\.[^(]+\([^\n]+userId/);
  assert.doesNotMatch(serviceSource, /logger\.[^(]+\([^\n]+(?:title|body)/);
  assert.doesNotMatch(webPushSource, /error\?\.statusCode \?\? err/);
  assert.match(webPushSource, /reason:\s*'provider_rejected'/);
});

test('resident lifecycle delivery is restricted to FC mobile and web targets', () => {
  const serviceSource = readSource('lib/push-notification-service.ts');
  const deviceQueryStart = serviceSource.indexOf(".from('device_tokens')");
  const deviceQueryEnd = serviceSource.indexOf('if (tokensError)', deviceQueryStart);
  const webQueryStart = serviceSource.indexOf(".from('web_push_subscriptions')", deviceQueryEnd);
  const webQueryEnd = serviceSource.indexOf('if (subscriptionsError)', webQueryStart);
  const deviceQuery = serviceSource.slice(deviceQueryStart, deviceQueryEnd);
  const webQuery = serviceSource.slice(webQueryStart, webQueryEnd);

  assert.match(deviceQuery, /\.eq\('resident_id', userId\)/);
  assert.match(deviceQuery, /\.eq\('role', 'fc'\)/);
  assert.match(webQuery, /\.eq\('resident_id', userId\)/);
  assert.match(webQuery, /\.eq\('role', 'fc'\)/);
  assert.doesNotMatch(deviceQuery, /\.in\('role'/);
  assert.doesNotMatch(webQuery, /\.in\('role'/);
});

test('FC inbox persistence and partial delivery accounting remain independent', () => {
  const serviceSource = readSource('lib/push-notification-service.ts');

  assert.match(serviceSource, /recipient_role:\s*'fc'/);
  assert.match(serviceSource, /delivery\.inbox\.attempted = true/);
  assert.match(serviceSource, /delivery\.inbox\.logged = true/);
  assert.match(serviceSource, /addFailure\(delivery, 'token_query_failed'\)/);
  assert.match(serviceSource, /addFailure\(delivery, 'web_subscription_query_failed'\)/);
  assert.match(serviceSource, /const result = finalizeDeliveryResult\(delivery\)/);
});

test('post-commit actions return success with a separate notification warning', () => {
  const docsSource = readSource('app/dashboard/docs/actions.ts');
  const appointmentSource = readSource('app/dashboard/appointment/actions.ts');

  assert.match(
    docsSource,
    /return \{ success: true, message, warning: notificationWarning \}/,
  );
  assert.match(
    appointmentSource,
    /return \{ success: true, message: '처리 완료', warning: notificationWarning \}/,
  );
});
