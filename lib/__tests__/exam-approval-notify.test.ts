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

describe('notifyExamApprovalStatus', () => {
  beforeEach(() => {
    invokeFcNotifyForDelivery.mockReset();
    warn.mockReset();
  });

  it('fails visibly when the notification target is unavailable', async () => {
    await expect(notifyExamApprovalStatus({
      residentId: null,
      examInfo: 'exam',
      examPath: '/exam-apply',
      isConfirmed: true,
    })).rejects.toThrow('target is unavailable');

    expect(invokeFcNotifyForDelivery).not.toHaveBeenCalled();
  });

  it('fails visibly when no device delivery is confirmed', async () => {
    invokeFcNotifyForDelivery.mockResolvedValue({
      confirmed: false,
      reason: 'no_device_target',
    });

    await expect(notifyExamApprovalStatus({
      residentId: '010-0000-0000',
      examInfo: 'exam',
      examPath: '/exam-apply2',
      isConfirmed: true,
    })).rejects.toThrow('delivery was not confirmed');

    expect(invokeFcNotifyForDelivery).toHaveBeenCalledWith(expect.objectContaining({
      target_role: 'fc',
      target_id: '01000000000',
      category: 'exam_apply',
      url: '/exam-apply2',
    }));
    expect(warn).toHaveBeenCalledWith(
      '[exam-approval-notify] delivery unconfirmed',
      { reason: 'no_device_target' },
    );
  });

  it('returns success only after delivery is confirmed', async () => {
    invokeFcNotifyForDelivery.mockResolvedValue({ confirmed: true, sent: 1 });

    await expect(notifyExamApprovalStatus({
      residentId: '01000000000',
      examInfo: 'exam',
      examPath: '/exam-apply',
      isConfirmed: true,
    })).resolves.toBe(true);
  });

  it('uses the release template when a confirmed registration returns to pending', async () => {
    invokeFcNotifyForDelivery.mockResolvedValue({ confirmed: true, sent: 1 });

    await expect(notifyExamApprovalStatus({
      residentId: '01000000000',
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
