import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSession } from './use-session';

export function useMyReferralCode() {
  const { role, residentId, appSessionToken, isRequestBoardDesigner } = useSession();

  return useQuery({
    queryKey: ['my-referral-code', role, residentId, Boolean(appSessionToken), isRequestBoardDesigner],
    queryFn: async () => {
      if (!appSessionToken) {
        throw new Error('추천 코드를 확인하려면 다시 로그인해주세요.');
      }

      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        code: string | null;
        codeId?: string | null;
        createdAt?: string | null;
        message?: string;
      }>(
        'get-my-referral-code',
        {
          body: {},
          headers: {
            Authorization: `Bearer ${appSessionToken}`,
          },
        },
      );
      if (error) throw error;
      if (!data?.ok) {
        throw new Error(data?.message ?? '추천 코드를 불러오지 못했습니다.');
      }
      return data.code ?? null;
    },
    enabled: role === 'fc' && !isRequestBoardDesigner && Boolean(residentId) && Boolean(appSessionToken),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
