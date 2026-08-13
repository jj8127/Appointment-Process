import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const screen = readFileSync(join(root, 'app', 'notifications.tsx'), 'utf8');
const helper = readFileSync(
  join(root, 'lib', 'notification-center-read-state.ts'),
  'utf8',
);

describe('notification center read-state wiring', () => {
  it('captures the observation boundary before loading and acknowledges after rendering', () => {
    const boundaryIndex = screen.indexOf(
      'const viewedAt = new Date().toISOString();',
    );
    const fetchIndex = screen.indexOf(
      'const { pushRows, noticeRows } = await fetchInbox();',
    );
    const renderIndex = screen.indexOf('setNotices(merged);');
    const reconcileIndex = screen.indexOf(
      'await reconcileNotificationCenterReadState({',
    );

    expect(boundaryIndex).toBeGreaterThan(-1);
    expect(fetchIndex).toBeGreaterThan(boundaryIndex);
    expect(renderIndex).toBeGreaterThan(fetchIndex);
    expect(reconcileIndex).toBeGreaterThan(renderIndex);
  });

  it('keeps receipt authorization and bridged inbox scope on the bulk read request', () => {
    expect(screen).toContain("type: 'inbox_mark_read'");
    expect(screen).toContain('notification_ids: notificationIds');
    expect(screen).toContain(
      'include_request_board_fc: includeRequestBoardFcInbox',
    );
    expect(screen).toContain(
      "context: 'notifications-screen-load'",
    );
  });

  it('does not turn acknowledgement failures into a user-facing alert', () => {
    expect(helper).not.toContain('Alert.');
    expect(helper).toContain(
      "'[notifications] visible notification acknowledgement failed'",
    );
  });
});
