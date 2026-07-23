import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, '..', '..', 'supabase', 'functions', 'docs-deadline-reminder', 'index.ts'),
  'utf8',
);

describe('docs deadline reminder delivery confirmation', () => {
  it('requires the exact service-role bearer inside the handler while allowing preflight', () => {
    const optionsGuard = source.indexOf("if (req.method === 'OPTIONS')");
    const authGuard = source.indexOf('const authorizationFailure = cronAuthorizationFailure(req)');

    expect(source).toContain("req.headers.get('Authorization')");
    expect(source).toContain('constantTimeTextEqual(authorization, `Bearer ${serviceKey}`)');
    expect(source).toContain("error: 'Unauthorized'");
    expect(source).toContain("error: 'Forbidden'");
    expect(optionsGuard).toBeGreaterThan(-1);
    expect(authGuard).toBeGreaterThan(optionsGuard);
    expect(source).not.toContain("req.headers.get('apikey')");
    expect(source).not.toContain('console.log(authorization');
    expect(source).not.toContain('console.warn(authorization');
  });

  it('counts only Expo HTTP/ticket accepted deliveries', () => {
    expect(source).toContain("from '../_shared/expo-push-delivery.ts'");
    expect(source).toContain('classifyExpoPushDelivery(chunk.length, resp.status, responseBody)');
    expect(source).toContain('mergeExpoPushDeliverySummaries(chunks)');
    expect(source).toContain('sent += delivery.accepted');
    expect(source).not.toContain('sent += tokens.length');
  });

  it('bounds each Expo provider call without exposing upstream errors', () => {
    expect(source).toContain('const EXPO_PUSH_TIMEOUT_MS = 10_000;');
    expect(source).toContain('signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS)');
    expect(source).toContain('classifyExpoPushDelivery(chunk.length, 0, null)');
    expect(source).not.toContain('console.warn(error');
    expect(source).not.toContain('console.error(error');
  });

  it('keeps failed recipients retryable by advancing the reminder date only after full acceptance', () => {
    const acceptanceGuard = source.indexOf('if (!deliveryConfirmed)');
    const reminderUpdate = source.indexOf(
      ".update({ docs_deadline_last_notified_at: today })",
      acceptanceGuard,
    );
    const tokenLookupWarning = source.indexOf('warningCounts.token_lookup_failed += 1;');
    const noTokenWarning = source.indexOf('warningCounts.no_registered_tokens += 1;');

    expect(acceptanceGuard).toBeGreaterThan(-1);
    expect(source).toContain('delivery.attempted > 0');
    expect(source).toContain('delivery.accepted === delivery.attempted');
    expect(source).toContain('delivery.rejected === 0');
    expect(source.indexOf('continue;', acceptanceGuard)).toBeLessThan(reminderUpdate);
    expect(reminderUpdate).toBeGreaterThan(acceptanceGuard);
    expect(source.indexOf('continue;', tokenLookupWarning)).toBeLessThan(noTokenWarning);
    expect(source.indexOf('continue;', noTokenWarning)).toBeLessThan(acceptanceGuard);
  });

  it('deduplicates the daily inbox row without preventing push retry', () => {
    const existingLookup = source.indexOf('const existingNotification = await hasNotificationForKstDay');
    const conditionalInsert = source.indexOf('if (!existingNotification.exists)', existingLookup);
    const tokenLookup = source.indexOf(".from('device_tokens')", conditionalInsert);
    const acceptanceGuard = source.indexOf('if (!deliveryConfirmed)', tokenLookup);

    expect(source).toContain(".eq('fc_id', input.fcId)");
    expect(source).toContain(".eq('category', input.category)");
    expect(source).toContain(".gte('created_at', bounds.start)");
    expect(source).toContain(".lt('created_at', bounds.end)");
    expect(existingLookup).toBeGreaterThan(-1);
    expect(conditionalInsert).toBeGreaterThan(existingLookup);
    expect(tokenLookup).toBeGreaterThan(conditionalInsert);
    expect(acceptanceGuard).toBeGreaterThan(tokenLookup);
    expect(source).toContain('notification_log_lookup_failed');
  });

  it('reports only privacy-safe aggregate warnings for provider and persistence failures', () => {
    expect(source).toContain('provider_delivery_not_accepted');
    expect(source).toContain('provider_ticket_rejected');
    expect(source).toContain("console.warn('[docs-deadline-reminder] completed with retryable warnings', { errors })");
    expect(source).not.toContain('result: responseBody');
    expect(source).not.toContain('errors.push(`');
    expect(source).not.toContain('${row.id}');
    expect(source).not.toContain('${t.expo_push_token}');
    expect(source).not.toContain('authorization });');
    expect(source).not.toContain('serviceKey });');
  });
});
