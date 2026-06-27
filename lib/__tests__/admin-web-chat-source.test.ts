import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const chatPagePath = join(root, 'web', 'src', 'app', 'dashboard', 'chat', 'page.tsx');
const notificationBellPath = join(root, 'web', 'src', 'components', 'DashboardNotificationBell.tsx');
const fcNotifyRoutePath = join(root, 'web', 'src', 'app', 'api', 'fc-notify', 'route.ts');
const adminPushRoutePath = join(root, 'web', 'src', 'app', 'api', 'admin', 'push', 'route.ts');
const fcNotifyFunctionPath = join(root, 'supabase', 'functions', 'fc-notify', 'index.ts');

describe('admin web direct chat list source', () => {
  it('does not issue per-FC Supabase message queries while building the left chat list', () => {
    const page = readFileSync(chatPagePath, 'utf8');

    expect(page).toContain('buildAdminChatConversationSummaries');
    expect(page).not.toContain('for (const fc of baseTargets)');
    expect(page).not.toContain('.select(\'*\', { count: \'exact\', head: true })');
  });

  it('can open a deep-linked chat target before the full list finishes loading', () => {
    const page = readFileSync(chatPagePath, 'utf8');

    expect(page).toContain('if (!deepLinkedTargetId) return null');
    expect(page).not.toContain('if (!chatList || chatList.length === 0 || !deepLinkedTargetId) return null');
  });

  it('scopes web header notifications like direct chat: shared admin for staff, personal for developers and managers', () => {
    const notificationBell = readFileSync(notificationBellPath, 'utf8');

    expect(notificationBell).toContain("const staffPersonalInboxId = role === 'manager' || isDeveloper ? sanitize(residentId) : null");
    expect(notificationBell).toContain("const inboxResidentId = inboxRole === 'fc' ? sanitize(residentId) : staffPersonalInboxId");
    expect(notificationBell).toContain("isDeveloper ? fetchInbox('fc') : Promise.resolve(null)");
  });

  it('does not send shared admin web push to developer browser subscriptions', () => {
    const fcNotifyRoute = readFileSync(fcNotifyRoutePath, 'utf8');
    const adminPushRoute = readFileSync(adminPushRoutePath, 'utf8');

    expect(fcNotifyRoute).toContain('normalizeAdminNotificationTargetId');
    expect(fcNotifyRoute).toContain('fetchSharedAdminResidentIds');
    expect(fcNotifyRoute).toContain("account.staff_type !== 'developer'");
    expect(fcNotifyRoute).toContain('fetchAdminWebPushSubscriptions(body.target_id)');
    expect(adminPushRoute).toContain('normalizeAdminNotificationTargetId');
    expect(adminPushRoute).toContain('fetchSharedAdminResidentIds');
    expect(adminPushRoute).toContain("account.staff_type !== 'developer'");
    expect(adminPushRoute).toContain("query = query.eq('resident_id', normalizedTargetId)");
    expect(adminPushRoute).toContain("query = query.in('resident_id', sharedAdminResidentIds)");
  });

  it('keeps Edge notification inbox and mobile push fanout separated by shared admin vs personal admin targets', () => {
    const edgeFunction = readFileSync(fcNotifyFunctionPath, 'utf8');

    expect(edgeFunction).toContain('normalizeAdminNotificationTargetId');
    expect(edgeFunction).toContain('fetchSharedAdminPhones');
    expect(edgeFunction).toContain("account.staff_type !== 'developer'");
    expect(edgeFunction).toContain("query = query.eq('recipient_role', 'admin').eq('resident_id', residentId)");
    expect(edgeFunction).toContain("deleteQuery = deleteQuery.eq('recipient_role', 'admin').eq('resident_id', residentId)");
    expect(edgeFunction).toContain(".eq('role', 'admin')");
    expect(edgeFunction).toContain(".in('resident_id', sharedAdminPhones)");
    expect(edgeFunction).toContain('notifyAdminWebPush(pushTitle, message, url, target_id || null)');
  });
});
