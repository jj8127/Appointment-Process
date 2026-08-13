import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('home latest admin message Sentry noise contract', () => {
  const source = readFileSync(join(process.cwd(), 'app/index.tsx'), 'utf8');

  it('does not capture optional latest-admin-message fetch failures as Sentry errors', () => {
    expect(source).not.toContain("logger.error('[Home] latest admin msg error'");
    expect(source).toContain("logger.warn('[Home] latest admin msg error'");
  });

  it('shows the internal unread count on the messenger shortcut card', () => {
    expect(source).toContain("const isMessengerShortcut = item.href === '/messenger'");
    expect(source).toContain("const messengerUnreadBadge = unreadMsgCount > 99 ? '99+' : String(unreadMsgCount)");
    expect(source).toContain('isMessengerShortcut && unreadMsgCount > 0');
    expect(source).toContain('styles.quickLinkUnreadBadge');
    expect(source).toContain('읽지 않은 메시지 ${messengerUnreadBadge}개');
  });
});
