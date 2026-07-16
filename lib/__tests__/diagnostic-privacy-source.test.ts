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

  test('server push delivery diagnostics and failures never retain recipient content or provider bodies', () => {
    const source = read('web/src/lib/push-notification-service.ts');
    expect(source).not.toContain("{ userId, title, body }");
    expect(source).not.toContain('tokens: tokens?.map');
    expect(source).not.toContain('const respBody = await resp.text()');
    expect(source).not.toContain('body: respBody');
    expect(source).not.toContain('Expo push notification failed: ${respBody}');
    expect(source).not.toContain("logger.error('[push-notification-service] Push notification error:', error)");
    expect(source).toContain("category: 'push_delivery'");
    expect(source).toContain("category: 'expo_push'");
    expect(source).toContain("reason: 'provider_rejected'");
    expect(source).toContain("return { success: false, error: 'Expo push notification failed' }");
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
    expect(groupChatSource).toContain("console.warn('[group-chat] expo push failed', { status: response.status })");
    expect(groupChatSource).toContain("reason: 'notification_insert_failed'");
  });
});
