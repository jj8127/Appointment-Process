import { invokeFcNotifyForDelivery } from '@/lib/fc-notify-client';
import { logger } from '@/lib/logger';
import {
  isNotificationUuid,
  type NotificationExamType,
} from '@/lib/notification-target';

type ExamApprovalNotifyParams = {
  residentId?: string | null;
  examRegistrationId: string;
  examType: NotificationExamType;
  examInfo?: string | null;
  examPath: '/exam-apply' | '/exam-apply2';
  isConfirmed: boolean;
};

const normalizeDigits = (value?: string | null) => (value ?? '').replace(/[^0-9]/g, '');

const formatExamInfo = (value?: string | null) => {
  const trimmed = (value ?? '').trim();
  return trimmed || '시험 신청';
};

export async function notifyExamApprovalStatus({
  residentId,
  examRegistrationId,
  examType,
  examInfo,
  examPath,
  isConfirmed,
}: ExamApprovalNotifyParams): Promise<boolean> {
  const targetId = normalizeDigits(residentId);
  if (!targetId) {
    logger.warn('[exam-approval-notify] skipped: missing resident id');
    throw new Error('Exam approval notification target is unavailable.');
  }
  if (
    !isNotificationUuid(examRegistrationId)
    || examPath !== (examType === 'life' ? '/exam-apply' : '/exam-apply2')
  ) {
    logger.warn('[exam-approval-notify] skipped: invalid exam target');
    throw new Error('Exam approval notification target is unavailable.');
  }

  const normalizedExamInfo = formatExamInfo(examInfo);
  const title = isConfirmed
    ? '시험 신청이 승인되었습니다.'
    : '시험 신청 승인 상태가 변경되었습니다.';
  const body = isConfirmed
    ? `${normalizedExamInfo} 접수가 승인되었습니다. 시험 신청 화면에서 상태를 확인해주세요.`
    : `${normalizedExamInfo} 접수 완료가 해제되었습니다. 시험 신청 화면에서 상태를 확인해주세요.`;

  const delivery = await invokeFcNotifyForDelivery({
    type: 'notify',
    target_role: 'fc',
    target_id: targetId,
    title,
    body,
    category: 'exam_apply',
    url: examPath,
    target: {
      version: 1,
      kind: 'exam',
      examType,
      examRegistrationId,
    },
  });

  if (
    !delivery.confirmed
    && (
      delivery.reason === 'invalid_recipient'
      || delivery.notificationStored === false
    )
  ) {
    logger.warn('[exam-approval-notify] delivery unconfirmed', {
      reason: delivery.reason,
    });
    throw new Error('Exam approval notification delivery was not confirmed.');
  }

  return true;
}
