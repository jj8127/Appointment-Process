import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

type ExamApprovalNotifyParams = {
  residentId?: string | null;
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
  examInfo,
  examPath,
  isConfirmed,
}: ExamApprovalNotifyParams): Promise<boolean> {
  const targetId = normalizeDigits(residentId);
  if (!targetId) {
    logger.warn('[exam-approval-notify] skipped: missing resident id');
    return false;
  }

  const normalizedExamInfo = formatExamInfo(examInfo);
  const title = isConfirmed
    ? '시험 신청이 승인되었습니다.'
    : '시험 신청 승인 상태가 변경되었습니다.';
  const body = isConfirmed
    ? `${normalizedExamInfo} 접수가 승인되었습니다. 시험 신청 화면에서 상태를 확인해주세요.`
    : `${normalizedExamInfo} 접수 완료가 해제되었습니다. 시험 신청 화면에서 상태를 확인해주세요.`;

  const { data, error } = await supabase.functions.invoke('fc-notify', {
    body: {
      type: 'notify',
      target_role: 'fc',
      target_id: targetId,
      title,
      body,
      category: 'exam_apply',
      url: examPath,
    },
  });

  if (error) throw error;
  if (!data?.ok) {
    throw new Error(data?.message ?? '시험 승인 알림 전송 실패');
  }

  return true;
}
