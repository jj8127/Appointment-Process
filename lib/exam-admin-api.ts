import { invokeAdminAction } from '@/lib/admin-action-api';

export type ExamAdminTransitionAction =
  | 'confirm'
  | 'unconfirm'
  | 'reject'
  | 'cancel_by_admin';

type TransitionExamRegistrationParams = {
  adminPhone: string;
  registrationId: string;
  action: ExamAdminTransitionAction;
  reason?: string | null;
};

const normalizeDigits = (value?: string | null) => (value ?? '').replace(/[^0-9]/g, '');

export async function transitionExamRegistrationAsAdmin({
  adminPhone,
  registrationId,
  action,
  reason,
}: TransitionExamRegistrationParams): Promise<{
  status: string;
  cleanupWarning: boolean;
}> {
  const normalizedAdminPhone = normalizeDigits(adminPhone);
  const normalizedRegistrationId = String(registrationId ?? '').trim();

  if (!normalizedAdminPhone) {
    throw new Error('관리자 전화번호를 확인할 수 없습니다.');
  }

  if (!normalizedRegistrationId) {
    throw new Error('삭제할 시험 신청 정보를 확인할 수 없습니다.');
  }

  const normalizedReason = String(reason ?? '').trim();
  if (action === 'reject' && (normalizedReason.length < 1 || normalizedReason.length > 1000)) {
    throw new Error('반려 사유를 1자 이상 1000자 이하로 입력해주세요.');
  }

  const data = await invokeAdminAction<{
    status?: string;
    cleanupWarning?: boolean;
  }>(
    normalizedAdminPhone,
    'transitionExamRegistration',
    {
      registrationId: normalizedRegistrationId,
      transition: action,
      reason: action === 'reject' ? normalizedReason : null,
    },
  );

  return {
    status: String(data.status ?? ''),
    cleanupWarning: Boolean(data.cleanupWarning),
  };
}

export async function deleteExamRegistrationAsAdmin({
  adminPhone,
  registrationId,
}: Omit<TransitionExamRegistrationParams, 'action' | 'reason'>): Promise<boolean> {
  await transitionExamRegistrationAsAdmin({
    adminPhone,
    registrationId,
    action: 'cancel_by_admin',
  });
  return true;
}
