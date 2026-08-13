import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const functionFiles = [
  'supabase/functions/board-create/index.ts',
  'supabase/functions/board-update/index.ts',
];

describe('board write notification delivery contract', () => {
  for (const file of functionFiles) {
    it(`${file} keeps the saved write successful while returning a delivery warning`, () => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');

      expect(source).toContain('const pushTargets = notificationError');
      expect(source).toContain(': await Promise.all([');
      expect(source).toContain('signal: AbortSignal.timeout(NOTIFICATION_FETCH_TIMEOUT_MS)');
      expect(source).toContain('const confirmed = parsed?.ok === true');
      expect(source).toContain('parsed?.delivery?.notificationStored === true');
      expect(source).toContain('validatePersistedNotificationForDelivery');
      expect(source).toContain('const inboxOk = !notificationError;');
      expect(source).toContain('const pushOk = inboxOk && pushTargets.every((target) => target.ok);');
      expect(source).toContain('saved: true');
      expect(source).toContain('notification,');
      const warningSource = file.endsWith('board-create/index.ts')
        ? 'notificationWarning: inboxOk && pushOk && pushDeliveryAudit.ok'
        : "notificationWarning: inboxOk ? null : 'notification_delivery_incomplete'";
      expect(source).toContain(warningSource);
    });

    it(`${file} returns privacy-safe failure codes for every unconfirmed push path`, () => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');

      for (const failure of [
        'missing_configuration',
        'upstream_rejected',
        'invalid_response',
        'delivery_unconfirmed',
        'request_failed',
      ]) {
        expect(source).toContain(`failure: '${failure}'`);
      }

      expect(source).not.toMatch(/failure:\s*(?:error|response|raw)/);
      expect(source).not.toContain('message: parsed');
      expect(source).not.toContain('console.warn(error');
      expect(source).not.toContain('console.error(error');
    });
  }

  it('records the board-create fanout result and surfaces an unconfirmed push', () => {
    const source = readFileSync(
      join(process.cwd(), 'supabase/functions/board-create/index.ts'),
      'utf8',
    );

    expect(source).toContain(".from('notification_delivery_attempts')");
    expect(source).toContain("delivery_source: 'board_create'");
    expect(source).toContain('provider_response_status: target.providerResponseStatus');
    expect(source).toContain('response_confirmed: target.ok');
    expect(source).toContain('deliveryRecorded: pushDeliveryAudit.ok');
    expect(source).toContain('notificationWarning: inboxOk && pushOk && pushDeliveryAudit.ok');
    expect(source).not.toContain('provider_response_body');
  });
});
