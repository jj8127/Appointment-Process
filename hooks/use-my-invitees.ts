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
            'x-app-session-token': appSessionToken,
          },
        },
      );
      if (error) throw await toFunctionError(error, '초대 목록을 불러오지 못했습니다.');
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
