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
  assert.match(dashboardSource, /notificationResult\.inbox/);
  assert.match(dashboardSource, /notificationResult\.failures/);
  assert.doesNotMatch(dashboardSource, /if \(!notificationResult\.success\)/);
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
  assert.match(webPushSource, /mode:\s*'in_app_only'/);
  assert.doesNotMatch(webPushSource, /sendNotification|setVapidDetails|provider_rejected/);
});

test('resident lifecycle delivery is restricted to FC mobile targets', () => {
  const serviceSource = readSource('lib/push-notification-service.ts');
  const deviceQueryStart = serviceSource.indexOf(".from('device_tokens')");
  const deviceQueryEnd = serviceSource.indexOf('if (tokensError)', deviceQueryStart);
  const deviceQuery = serviceSource.slice(deviceQueryStart, deviceQueryEnd);

  assert.match(deviceQuery, /\.eq\('resident_id', userId\)/);
  assert.match(deviceQuery, /\.eq\('role', 'fc'\)/);
  assert.doesNotMatch(deviceQuery, /\.in\('role'/);
  assert.doesNotMatch(serviceSource, /web_push_subscriptions|sendWebPush/);
});

test('FC inbox persistence and partial delivery accounting remain independent', () => {
  const serviceSource = readSource('lib/push-notification-service.ts');

  assert.match(serviceSource, /recipient_role:\s*'fc'/);
  assert.match(serviceSource, /recipient_actor_id:\s*recipientActorId/);
  assert.match(serviceSource, /\.eq\('id', recipientActorId\)/);
  assert.match(serviceSource, /String\(data\.phone \?\? ''\)\.replace\(\/\\D\/g, ''\) === userId/);
  assert.match(serviceSource, /addFailure\(delivery, 'recipient_mismatch'\)/);
  assert.match(serviceSource, /delivery\.inbox\.attempted = true/);
  assert.match(serviceSource, /delivery\.inbox\.logged = true/);
  assert.match(serviceSource, /addFailure\(delivery, 'token_query_failed'\)/);
  assert.doesNotMatch(serviceSource, /addFailure\(delivery, 'web_subscription_query_failed'\)/);
  assert.match(serviceSource, /const result = finalizeDeliveryResult\(delivery\)/);
  assert.match(
    serviceSource,
    /if \(delivery\.inbox\.logged && notificationId\) \{[\s\S]*?deliverToRegisteredTargets/,
  );
  assert.match(
    serviceSource,
    /if \(!notificationId\) \{[\s\S]*?addFailure\(delivery, 'inbox_write_failed'\)[\s\S]*?return result/,
  );
});

test('notice broadcasts fail closed when inbox persistence does not return a notification id', () => {
  const noticeSource = readSource('app/dashboard/notifications/actions.ts');
  const missingIdGuard = noticeSource.indexOf('if (!notificationId)');
  const tokenQuery = noticeSource.indexOf(".from('device_tokens')", missingIdGuard);
  const guardSource = noticeSource.slice(missingIdGuard, tokenQuery);

  assert.ok(missingIdGuard >= 0);
  assert.match(guardSource, /provider delivery skipped because notification persistence failed/);
  assert.match(guardSource, /notification_persistence_and_delivery_incomplete/);
  assert.match(guardSource, /return \{/);
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
