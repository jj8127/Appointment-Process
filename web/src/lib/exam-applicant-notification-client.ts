import { classifyFcNotificationResult } from './admin-chat-notification-result';
import { logger } from './logger';

type ExamApprovalNotificationTarget = {
  phone: string;
  exam_date: string | null;
  round_label: string;
  location_name: string;
  exam_type?: string | null;
};

function formatExamApprovalInfo(item: ExamApprovalNotificationTarget): string {
  const dateLabel = item.exam_date?.slice(0, 10) || '시험 일정';
  const roundLabel = item.round_label && item.round_label !== '-' ? ` (${item.round_label})` : '';
  const locationLabel = item.location_name && item.location_name !== '미정' ? ` [${item.location_name}]` : '';
  return `${dateLabel}${roundLabel}${locationLabel}`;
}

export async function notifyFcExamApprovalStatus(
  item: ExamApprovalNotificationTarget,
  isConfirmed: boolean,
): Promise<void> {
  const targetId = (item.phone ?? '').replace(/[^0-9]/g, '');
  if (!targetId) {
    throw new Error('FC 전화번호를 찾을 수 없습니다.');
  }

  let response: Response;
  try {
    response = await fetch('/api/fc-notify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        type: 'exam_approval_notify',
        target_id: targetId,
        is_confirmed: isConfirmed,
        exam_info: formatExamApprovalInfo(item),
        exam_type: item.exam_type,
      }),
    });
  } catch {
    logger.warn('[exam-applicant] mobile notification unconfirmed', {
      reason: 'network_error',
      status: 0,
    });
    throw new Error('FC 모바일 알림 전달을 확인하지 못했습니다.');
  }

  const responseBody: unknown = await response.json().catch(() => null);
  const result = classifyFcNotificationResult(response.status, responseBody);
  if (!result.ok) {
    logger.warn('[exam-applicant] mobile notification unconfirmed', {
      reason: result.reason,
      status: response.status,
    });
    throw new Error('FC 모바일 알림 전달을 확인하지 못했습니다.');
  }

  logger.debug('[exam-applicant] mobile notification confirmed', {
    sent: result.sent,
    status: response.status,
  });
}
