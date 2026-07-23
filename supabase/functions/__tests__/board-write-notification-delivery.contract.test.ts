import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const functionFiles = [
  'supabase/functions/board-create/index.ts',
  'supabase/functions/board-update/index.ts',
];

describe('board write notification delivery contract', () => {
  for (const file of functionFiles) {
    it(`${file} keeps the saved write successful while exposing incomplete notification delivery`, () => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');

      expect(source).toContain('const pushTargets = await Promise.all([');
      expect(source).toContain('signal: AbortSignal.timeout(NOTIFICATION_FETCH_TIMEOUT_MS)');
      expect(source).toContain('const confirmed = parsed?.ok === true');
      expect(source).toContain('delivery.attempted > 0');
      expect(source).toContain('delivery.accepted === delivery.attempted');
      expect(source).toContain('delivery.rejected === 0');
      expect(source).toContain('sent === delivery.accepted');
      expect(source).toContain('const inboxOk = !notificationError;');
      expect(source).toContain('const pushOk = pushTargets.every((target) => target.ok);');
      expect(source).toContain('saved: true');
      expect(source).toContain('notification,');
      expect(source).toContain(
        "notificationWarning: notification.ok ? null : 'notification_delivery_incomplete'",
      );
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
});
