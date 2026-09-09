import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import type { ReferralAllowanceAccessResponse, ReferralAllowanceStatement, ReferralAllowanceStatementResponse } from '@/types/referral-allowance';

import { ReferralAppSessionError, useReferralAppSession } from './use-referral-app-session';
import { useSession } from './use-session';

type AllowanceResponse = (ReferralAllowanceAccessResponse | ReferralAllowanceStatementResponse)
  & { statement?: ReferralAllowanceStatement | null };

let nextSessionScope = 0;

/** A screen hint only; the endpoint independently verifies the signed FC/manager. */
export function canRequestReferralAllowance(session: {
  hydrated: boolean;
  role: string | null;
  readOnly: boolean;
  isRequestBoardDesigner: boolean;
  residentId: string;
  appSessionToken: string | null;
}) {
  return session.hydrated && (session.role === 'fc' || (session.role === 'admin' && session.readOnly))
    && !session.isRequestBoardDesigner && Boolean(session.residentId)
    && Boolean(session.appSessionToken);
}

function useAllowanceQuery(action: 'access' | 'statement', month?: string) {
  const session = useSession();
  const { invokeReferralFunction } = useReferralAppSession();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const canRequest = canRequestReferralAllowance(session);
  // Only an opaque, in-memory scope enters the query key. Tokens and account identifiers do not.
  const identity = JSON.stringify([session.residentId, session.role, session.readOnly,
    session.isRequestBoardDesigner, session.hydrated, Boolean(session.appSessionToken)]);
  const scope = useMemo(() => ({ identity, id: ++nextSessionScope }), [identity]).id;
  const needsLogin = session.hydrated && (session.role === 'fc' || (session.role === 'admin' && session.readOnly))
    && !session.isRequestBoardDesigner && Boolean(session.residentId) && !session.appSessionToken;
  const localSessionError = useMemo(() => needsLogin
    ? new ReferralAppSessionError('로그인 후 증원수당 내역을 다시 확인해주세요.', { needsRelogin: true }) : null, [needsLogin]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const requestSequence = useRef(0);
  const queryKey = useMemo(() => ['referral-allowance', scope, action, month ?? 'latest'] as const,
    [scope, action, month]);
  const requestContext = `${scope}:${action}:${month ?? 'latest'}`;
  const currentRequestContext = useRef(requestContext);
  currentRequestContext.current = requestContext;

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const request = ++requestSequence.current;
      const owner = identity;
      const data = await invokeReferralFunction<AllowanceResponse>('get-my-referral-allowance', {
        body: action === 'access' ? { action } : { action, ...(month ? { month } : {}) },
        fallbackMessage: '증원수당 내역을 불러오지 못했습니다. 다시 시도해주세요.',
        requireCurrentToken: true,
      });
      if (signal.aborted || request !== requestSequence.current || currentIdentity.current !== owner
        || currentRequestContext.current !== requestContext) {
        throw new Error('종료된 수당 조회 요청입니다.');
      }
      if (typeof data.enabled !== 'boolean'
        || (data.enabled && (!Array.isArray(data.availableMonths)
          || data.availableMonths.some((item) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(item))))) {
        throw new Error('수당 조회 응답을 확인하지 못했습니다. 다시 시도해주세요.');
      }
      if (action === 'statement' && data.enabled && data.statement === undefined) {
        throw new Error('수당 내역 응답을 확인하지 못했습니다. 다시 시도해주세요.');
      }
      if (month && data.statement && data.statement.performanceMonth !== month) {
        throw new Error('선택한 월의 수당 내역을 확인하지 못했습니다. 다시 시도해주세요.');
      }
      return data;
    },
    enabled: canRequest && isFocused,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  useEffect(() => () => {
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [queryClient, queryKey]);

  const refetch = query.refetch;
  useEffect(() => {
    if (!canRequest || !isFocused) {
      requestSequence.current += 1;
      void queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.removeQueries({ queryKey, exact: true });
      return;
    }
    void refetch();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refetch();
    });
    return () => subscription.remove();
  }, [canRequest, isFocused, queryClient, queryKey, refetch]);

  const settled = canRequest && isFocused && !query.isFetching && !query.isError;
  return {
    scope,
    canRequest,
    hydrated: session.hydrated,
    data: settled ? query.data : undefined,
    isLoading: !session.hydrated || (canRequest && (query.isPending || query.isFetching)),
    error: localSessionError ?? (canRequest && query.isError ? query.error : null),
    retry: useCallback(() => {
      if (canRequest && isFocused) void refetch();
    }, [canRequest, isFocused, refetch]),
  };
}

export function useReferralAllowanceAccess() {
  const query = useAllowanceQuery('access');
  const mode = query.isLoading ? 'loading'
    : query.error ? 'error'
    : query.data?.enabled ? 'enabled'
    : 'sample';
  return { ...query, mode, enabled: mode === 'enabled' };
}

export function useReferralAllowance(month?: string) {
  const query = useAllowanceQuery('statement', month);
  return {
    ...query,
    enabled: query.data?.enabled === true,
    availableMonths: query.data?.enabled ? query.data.availableMonths : [],
    statement: query.data?.enabled ? query.data.statement ?? null : null,
  };
}
