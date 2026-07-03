import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const chatPath = join(root, 'app', 'chat.tsx');
const unreadBadgePath = join(root, 'components', 'MessageUnreadReceiptBadge.tsx');

describe('mobile direct chat source', () => {
  it('uses narrow message selects for chat fetches and sends', () => {
    const source = readFileSync(chatPath, 'utf8');
    const fetchStart = source.indexOf('const fetchMessages = useCallback');
    const fetchEnd = source.indexOf('  useEffect(() => {', fetchStart);
    const sendStart = source.indexOf('const sendPayload = async');
    const sendEnd = source.indexOf('const handleSendText', sendStart);
    const fetchSource = source.slice(fetchStart, fetchEnd);
    const sendSource = source.slice(sendStart, sendEnd);

    expect(source).toContain('const MESSAGE_SELECT_COLUMNS');
    expect(fetchSource).toContain('.select(MESSAGE_SELECT_COLUMNS)');
    expect(sendSource).toContain('.select(MESSAGE_SELECT_COLUMNS)');
    expect(fetchSource).not.toContain(".select('*')");
    expect(sendSource).not.toContain(".select('*')");
  });

  it('keeps mobile direct message sends optimistic with background notifications', () => {
    const source = readFileSync(chatPath, 'utf8');
    const sendStart = source.indexOf('const sendPayload = async');
    const sendEnd = source.indexOf('const handleSendText', sendStart);
    const sendSource = source.slice(sendStart, sendEnd);

    expect(sendSource).toContain('const optimisticMessage = createOptimisticMessage');
    expect(sendSource).toContain('applyMessages([optimisticMessage, ...messagesRef.current])');
    expect(sendSource).toContain("void supabase.functions.invoke('fc-notify'");
    expect(sendSource).not.toContain('await supabase.functions.invoke');
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
});
