import { useQuery } from '@tanstack/react-query';
import {
  parseMyInviteesResponse,
} from '@/lib/referral-read-response';
import { useSession } from './use-session';
import {
  type ReferralFunctionResponseEnvelope,
  useReferralAppSession,
} from './use-referral-app-session';

export function useMyInvitees() {
  const { role, residentId, isRequestBoardDesigner, readOnly } = useSession();
  const { appSessionToken, invokeReferralFunction } = useReferralAppSession();
  const canUseReferralSelfService =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));

  return useQuery({
    queryKey: ['my-invitees', role, residentId, Boolean(appSessionToken), isRequestBoardDesigner, readOnly],
    queryFn: async () => {
      const data = await invokeReferralFunction<ReferralFunctionResponseEnvelope>('get-my-invitees', {
        body: {},
        fallbackMessage: '초대 목록을 불러오지 못했습니다.',
      });
      return parseMyInviteesResponse(data);
    },
    enabled: canUseReferralSelfService && Boolean(residentId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
