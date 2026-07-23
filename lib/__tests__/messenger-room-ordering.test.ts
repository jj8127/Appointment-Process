import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getLastMessageTimestamp,
  sortConversationsByLastMessageTime,
} from '../messenger-room-ordering';

const root = join(__dirname, '..', '..');
const requestBoardMessengerPath = join(root, 'app', 'request-board-messenger.tsx');
const directChatPath = join(root, 'app', 'chat.tsx');
const internalChatHelperPath = join(root, 'supabase', 'functions', '_shared', 'internal-chat.ts');
const adminChatTargetsPath = join(root, 'web', 'src', 'lib', 'admin-chat-targets.ts');

describe('messenger room ordering', () => {
  test('uses only real message timestamps for room ordering', () => {
    expect(getLastMessageTimestamp({ created_at: '2026-07-03T09:10:00.000Z' })).toBe(
      new Date('2026-07-03T09:10:00.000Z').getTime(),
    );
    expect(getLastMessageTimestamp(null)).toBe(0);
    expect(getLastMessageTimestamp({ created_at: null })).toBe(0);
    expect(getLastMessageTimestamp({ created_at: 'not-a-date' })).toBe(0);
  });

  test('keeps message-less rooms below rooms with messages', () => {
    const sorted = sortConversationsByLastMessageTime([
      { id: 'empty-but-newly-opened', lastTimestamp: 0 },
      { id: 'old-message', lastTimestamp: new Date('2026-07-01T08:00:00.000Z').getTime() },
      { id: 'new-message', lastTimestamp: new Date('2026-07-02T08:00:00.000Z').getTime() },
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      'new-message',
      'old-message',
      'empty-but-newly-opened',
    ]);
  });

  test('request-board messenger source applies the shared ordering helper after list updates', () => {
    const source = readFileSync(requestBoardMessengerPath, 'utf8');

    expect(source).toContain("from '@/lib/messenger-room-ordering'");
    expect(source).toContain('getLastMessageTimestamp(c.lastMessage)');
    expect(source).toContain('getLastMessageTimestamp(d.lastMessage)');
    expect(source).toContain('sortConversationsByLastMessageTime(visibleConversations)');
    expect(source).toContain('sortConversationsByLastMessageTime(prev.map');
    expect(source).not.toContain('lastTimestamp: Date.now()');
  });

  test('all direct-conversation lists keep latest real messages above empty conversations', () => {
    const directChatSource = readFileSync(directChatPath, 'utf8');
    const internalChatSource = readFileSync(internalChatHelperPath, 'utf8');
    const adminChatSource = readFileSync(adminChatTargetsPath, 'utf8');

    expect(directChatSource).toContain('sortConversationsByLastMessageTime<FcChatTarget>([');
    expect(internalChatSource).toContain('return new Date(right.last_time).getTime() - new Date(left.last_time).getTime()');
    expect(adminChatSource).toContain('return new Date(b.last_time).getTime() - new Date(a.last_time).getTime()');
    expect(adminChatSource).toContain('if (a.last_time) return -1');
    expect(adminChatSource).toContain('if (b.last_time) return 1');
  });
});
