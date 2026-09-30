import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ExamPaymentProofApiError,
  listExamApplicationTargets,
  type ExamApplicationTarget,
} from '@/lib/exam-payment-proof-api';
import { isExamProxyApplicationActor } from '@/lib/exam-role';

import { useSession } from './use-session';

let nextSessionScope = 0;

export function useExamApplicationTargets() {
  const { hydrated, role, readOnly, staffType, residentId, appSessionToken } = useSession();
  const queryClient = useQueryClient();
  const isProxy = isExamProxyApplicationActor({ role, readOnly, staffType });
  const canRequest = hydrated && isProxy && Boolean(appSessionToken?.trim());
  const needsToken = hydrated && isProxy && !appSessionToken?.trim();
  // Account changes and renewed tokens must not reuse another session's results.
  // Only an opaque in-memory ID enters the query cache, never a token or phone.
  const owner = useMemo(() => ({
    hydrated, role, readOnly, staffType, residentId, appSessionToken, scope: ++nextSessionScope,
  }), [hydrated, role, readOnly, staffType, residentId, appSessionToken]);
  const queryKey = useMemo(() => ['exam-application-targets', owner.scope] as const, [owner.scope]);
  const [selection, setSelection] = useState<{
    scope: number;
    target: ExamApplicationTarget;
  } | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const targets = await listExamApplicationTargets(appSessionToken ?? '');
      if (signal.aborted) throw new Error('종료된 FC 목록 조회입니다.');
      return targets;
    },
    enabled: canRequest,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
  });

  useEffect(() => () => {
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [queryClient, queryKey]);

  const selectTarget = useCallback((target: ExamApplicationTarget) => {
    setSelection({ scope: owner.scope, target });
  }, [owner.scope]);
  const { refetch } = query;
  const retry = useCallback(async () => {
    if (canRequest) return refetch();
  }, [canRequest, refetch]);
  const error = needsToken
    ? new ExamPaymentProofApiError('FC 목록을 확인하려면 다시 로그인해주세요.', 'missing_app_session')
    : query.error;

  return {
    targets: canRequest && !query.isError && !query.isFetching ? query.data ?? [] : [],
    selectedTarget: canRequest && selection?.scope === owner.scope ? selection.target : null,
    selectTarget,
    isLoading: isProxy && (!hydrated || (canRequest && query.isFetching)),
    errorMessage: error instanceof ExamPaymentProofApiError ? error.message
      : error ? 'FC 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' : null,
    needsRelogin: error instanceof ExamPaymentProofApiError && error.needsRelogin,
    refetch: retry,
  };
}
