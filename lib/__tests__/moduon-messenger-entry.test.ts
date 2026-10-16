import {
  formatMessengerEntryBadge,
  MODUON_MESSENGER_SERVICES,
  shouldShowMessengerEntry,
} from '../moduon-messenger-entry';

describe('모두온 floating messenger entry', () => {
  it('shows on browsing screens and stays off sign-in, forms, viewers and the messenger', () => {
    for (const path of ['/', '/board', '/notice', '/settings', '/notifications', '/services/hospitals', '/services/care', '/services/activity', '/board/']) {
      expect([path, shouldShowMessengerEntry(path)]).toEqual([path, true]);
    }
    for (const path of ['/login', '/signup', '/services/login', '/services/signup', '/services/application', '/messenger', '/chat', '/group-chat',
      '/request-board-messenger', '/photo-viewer', '/apply-gate', '/identity', '/docs-upload', '/exam-apply', '/board-detail', null, undefined, '']) {
      expect([path, shouldShowMessengerEntry(path)]).toEqual([path, false]);
    }
  });

  it('lists 모두온 first, then 가람in, and only those two open a messenger today', () => {
    expect(MODUON_MESSENGER_SERVICES.map((s) => s.key)).toEqual(['moduon', 'insurance', 'care', 'telecom', 'rental', 'car', 'hospital']);
    expect(MODUON_MESSENGER_SERVICES.filter((s) => s.available).map((s) => s.label)).toEqual(['모두온', '가람in']);
  });

  it('formats the badge like the room list', () => {
    expect(formatMessengerEntryBadge(0)).toBe('');
    expect(formatMessengerEntryBadge(undefined)).toBe('');
    expect(formatMessengerEntryBadge(7)).toBe('7');
    expect(formatMessengerEntryBadge(120)).toBe('99+');
  });
});
