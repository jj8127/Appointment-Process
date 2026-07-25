import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const chatPath = join(root, 'app', 'chat.tsx');
const unreadBadgePath = join(root, 'components', 'MessageUnreadReceiptBadge.tsx');

describe('mobile direct chat source', () => {
  it('keeps direct-message CRUD behind the authenticated service API', () => {
    const source = readFileSync(chatPath, 'utf8');

    expect(source).toContain("from '@/lib/direct-message-api'");
    expect(source).toContain('resolveGaraminDirectConversation');
    expect(source).toContain('fetchGaraminDirectMessages');
    expect(source).toContain('sendGaraminDirectMessage');
    expect(source).toContain('markGaraminDirectMessagesRead');
    expect(source).toContain('deleteGaraminDirectMessage');
    expect(source).not.toMatch(/\.from\(\s*['"]messages['"]\s*\)/);
    expect(source).not.toMatch(/table:\s*['"]messages['"]/);
    expect(source).not.toContain('MESSAGE_SELECT_COLUMNS');
  });

  it('keeps direct sends optimistic, atomic, and idempotent across retries', () => {
    const source = readFileSync(chatPath, 'utf8');
    const sendStart = source.indexOf('const sendPayload = async');
    const sendEnd = source.indexOf('const handleSendText', sendStart);
    const sendSource = source.slice(sendStart, sendEnd);

    expect(sendSource).toContain('const optimisticMessage = createOptimisticMessage');
    expect(sendSource).toContain('applyMessages([optimisticMessage, ...messagesRef.current])');
    expect(sendSource).toContain('const clientMessageId = randomUUID()');
    expect(sendSource).toContain('clientMessageId,');
    expect(sendSource).toContain('const commitMessage = async');
    expect(sendSource).toContain('commitMessageWithRetry()');
    expect(sendSource).toContain('uploadMessengerAttachmentBatch');
    expect(sendSource).toContain("uploadResult.state === 'committed'");
    expect(sendSource).toContain('attachmentBatchRef.current');
    expect(sendSource).toContain('const notificationDelivery = sendResult.delivery');
    expect(sendSource).toContain('notificationDelivery.notificationStored === false');
    expect(sendSource).not.toContain('await invokeFcNotifyForDelivery({');
    expect(sendSource).not.toContain("type: 'notify'");
    expect(sendSource).not.toContain("supabase.functions.invoke('fc-notify'");
    expect(sendSource).not.toContain('void invokeFcNotify');
  });

  it('resolves and loads the exact typed direct-chat conversation before receipt completion', () => {
    const source = readFileSync(chatPath, 'utf8');
    const fetchStart = source.indexOf('const fetchMessages = useCallback');
    const fetchEnd = source.indexOf('  useEffect(() => {', fetchStart);
    const sendStart = source.indexOf('const sendPayload = async');
    const sendEnd = source.indexOf('const handleSendText', sendStart);
    const fetchSource = source.slice(fetchStart, fetchEnd);
    const sendSource = source.slice(sendStart, sendEnd);

    expect(source).toContain(
      '? { conversationId: conversationIdValue }',
    );
    expect(fetchSource).toContain(
      'fetchGaraminDirectMessages(',
    );
    expect(fetchSource).toContain(
      'resolvedConversation.id',
    );
    expect(fetchSource).toContain(
      'result.conversation.counterpartyId !== otherId',
    );
    expect(source).toContain('useNotificationReceiptCompletion');
    expect(source).toContain(
      "resolvedConversation?.id === conversationIdValue",
    );
    expect(source).toContain("messageLoadState === 'success'");
    expect(sendSource).toContain(
      'sendGaraminDirectMessage({',
    );
    expect(sendSource).toContain(
      'conversationId: resolvedConversation.id',
    );
    expect(sendSource).toContain('clientMessageId,');
  });

  it('polls the service instead of subscribing directly to the messages table', () => {
    const source = readFileSync(chatPath, 'utf8');

    expect(source).toContain('const DIRECT_MESSAGE_POLL_INTERVAL_MS = 4_000');
    expect(source).toContain('DIRECT_MESSAGE_POLL_INTERVAL_MS');
    expect(source).toContain("AppState.addEventListener('change'");
    expect(source).not.toMatch(
      /postgres_changes[\s\S]{0,500}table:\s*['"]messages['"]/,
    );
  });

  it('deletes only an exact persisted message from the resolved conversation', () => {
    const source = readFileSync(chatPath, 'utf8');
    const deleteStart = source.indexOf('const handleDeleteMessage');
    const deleteEnd = source.indexOf('const handleCopyMessage', deleteStart);
    const deleteSource = source.slice(deleteStart, deleteEnd);

    expect(deleteSource).toContain('isNotificationUuid(message.id)');
    expect(deleteSource).toContain('deleteGaraminDirectMessage({');
    expect(deleteSource).toContain(
      'conversationId: resolvedConversation.id',
    );
    expect(deleteSource).toContain('messageId: message.id');
  });

  it('shows KakaoTalk-style unread recipient counts on sent direct messages', () => {
    const source = readFileSync(chatPath, 'utf8');
    const badgeSource = readFileSync(unreadBadgePath, 'utf8');
    const optimisticStart = source.indexOf('const createOptimisticMessage');
    const optimisticEnd = source.indexOf('const markIncomingAsRead', optimisticStart);
    const optimisticSource = source.slice(optimisticStart, optimisticEnd);

    expect(source).toContain("from '@/lib/message-read-receipts'");
    expect(source).toContain('getDirectMessageUnreadCount');
    expect(source).toContain("from '@/components/MessageUnreadReceiptBadge'");
    expect(source).toContain('<MessageUnreadReceiptBadge');
    expect(source).not.toContain('<Text style={styles.messageUnreadCount}>');
    expect(badgeSource).toContain('formatUnreadReceiptCount');
    expect(badgeSource).toContain('messageUnreadCount');
    expect(source).toContain('messageBubbleLine');
    expect(optimisticSource).toContain('is_read: false');
  });

  it('sorts every FC direct-chat target by its latest real message time', () => {
    const source = readFileSync(chatPath, 'utf8');

    expect(source).toContain("from '@/lib/messenger-room-ordering'");
    expect(source).toContain('getLastMessageTimestamp({ created_at: manager.last_time })');
    expect(source).toContain('getLastMessageTimestamp({ created_at: developer.last_time })');
    expect(source).toContain('getLastMessageTimestamp({ created_at: adminSummary?.last_time })');
    expect(source).toContain('sortConversationsByLastMessageTime<FcChatTarget>([');
  });
});
