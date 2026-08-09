import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('fc-notify inbox unread count contract', () => {
  const source = readFileSync(join(process.cwd(), 'supabase/functions/fc-notify/index.ts'), 'utf8');

  it('counts the same visible inbox sources requested by the mobile badge', () => {
    expect(source).toContain('include_notices?: boolean');
    expect(source).toContain('notice_since?: string | null');
    expect(source).toContain('only_request_board_categories?: boolean');
    expect(source).toContain('body.include_notices === true');
    expect(source).toContain('body.only_request_board_categories === true');
    expect(source).toContain("countQuery = countQuery.ilike('category', `${REQUEST_BOARD_CATEGORY_PREFIX}%`)");
    expect(source).toContain('const notices = await fetchUnifiedNotices(200)');
    expect(source).toContain('const noticeSinceDate = body.notice_since');
    expect(source).toContain('const sinceTime = new Date(noticeSinceIso).getTime()');
    expect(source).toContain('const notificationCount = visibleIds.filter');
    expect(source).toContain('return ok({ ok: true, count: notificationCount + noticeCount })');
  });

  it('pages past dismissed notification receipts before applying the inbox limit', () => {
    expect(source).toContain('collectVisibleNotificationInboxRows<Record<string, any>>({');
    expect(source).toContain('pageSize: 200');
    expect(source).toContain('.range(offset, offset + pageSize - 1)');
    expect(source).toContain('.filter((item) => item.dismissed_at === null)');
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
});
