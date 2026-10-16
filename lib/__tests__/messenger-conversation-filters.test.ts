import { formatGroupChatSeenLabel } from '../group-chat-display';
import {
  countMessengerConversationFilters,
  hasMessengerConversationActivity,
  matchesMessengerConversationFilter,
  type MessengerHubConversation,
} from '../messenger-hub-model';

const row = (overrides: Partial<MessengerHubConversation>): MessengerHubConversation => ({
  key: 'k',
  name: '이름',
  detail: '',
  role: 'operations',
  sourceLabel: '가람in',
  route: { kind: 'internal', targetName: '이름' },
  preview: '',
  timestamp: null,
  timestampMs: 0,
  unreadCount: 0,
  ...overrides,
});

describe('messenger conversation filters', () => {
  const rooms = [
    row({ key: 'dm', timestampMs: 10, unreadCount: 2 }),
    row({ key: 'group', route: { kind: 'group' }, timestampMs: 20 }),
    row({ key: 'link', sourceLabel: '가람Link', route: { kind: 'request', requestDesignerId: 1 }, timestampMs: 30, unreadCount: 1 }),
    row({ key: 'empty' }),
    row({ key: 'pinned-empty', pinnedAt: '2026-10-16T00:00:00Z' }),
  ];

  it('keeps rooms with a message or a pin and hides the rest', () => {
    expect(rooms.filter(hasMessengerConversationActivity).map((r) => r.key)).toEqual(['dm', 'group', 'link', 'pinned-empty']);
  });

  it('matches each chip and counts them', () => {
    const active = rooms.filter(hasMessengerConversationActivity);
    expect(active.filter((r) => matchesMessengerConversationFilter(r, 'unread')).map((r) => r.key)).toEqual(['dm', 'link']);
    expect(active.filter((r) => matchesMessengerConversationFilter(r, 'group')).map((r) => r.key)).toEqual(['group']);
    expect(active.filter((r) => matchesMessengerConversationFilter(r, 'garamlink')).map((r) => r.key)).toEqual(['link']);
    expect(countMessengerConversationFilters(active)).toEqual({ all: 4, unread: 2, group: 1, garamlink: 1 });
  });
});

describe('large group room read label', () => {
  it('counts readers in a large room and stays out of small rooms', () => {
    expect(formatGroupChatSeenLabel(688, 275)).toBe('412명 읽음');
    expect(formatGroupChatSeenLabel(688, 0)).toBe('687명 읽음');
    expect(formatGroupChatSeenLabel(688, 9999)).toBe('0명 읽음');
    expect(formatGroupChatSeenLabel(12, 3)).toBeNull();
    expect(formatGroupChatSeenLabel(Number.NaN, 3)).toBeNull();
  });
});
