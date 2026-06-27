import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const webRoot = join(root, 'web', 'src');

function readWebFile(relativePath: string) {
  return readFileSync(join(webRoot, relativePath), 'utf8');
}

describe('admin web group chat wiring', () => {
  it('exposes the group chat from the messenger hub without duplicating the sidebar', () => {
    const layout = readWebFile(join('app', 'dashboard', 'layout.tsx'));
    const messengerHub = readWebFile(join('app', 'dashboard', 'messenger', 'page.tsx'));

    expect(layout).not.toContain('/dashboard/group-chat');
    expect(layout).not.toContain('가람PA 단톡방');
    expect(messengerHub).toContain('/dashboard/group-chat');
    expect(messengerHub).toContain('가람PA 단톡방');
    expect(messengerHub).toContain('로컬 개발 환경');
    expect(messengerHub).toContain('NEXT_PUBLIC_REQUEST_BOARD_URL');
    expect(messengerHub).toContain("fetch('/api/fc-notify'");
    expect(messengerHub).not.toContain("functions.invoke('fc-notify'");
  });

  it('routes group chat notifications to the admin web group chat page', () => {
    const notificationBell = readWebFile(join('components', 'DashboardNotificationBell.tsx'));

    expect(notificationBell).toContain("category === 'group_chat_message'");
    expect(notificationBell).toContain("trimmed.startsWith('/group-chat')");
    expect(notificationBell).toContain('/dashboard/group-chat');
  });

  it('proxies web group chat actions through the existing Edge Function contract', () => {
    const route = readWebFile(join('app', 'api', 'group-chat', 'route.ts'));
    const helper = readWebFile(join('lib', 'group-chat-web.ts'));

    expect(route).toContain('createWebGroupChatAppSessionToken');
    expect(route).toContain('WEB_APP_SESSION_COOKIE');
    expect(route).toContain('normalizeGroupChatProxyPayload');
    expect(route).toContain('buildGroupChatFunctionHeaders');
    expect(helper).toContain('x-app-session-token');
    expect(route).toContain('getVerifiedServerSession');
    expect(route).toContain("allowedRoles: ['admin', 'manager']");
    expect(helper).toContain('group_chat_bootstrap');
    expect(helper).toContain('group_chat_member_send_permission');
    expect(helper).toContain('group_chat_notice_clear');
    expect(helper).toContain('isAllowedGroupChatFileUrl');
    expect(helper).toContain('MAX_GROUP_CHAT_UPLOAD_BYTES');
    expect(helper).toContain('isAllowedGroupChatUploadFile');
  });

  it('supports the expected web group chat surface behavior', () => {
    const page = readWebFile(join('app', 'dashboard', 'group-chat', 'page.tsx'));

    expect(page).toContain('groupChatBootstrap');
    expect(page).toContain('groupChatSend');
    expect(page).toContain('groupChatMarkRead');
    expect(page).toContain('groupChatDeleteMessage');
    expect(page).toContain('groupChatSetNotice');
    expect(page).toContain('groupChatSetMemberSendPermission');
    expect(page).toContain('classifyGroupChatError');
    expect(page).toContain('if (!options?.silent) showGroupChatErrorNotification(error)');
    expect(page).toContain('replyTarget');
    expect(page).toContain('memberSearch');
    expect(page).toContain('chat-uploads');
    expect(page).toContain('group_chat_messages');
    expect(page).toContain('supabase.removeChannel(channel)');
  });

  it('requires a signed HttpOnly staff session for admin web server routes', () => {
    const loginRoute = readWebFile(join('app', 'api', 'auth', 'login', 'route.ts'));
    const logoutRoute = readWebFile(join('app', 'api', 'auth', 'logout', 'route.ts'));
    const serverSession = readWebFile(join('lib', 'server-session.ts'));

    expect(loginRoute).toContain('createStaffSessionValue');
    expect(loginRoute).toContain('STAFF_SESSION_COOKIE');
    expect(loginRoute).toContain('WEB_APP_SESSION_COOKIE');
    expect(logoutRoute).toContain('STAFF_SESSION_COOKIE');
    expect(logoutRoute).toContain('WEB_APP_SESSION_COOKIE');
    expect(serverSession).toContain('verifyStaffSessionValue');
    expect(serverSession).toContain('Invalid staff session');
  });
});
