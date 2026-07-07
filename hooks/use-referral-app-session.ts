import { useCallback, useRef } from 'react';

import { logger } from '@/lib/logger';
import {
  clearRequestBoardState,
  getStoredAppSessionToken,
  getStoredBridgeToken,
} from '@/lib/request-board-api';
import {
  normalizeReferralFunctionFailure,
  toUserFacingReferralSessionMessage,
} from '@/lib/referral-session-error';
import { supabase } from '@/lib/supabase';

import { useSession } from './use-session';

type ReferralFunctionFailure = {
  code?: string;
  message?: string;
};

type RefreshAppSessionResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  appSessionToken?: string;
  role?: 'fc' | 'manager';
};

const SESSION_REFRESHABLE_CODES = new Set([
  'missing_app_session',
  'expired_app_session',
  'invalid_app_session',
]);

export class ReferralAppSessionError extends Error {
  code?: string;
  needsRelogin: boolean;

  constructor(message: string, options?: { code?: string; needsRelogin?: boolean }) {
    super(message);
    this.name = 'ReferralAppSessionError';
    this.code = options?.code;
    this.needsRelogin = Boolean(options?.needsRelogin);
  }
}

async function extractFunctionFailurePayload(response: Response): Promise<ReferralFunctionFailure> {
  try {
    const payload = await response.clone().json() as ReferralFunctionFailure;
    return {
      code: typeof payload?.code === 'string' ? payload.code.trim() : undefined,
      message: typeof payload?.message === 'string' ? payload.message.trim() : undefined,
    };
  } catch {
    return {};
  }
}

async function toReferralAppSessionError(error: unknown, fallback: string) {
  if (error instanceof ReferralAppSessionError) {
    return error;
  }

  if (!error || typeof error !== 'object' || !('context' in error)) {
    const normalized = normalizeReferralFunctionFailure(
      { message: error instanceof Error ? error.message : undefined },
      fallback,
    );
    return new ReferralAppSessionError(normalized.message, {
      code: normalized.code,
      needsRelogin: normalized.needsRelogin,
    });
  }

  const response = (error as { context?: unknown }).context;
  if (!(response instanceof Response)) {
    const normalized = normalizeReferralFunctionFailure(
      { message: error instanceof Error ? error.message : undefined },
      fallback,
    );
    return new ReferralAppSessionError(normalized.message, {
      code: normalized.code,
      needsRelogin: normalized.needsRelogin,
    });
  }

  const payload = await extractFunctionFailurePayload(response);
  const normalized = normalizeReferralFunctionFailure(payload, fallback);
  return new ReferralAppSessionError(
    normalized.message,
    { code: normalized.code, needsRelogin: normalized.needsRelogin },
  );
}

export function isReferralReloginError(error: unknown): error is ReferralAppSessionError {
  return error instanceof ReferralAppSessionError && error.needsRelogin;
}

export function useReferralAppSession() {
  const { appSessionToken, replaceAppSessionToken } = useSession();
  const refreshPromiseRef = useRef<Promise<string> | null>(null);

  const clearReferralSession = useCallback(async () => {
    await clearRequestBoardState({ clearAppSession: true });
    await replaceAppSessionToken(null);
  }, [replaceAppSessionToken]);

  const refreshReferralAppSession = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const refreshPromise = (async () => {
      const bridgeToken = await getStoredBridgeToken();
      if (!bridgeToken) {
        await clearReferralSession();
        throw new ReferralAppSessionError(
          toUserFacingReferralSessionMessage('missing_bridge_token', '세션이 만료되었습니다. 다시 로그인해주세요.'),
          { code: 'missing_bridge_token', needsRelogin: true },
        );
      }

      try {
        const { data, error } = await supabase.functions.invoke<RefreshAppSessionResponse>(
          'refresh-app-session',
          {
            body: { bridgeToken },
          },
        );

        if (error) {
          const parsedError = await toReferralAppSessionError(error, '세션을 복구하지 못했습니다.');
          if (parsedError.needsRelogin) {
            await clearReferralSession();
          }
          throw parsedError;
        }

        if (!data?.ok || !data.appSessionToken) {
          const normalized = normalizeReferralFunctionFailure(data ?? {}, '세션을 복구하지 못했습니다.');
          const nextError = new ReferralAppSessionError(
            normalized.message,
            { code: normalized.code, needsRelogin: normalized.needsRelogin },
          );
          if (nextError.needsRelogin) {
            await clearReferralSession();
          }
          throw nextError;
        }

        await replaceAppSessionToken(data.appSessionToken);
        return data.appSessionToken;
      } catch (error) {
        if (error instanceof ReferralAppSessionError) {
          throw error;
        }
        logger.warn('[referral-session] refresh-app-session failed', error);
        throw new ReferralAppSessionError('세션 복구 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      }
    })().finally(() => {
      refreshPromiseRef.current = null;
    });

    refreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, [clearReferralSession, replaceAppSessionToken]);

  const ensureReferralAppSession = useCallback(async () => {
    const currentToken = appSessionToken?.trim()
      ? appSessionToken.trim()
      : await getStoredAppSessionToken();

    if (currentToken) {
      if (currentToken !== appSessionToken) {
        await replaceAppSessionToken(currentToken);
      }
      return currentToken;
    }

    return refreshReferralAppSession();
  }, [appSessionToken, refreshReferralAppSession, replaceAppSessionToken]);

  const invokeReferralFunction = useCallback(async <
    TResponse extends { ok?: boolean; code?: string | null; message?: string | null },
  >(
    functionName: string,
    options: {
      body?: Record<string, unknown>;
      fallbackMessage: string;
      retryOnSessionFailure?: boolean;
    },
  ): Promise<TResponse> => {
    const execute = async (token: string) => {
      const { data, error } = await supabase.functions.invoke<TResponse>(functionName, {
        body: options.body ?? {},
        headers: {
          'x-app-session-token': token,
        },
      });

      if (error) {
        throw await toReferralAppSessionError(error, options.fallbackMessage);
      }

      if (!data?.ok) {
        const normalized = normalizeReferralFunctionFailure(data ?? {}, options.fallbackMessage);
        throw new ReferralAppSessionError(
          normalized.message,
          {
            code: normalized.code,
            needsRelogin: normalized.needsRelogin,
          },
        );
      }

      return data;
    };

    const retryOnSessionFailure = options.retryOnSessionFailure !== false;
    const token = await ensureReferralAppSession();

    try {
      return await execute(token);
    } catch (error) {
      const parsedError = await toReferralAppSessionError(error, options.fallbackMessage);
      if (!retryOnSessionFailure || !parsedError.code || !SESSION_REFRESHABLE_CODES.has(parsedError.code)) {
        throw parsedError;
      }

      const refreshedToken = await refreshReferralAppSession();
      return execute(refreshedToken);
    }
  }, [ensureReferralAppSession, refreshReferralAppSession]);

  return {
    appSessionToken,
    clearReferralSession,
    ensureReferralAppSession,
    invokeReferralFunction,
  };
}
