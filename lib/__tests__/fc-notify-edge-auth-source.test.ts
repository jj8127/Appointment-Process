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

  it('validates concrete direct-message recipients and restricts device tokens to the authorized role', () => {
    expect(source).toContain('shouldRequireActiveStaffNotificationTarget');
    expect(source).toContain('validateActiveStaffNotificationTarget(target_id, target_role)');
    expect(source).toContain(".from('manager_accounts')");
    expect(source).toContain(".from('admin_accounts')");
    expect(source).toContain(".from('fc_profiles')");
    expect(source).toContain(".eq('signup_completed', true)");
    expect(source).toContain(".eq('active', true)");
    expect(source).toContain(".in('role', [...getAllowedNotificationTokenRoles(target_role, category)])");
    expect(source).not.toContain('role과 무관하게 같은 번호의 모든 토큰');
  });

  it('keeps legacy lifecycle token queries role-bound', () => {
    expect((source.match(/getAllowedNotificationTokenRoles\(targetRole\)/g) ?? []).length).toBe(2);
    expect(source).toMatch(
      /\.in\('resident_id', recipientResidentIds\)\s*\.in\('role', \[\.\.\.getAllowedNotificationTokenRoles\(targetRole\)\]\)/,
    );
    expect(source).toMatch(
      /\.eq\('resident_id', targetResidentId\)\s*\.in\('role', \[\.\.\.getAllowedNotificationTokenRoles\(targetRole\)\]\)/,
    );
  });

  it('keeps affiliation-scoped managers for FC lifecycle events without enabling broadcasts', () => {
    expect(source).toContain('allowScopedManagerLifecycle: isFcAdminUpdateEvent');
    expect(source).toContain('recipientResidentIds = await resolveFcUpdateAdminRecipientIds(fcRow.affiliation)');
    expect(source).not.toContain('allowScopedManagerLifecycle: true');
  });

  it('classifies the admin web callback body and exposes a fixed partial-delivery warning', () => {
    expect(source).toContain("typeof parsed.ok === 'boolean'");
    expect(source).toContain("typeof parsed?.sent === 'number'");
    expect(source).toContain("typeof parsed?.failed === 'number'");
    expect(source).toContain('Boolean(targetId) && sent === 0');
    expect(source).toContain("NOTIFICATION_DELIVERY_INCOMPLETE_WARNING = 'notification_delivery_incomplete'");
    expect(source).toContain('getNotificationDeliveryWarning(adminWebPush)');
    expect(source).not.toContain('raw: await resp.text()');
  });

  it('does not report a zero-token provider delivery as successful', () => {
    expect((source.match(/toExpoPushDeliveryOutcome\(\{ attempted: 0, accepted: 0, rejected: 0 \}\)/g) ?? []).length)
      .toBe(2);
    expect(source).not.toContain("return ok({ ok: true, sent: 0, logged: !logError");
  });

  it('bounds both external push requests and classifies timeouts without raw exceptions', () => {
    expect(source).toContain('EXPO_PUSH_TIMEOUT_MS = 10_000');
    expect(source).toContain('ADMIN_WEB_PUSH_TIMEOUT_MS = 10_000');
    expect(source).toContain('signal: AbortSignal.timeout(ADMIN_WEB_PUSH_TIMEOUT_MS)');
    expect(source).toContain('signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS)');
    expect(source).toContain("reason: timedOut ? 'callback-timeout' : 'callback-network-error'");
    expect(source).toContain("event: 'fc_notify.expo_push'");
    expect(source).toContain("reason: timedOut ? 'timeout' : 'request_failed'");
    expect(source).not.toContain("console.warn('[fc-notify] expo push request failed', error)");
    expect(source).not.toContain("console.warn('[fc-notify] admin web push callback failed', error)");
  });

  it('keeps only latest_notice explicitly public and does not log raw payloads', () => {
    expect(source).toContain("rawBody.type === 'latest_notice'");
    expect(source).not.toContain("console.log('[fc-notify] payload', body)");
    expect(source).not.toContain("console.log('[fc-notify] request'");
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
