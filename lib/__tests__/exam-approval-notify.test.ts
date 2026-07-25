const invokeFcNotifyForDelivery = jest.fn();
const warn = jest.fn();

jest.mock('@/lib/fc-notify-client', () => ({
  invokeFcNotifyForDelivery: (...args: unknown[]) => invokeFcNotifyForDelivery(...args),
}));

jest.mock('@/lib/logger', () => ({
  logger: { warn: (...args: unknown[]) => warn(...args) },
}));

// Jest hoists the mocks above the imported module under test.
// eslint-disable-next-line import/first
import { notifyExamApprovalStatus } from '@/lib/exam-approval-notify';

const examRegistrationId = '11111111-1111-4111-8111-111111111111';

describe('notifyExamApprovalStatus', () => {
  beforeEach(() => {
    invokeFcNotifyForDelivery.mockReset();
    warn.mockReset();
  });

  it('fails visibly when the notification target is unavailable', async () => {
    await expect(notifyExamApprovalStatus({
      residentId: null,
      examRegistrationId,
      examType: 'life',
      examInfo: 'exam',
      examPath: '/exam-apply',
      isConfirmed: true,
    })).rejects.toThrow('target is unavailable');

    expect(invokeFcNotifyForDelivery).not.toHaveBeenCalled();
  });

  it('treats a stored inbox notification with no device as success', async () => {
    invokeFcNotifyForDelivery.mockResolvedValue({
      confirmed: true,
      notificationStored: true,
      sent: 0,
      state: 'stored_no_registered_device',
    });

    await expect(notifyExamApprovalStatus({
      residentId: '010-0000-0000',
      examRegistrationId,
      examType: 'nonlife',
      examInfo: 'exam',
      examPath: '/exam-apply2',
      isConfirmed: true,
    })).resolves.toBe(true);

    expect(invokeFcNotifyForDelivery).toHaveBeenCalledWith(expect.objectContaining({
      target_role: 'fc',
      target_id: '01000000000',
      category: 'exam_apply',
      url: '/exam-apply2',
      target: {
        version: 1,
        kind: 'exam',
        examType: 'nonlife',
        examRegistrationId,
      },
    }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('fails visibly when canonical inbox persistence fails', async () => {
    invokeFcNotifyForDelivery.mockResolvedValue({
      confirmed: false,
      notificationStored: false,
      reason: 'persistence_failed',
    });

    await expect(notifyExamApprovalStatus({
      residentId: '010-0000-0000',
      examRegistrationId,
      examType: 'nonlife',
      examInfo: 'exam',
      examPath: '/exam-apply2',
      isConfirmed: true,
    })).rejects.toThrow('delivery was not confirmed');

    expect(warn).toHaveBeenCalledWith(
      '[exam-approval-notify] delivery unconfirmed',
      { reason: 'persistence_failed' },
    );
  });

  it('returns success only after delivery is confirmed', async () => {
    invokeFcNotifyForDelivery.mockResolvedValue({ confirmed: true, sent: 1 });

    await expect(notifyExamApprovalStatus({
      residentId: '01000000000',
      examRegistrationId,
      examType: 'life',
      examInfo: 'exam',
      examPath: '/exam-apply',
      isConfirmed: true,
    })).resolves.toBe(true);
  });

  it('uses the release template when a confirmed registration returns to pending', async () => {
    invokeFcNotifyForDelivery.mockResolvedValue({ confirmed: true, sent: 1 });

    await expect(notifyExamApprovalStatus({
      residentId: '01000000000',
      examRegistrationId,
      examType: 'life',
      examInfo: '생명보험 7차',
      examPath: '/exam-apply',
      isConfirmed: false,
    })).resolves.toBe(true);

    expect(invokeFcNotifyForDelivery).toHaveBeenCalledWith(expect.objectContaining({
      title: '시험 신청 승인 상태가 변경되었습니다.',
      body: expect.stringContaining('접수 완료가 해제되었습니다.'),
      url: '/exam-apply',
    }));
  });
});
