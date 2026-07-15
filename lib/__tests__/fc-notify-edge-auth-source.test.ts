import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.join(__dirname, '../../supabase/functions/fc-notify/index.ts'),
  'utf8',
);
const notificationsSource = fs.readFileSync(
  path.join(__dirname, '../../app/notifications.tsx'),
  'utf8',
);
const noticeSource = fs.readFileSync(
  path.join(__dirname, '../../app/notice.tsx'),
  'utf8',
);

describe('fc-notify Edge authentication wiring', () => {
  it('allows the app-session header through CORS and imports the shared policy', () => {
    expect(source).toContain('x-app-session-token');
    expect(source).toContain("from '../_shared/fc-notify-auth-policy.ts'");
    expect(source).toContain("from '../_shared/request-board-auth.ts'");
  });

  it('separates exact service-key and signed app-session callers before action handlers', () => {
    expect(source).toContain("req.headers.get('apikey')");
    expect(source).toContain('isTrustedFcNotifyServiceKey');
    expect(source).toContain('requireAppSessionFromRequest(req)');
    expect(source).toContain('resolveFcNotifyAppActor');
    expect(source).toContain('buildAppFcNotifyPayload');

    const policyIndex = source.indexOf('buildAppFcNotifyPayload');
    const firstPrivilegedHandler = source.indexOf("if (body.type === 'chat_targets')");
    expect(policyIndex).toBeGreaterThan(-1);
    expect(firstPrivilegedHandler).toBeGreaterThan(policyIndex);
  });

  it('keeps only latest_notice explicitly public and does not log raw payloads', () => {
    expect(source).toContain("rawBody.type === 'latest_notice'");
    expect(source).not.toContain("console.log('[fc-notify] payload', body)");
    expect(source).toContain("console.log('[fc-notify] request'");
  });

  it('prevents signed FC callers from physically deleting global broadcast rows', () => {
    expect(source).toContain("appActor?.sessionRole === 'fc'");
    expect(source).toContain("deleteQuery.eq('recipient_role', 'fc').eq('resident_id', residentId)");
    expect(notificationsSource).toContain('item.isBroadcast');
    expect(notificationsSource).toContain('locallyHiddenNotificationIds');
    expect(notificationsSource).toContain('hiddenNoticeIds.has(item.id)');
  });

  it('keeps read-only manager notice deletion local instead of deleting shared state', () => {
    expect(noticeSource).toContain("role !== 'admin' || readOnly");
    expect(noticeSource).toContain("role === 'admin' && !readOnly");
    expect(notificationsSource).toContain("const canDeleteSharedNotices = inboxRole === 'admin' && !readOnly");
    expect(notificationsSource).toContain('notice_ids: canDeleteSharedNotices ? noticeIds : []');
  });
});
