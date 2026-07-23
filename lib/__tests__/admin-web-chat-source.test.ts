import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const chatPagePath = join(root, 'web', 'src', 'app', 'dashboard', 'chat', 'page.tsx');
const legacyChatPagePath = join(root, 'web', 'src', 'app', 'chat', 'page.tsx');
const chatListRoutePath = join(root, 'web', 'src', 'app', 'api', 'admin', 'chat-list', 'route.ts');
const notificationBellPath = join(root, 'web', 'src', 'components', 'DashboardNotificationBell.tsx');
const fcNotifyRoutePath = join(root, 'web', 'src', 'app', 'api', 'fc-notify', 'route.ts');
const adminPushRoutePath = join(root, 'web', 'src', 'app', 'api', 'admin', 'push', 'route.ts');
const fcNotifyFunctionPath = join(root, 'supabase', 'functions', 'fc-notify', 'index.ts');

describe('admin web direct chat list source', () => {
  it('keeps reminder notification failure visible because delivery is the primary action', () => {
    const dashboardSource = readFileSync(
      join(root, 'web', 'src', 'app', 'dashboard', 'page.tsx'),
      'utf8',
    );

    expect(dashboardSource).toContain('if (!notificationResult.success)');
    expect(dashboardSource).toContain("title: '전송 실패'");
    expect(dashboardSource).not.toContain("title: '전달 확인 필요'");
  });

  it('does not issue per-FC Supabase message queries while building the left chat list', () => {
    const page = readFileSync(chatPagePath, 'utf8');
    const route = readFileSync(chatListRoutePath, 'utf8');

    expect(route).toContain('buildAdminChatConversationSummaries');
    expect(page).not.toContain('for (const fc of baseTargets)');
    expect(route).not.toContain('for (const fc of baseTargets)');
    expect(page).not.toContain('.select(\'*\', { count: \'exact\', head: true })');
    expect(route).not.toContain('.select(\'*\', { count: \'exact\', head: true })');
  });

  it('loads the admin web chat list through the lightweight chat-list route instead of the full dashboard list', () => {
    const page = readFileSync(chatPagePath, 'utf8');
    const route = readFileSync(chatListRoutePath, 'utf8');

    expect(page).toContain("fetch('/api/admin/chat-list'");
    expect(page).not.toContain("fetch('/api/admin/list'");
    expect(page).toContain('CHAT_LIST_REFETCH_INTERVAL_MS');
    expect(page).not.toContain('refetchInterval: 10000');
    expect(route).toContain('RECENT_CHAT_SUMMARY_LIMIT');
    expect(route).toContain('.limit(RECENT_CHAT_SUMMARY_LIMIT)');
    expect(route).toContain(".eq('receiver_id', myChatId)");
    expect(route).toContain(".eq('is_read', false)");
    expect(route).toContain('mergeAdminChatSummaryRows');
  });

  it('does not refetch the left chat list for unrelated message table changes', () => {
    const page = readFileSync(chatPagePath, 'utf8');

    expect(page).toContain('const source = payload.eventType === \'DELETE\'');
    expect(page).toContain('senderId !== myChatId && receiverId !== myChatId');
    expect(page).toContain('return;');
    expect(page).toContain('ROOM_POLL_INTERVAL_MS = 15000');
  });

  it('keeps admin direct message sends optimistic while confirming post-commit mobile notifications', () => {
    const page = readFileSync(chatPagePath, 'utf8');
    const sendStart = page.indexOf('const handleSendMessage');
    const sendEnd = page.indexOf('const handleKeyDown', sendStart);
    const sendSource = page.slice(sendStart, sendEnd);

    expect(page).toContain('const MESSAGE_SELECT_COLUMNS');
    expect(page).toContain('.select(MESSAGE_SELECT_COLUMNS)');
    expect(page).not.toContain(".select('*')");
    expect(sendSource).toContain("setInputText('');");
    expect(sendSource).toContain('await sendFcMessageNotification({');
    expect(sendSource).toContain("logger.warn('[chat] message notification unconfirmed'");
    expect(sendSource).not.toContain('메시지는 저장됐지만 가람in 푸시 알림 전달을 확인하지 못했습니다.');
    expect(sendSource.indexOf('if (error) throw error;')).toBeLessThan(
      sendSource.indexOf('await sendFcMessageNotification({'),
    );
    expect(sendSource).not.toContain("await supabase.from('notifications')");
    expect(page).toContain('keepalive: true');
    expect(page).toContain('classifyAdminChatNotificationResult(resp.status, responseBody)');
    expect(page).not.toContain('data,\n        });');
  });

  it('does not lock the direct chat composer while a previous send is still saving', () => {
    const page = readFileSync(chatPagePath, 'utf8');
    const sendStart = page.indexOf('const handleSendMessage');
    const sendEnd = page.indexOf('const handleKeyDown', sendStart);
    const sendSource = page.slice(sendStart, sendEnd);

    expect(page).toContain('const inputTextRef = useRef');
    expect(page).toContain('inputTextRef.current = inputText');
    expect(sendSource).toContain('const trimmed = inputTextRef.current.trim();');
    expect(sendSource).toContain("inputTextRef.current = '';");
    expect(sendSource).not.toContain('isSending');
    expect(sendSource).not.toContain('setIsSending');
    expect(page).not.toContain('loading={isSending}');
    expect(page).not.toContain('disabled={isReadOnly || isSending || !inputText.trim()}');
  });

  it('merges realtime message inserts into the open room instead of refetching the whole room', () => {
    const page = readFileSync(chatPagePath, 'utf8');
    const realtimeStart = page.indexOf(".channel(`chat-room-${fc.phone}`)");
    const realtimeEnd = page.indexOf('    }, [fc.phone', realtimeStart);
    const realtimeSource = page.slice(realtimeStart, realtimeEnd);

    expect(page).toContain('function mergeMessageRows');
    expect(page).toContain('const applyRealtimeMessageChange = useCallback');
    expect(realtimeSource).toContain('applyRealtimeMessageChange(payload)');
    expect(realtimeSource).not.toContain("fetchMessages({ scrollOnChange: payload.eventType === 'INSERT'");
  });

  it('shows KakaoTalk-style unread recipient counts on sent direct messages', () => {
    const page = readFileSync(chatPagePath, 'utf8');

    expect(page).toContain("from '@/lib/message-read-receipts'");
    expect(page).toContain('getDirectMessageUnreadCount');
    expect(page).toContain('formatUnreadReceiptCount');
    expect(page).toContain('unreadReceiptText');
    expect(page).toContain('isRead: msg.is_read');
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

  it('keeps admin-targeted web push out of the browser FC notify proxy', () => {
    const fcNotifyRoute = readFileSync(fcNotifyRoutePath, 'utf8');
    const adminPushRoute = readFileSync(adminPushRoutePath, 'utf8');

    expect(fcNotifyRoute).toContain('buildBrowserFcNotifyPayload');
    expect(fcNotifyRoute).toContain(".eq('role', 'fc')");
    expect(fcNotifyRoute).not.toContain(".eq('role', 'admin')");
    expect(fcNotifyRoute).not.toContain('fetchSharedAdminResidentIds');
    expect(fcNotifyRoute).not.toContain('fetchAdminWebPushSubscriptions');
    expect(adminPushRoute).toContain('normalizeAdminNotificationTargetId');
    expect(adminPushRoute).toContain('fetchSharedAdminResidentIds');
    expect(adminPushRoute).toContain("account.staff_type !== 'developer'");
    expect(adminPushRoute).toContain('resolveConcreteTargetRole(normalizedTargetId)');
    expect(adminPushRoute).toContain(".eq('resident_id', normalizedTargetId)");
    expect(adminPushRoute).toContain(".eq('role', targetRole.role)");
    expect(adminPushRoute).toContain(".eq('role', 'admin')");
    expect(adminPushRoute).toContain(".in('resident_id', sharedAdminTargets.residentIds)");
  });

  it('keeps FC web-push message clicks on the exact staff conversation', () => {
    const fcNotifyRoute = readFileSync(fcNotifyRoutePath, 'utf8');

    expect(fcNotifyRoute).toContain("new URLSearchParams({ targetId: payload.sender_id })");
    expect(fcNotifyRoute).toContain('chatParams.set(\'targetName\', payload.sender_name.trim())');
    expect(fcNotifyRoute).toContain('url: chatUrl');
    expect(fcNotifyRoute).toContain("type: 'message'");
    expect(fcNotifyRoute).toContain('sender_id: payload.sender_id');
  });

  it('keeps concrete admin web push role-bound and reports delivery truth without identifiers', () => {
    const route = readFileSync(adminPushRoutePath, 'utf8');

    expect(route).toContain(".from('admin_accounts')");
    expect(route).toContain(".from('manager_accounts')");
    expect((route.match(/\.eq\('active', true\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(route).toContain('matchingRoles.length === 1');
    expect(route).toContain("matchingRoles.push('admin')");
    expect(route).toContain("matchingRoles.push('manager')");
    expect(route).toContain('ok: !normalizedTargetId');
    expect(route).toContain('noTarget: true');
    expect(route).toContain('ok: result.sent > 0 && result.failed === 0');
    expect(route).not.toContain('error: error.message');
    expect(route).not.toContain("subscriptions query failed:', error");
    expect(route).not.toContain("expired subscription cleanup failed:', deleteError");
  });

  it('keeps Edge fc-notify as the single browser-message notification writer and derives sender identity server-side', () => {
    const dashboardChat = readFileSync(chatPagePath, 'utf8');
    const legacyChat = readFileSync(legacyChatPagePath, 'utf8');
    const dashboardNotifyStart = dashboardChat.indexOf('async function sendFcMessageNotification');
    const dashboardNotifyEnd = dashboardChat.indexOf('// --- Page Component', dashboardNotifyStart);
    const dashboardNotifySource = dashboardChat.slice(dashboardNotifyStart, dashboardNotifyEnd);
    const legacySendStart = legacyChat.indexOf('const sendMessageContent');
    const legacySendEnd = legacyChat.indexOf('const sendMessage =', legacySendStart);
    const legacySendSource = legacyChat.slice(legacySendStart, legacySendEnd);
    const legacyProxyStart = legacySendSource.indexOf("fetch('/api/fc-notify'");
    const legacyProxyEnd = legacySendSource.indexOf('const responseBody:', legacyProxyStart);
    const legacyProxySource = legacySendSource.slice(legacyProxyStart, legacyProxyEnd);

    expect(dashboardNotifySource).not.toContain("from('notifications').insert");
    expect(dashboardNotifySource).not.toContain('sender_id:');
    expect(dashboardNotifySource).not.toContain('sender_name:');
    expect(legacySendSource).not.toContain("from('notifications').insert");
    expect(legacyProxySource).not.toContain('sender_id:');
    expect(legacyProxySource).not.toContain('sender_name:');
    expect(legacySendSource).toContain('keepalive: true');
    expect(legacySendSource).toContain('classifyFcNotificationResult(resp.status, responseBody)');
    expect(legacySendSource).not.toContain('메시지는 저장됐지만 모바일 알림 전달을 확인하지 못했습니다.');
    expect(legacySendSource).toContain("logger.warn('[chat][legacy] mobile notification unconfirmed'");
    expect(legacySendSource).not.toContain('fc-notify proxy response');
    expect(legacySendSource).not.toContain('fc-notify proxy error');
    expect(legacySendSource).not.toContain('responseBody,');
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
