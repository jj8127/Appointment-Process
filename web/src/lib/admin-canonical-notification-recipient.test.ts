import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSource = readFileSync(
  path.join(sourceRoot, 'app/api/admin/fc/route.ts'),
  'utf8',
);
const serverActionSource = readFileSync(
  path.join(sourceRoot, 'app/actions.ts'),
  'utf8',
);

test('FC notifications resolve the current canonical profile phone on the server', () => {
  assert.match(
    routeSource,
    /async function resolveCanonicalFcNotificationRecipient[\s\S]*?\.from\('fc_profiles'\)[\s\S]*?\.select\('phone'\)[\s\S]*?\.eq\('id', fcId\)/,
  );
  assert.match(routeSource, /!\/\^010\\d\{8\}\$\/\.test\(phoneDigits\)/);
  assert.match(
    routeSource,
    /async function sendPushNotificationToCanonicalFc[\s\S]*?resolveCanonicalFcNotificationRecipient\(fcId\)/,
  );
  assert.match(
    routeSource,
    /async function queuePushNotificationToCanonicalFc[\s\S]*?resolveCanonicalFcNotificationRecipient\(fcId\)/,
  );
  assert.match(routeSource, /return sendPushNotificationToResident\('', payload\)/);
  assert.match(routeSource, /return sendPushNotificationToResident\(phoneDigits, payload\)/);
  assert.doesNotMatch(routeSource, /return sendPushNotificationToResident\(phone, payload\)/);

  const canonicalCalls = routeSource.match(/await sendPushNotificationToCanonicalFc\(fcId,/g) ?? [];
  assert.equal(canonicalCalls.length, 5);

  const queuedCanonicalCalls =
    routeSource.match(/await queuePushNotificationToCanonicalFc\(fcId,/g) ?? [];
  assert.equal(queuedCanonicalCalls.length, 3);

  const directCalls = routeSource.match(/sendPushNotificationToResident\(/g) ?? [];
  assert.equal(directCalls.length, 2);
});

test('notification actions do not read a client supplied phone target', () => {
  for (const action of [
    'updateProfile',
    'updateStatus',
    'updateDocsRequest',
    'updateDocStatus',
    'sendReminder',
  ]) {
    const actionStart = routeSource.indexOf(`if (action === '${action}')`);
    assert.notEqual(actionStart, -1);
    const nextAction = routeSource.indexOf("if (action === '", actionStart + 1);
    const actionSource = routeSource.slice(
      actionStart,
      nextAction === -1 ? routeSource.length : nextAction,
    );
    assert.doesNotMatch(actionSource, /\{[^}]*\bphone\b[^}]*\}\s*=\s*payload/);
  }
});

test('sendReminder requires a scoped FC identifier instead of a phone number', () => {
  const reminderStart = routeSource.indexOf("if (action === 'sendReminder')");
  const nextAction = routeSource.indexOf("if (action === '", reminderStart + 1);
  const reminderSource = routeSource.slice(reminderStart, nextAction);

  assert.match(reminderSource, /if \(!fcId \|\| !title \|\| !body\)/);
  assert.match(reminderSource, /requireFcProfileScope\(sessionCheck\.session, fcId\)/);
  assert.match(reminderSource, /sendPushNotificationToCanonicalFc\(fcId,/);
  assert.doesNotMatch(reminderSource, /phone\??:/);
});

test('temporary ID notification lookup runs after the profile update', () => {
  const updateProfileStart = routeSource.indexOf("if (action === 'updateProfile')");
  const updateStatusStart = routeSource.indexOf("if (action === 'updateStatus')");
  const profileActionSource = routeSource.slice(updateProfileStart, updateStatusStart);

  assert.ok(profileActionSource.indexOf('.update(updateData)') >= 0);
  assert.ok(
    profileActionSource.indexOf('.update(updateData)') <
      profileActionSource.indexOf('sendPushNotificationToCanonicalFc(fcId,'),
  );
});

test('admin web callers no longer include phone as a notification target', () => {
  const dashboardSource = readFileSync(
    path.join(sourceRoot, 'app/dashboard/page.tsx'),
    'utf8',
  );
  const docsSource = readFileSync(
    path.join(sourceRoot, 'app/dashboard/docs/page.tsx'),
    'utf8',
  );
  const profileSource = readFileSync(
    path.join(sourceRoot, 'app/dashboard/profile/[id]/page.tsx'),
    'utf8',
  );

  assert.doesNotMatch(dashboardSource, /action: 'updateProfile',[\s\S]{0,220}?phone:/);
  assert.doesNotMatch(dashboardSource, /action: 'updateDocsRequest',[\s\S]{0,320}?phone:/);
  assert.doesNotMatch(dashboardSource, /action: 'updateStatus',[\s\S]{0,320}?phone:/);
  assert.doesNotMatch(docsSource, /action: 'updateDocStatus',[\s\S]{0,320}?phone:/);
  assert.doesNotMatch(profileSource, /action: 'updateProfile',[\s\S]{0,260}?phone:/);
  assert.match(dashboardSource, /sendPushNotificationForFc\(selectedFc\.id,/);
  assert.doesNotMatch(dashboardSource, /sendPushNotification\(selectedFc\.phone,/);
});

test('standalone reminder action resolves the canonical FC phone after session verification', () => {
  const actionStart = serverActionSource.indexOf('export async function sendPushNotificationForFc');
  assert.notEqual(actionStart, -1);
  const actionSource = serverActionSource.slice(actionStart);

  assert.ok(actionSource.indexOf('await getVerifiedAdminSession()') < actionSource.indexOf(".from('fc_profiles')"));
  assert.match(actionSource, /\.eq\('id', fcId\)/);
  assert.match(actionSource, /parseFcNotificationPhone\(profile\.phone\)/);
  assert.match(actionSource, /sendPushNotificationToResident\(phoneResult\.value, payload\)/);
});
