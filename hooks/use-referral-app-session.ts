import { useCallback, useEffect, useRef } from 'react';

import { logger } from '@/lib/logger';
import {
  captureAppSessionOwner,
  clearRequestBoardState,
  getStoredAppSessionToken,
  getStoredBridgeToken,
} from '@/lib/request-board-api';
import { createReadScope } from '@/lib/request-board-read-state';
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
  status?: number;
  needsRelogin: boolean;

  constructor(message: string, options?: { code?: string; status?: number; needsRelogin?: boolean }) {
    super(message);
    this.name = 'ReferralAppSessionError';
    this.code = options?.code;
    this.status = options?.status;
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

  const response = error && typeof error === 'object' && 'context' in error
    ? error.context : undefined;
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
    { code: normalized.code, status: response.status, needsRelogin: normalized.needsRelogin || response.status === 401 },
  );
}

export function isReferralReloginError(error: unknown): error is ReferralAppSessionError {
  return error instanceof ReferralAppSessionError && error.needsRelogin;
}

function sessionChangedError() {
  return new ReferralAppSessionError('로그인 세션이 변경되었습니다. 다시 시도해주세요.', { code: 'session_changed' });
}

export function useReferralAppSession() {
  const { appSessionToken, replaceAppSessionToken, role, residentId, readOnly, hydrated } = useSession();
  const currentTokenRef = useRef(appSessionToken);
  currentTokenRef.current = appSessionToken;
  const ownerKey = JSON.stringify([role, residentId, readOnly, hydrated]);
  const ownerScopeRef = useRef(createReadScope());
  ownerScopeRef.current.setScope(ownerKey);
  useEffect(() => {
    const ownerScope = ownerScopeRef.current;
    return () => { ownerScope.invalidate(); };
  }, []);
  const captureOwner = useCallback(() => {
    const ownsScope = ownerScopeRef.current.captureOwner(ownerKey);
    const ownsStoredSession = captureAppSessionOwner();
    return () => ownsScope() && ownsStoredSession();
  }, [ownerKey]);
  const refreshPromiseRef = useRef<{ isCurrent: () => boolean; promise: Promise<string> } | null>(null);

  const clearReferralSession = useCallback(async () => {
    if (!ownerScopeRef.current.captureOwner(ownerKey)()) throw sessionChangedError();
    const cleanup = clearRequestBoardState({ clearAppSession: true });
    const ownsCleanup = captureOwner();
    await cleanup;
    if (!ownsCleanup()) throw sessionChangedError();
    const replacement = replaceAppSessionToken(null);
    const ownsReplacement = captureOwner();
    await replacement;
    if (!ownsReplacement()) throw sessionChangedError();
  }, [captureOwner, ownerKey, replaceAppSessionToken]);

  const refreshReferralAppSession = useCallback(async () => {
    const pending = refreshPromiseRef.current;
    if (pending?.isCurrent()) {
      return pending.promise;
    }

    let isCurrent = captureOwner();
    const refreshPromise = (async () => {
      try {
        const bridgeToken = await getStoredBridgeToken();
        if (!isCurrent()) throw sessionChangedError();
        if (!bridgeToken) {
          throw new ReferralAppSessionError(
            toUserFacingReferralSessionMessage('missing_bridge_token', '세션이 만료되었습니다. 다시 로그인해주세요.'),
            { code: 'missing_bridge_token', needsRelogin: true },
          );
        }
        const { data, error } = await supabase.functions.invoke<RefreshAppSessionResponse>(
          'refresh-app-session',
          {
            body: { bridgeToken },
          },
        );
        if (!isCurrent()) throw sessionChangedError();

        if (error) {
          throw await toReferralAppSessionError(error, '세션을 복구하지 못했습니다.');
        }

        if (!data?.ok || !data.appSessionToken) {
          const normalized = normalizeReferralFunctionFailure(data ?? {}, '세션을 복구하지 못했습니다.');
          throw new ReferralAppSessionError(
            normalized.message,
            { code: normalized.code, needsRelogin: normalized.needsRelogin },
          );
        }

        const replacement = replaceAppSessionToken(data.appSessionToken);
        isCurrent = captureOwner();
        await replacement;
        if (!isCurrent()) throw sessionChangedError();
        return data.appSessionToken;
      } catch (error) {
        if (error instanceof ReferralAppSessionError && error.code === 'session_changed') throw error;
        if (!isCurrent()) throw sessionChangedError();
        if (error instanceof ReferralAppSessionError) {
          if (error.needsRelogin) await clearReferralSession();
          throw error;
        }
        logger.warn('[referral-session] refresh-app-session failed');
        throw new ReferralAppSessionError('세션 복구 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      }
    })();

    const flight = { isCurrent: () => isCurrent(), promise: refreshPromise };
    refreshPromiseRef.current = flight;
    try { return await refreshPromise; }
    finally { if (refreshPromiseRef.current === flight) refreshPromiseRef.current = null; }
  }, [captureOwner, clearReferralSession, replaceAppSessionToken]);

  const ensureReferralAppSession = useCallback(async () => {
    const isCurrent = captureOwner();
    const currentToken = currentTokenRef.current?.trim()
      ? currentTokenRef.current.trim()
      : await getStoredAppSessionToken();
    if (!isCurrent()) throw sessionChangedError();

    if (currentToken) {
      if (currentToken !== currentTokenRef.current) {
        const replacement = replaceAppSessionToken(currentToken);
        const ownsReplacement = captureOwner();
        await replacement;
        if (!ownsReplacement()) throw sessionChangedError();
      }
      return currentToken;
    }

    return refreshReferralAppSession();
  }, [captureOwner, refreshReferralAppSession, replaceAppSessionToken]);

  const invokeReferralFunction = useCallback(async <
    TResponse extends { ok?: boolean; code?: string | null; message?: string | null },
  >(
    functionName: string,
    options: {
      body?: Record<string, unknown>;
      fallbackMessage: string;
      retryOnSessionFailure?: boolean;
      /** Read with the currently signed token only; never restore, refresh, replace, or clear session storage. */
      requireCurrentToken?: boolean;
    },
  ): Promise<TResponse> => {
    const execute = async (token: string, isCurrent = () => true) => {
      const { data, error } = await supabase.functions.invoke<TResponse>(functionName, {
        body: options.body ?? {},
        headers: {
          'x-app-session-token': token,
        },
      });
      if (!isCurrent()) throw sessionChangedError();

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

    if (options.requireCurrentToken) {
      const currentToken = appSessionToken?.trim();
      if (!currentToken) {
        throw new ReferralAppSessionError('로그인 후 다시 확인해주세요.', {
          code: 'missing_app_session', needsRelogin: true,
        });
      }
      return execute(currentToken);
    }

    const retryOnSessionFailure = options.retryOnSessionFailure !== false;
    const token = await ensureReferralAppSession();
    const ownsRequest = captureOwner();

    try {
      return await execute(token, ownsRequest);
    } catch (error) {
      const parsedError = await toReferralAppSessionError(error, options.fallbackMessage);
      if (!ownsRequest()) throw sessionChangedError();
      if (!retryOnSessionFailure || !parsedError.code || !SESSION_REFRESHABLE_CODES.has(parsedError.code)) {
        throw parsedError;
      }

      const refreshedToken = await refreshReferralAppSession();
      return execute(refreshedToken, captureOwner());
    }
  }, [appSessionToken, captureOwner, ensureReferralAppSession, refreshReferralAppSession]);

  return {
    appSessionToken,
    clearReferralSession,
    ensureReferralAppSession,
    invokeReferralFunction,
  };
}
