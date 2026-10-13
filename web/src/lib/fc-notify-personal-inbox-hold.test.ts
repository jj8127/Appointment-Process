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

test('personal administrator browser inbox actions bind the exact staff account scope', () => {
  for (const session of [developer, manager]) {
    const list = buildBrowserFcNotifyPayload({
      body: {
        type: 'inbox_list',
        role: 'admin',
        resident_id: session.residentDigits,
        limit: 80,
      },
      session,
    });
    assert.equal(list.ok, true);
    if (list.ok) {
      assert.equal(list.payload?.role, 'admin');
      assert.equal(list.payload?.resident_id, session.residentDigits);
      assert.equal(list.payload?.viewer_actor_role, session.role);
    }

    for (const body of [
      { type: 'inbox_unread_count' },
      { type: 'inbox_mark_all_read' },
      { type: 'inbox_get', notification_id: notificationId },
      { type: 'inbox_mark_read', notification_ids: [notificationId] },
      { type: 'inbox_dismiss', notification_ids: [notificationId] },
    ]) {
      const result = buildBrowserFcNotifyPayload({ body, session });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.payload?.viewer_actor_role, session.role);
        assert.equal(result.payload?.viewer_actor_phone, session.residentDigits);
      }
    }

    assert.deepEqual(
      buildBrowserFcNotifyPayload({
        body: { type: 'inbox_list', role: 'fc', resident_id: session.residentDigits },
        session,
      }),
      {
        ok: false,
        status: 403,
        error: 'Inbox identity does not match the verified session',
      },
    );
  }
});

test('browser unread count may narrow to Request Board while mark-all cannot forge scope', () => {
  const unread = buildBrowserFcNotifyPayload({
    body: { type: 'inbox_unread_count', only_request_board_categories: true },
    session: manager,
  });
  assert.equal(unread.ok, true);
  if (unread.ok) {
    assert.equal(unread.payload?.role, 'admin');
    assert.equal(unread.payload?.resident_id, manager.residentDigits);
    assert.equal(unread.payload?.only_request_board_categories, true);
  }

  const forged = buildBrowserFcNotifyPayload({
    body: {
      type: 'inbox_mark_all_read',
      role: 'fc',
      resident_id: manager.residentDigits,
    },
    session: manager,
  });
  assert.deepEqual(forged, {
    ok: false,
    status: 403,
    error: 'Inbox identity does not match the verified session',
  });
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

test('web callers request the personal admin inbox without merging an FC shadow inbox', () => {
  const bell = readFileSync(
    resolve(root, 'web/src/components/DashboardNotificationBell.tsx'),
    'utf8',
  );
  const messenger = readFileSync(
    resolve(root, 'web/src/app/dashboard/messenger/page.tsx'),
    'utf8',
  );

  assert.match(bell, /const isPersonalAdminInbox = role === 'manager' \|\| staffType === 'developer'/);
  assert.match(bell, /inboxRole === 'fc' \|\| isPersonalAdminInbox/);
  assert.match(bell, /type: 'inbox_unread_count'/);
  assert.match(bell, /type: 'inbox_mark_all_read'/);
  assert.match(bell, /const unreadCount = countQuery\.data \?\? 0/);
  assert.doesNotMatch(bell, /unreadIds\.length/);
  assert.doesNotMatch(bell, /markAllMutation\.mutate\(unreadIds\)/);
  assert.match(bell, /!Array\.isArray\(data\.notifications\)[\s\S]{0,80}!data\.notifications\.every\(isInboxNotificationPayload\)/);
  assert.doesNotMatch(bell, /data\.notifications \?\? \[\]/);
  assert.doesNotMatch(bell, /UUID_PATTERN\.test\(String\(item\.id/);
  assert.doesNotMatch(bell, /personalInboxHeld/);
  assert.doesNotMatch(bell, /developerFcInbox/);

  assert.match(messenger, /role === 'fc' \|\| isPersonalAdminInbox/);
  assert.doesNotMatch(messenger, /personalInboxHeld/);
  assert.match(messenger, /role === 'fc' \? 'fc' : 'admin'/);
  assert.match(messenger, /type: 'inbox_unread_count'/);
  assert.match(messenger, /only_request_board_categories: true/);
  assert.doesNotMatch(messenger, /type: 'inbox_list'/);
  assert.doesNotMatch(messenger, /notifications\.filter/);
});

test('notification inbox source rejects null successful collection reads', () => {
  const source = readFileSync(
    resolve(root, 'supabase/functions/fc-notify/index.ts'),
    'utf8',
  );
  assert.match(
    source,
    /if \(!Array\.isArray\(data\) \|\| !data\.every\(isNotificationOwnershipPageQueryRow\)\) \{\s*throw new Error\('notification_inbox_query_contract_invalid'\)/,
  );
  assert.doesNotMatch(source, /return \(data \?\? \[\]\)\.map\(\(rawRow\)/);
  assert.doesNotMatch(source, /Legacy physical-delete block/);
  assert.doesNotMatch(source, /deleted_notifications/);
});

test('legacy Request Board rows are rebound only for one unambiguous staff actor', () => {
  const migration = readFileSync(
    resolve(
      root,
      'supabase/migrations/20260808094709_canonicalize_request_board_personal_recipients_v1.sql',
    ),
    'utf8',
  );
  const receiptPolicy = readFileSync(
    resolve(root, 'supabase/functions/_shared/notification-receipt-policy.ts'),
    'utf8',
  );
  const edge = readFileSync(
    resolve(root, 'supabase/functions/fc-notify/index.ts'),
    'utf8',
  );

  assert.match(migration, /from public\.admin_accounts account[\s\S]*union all[\s\S]*from public\.manager_accounts account/);
  assert.match(migration, /having count\(distinct candidate\.actor_id\) = 1/);
  assert.match(migration, /set recipient_role = 'admin',[\s\S]*recipient_actor_id = staff\.actor_id/);
  assert.match(migration, /exists \([\s\S]*from public\.fc_profiles profile[\s\S]*profile\.id = notification\.recipient_actor_id/);

  assert.match(receiptPolicy, /if \(!viewer\.allowBroadcast\)[\s\S]*reason: 'broadcast_not_allowed'/);
  assert.match(edge, /function applyNotificationAudienceScope\([\s\S]*query\.eq\('recipient_actor_id', viewer\.actorId\)/);
  assert.match(edge, /recipientBinding !== 'canonical_person_v1'/);
});
