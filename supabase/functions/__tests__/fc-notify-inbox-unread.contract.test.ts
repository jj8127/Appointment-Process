import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('fc-notify inbox unread count contract', () => {
  const source = readFileSync(join(process.cwd(), 'supabase/functions/fc-notify/index.ts'), 'utf8');

  it('counts every visible inbox source requested by the mobile badge', () => {
    expect(source).toContain('include_notices?: boolean');
    expect(source).toContain('notice_since?: string | null');
    expect(source).toContain('only_request_board_categories?: boolean');
    expect(source).toContain('body.include_notices === true');
    expect(source).toContain('body.only_request_board_categories === true');
    expect(source).toContain('fetchVisibleNotificationOwnershipRows({');
    expect(source).toContain('collectAllNotificationOwnershipRows(');
    expect(source).toContain('collectSupabaseRows<Record<string, unknown>>({');
    expect(source).toContain('.range(from, to)');
    expect(source).toContain('countUnifiedNoticesAfter(noticeSinceIso)');
    expect(source).toContain(".select('id', { count: 'exact', head: true })");
    expect(source).not.toContain('fetchUnifiedNotices(200)');
    expect(source).toContain('const noticeSinceDate = body.notice_since');
    expect(source).toContain('const notificationCount = visibleIds.filter');
    expect(source).toContain('return ok({ ok: true, count: notificationCount + noticeCount })');
  });

  it('batches receipt reads and mark-all writes beyond one 200-row page', () => {
    expect(source).toContain('const NOTIFICATION_QUERY_PAGE_SIZE = 200');
    expect(source).toContain('const NOTIFICATION_RECEIPT_BATCH_SIZE = 100');
    expect(source).toMatch(/for \(\s*let offset = 0;\s*offset < uniqueIds\.length;\s*offset \+= NOTIFICATION_RECEIPT_BATCH_SIZE\s*\)/);
    expect(source).toMatch(/for \(\s*let offset = 0;\s*offset < receiptRows\.length;\s*offset \+= NOTIFICATION_RECEIPT_BATCH_SIZE\s*\)/);
    expect(source).toContain("if (body.type === 'inbox_mark_all_read')");
    expect(source).toContain('matched: nonDismissedIds.length');
    expect(source).toContain('updated: unreadIds.length');
  });

  it('pages past dismissed notification receipts before applying the inbox limit', () => {
    expect(source).toContain('collectVisibleNotificationInboxRows<NotificationInboxRow>({');
    expect(source).toContain('pageSize: 200');
    expect(source).toContain('.range(offset, offset + pageSize - 1)');
    expect(source).toContain('.filter((item) => item.dismissed_at === null)');
  });

  it('provides independent stable cursors for notifications and merged notices', () => {
    expect(source).toContain('parseFcNotifyInboxCursor(body.notification_cursor)');
    expect(source).toContain('parseFcNotifyInboxCursor(body.notice_cursor, true)');
    expect(source).toContain('limit: limit + 1');
    expect(source).toMatch(/applyNotificationInboxCursor\(\s*buildQuery\(/);
    expect(source).toContain('dedupedNotifications.sort(compareInboxRowsDescending)');
    expect(source).toContain('fetchUnifiedNoticePage(limit, noticeCursor)');
    expect(source).toContain('fetchNoticesWithOptionalAttachments(sourceLimit, cursor)');
    expect(source).toContain('fetchBoardNoticesWithAttachments(sourceLimit, cursor)');
    expect(source).toContain('LEGACY_NOTICE_ID_AFTER_BOARD_PREFIX_BOUNDARY');
    expect(source).toContain("query.lte('created_at', cursor.created_at)");
    expect(source).toContain("query.lt('created_at', cursor.created_at)");
    expect(source).toContain('notification_has_more: notificationPage.hasMore');
    expect(source).toContain('notification_next_cursor: notificationPage.nextCursor');
    expect(source).toContain('notice_has_more: noticePage.hasMore');
    expect(source).toContain('notice_next_cursor: noticePage.nextCursor');
  });

  it('uses one actor audience scope for list and unread while denying personal-admin broadcasts', () => {
    expect(source).toContain('function applyNotificationAudienceScope(');
    expect(source).toContain("allowBroadcast: input.inboxRole === 'fc' || !input.residentId");
    expect(source.match(/applyNotificationAudienceScope\(/g)).toHaveLength(3);
    expect(source).toContain(": query.eq('recipient_actor_id', viewer.actorId)");
  });

  it('supports a staged rollout before requiring the versioned canonical-person binding', () => {
    expect(source).toContain("recipient_binding?: 'canonical_person_v1'");
    expect(source).toContain("getEnv('REQUIRE_CANONICAL_REQUEST_BOARD_RECIPIENT_BINDING') === 'true'");
    expect(source).toContain('recipientBinding === undefined');
    expect(source).toContain('requireCanonicalRequestBoardRecipientBinding');
    expect(source).toContain("recipientBinding !== 'canonical_person_v1'");
    expect(source).toContain('Canonical Request Board recipient binding is required');
    expect(source).toContain('Unsupported Request Board recipient binding');
  });

  it('reuses the shared parsers and fails closed on malformed rows and counts', () => {
    expect(source).toContain("from '../_shared/query-result-contract.ts'");
    expect(source).toMatch(/parseQueryRows\(\s*withAttachments\.data,/);
    expect(source).toContain('isNoticeQueryRow(value, true)');
    expect(source).toContain('parseQueryRows(posts, isBoardNoticePostQueryRow)');
    expect(source).toContain('collectSupabaseRows<BoardAttachmentRow>({');
    expect(source).toContain('isRow: isBoardAttachmentQueryRow');
    expect(source).toContain('const exactCount = parseQueryCount(count)');
    expect(source).toContain('const exactLegacyCount = parseQueryCount(legacyResult.count)');
    expect(source).not.toContain('function parseQueryRows<T>');
    expect(source).not.toContain('function isExactCount(');
    expect(source).not.toContain('const safeCount = typeof count === \'number\' ? count : 0');
  });
});
