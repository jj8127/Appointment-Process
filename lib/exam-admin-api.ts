import { supabase } from '@/lib/supabase';

type DeleteExamRegistrationParams = {
  adminPhone: string;
  registrationId: string;
};

const normalizeDigits = (value?: string | null) => (value ?? '').replace(/[^0-9]/g, '');

export async function deleteExamRegistrationAsAdmin({
  adminPhone,
  registrationId,
}: DeleteExamRegistrationParams): Promise<boolean> {
  const normalizedAdminPhone = normalizeDigits(adminPhone);
  const normalizedRegistrationId = String(registrationId ?? '').trim();

  if (!normalizedAdminPhone) {
    throw new Error('관리자 전화번호를 확인할 수 없습니다.');
  }

  if (!normalizedRegistrationId) {
    throw new Error('삭제할 시험 신청 정보를 확인할 수 없습니다.');
  }

  const { data, error } = await supabase.functions.invoke('admin-action', {
    body: {
      adminPhone: normalizedAdminPhone,
      action: 'deleteExamRegistration',
      payload: { registrationId: normalizedRegistrationId },
    },
  });

  if (error) {
    throw error;
  }

  if (!data?.ok) {
    throw new Error(data?.message ?? '시험 신청 삭제에 실패했습니다.');
  }

  return Boolean(data.deleted ?? true);
}
