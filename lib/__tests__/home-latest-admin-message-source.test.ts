import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('home latest admin message Sentry noise contract', () => {
  const source = readFileSync(join(process.cwd(), 'app/index.tsx'), 'utf8');

  it('does not capture optional latest-admin-message fetch failures as Sentry errors', () => {
    const fetchSource = source.slice(
      source.indexOf('const fetchLatestAdminMessage ='),
      source.indexOf('const fetchFcStatus ='),
    );
    // Query errors now reach the UI; warning-only logging is no longer required.
    // Runtime failure propagation is covered by mobile-read-states.test.tsx.
    expect(fetchSource).not.toMatch(/\b(?:logger\.error|captureException|captureMessage)\s*\(/);
  });

  it('shows the internal unread count on the messenger shortcut card', () => {
    expect(source).toContain("const isMessengerShortcut = item.href === '/messenger'");
    expect(source).toContain("const messengerUnreadBadge = unreadMsgCount > 99 ? '99+' : String(unreadMsgCount)");
    expect(source).toContain('isMessengerShortcut && unreadMsgCount > 0');
    expect(source).toContain('styles.quickLinkUnreadBadge');
    expect(source).toContain('읽지 않은 메시지 ${messengerUnreadBadge}개');
  });
});
