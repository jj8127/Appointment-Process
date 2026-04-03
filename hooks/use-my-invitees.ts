import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSession } from './use-session';

export type Invitee = {
  id: string;
  inviteeName: string | null;
  inviteePhone: string;
  status: 'captured' | 'pending_signup' | 'confirmed' | 'rejected' | 'cancelled' | 'overridden';
  capturedAt: string;
  confirmedAt: string | null;
};

export function useMyInvitees() {
  const { role, residentId, appSessionToken, isRequestBoardDesigner, readOnly } = useSession();
  const canUseReferralSelfService =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));

  return useQuery({
    queryKey: ['my-invitees', role, residentId, Boolean(appSessionToken), isRequestBoardDesigner, readOnly],
    queryFn: async () => {
      if (!appSessionToken) {
        throw new Error('초대 목록을 확인하려면 다시 로그인해주세요.');
      }

      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        invitees?: Invitee[];
        message?: string;
        code?: string;
      }>(
        'get-my-invitees',
        {
          body: {},
          headers: {
            Authorization: `Bearer ${appSessionToken}`,
          },
        },
      );
      if (error) throw error;
      if (!data?.ok) {
        throw new Error(data?.message ?? '초대 목록을 불러오지 못했습니다.');
      }
      return data.invitees ?? [];
    },
    enabled: canUseReferralSelfService && Boolean(residentId) && Boolean(appSessionToken),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
