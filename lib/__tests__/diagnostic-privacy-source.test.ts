import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('diagnostic privacy source boundary', () => {
  test('both structured loggers sanitize messages, payloads, exceptions, and Sentry context', () => {
    for (const relativePath of ['lib/logger.ts', 'web/src/lib/logger.ts']) {
      const source = read(relativePath);
      expect(source).toContain("import { sanitizeSentryContext } from");
      expect(source).toContain('const sanitizedMessage = sanitizeLogMessage(message);');
      expect(source).toContain('const sanitizedData = sanitizeSentryContext(data);');
      expect(source).toContain('toSanitizedError(data, sanitizedMessage)');
      expect(source).not.toContain('captureSentryException(data instanceof Error ? data');
    }
  });

  test('push API diagnostics never interpolate or forward raw tokens and exceptions', () => {
    const source = read('app/api/push+api.ts');
    expect(source).not.toContain('Push token ${to}');
    expect(source).not.toContain('console.error(error)');
    expect(source).not.toContain("console.error('Push API Error:', error)");
    expect(source).not.toContain('error: error.message');
    expect(source).toContain("console.warn('[push-api] invalid push token')");
    expect(source).toContain("reason: 'expo_delivery_failed'");
  });

  test('push registration diagnostics expose state but not identifiers, tokens, or raw errors', () => {
    const source = read('lib/notifications.ts');
    expect(source).not.toContain("{ role, residentId }");
    expect(source).not.toContain('{ projectId, expoToken');
    expect(source).not.toContain('serverRole: data?.role, error: registerError');
    expect(source).not.toContain("logger.warn('registerPushToken failed', err)");
    expect(source).toContain("reason: 'registration_failed'");
  });

  test('foreground notification handlers use the current Expo presentation fields', () => {
    for (const relativePath of ['app/_layout.tsx', 'lib/notifications.ts']) {
      const source = read(relativePath);
      expect(source).toContain('shouldShowBanner: true');
      expect(source).toContain('shouldShowList: true');
      expect(source).not.toContain('shouldShowAlert');
    }
  });

  test('server push delivery diagnostics and failures never retain recipient content or provider bodies', () => {
    const source = read('web/src/lib/push-notification-service.ts');
    const resultSource = read('web/src/lib/push-notification-delivery-result.ts');
    expect(source).not.toContain("{ userId, title, body }");
    expect(source).not.toContain('tokens: tokens?.map');
    expect(source).not.toContain('const respBody = await resp.text()');
    expect(source).not.toContain('body: respBody');
    expect(source).not.toContain('Expo push notification failed: ${respBody}');
    expect(source).not.toContain("logger.error('[push-notification-service] Push notification error:', error)");
    expect(source).toContain("category: 'push_delivery'");
    expect(source).toContain('expoAccepted: result.expo.accepted');
    expect(source).toContain('expoRejected: result.expo.rejected');
    expect(source).not.toContain('providerBody:');
    expect(resultSource).toContain("failures: ['expo_http_failed']");
    expect(resultSource).toContain("failures.push('expo_ticket_rejected')");
  });

  test('OTP and group-chat Edge diagnostics use a reviewed fixed-reason/status baseline', () => {
    const otpSource = read('supabase/functions/request-signup-otp/index.ts');
    expect(otpSource).not.toContain("console.log('[TEST MODE] OTP code for'");
    expect(otpSource).not.toContain('profileId, authDeleteError.message');
    expect(otpSource).not.toContain('const text = await res.text()');
    expect(otpSource).toContain("reason: 'auth_cleanup_failed'");
    expect(otpSource).toContain("console.info('[request-signup-otp] test delivery simulated')");

    const groupChatSource = read('supabase/functions/group-chat/index.ts');
    expect(groupChatSource).not.toContain('raw.slice(0, 300)');
    expect(groupChatSource).not.toContain("console.error('[group-chat] db error', error?.message)");
    expect(groupChatSource).not.toContain('console.warn(\'[group-chat] token query failed\', tokenError.message)');
    expect(groupChatSource).toContain("reason: 'provider_http_failed'");
    expect(groupChatSource).toContain("reason: 'provider_ticket_rejected'");
    expect(groupChatSource).toContain("reason: 'provider_delivery_not_accepted'");
    expect(groupChatSource).not.toContain('console.warn(providerPayload)');
    expect(groupChatSource).toContain("reason: 'notification_insert_failed'");
  });

  test('the reviewed Edge and settings leak paths terminate at closed diagnostics', () => {
    const setPassword = read('supabase/functions/set-password/index.ts');
    expect(setPassword).not.toContain("not found or inactive', params.referralCode");
    expect(setPassword).not.toContain('referralCode: params.referralCode');
    expect(setPassword).not.toContain('referral code lookup error');
    expect(setPassword).not.toContain('inviter profile lookup error');
    expect(setPassword).not.toContain('resolveReferralDetails: unexpected error');
    expect(setPassword).not.toContain('${params.logLabel}: event insert error');
    expect(setPassword).not.toContain('applyReferralLinkState failed');
    expect(setPassword).toContain("event: 'set_password.referral_resolution'");
    expect(setPassword).toContain("event: 'set_password.referral_event'");
    expect(setPassword).toContain("event: 'set_password.referral_link'");

    const login = read('supabase/functions/login-with-password/index.ts');
    expect(login).not.toContain('phone: cleanPhone(params.actorPhone)');
    expect(login).not.toContain('JSON.stringify({ phone: manager.phone');
    expect(login).toContain("event: 'login_with_password.referral_bootstrap'");

    const passwordSync = read('supabase/functions/_shared/request-board-password-sync.ts');
    expect(passwordSync).not.toContain('response.text()');
    expect(passwordSync).not.toContain('JSON.stringify(json)');
    expect(passwordSync).not.toContain('console.warn');
    expect(passwordSync).toContain("event: 'request_board.password_sync'");

    const notify = read('supabase/functions/fc-notify/index.ts');
    expect(notify).not.toContain('statusText: resp.statusText');
    expect(notify).not.toContain('body: text.slice(0, 300)');
    expect(notify).not.toContain("no admin recipients resolved for fc_update/fc_delete");
    expect(notify).not.toContain('admin web push callback failed');
    expect(notify).not.toContain("console.log('[fc-notify] request'");
    expect(notify).not.toContain('board attachment cleanup failed');
    expect(notify).not.toContain("console.warn('notifications insert failed'");
    expect(notify).not.toContain('device token load failed');
    expect(notify).toContain("event: 'fc_notify.admin_web_push'");
    expect(notify).toContain("event: 'fc_notify.recipient_resolution'");
    expect(notify).toContain("event: 'fc_notify.attachment_cleanup'");
    expect(notify).toContain("event: 'fc_notify.notification_insert'");
    expect(notify).toContain("event: 'fc_notify.device_token_load'");

    const presence = read('supabase/functions/user-presence/index.ts');
    expect(presence).not.toContain('rpc failed; falling back to table');
    expect(presence).toContain("event: 'user_presence.rpc_fallback'");

    const referralTree = read('supabase/functions/get-referral-tree/index.ts');
    expect(referralTree).not.toContain('rpc and fallback both failed');
    expect(referralTree).not.toContain('fallbackError instanceof Error');
    expect(referralTree).toContain("event: 'referral_tree.load'");

    for (const name of ['board-create', 'board-update']) {
      const source = read(`supabase/functions/${name}/index.ts`);
      expect(source).not.toContain('body: raw.slice(0, 300)');
      expect(source).not.toContain('push fanout returned not ok');
      expect(source).not.toContain('push fanout network error');
      expect(source).not.toContain('notifications insert failed');
      expect(source).toContain(`event: '${name.replace('-', '_')}.push_fanout'`);
      expect(source).toContain(`event: '${name.replace('-', '_')}.notification_insert'`);
    }

    const boardDetail = read('supabase/functions/board-detail/index.ts');
    expect(boardDetail).not.toContain("console.warn('[board-detail] view track failed'");
    expect(boardDetail).toContain("event: 'board.view_tracking'");

    const boardShared = read('supabase/functions/_shared/board.ts');
    expect(boardShared).not.toContain("console.error('[db_error]'");
    expect(boardShared).toContain("event: 'board.database_operation'");

    const attachmentDelete = read('supabase/functions/board-attachment-delete/index.ts');
    expect(attachmentDelete).not.toContain('storage delete error:');
    expect(attachmentDelete).toContain("reason: 'delete_failed'");

    const attachmentSign = read('supabase/functions/board-attachment-sign/index.ts');
    expect(attachmentSign).not.toContain("console.error('[storage_error]'");
    expect(attachmentSign).toContain("reason: 'signed_upload_url_failed'");

    const deleteAccount = read('supabase/functions/delete-account/index.ts');
    expect(deleteAccount).not.toContain('profileId, authDeleteError.message');
    expect(deleteAccount).not.toContain('fc-documents storage remove failed');
    expect(deleteAccount).not.toContain('board-attachments storage remove failed');
    expect(deleteAccount).not.toContain('chat-uploads storage remove failed');
    expect(deleteAccount).toContain("event: 'delete_account.auth_cleanup'");
    expect(deleteAccount).toContain("event: 'delete_account.storage_cleanup'");

    const settings = read('web/src/app/dashboard/settings/page.tsx');
    expect(settings).not.toContain('Starting account deletion via delete-account function');
    expect(settings).not.toContain("console.error('[Settings] Account deletion failed'");
    expect(settings).toContain("logger.info('[settings] account deletion requested')");
    expect(settings).toContain("logger.error('[Settings] Account deletion failed')");
  });
});
