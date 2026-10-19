import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '..', '..', 'app', 'chat.tsx'), 'utf8');
const fetchMessages = source.slice(
  source.indexOf('const fetchMessages = useCallback('),
  source.indexOf('const loadAnchorContext = useCallback('),
);

describe('1:1 room refresh asks only for changes', () => {
  it('sends the cursor only on quiet refreshes of the same room', () => {
    expect(fetchMessages).toContain('const since = silent && cursorEntry?.conversationId === resolvedConversation.id');
    expect(fetchMessages).toContain('fetchGaraminDirectMessages(resolvedConversation.id, { since })');
  });

  it('merges changes into what the screen holds and drops deleted rows', () => {
    expect(fetchMessages).toContain("if (result.mode === 'changes') {");
    expect(fetchMessages).toContain('!removedIds.has(message.id) && !changedIds.has(message.id)');
  });

  it('keeps the next cursor per room and clears it when the server sends none', () => {
    expect(fetchMessages).toContain('directMessageCursorRef.current = result.cursor');
    expect(fetchMessages).toContain(': null;');
  });

  it('pulls changes as soon as the conversation signals, and slows the timer while live', () => {
    expect(source).toContain('const unsubscribe = subscribeDirectMessageSignal(');
    expect(source).toContain('await fetchMessagesRef.current({ silent: true });');
    expect(source).toContain("if (live && active) void pull();");
    expect(source).toContain('? DIRECT_MESSAGE_REALTIME_FALLBACK_MS');
    expect(source).toContain('unsubscribe();');
  });
});
