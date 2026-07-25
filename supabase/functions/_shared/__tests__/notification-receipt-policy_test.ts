import {
  authorizeNotificationReceipt,
  authorizeNotificationReceiptSet,
  classifyNotificationReceiptState,
  type NotificationOwnershipRow,
  type NotificationReceiptViewer,
} from '../notification-receipt-policy.ts';

const ACTOR_A = '11111111-1111-4111-8111-111111111111';
const ACTOR_B = '22222222-2222-4222-8222-222222222222';

const fcViewer: NotificationReceiptViewer = {
  actorId: ACTOR_A,
  inboxRole: 'fc',
  residentId: '01011112222',
  includeRequestBoardFc: false,
};

function row(
  overrides: Partial<NotificationOwnershipRow> = {},
): NotificationOwnershipRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    recipient_actor_id: ACTOR_A,
    recipient_role: 'fc',
    resident_id: '01011112222',
    category: 'app_event',
    ...overrides,
  };
}

Deno.test('targeted notification requires the exact immutable recipient actor', () => {
  const allowed = authorizeNotificationReceipt(row(), fcViewer);
  const afterPhoneChange = authorizeNotificationReceipt(
    row({ resident_id: '01099998888' }),
    fcViewer,
  );
  const foreign = authorizeNotificationReceipt(
    row({ recipient_actor_id: ACTOR_B }),
    fcViewer,
  );
  const unresolvedLegacy = authorizeNotificationReceipt(
    row({ recipient_actor_id: null }),
    fcViewer,
  );

  if (!allowed.authorized || allowed.audience !== 'targeted') {
    throw new Error('exact targeted actor should be authorized');
  }
  if (!afterPhoneChange.authorized || afterPhoneChange.audience !== 'targeted') {
    throw new Error('immutable actor ownership must survive a phone change');
  }
  if (foreign.authorized || foreign.reason !== 'recipient_actor_mismatch') {
    throw new Error('foreign targeted actor must be denied');
  }
  if (
    unresolvedLegacy.authorized
    || unresolvedLegacy.reason !== 'target_actor_missing'
  ) {
    throw new Error('unbound legacy target must fail closed');
  }
});

Deno.test('true broadcast allows a second viewer in the intended role', () => {
  const broadcast = row({
    recipient_actor_id: null,
    resident_id: null,
  });
  const first = authorizeNotificationReceipt(broadcast, fcViewer);
  const second = authorizeNotificationReceipt(broadcast, {
    ...fcViewer,
    actorId: ACTOR_B,
    residentId: '01033334444',
  });
  const wrongRole = authorizeNotificationReceipt(broadcast, {
    ...fcViewer,
    actorId: ACTOR_B,
    inboxRole: 'admin',
    residentId: null,
  });

  if (!first.authorized || first.audience !== 'broadcast') {
    throw new Error('first intended viewer should be authorized');
  }
  if (!second.authorized || second.audience !== 'broadcast') {
    throw new Error('second intended viewer should receive an independent receipt');
  }
  if (wrongRole.authorized || wrongRole.reason !== 'role_scope_mismatch') {
    throw new Error('broadcast must remain scoped to its intended role');
  }
});

Deno.test('request-board FC fallback still requires exact actor ownership', () => {
  const designerViewer: NotificationReceiptViewer = {
    actorId: ACTOR_A,
    inboxRole: 'admin',
    residentId: '01011112222',
    includeRequestBoardFc: true,
  };
  const requestBoardRow = row({ category: 'request_board_message' });

  if (!authorizeNotificationReceipt(requestBoardRow, designerViewer).authorized) {
    throw new Error('exact request-board fallback should be authorized');
  }
  const mismatch = authorizeNotificationReceipt(
    { ...requestBoardRow, recipient_actor_id: ACTOR_B },
    designerViewer,
  );
  if (mismatch.authorized || mismatch.reason !== 'recipient_actor_mismatch') {
    throw new Error('request-board fallback must not weaken actor ownership');
  }
});

Deno.test('receipt set authorization distinguishes missing and foreign rows before writes', () => {
  const expectedId = row().id;
  const missing = authorizeNotificationReceiptSet(
    [expectedId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
    [row()],
    fcViewer,
  );
  const foreign = authorizeNotificationReceiptSet(
    [expectedId],
    [row({ recipient_actor_id: ACTOR_B })],
    fcViewer,
  );
  const allowed = authorizeNotificationReceiptSet(
    [expectedId],
    [row()],
    fcViewer,
  );

  if (missing.authorized || missing.status !== 404 || missing.reason !== 'missing') {
    throw new Error('missing notification must return 404');
  }
  if (foreign.authorized || foreign.status !== 403 || foreign.reason !== 'denied') {
    throw new Error('foreign notification must return 403');
  }
  if (!allowed.authorized || allowed.rows.length !== 1) {
    throw new Error('exact set should be authorized');
  }
});

Deno.test('read and dismiss states distinguish first mutation from idempotent replay', () => {
  const firstRead = classifyNotificationReceiptState({
    action: 'mark_read',
    readAt: null,
    dismissedAt: null,
  });
  const alreadyRead = classifyNotificationReceiptState({
    action: 'mark_read',
    readAt: '2026-07-25T00:00:00.000Z',
    dismissedAt: null,
  });
  const firstDismiss = classifyNotificationReceiptState({
    action: 'dismiss',
    readAt: null,
    dismissedAt: null,
  });
  const alreadyDismissed = classifyNotificationReceiptState({
    action: 'dismiss',
    readAt: '2026-07-25T00:00:00.000Z',
    dismissedAt: '2026-07-25T00:00:00.000Z',
  });

  if (!firstRead.changed || firstRead.state !== 'read') throw new Error('first read');
  if (alreadyRead.changed || alreadyRead.state !== 'already_read') {
    throw new Error('already read');
  }
  if (!firstDismiss.changed || firstDismiss.state !== 'dismissed') {
    throw new Error('first dismiss');
  }
  if (alreadyDismissed.changed || alreadyDismissed.state !== 'already_dismissed') {
    throw new Error('already dismissed');
  }
});
