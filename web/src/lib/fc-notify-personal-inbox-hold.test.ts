import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');

const policyFilename = resolve(root, 'web/src/lib/fc-notify-proxy-policy.ts');
const policySource = readFileSync(policyFilename, 'utf8');
const policyOutput = ts.transpileModule(policySource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: policyFilename,
}).outputText;
const policyModule = { exports: {} as Record<string, unknown> };
const policyRequire = (specifier: string) => {
  if (specifier === './sensitive-text') {
    return {
      containsSensitiveText: () => false,
      redactSensitiveText: (value: string) => value,
    };
  }
  if (specifier === './notification-target') {
    return {
      parseNotificationTargetV1: () => null,
      parseRequestBoardTargetForFc: () => null,
    };
  }
  if (specifier === './staff-identity') {
    return { getWebStaffSenderName: () => 'staff' };
  }
  return require(specifier);
};
new Function('exports', 'require', 'module', '__filename', '__dirname', policyOutput)(
  policyModule.exports,
  policyRequire,
  policyModule,
  policyFilename,
  dirname(policyFilename),
);

const buildBrowserFcNotifyPayload = policyModule.exports.buildBrowserFcNotifyPayload as (input: {
  body: unknown;
  session: {
    role: 'admin' | 'manager' | 'fc';
    residentDigits: string;
    displayName: string;
    staffType: 'admin' | 'developer' | null;
  };
}) => {
  ok: boolean;
  status?: number;
  error?: string;
  payload?: Record<string, unknown>;
};

const notificationId = '00000000-0000-4000-8000-000000000001';
const developer = {
  role: 'admin' as const,
  residentDigits: '01011112222',
  displayName: 'developer',
  staffType: 'developer' as const,
};
const manager = {
  role: 'manager' as const,
  residentDigits: '01033334444',
  displayName: 'manager',
  staffType: null,
};

test('personal administrator browser inbox actions fail closed before Edge proxying', () => {
  for (const session of [developer, manager]) {
    for (const body of [
      { type: 'inbox_list', role: 'admin', resident_id: session.residentDigits, limit: 80 },
      { type: 'inbox_get', notification_id: notificationId },
      { type: 'inbox_mark_read', notification_ids: [notificationId] },
      { type: 'inbox_dismiss', notification_ids: [notificationId] },
    ]) {
      assert.deepEqual(
        buildBrowserFcNotifyPayload({ body, session }),
        {
          ok: false,
          status: 403,
          error: 'Personal administrator inbox is unavailable until its Edge scope is upgraded',
        },
      );
    }
  }
});

test('regular administrator and FC inbox reads keep their signed scopes', () => {
  const adminResult = buildBrowserFcNotifyPayload({
    body: { type: 'inbox_list', role: 'admin', resident_id: null, limit: 80 },
    session: {
      role: 'admin',
      residentDigits: '01077778888',
      displayName: 'administrator',
      staffType: 'admin',
    },
  });
  assert.equal(adminResult.ok, true);
  if (adminResult.ok) {
    assert.equal(adminResult.payload?.role, 'admin');
    assert.equal(adminResult.payload?.resident_id, null);
  }

  const fcResult = buildBrowserFcNotifyPayload({
    body: { type: 'inbox_list', role: 'fc', resident_id: '01099990000', limit: 80 },
    session: {
      role: 'fc',
      residentDigits: '01099990000',
      displayName: 'FC',
      staffType: null,
    },
  });
  assert.equal(fcResult.ok, true);
  if (fcResult.ok) {
    assert.equal(fcResult.payload?.role, 'fc');
    assert.equal(fcResult.payload?.resident_id, '01099990000');
  }
});

test('web callers do not emit held personal inbox requests', () => {
  const bell = readFileSync(
    resolve(root, 'web/src/components/DashboardNotificationBell.tsx'),
    'utf8',
  );
  const messenger = readFileSync(
    resolve(root, 'web/src/app/dashboard/messenger/page.tsx'),
    'utf8',
  );

  assert.match(bell, /const personalInboxHeld = role === 'manager' \|\| staffType === 'developer'/);
  assert.match(bell, /enabled: !personalInboxHeld/);
  assert.match(bell, /if \(personalInboxHeld\) return \[\]/);
  assert.match(bell, /disabled=\{personalInboxHeld\}/);
  assert.doesNotMatch(bell, /developerFcInbox|Promise\.all/);

  assert.match(messenger, /if \(personalInboxHeld\) \{/);
  assert.match(messenger, /requestBoardUnread: 0/);
  assert.match(messenger, /role === 'fc' \? 'fc' : 'admin'/);
});
