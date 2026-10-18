import { logger } from './logger';
import { collectPresenceSnapshotBatches } from './presence-read-response';
import { getStoredAppSessionToken } from './request-board-api';
import { supabase } from './supabase';

type UserPresenceAction = 'heartbeat' | 'offline' | 'read';

export type AppPresenceSnapshot = {
  phone: string;
  garam_in_at: string | null;
  garam_link_at: string | null;
  last_seen_at: string | null;
  is_online: boolean;
  updated_at: string | null;
};

type PresenceMutationData = AppPresenceSnapshot & {
  applied?: boolean;
  platform?: 'garam_in';
  platform_at?: string | null;
};

type UserPresenceMutationResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  data?: PresenceMutationData | null;
};

type UserPresenceReadResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  data?: AppPresenceSnapshot[] | null;
};

async function getUserPresenceSessionToken() {
  const sessionToken = await getStoredAppSessionToken();
  if (!sessionToken) {
    return {
      ok: false as const,
      message: '앱 세션 토큰이 없습니다.',
      code: 'missing_session_token',
    };
  }

  return {
    ok: true as const,
    sessionToken,
  };
}

export async function updateUserPresence(
  action: Extract<UserPresenceAction, 'heartbeat' | 'offline'>,
  options?: { expectedAt?: string | null },
): Promise<{
  ok: boolean;
  data?: PresenceMutationData | null;
  message?: string;
  code?: string;
}> {
  const auth = await getUserPresenceSessionToken();
  if (!auth.ok) {
    return auth;
  }

  try {
    const { data, error } = await supabase.functions.invoke<UserPresenceMutationResponse>('user-presence', {
      body: {
        sessionToken: auth.sessionToken,
        action,
        expectedAt: options?.expectedAt ?? null,
      },
    });

    if (error) {
      logger.warn('[presence] user-presence invoke failed', error);
      return {
        ok: false,
        message: error instanceof Error ? error.message : '활동 상태를 동기화하지 못했습니다.',
        code: 'network_error',
      };
    }

    if (!data?.ok) {
      return {
        ok: false,
        message: data?.message ?? '활동 상태를 동기화하지 못했습니다.',
        code: data?.code ?? 'presence_sync_failed',
      };
    }

    return {
      ok: true,
      data: data.data ?? null,
    };
  } catch (error) {
    logger.warn('[presence] user-presence invoke error', error);
    return {
      ok: false,
      message: '활동 상태 동기화 중 오류가 발생했습니다.',
      code: 'network_error',
    };
  }
}

export async function fetchUserPresence(
  phones: (string | null | undefined)[],
): Promise<AppPresenceSnapshot[]> {
  let authPromise: ReturnType<typeof getUserPresenceSessionToken> | null = null;

  return collectPresenceSnapshotBatches(phones, async (phoneBatch) => {
    const auth = await (authPromise ??= getUserPresenceSessionToken());
    if (!auth.ok) {
      logger.warn('[presence] read skipped:', auth.code);
      throw new Error(auth.message);
    }

    let result: { data: UserPresenceReadResponse | null; error: unknown };
    try {
      result = await supabase.functions.invoke<UserPresenceReadResponse>('user-presence', {
        body: {
          sessionToken: auth.sessionToken,
          action: 'read',
          phones: phoneBatch,
        },
      });
    } catch (error) {
      logger.warn('[presence] user-presence read error', error);
      throw error;
    }

    if (result.error) {
      logger.warn('[presence] user-presence read failed', result.error);
      throw result.error;
    }

    if (!result.data?.ok) {
      logger.warn('[presence] user-presence read rejected', {
        code: result.data?.code,
        message: result.data?.message,
      });
      throw new Error(result.data?.message ?? '활동 상태를 불러오지 못했습니다.');
    }

    return result.data.data;
  });
}
