import fs from 'node:fs';
import path from 'node:path';

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');

describe('mobile admin canonical FC notification target', () => {
  const edgeSource = readRepoFile('supabase/functions/admin-action/index.ts');
  const dashboardSource = readRepoFile('app/dashboard.tsx');

  it('resolves the current FC phone from the trusted fcId immediately before delivery', () => {
    expect(edgeSource).toContain('resolveCanonicalFcNotificationTarget(fcId)');
    expect(edgeSource).toContain(".from('fc_profiles')");
    expect(edgeSource).toContain(".select('phone')");
    expect(edgeSource).toContain(".eq('id', fcId)");
    expect(edgeSource).toContain('/^010\\d{8}$/.test(phone)');
    expect(edgeSource).toContain('resident_id: target.phone');
    expect(edgeSource).toContain('target_id: input.phone');
    expect(edgeSource).toContain('skip_notification_insert: true');
  });

  it('fails closed with a fixed post-commit warning when the canonical target is unavailable', () => {
    expect(edgeSource).toContain("const NOTIFICATION_DELIVERY_WARNING = 'notification_delivery_incomplete'");
    expect(edgeSource).toContain("reason: 'target_lookup_failed'");
    expect(edgeSource).toContain("reason: 'target_not_found'");
    expect(edgeSource).toContain("reason: 'target_phone_invalid'");
    expect(edgeSource).toContain('warning: NOTIFICATION_DELIVERY_WARNING');
    expect(edgeSource).not.toMatch(/console\.(?:log|warn|error)\([^)]*(?:phone|target|error)/);
  });

  it('bounds the downstream push attempt and keeps raw downstream failures out of the response', () => {
    expect(edgeSource).toContain('setTimeout(() => controller.abort(), 10_000)');
    expect(edgeSource).toContain('signal: controller.signal');
    expect(edgeSource).toContain('clearTimeout(timeoutId)');
    expect(edgeSource).not.toContain('message: response');
    expect(edgeSource).not.toContain('message: data');
  });

  it('sends only the canonical fcId from every dashboard workflow notification call', () => {
    const helperStart = dashboardSource.indexOf('async function sendNotificationAndPush');
    const helperEnd = dashboardSource.indexOf(
      'type NotificationAndPushResult',
      helperStart,
    );
    const helper = dashboardSource.slice(helperStart, helperEnd);
    const calls = Array.from(
      dashboardSource
        .slice(helperEnd)
        .matchAll(/sendNotificationAndPush\([\s\S]*?\)/g),
      (match) => match[0],
    );

    expect(helper).toContain("invokeAdminAction<{");
    expect(helper).toContain(">(adminPhone, 'sendNotification'");
    expect(helper).toContain('fcId,');
    expect(helper).toContain('.catch(() => null)');
    expect(helper).toContain("reason: 'transport_error'");
    expect(helper).not.toContain('phone:');
    expect(helper).not.toContain('target_id');
    expect(helper).not.toContain('invokeFcNotifyForDelivery');
    expect(calls.length).toBeGreaterThanOrEqual(15);
    for (const call of calls) {
      expect(call).not.toContain("'fc'");
      expect(call).not.toMatch(/\b(?:fc|rejectTarget)\.phone\b/);
      expect(call).not.toMatch(/\bphone\b/);
    }
  });
});
