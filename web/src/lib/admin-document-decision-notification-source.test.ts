import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath: string) =>
  readFileSync(path.join(sourceRoot, relativePath), 'utf8');

test('every document approval or rejection queues one durable FC notification', () => {
  const routeSource = readSource('app/api/admin/fc/route.ts');
  const decisionStart = routeSource.indexOf("if (action === 'updateDocStatus')");
  const decisionEnd = routeSource.indexOf("if (action === 'deleteDocFile')", decisionStart);
  const decisionSource = routeSource.slice(decisionStart, decisionEnd);

  assert.match(
    decisionSource,
    /normalizedStatus === 'rejected'[\s\S]*?queuePushNotificationToCanonicalFc/,
  );
  assert.match(
    decisionSource,
    /normalizedStatus === 'approved' && allApproved[\s\S]*?서류 검토 완료[\s\S]*?queuePushNotificationToCanonicalFc/,
  );
  assert.match(
    decisionSource,
    /else if \(normalizedStatus === 'approved'\)[\s\S]*?서류 승인 안내[\s\S]*?queuePushNotificationToCanonicalFc/,
  );
  assert.equal(
    (decisionSource.match(/queuePushNotificationToCanonicalFc\(fcId,/g) ?? []).length,
    3,
  );
});

test('document decisions persist the inbox before deferring provider delivery', () => {
  const routeSource = readSource('app/api/admin/fc/route.ts');
  const queueStart = routeSource.indexOf('async function queuePushNotificationToCanonicalFc');
  const queueEnd = routeSource.indexOf('async function getValidatedCookieSession', queueStart);
  const queueSource = routeSource.slice(queueStart, queueEnd);

  assert.ok(queueStart >= 0);
  assert.match(queueSource, /await persistNotificationToResident\(phoneDigits, payload\)/);
  assert.match(
    queueSource,
    /if \(persistence\.success\)[\s\S]*?after\(async \(\) => \{[\s\S]*?sendPushNotificationToResidentDevices\(phoneDigits, payload\)/,
  );
});

test('provider-only delivery cannot insert a duplicate inbox notification', () => {
  const serviceSource = readSource('lib/push-notification-service.ts');
  const providerStart = serviceSource.indexOf('export async function sendPushNotificationToResidentDevices');
  const providerEnd = serviceSource.indexOf('export async function sendPushNotificationToResident(', providerStart);
  const providerSource = serviceSource.slice(providerStart, providerEnd);

  assert.ok(providerStart >= 0);
  assert.match(providerSource, /deliverToRegisteredTargets\(userId, payload, delivery\)/);
  assert.doesNotMatch(providerSource, /persistNotification\(/);
  assert.doesNotMatch(providerSource, /\.from\('notifications'\)/);
});
