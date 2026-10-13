import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

describe('FC submit notification source', () => {
  it.each([
    'appointment.tsx',
    'consent.tsx',
    'hanwha-commission.tsx',
  ])('%s awaits canonical notification delivery and uses notification-only retry', (fileName) => {
    const source = readFileSync(join(root, 'app', fileName), 'utf8');

    expect(source).toContain('const notifyAdmins = () => invokeFcNotifyForDelivery({');
    expect(source).toContain('const notificationDelivery = await notifyAdmins()');
    expect(source).toContain('presentPostCommitNotificationDelivery({');
    expect(source).toContain('retryNotification: notifyAdmins');
    expect(source).not.toContain('알림 확인 필요');
    expect(source).not.toContain('정보는 정상 저장됐지만 담당자 알림 전달을 확인하지 못했습니다.');
    expect(source).not.toContain('.catch(() => undefined)');
    expect(source).not.toContain('.catch(() => { });');
  });

  it('verifies the Hanwha submission against the requested profile and date before notifying', () => {
    const mobileSource = readFileSync(join(root, 'app', 'hanwha-commission.tsx'), 'utf8');
    const edgeSource = readFileSync(
      join(root, 'supabase', 'functions', 'fc-submit-hanwha-commission', 'index.ts'),
      'utf8',
    );

    expect(edgeSource).toContain("from '../_shared/ux-mutation-contract.ts'");
    expect(edgeSource).toContain('requireMutationRowReceipt(updated, {');
    expect(edgeSource).not.toContain('updated ?? { id: profile.id');
    expect(mobileSource).toContain('requireHanwhaSubmissionReceipt(data.data, profile.id, ymd)');
    expect(mobileSource).toContain("row.status !== 'hanwha-commission-review'");
    expect(mobileSource).toContain('row.hanwha_commission_date_sub !== expectedDate');
    expect(mobileSource.indexOf('requireHanwhaSubmissionReceipt(data.data, profile.id, ymd)'))
      .toBeLessThan(mobileSource.indexOf('const notifyAdmins = () => invokeFcNotifyForDelivery({'));
  });
});
