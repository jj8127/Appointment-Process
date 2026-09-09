import { readFileSync as readRawFileSync } from 'node:fs';
import { join } from 'node:path';

const readFileSync = (filePath: string, encoding: 'utf8') =>
  readRawFileSync(filePath, encoding).replace(/\r\n/g, '\n');

const root = join(__dirname, '..', '..');
const chatPagePath = join(root, 'web', 'src', 'app', 'dashboard', 'chat', 'page.tsx');
const legacyChatPagePath = join(root, 'web', 'src', 'app', 'chat', 'page.tsx');
const chatListRoutePath = join(root, 'web', 'src', 'app', 'api', 'admin', 'chat-list', 'route.ts');
const notificationBellPath = join(root, 'web', 'src', 'components', 'DashboardNotificationBell.tsx');
const fcNotifyRoutePath = join(root, 'web', 'src', 'app', 'api', 'fc-notify', 'route.ts');
const adminPushRoutePath = join(root, 'web', 'src', 'app', 'api', 'admin', 'push', 'route.ts');
const fcNotifyFunctionPath = join(root, 'supabase', 'functions', 'fc-notify', 'index.ts');

describe('admin web direct chat list source', () => {
  it('treats persisted reminder notifications as successful regardless of provider delivery', () => {
    const dashboardSource = readFileSync(
      join(root, 'web', 'src', 'app', 'dashboard', 'page.tsx'),
      'utf8',
    );

    expect(dashboardSource).toContain('if (!notificationResult.inbox?.logged)');
    expect(dashboardSource).toContain("title: '알림 등록 실패'");
    expect(dashboardSource).toContain("title: '전송 완료'");
    expect(dashboardSource).not.toContain('if (!notificationResult.success)');
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

  it('polls the server-owned chat list without subscribing to the protected messages table', () => {
    const page = readFileSync(chatPagePath, 'utf8');

    expect(page).toContain('refetchInterval: CHAT_LIST_REFETCH_INTERVAL_MS');
    expect(page).toContain('ROOM_POLL_INTERVAL_MS = 15000');
    expect(page).not.toContain("table: 'messages'");
    expect(page).not.toContain(".channel(`admin-chat-list-");
  });

  it('keeps admin direct message sends optimistic through the actor-bound conversation API', () => {
    const page = readFileSync(chatPagePath, 'utf8');
    const sendStart = page.indexOf('const handleSendMessage');
    const sendEnd = page.indexOf('const handleKeyDown', sendStart);
    const sendSource = page.slice(sendStart, sendEnd);
    const directSendType = sendSource.indexOf("type: 'direct_message_send'");
    const directSendPayload = sendSource.slice(
      sendSource.lastIndexOf('body: JSON.stringify({', directSendType),
      sendSource.indexOf('}),', directSendType),
    );

    expect(sendSource).toContain("setInputText('');");
    expect(sendSource).toContain("type: 'direct_message_send'");
    expect(sendSource).toContain('conversation_id: activeConversationId');
    expect(sendSource).toContain('content: trimmed');
    expect(directSendPayload).not.toContain('sender_id:');
    expect(directSendPayload).not.toContain('receiver_id:');
    expect(sendSource).not.toContain('메시지는 저장됐지만 가람in 푸시 알림 전달을 확인하지 못했습니다.');
    expect(sendSource).not.toContain("await supabase.from('notifications')");
    expect(sendSource).not.toContain(".from('messages')");
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

  it('polls conversation-scoped messages through the protected proxy without realtime table access', () => {
    const page = readFileSync(chatPagePath, 'utf8');

    expect(page).toContain("type: 'direct_message_list'");
    expect(page).toContain("type: 'direct_message_mark_read'");
    expect(page).toContain('conversation_id: activeConversationId');
    expect(page).toContain('window.setInterval(() =>');
    expect(page).not.toContain("table: 'messages'");
    expect(page).not.toContain(".from('messages')");
    expect(page).toContain("type: 'direct_message_delete'");
    expect(page).toContain('message_id: messageId');
  });

  it('keeps all browser direct-message surfaces off direct Supabase message access', () => {
    const dashboardChat = readFileSync(chatPagePath, 'utf8');
    const legacyChat = readFileSync(legacyChatPagePath, 'utf8');
    const messengerHub = readFileSync(
      join(root, 'web', 'src', 'app', 'dashboard', 'messenger', 'page.tsx'),
      'utf8',
    );
    const chatListRoute = readFileSync(chatListRoutePath, 'utf8');

    for (const source of [dashboardChat, legacyChat, messengerHub]) {
      expect(source).not.toContain(".from('messages')");
      expect(source).not.toContain("table: 'messages'");
    }
    expect(chatListRoute).toContain("from '@/lib/admin-supabase'");
    expect(chatListRoute).toContain(".from('messages')");
  });

  it('shows KakaoTalk-style unread recipient counts on sent direct messages', () => {
    const page = readFileSync(chatPagePath, 'utf8');

    expect(page).toContain("from '@/lib/message-read-receipts'");
    expect(page).toContain('getDirectMessageUnreadCount');
    expect(page).toContain('formatUnreadReceiptCount');
    expect(page).toContain('unreadReceiptText');
    expect(page).toContain('isRead: msg.is_read');
  });

  it('opens a direct-chat notification only after its immutable conversation is authorized by the chat list', () => {
    const page = readFileSync(chatPagePath, 'utf8');

    expect(page).toContain("searchParams.get('conversationId')");
    expect(page).toContain('if (!deepLinkedConversationId) return null');
    expect(page).toContain(
      'chatList?.find((item) => item.conversation_id === deepLinkedConversationId) ?? null',
    );
    expect(page).toContain(
      'deepLinkedConversationId && deepLinkedSelection ? <NotificationDestinationReady /> : null',
    );
    expect(page).not.toContain("searchParams.get('targetName')");
    expect(page).not.toContain('fc_id: deepLinked');
  });

  it('keeps shared admin and FC inboxes while binding personal staff inboxes to the signed phone', () => {
    const notificationBell = readFileSync(notificationBellPath, 'utf8');

    expect(notificationBell).toContain("const inboxRole = role === 'fc' ? 'fc' : 'admin'");
    expect(notificationBell).toContain('const inbox = await invokeInbox({');
    expect(notificationBell).toContain("const isPersonalAdminInbox = role === 'manager' || staffType === 'developer'");
    expect(notificationBell).toContain(
      "resident_id: inboxRole === 'fc' || isPersonalAdminInbox",
    );
    expect(notificationBell).toContain("? residentId.replace(/\\D/g, '')");
    expect(notificationBell).not.toContain('personalInboxHeld');
    expect(notificationBell).not.toContain('Promise.all');
    expect(notificationBell).not.toContain('developerFcInbox');
    expect(notificationBell).not.toContain('actor_id:');
    expect(notificationBell).not.toContain('recipient_actor_id:');
  });

  it('keeps admin browser push retired behind an authenticated compatibility route', () => {
    const fcNotifyRoute = readFileSync(fcNotifyRoutePath, 'utf8');
    const adminPushRoute = readFileSync(adminPushRoutePath, 'utf8');

    expect(fcNotifyRoute).toContain('buildBrowserFcNotifyPayload');
    expect(fcNotifyRoute).toContain(".from('fc_profiles')");
    expect(fcNotifyRoute).toContain('buildAdminChatTargets(rows)');
    expect(fcNotifyRoute).toContain("browserPolicy.payload.target_role === 'fc'");
    expect(fcNotifyRoute).not.toContain(".eq('role', 'admin')");
    expect(fcNotifyRoute).not.toContain('fetchSharedAdminResidentIds');
    expect(fcNotifyRoute).not.toContain('fetchAdminWebPushSubscriptions');
    expect(fcNotifyRoute).not.toContain('sendBrowserFcMessageWebPush');
    expect(adminPushRoute).toContain('parseNotificationTargetV1(payload.target)');
    expect(adminPushRoute).toContain('UUID_PATTERN.test(notificationId)');
    expect(adminPushRoute).toContain('secretAuthOk');
    expect(adminPushRoute).toContain("mode: 'in_app_only'");
    expect(adminPushRoute).not.toContain('web_push_subscriptions');
    expect(adminPushRoute).not.toContain('sendWebPush');
  });

  it('keeps FC in-app message notifications on the exact staff conversation', () => {
    const dashboardChat = readFileSync(chatPagePath, 'utf8');
    const fcNotifyRoute = readFileSync(fcNotifyRoutePath, 'utf8');
    const edgeFunction = readFileSync(fcNotifyFunctionPath, 'utf8');

    expect(dashboardChat).toContain("type: 'resolve_garamin_direct_conversation'");
    expect(dashboardChat).toContain('conversation_id: activeConversationId');
    expect(edgeFunction).toContain('const directConversation = await resolveGaraminDirectConversation({');
    expect(edgeFunction).toContain('actor: appActor');
    expect(edgeFunction).toContain("kind: 'garamin_direct_chat'");
    expect(edgeFunction).toContain('conversationId: directConversation.id');
    expect(edgeFunction).toContain('notificationId,');
    expect(edgeFunction).toContain('notificationTarget,');
    expect(fcNotifyRoute).not.toContain('sendBrowserFcMessageWebPush');
    expect(fcNotifyRoute).not.toContain('new URLSearchParams');
    expect(fcNotifyRoute).not.toContain('targetName');
  });

  it('reports the retired administrator Web Push channel as a compatible no-op', () => {
    const route = readFileSync(adminPushRoutePath, 'utf8');

    expect(route).toContain('ok: true');
    expect(route).toContain('sent: 0');
    expect(route).toContain('failed: 0');
    expect(route).toContain('noTarget: true');
    expect(route).toContain("mode: 'in_app_only'");
    expect(route).not.toContain(".from('admin_accounts')");
    expect(route).not.toContain(".from('manager_accounts')");
    expect(route).not.toContain('web_push_subscriptions');
    expect(route).not.toContain('error: error.message');
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
    const legacyProxyEnd = legacySendSource.indexOf('const payload =', legacyProxyStart);
    const legacyProxySource = legacySendSource.slice(legacyProxyStart, legacyProxyEnd);

    expect(dashboardNotifySource).not.toContain("from('notifications').insert");
    expect(dashboardNotifySource).not.toContain('sender_id:');
    expect(dashboardNotifySource).not.toContain('sender_name:');
    expect(legacySendSource).not.toContain("from('notifications').insert");
    expect(legacyProxySource).not.toContain('sender_id:');
    expect(legacyProxySource).not.toContain('sender_name:');
    expect(legacyProxySource).toContain("type: 'direct_message_send'");
    expect(legacyProxySource).toContain('conversation_id: conversationId');
    expect(legacyProxySource).toContain('content');
    expect(legacySendSource).not.toContain('메시지는 저장됐지만 모바일 알림 전달을 확인하지 못했습니다.');
    expect(legacySendSource).not.toContain(".from('messages')");
  });

  it('keeps Edge notification inbox and mobile push fanout separated by shared admin vs personal admin targets', () => {
    const edgeFunction = readFileSync(fcNotifyFunctionPath, 'utf8');

    expect(edgeFunction).toContain('normalizeAdminNotificationTargetId');
    expect(edgeFunction).toContain('fetchSharedAdminPhones');
    expect(edgeFunction).toContain("account.staff_type !== 'developer'");
    expect(edgeFunction).toContain(".eq('recipient_role', role)");
    expect(edgeFunction).toContain(
      '`recipient_actor_id.eq.${viewer.actorId},and(recipient_actor_id.is.null,resident_id.is.null)`',
    );
    expect(edgeFunction).toContain('authorizeNotificationReceipt(');
    expect(edgeFunction).toContain(".eq('role', 'admin')");
    expect(edgeFunction).toContain(".in('resident_id', sharedAdminPhones)");
    expect(edgeFunction).toContain(`notifyAdminWebPush(
        pushTitle,
        message,
        url,
        target_id || null,
        notificationId,
        notificationTarget,
      )`);
    expect(edgeFunction).toContain(`notifyAdminWebPush(
          title,
          message,
          targetUrl,
          recipientId,
          notificationId,
          lifecycleTarget,
        )`);
    expect(edgeFunction).toContain('notificationId: notificationIdByRecipient.get');
    expect(edgeFunction).toContain('target: lifecycleTarget');
  });
});
