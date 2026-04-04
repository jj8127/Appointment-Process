import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSession } from './use-session';

export type MyReferralCodeData = {
  code: string | null;
  recommender: string | null;
  recommenderAffiliation: string | null;
  recommenderCode: string | null;
};

async function toFunctionError(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object' || !('context' in error)) {
    return error instanceof Error ? error : new Error(fallback);
  }

  const response = (error as { context?: unknown }).context;
  if (!(response instanceof Response)) {
    return error instanceof Error ? error : new Error(fallback);
  }

  try {
    const payload = await response.clone().json() as { message?: string };
    if (typeof payload?.message === 'string' && payload.message.trim()) {
      return new Error(payload.message.trim());
    }
  } catch {
    // Ignore body parse failure and fall back to the original error.
  }

  return error instanceof Error ? error : new Error(fallback);
}

export function useMyReferralCode() {
  const { role, residentId, appSessionToken, isRequestBoardDesigner, readOnly } = useSession();
  const canUseReferralSelfService =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));

  return useQuery({
    queryKey: ['my-referral-code', role, residentId, Boolean(appSessionToken), isRequestBoardDesigner, readOnly],
    queryFn: async () => {
      if (!appSessionToken) {
        throw new Error('추천 코드를 확인하려면 다시 로그인해주세요.');
      }

      const { data, error } = await supabase.functions.invoke<{
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
          headers: {
            'x-app-session-token': appSessionToken,
          },
        },
      );
      if (error) throw await toFunctionError(error, '추천 코드를 불러오지 못했습니다.');
      if (!data?.ok) {
        throw new Error(data?.message ?? '추천 코드를 불러오지 못했습니다.');
      }
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
    enabled: canUseReferralSelfService && Boolean(residentId) && Boolean(appSessionToken),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
