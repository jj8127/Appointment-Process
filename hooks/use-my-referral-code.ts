import { useQuery } from '@tanstack/react-query';
import { useReferralAppSession } from './use-referral-app-session';
import { useSession } from './use-session';

export type MyReferralCodeData = {
  code: string | null;
  recommender: string | null;
  recommenderAffiliation: string | null;
  recommenderCode: string | null;
};

export function useMyReferralCode() {
  const { role, residentId, isRequestBoardDesigner, readOnly } = useSession();
  const { invokeReferralFunction } = useReferralAppSession();
  const canUseReferralSelfService =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));

  return useQuery({
    queryKey: ['my-referral-code', role, residentId, isRequestBoardDesigner, readOnly],
    queryFn: async () => {
      const data = await invokeReferralFunction<{
        ok: boolean;
        code: string | null;
        recommender?: string | null;
        recommenderAffiliation?: string | null;
        recommenderCode?: string | null;
        codeId?: string | null;
        createdAt?: string | null;
        message?: string;
      }>(
        'get-my-referral-code',
        {
          body: {},
          fallbackMessage: '추천 코드를 불러오지 못했습니다.',
        },
      );

      return {
        code: data.code ?? null,
        recommender: typeof data.recommender === 'string' && data.recommender.trim()
          ? data.recommender.trim()
          : null,
        recommenderAffiliation: typeof data.recommenderAffiliation === 'string' && data.recommenderAffiliation.trim()
          ? data.recommenderAffiliation.trim()
          : null,
        recommenderCode: typeof data.recommenderCode === 'string' && data.recommenderCode.trim()
          ? data.recommenderCode.trim()
          : null,
      } satisfies MyReferralCodeData;
    },
    enabled: canUseReferralSelfService && Boolean(residentId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
