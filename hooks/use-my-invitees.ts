import { useQuery } from '@tanstack/react-query';
import { useSession } from './use-session';
import { useReferralAppSession } from './use-referral-app-session';

export type Invitee = {
  id: string;
  inviteeName: string | null;
  inviteePhone: string;
  status: 'captured' | 'pending_signup' | 'confirmed' | 'rejected' | 'cancelled' | 'overridden';
  capturedAt: string;
  confirmedAt: string | null;
};

export function useMyInvitees() {
  const { role, residentId, isRequestBoardDesigner, readOnly } = useSession();
  const { appSessionToken, invokeReferralFunction } = useReferralAppSession();
  const canUseReferralSelfService =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));

  return useQuery({
    queryKey: ['my-invitees', role, residentId, Boolean(appSessionToken), isRequestBoardDesigner, readOnly],
    queryFn: async () => {
      const data = await invokeReferralFunction<{
        ok: boolean;
        invitees?: Invitee[];
        message?: string;
        code?: string;
      }>('get-my-invitees', {
        body: {},
        fallbackMessage: '초대 목록을 불러오지 못했습니다.',
      });
      return data.invitees ?? [];
    },
    enabled: canUseReferralSelfService && Boolean(residentId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
