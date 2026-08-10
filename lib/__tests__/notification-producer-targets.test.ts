import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

const readApp = (path: string) =>
  readFileSync(join(root, 'app', path), 'utf8');

function collectSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return collectSources(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('mobile notification producers use exact typed targets', () => {
  it('binds onboarding producers to their exact committed FC or notice UUID', () => {
    const docs = readApp('docs-upload.tsx');
    expect(docs).toContain("kind: 'onboarding_section'");
    expect(docs).toContain("section: 'docs_upload'");
    expect(docs).toContain('fcId,');
    expect(docs).toMatch(/sendNotificationAndPush\([\s\S]*?fc\.id,[\s\S]*?'\/dashboard'/);
    expect(docs).toContain('combineFcNotifyDeliveryResults(deliveryResults)');
    expect(docs).toContain('delivery.notificationStored === false');
    expect(docs).toContain('retryableNotificationIndexes.map(');
    expect(docs).toContain('presentPostCommitNotificationDelivery({');

    const fcNew = readApp(join('fc', 'new.tsx'));
    expect(fcNew).toContain("kind: 'fc_profile'");
    expect(fcNew).toContain('savedProfile.id');
    expect(fcNew).toContain("'updateOwnProfile'");
    expect(fcNew).toContain('presentPostCommitNotificationDelivery({');
    expect(fcNew).toContain('retryNotification: notifyProfileSaved');

    const notice = readApp('admin-notice.tsx');
    expect(notice).toContain("kind: 'notice'");
    expect(notice).toContain('noticeId,');
    expect(notice).toContain('isNotificationUuid(noticeId)');
    expect(notice).toContain('presentPostCommitNotificationDelivery({');
    expect(notice).toContain('retryNotification: notifyCreatedNotice');
  });

  it('preserves exact committed exam registration and round IDs through notification builders', () => {
    for (const path of ['exam-apply.tsx', 'exam-apply2.tsx']) {
      const source = readApp(path);
      expect(source).toContain(
        'const submissionResult = await submitExamApplicationWithPaymentProof({',
      );
      expect(source).toContain(
        'const registrationId = submissionResult.registrationId',
      );
      expect(source).toContain('examRegistrationId: registrationId');
      expect(source).toContain('if (result.failedTargets.length > 0)');
      expect(source).toContain("text: '알림 다시 등록'");
      expect(source).toContain('retryTargets,');
    }
    for (const path of ['exam-register.tsx', 'exam-register2.tsx']) {
      const source = readApp(path);
      expect(source).toContain('examRoundId: res.id');
      expect(source).toContain('result.notificationStored === false');
      expect(source).toContain("text: '알림 다시 등록'");
    }
  });

  it('keeps every production type notify call behind target validation', () => {
    const sources = [
      ...collectSources(join(root, 'app')),
      ...collectSources(join(root, 'lib')),
    ];
    const notifyProducers = sources.filter((path) =>
      /type:\s*['"]notify['"]/.test(readFileSync(path, 'utf8')),
    );

    expect(notifyProducers.length).toBeGreaterThan(0);
    const wrapper = readFileSync(
      join(root, 'lib', 'fc-notify-client.ts'),
      'utf8',
    );
    expect(wrapper).toContain("body.type === 'notify'");
    expect(wrapper).toContain('parseNotificationTarget(');
    expect(wrapper).toContain("reason: 'invalid_notification_target'");
  });
});
