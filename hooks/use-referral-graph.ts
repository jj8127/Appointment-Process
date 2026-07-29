import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { normalizeReferralGraph } from '@/lib/referral-graph-native';
import type { ReferralGraphResponse } from '@/types/referral-graph';

import { useReferralAppSession } from './use-referral-app-session';
import { useSession } from './use-session';

type ReferralGraphFailure = {
  ok?: false;
  code?: string | null;
  message?: string | null;
};

export function useReferralGraph() {
  const { role, residentId, isRequestBoardDesigner, readOnly } = useSession();
  const { invokeReferralFunction } = useReferralAppSession();
  const canUseReferralGraph =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));
  const queryKey = useMemo(
    () => ['referral-graph', residentId ?? 'anonymous'] as const,
    [residentId],
  );

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await invokeReferralFunction<ReferralGraphResponse | ReferralGraphFailure>(
        'get-referral-tree',
        {
          body: { mode: 'graph' },
          fallbackMessage: '추천 관계 그래프를 불러오지 못했습니다.',
        },
      );

      if (data.ok !== true || !('nodes' in data) || !('edges' in data) || !('permissions' in data)) {
        throw new Error(data.message ?? '추천 관계 그래프를 불러오지 못했습니다.');
      }

      const normalized = normalizeReferralGraph(data.nodes, data.edges);
      return {
        ...data,
        nodes: normalized.nodes,
        edges: normalized.edges,
      } satisfies ReferralGraphResponse;
    },
    enabled: canUseReferralGraph && Boolean(residentId),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch,
    canUseReferralGraph,
  };
}
