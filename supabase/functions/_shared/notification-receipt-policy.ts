export type NotificationInboxRole = 'admin' | 'fc';

export type NotificationReceiptViewer = {
  actorId: string;
  inboxRole: NotificationInboxRole;
  residentId: string | null;
  allowBroadcast: boolean;
  includeRequestBoardFc: boolean;
};

export type NotificationOwnershipRow = {
  id: string;
  recipient_actor_id: string | null;
  recipient_role: string | null;
  resident_id: string | null;
  category: string | null;
};

export type NotificationOwnershipDecision =
  | { authorized: true; audience: 'broadcast' | 'targeted' }
  | {
      authorized: false;
      reason:
        | 'role_scope_mismatch'
        | 'broadcast_not_allowed'
        | 'recipient_actor_mismatch'
        | 'target_actor_missing';
    };

export type NotificationReceiptState =
  | 'read'
  | 'already_read'
  | 'dismissed'
  | 'already_dismissed';

const REQUEST_BOARD_CATEGORY_PREFIX = 'request_board_';

function isPrimaryAudience(
  row: NotificationOwnershipRow,
  viewer: NotificationReceiptViewer,
): boolean {
  return row.recipient_role === viewer.inboxRole;
}

function isRequestBoardFcAudience(
  row: NotificationOwnershipRow,
  viewer: NotificationReceiptViewer,
): boolean {
  return viewer.includeRequestBoardFc
    && viewer.inboxRole === 'admin'
    && Boolean(viewer.residentId)
    && row.recipient_role === 'fc'
    && String(row.category ?? '').startsWith(REQUEST_BOARD_CATEGORY_PREFIX);
}

export function authorizeNotificationReceipt(
  row: NotificationOwnershipRow,
  viewer: NotificationReceiptViewer,
): NotificationOwnershipDecision {
  const inAudience = isPrimaryAudience(row, viewer)
    || isRequestBoardFcAudience(row, viewer);
  if (!inAudience) {
    return { authorized: false, reason: 'role_scope_mismatch' };
  }

  const isTrueBroadcast =
    row.resident_id === null
    && row.recipient_actor_id === null;
  if (isTrueBroadcast) {
    if (!viewer.allowBroadcast) {
      return { authorized: false, reason: 'broadcast_not_allowed' };
    }
    return { authorized: true, audience: 'broadcast' };
  }

  if (!row.recipient_actor_id) {
    return { authorized: false, reason: 'target_actor_missing' };
  }
  if (row.recipient_actor_id !== viewer.actorId) {
    return { authorized: false, reason: 'recipient_actor_mismatch' };
  }
  return { authorized: true, audience: 'targeted' };
}

export function authorizeNotificationReceiptSet(
  requestedIds: string[],
  rows: NotificationOwnershipRow[],
  viewer: NotificationReceiptViewer,
):
  | { authorized: true; rows: NotificationOwnershipRow[] }
  | { authorized: false; status: 403 | 404; reason: 'missing' | 'denied' } {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const orderedRows: NotificationOwnershipRow[] = [];
  for (const notificationId of requestedIds) {
    const row = rowById.get(notificationId);
    if (!row) return { authorized: false, status: 404, reason: 'missing' };
    if (!authorizeNotificationReceipt(row, viewer).authorized) {
      return { authorized: false, status: 403, reason: 'denied' };
    }
    orderedRows.push(row);
  }
  return { authorized: true, rows: orderedRows };
}

export function classifyNotificationReceiptState(input: {
  action: 'mark_read' | 'dismiss';
  readAt: string | null;
  dismissedAt: string | null;
}): { changed: boolean; state: NotificationReceiptState } {
  if (input.action === 'mark_read') {
    return input.readAt
      ? { changed: false, state: 'already_read' }
      : { changed: true, state: 'read' };
  }

  return input.dismissedAt
    ? { changed: false, state: 'already_dismissed' }
    : { changed: true, state: 'dismissed' };
}
