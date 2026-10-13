import { useQuery } from '@tanstack/react-query';
import {
  parseMyReferralCodeResponse,
} from '@/lib/referral-read-response';
import {
  type ReferralFunctionResponseEnvelope,
  useReferralAppSession,
} from './use-referral-app-session';
import { useSession } from './use-session';

export function useMyReferralCode() {
  const { role, residentId, isRequestBoardDesigner, readOnly } = useSession();
  const { invokeReferralFunction } = useReferralAppSession();
  const canUseReferralSelfService =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));

  return useQuery({
    queryKey: ['my-referral-code', role, residentId, isRequestBoardDesigner, readOnly],
    queryFn: async () => {
      const data = await invokeReferralFunction<ReferralFunctionResponseEnvelope>(
        'get-my-referral-code',
        {
          body: {},
          fallbackMessage: '추천 코드를 불러오지 못했습니다.',
        },
      );

      return parseMyReferralCodeResponse(data);
    },
    enabled: canUseReferralSelfService && Boolean(residentId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
