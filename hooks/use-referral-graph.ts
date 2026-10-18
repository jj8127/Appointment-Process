import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fictionalReferralGraph, REFERRAL_FICTIONAL_DATA } from '@/lib/referral-dev-fictional';
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
  const canUseReferralGraph = REFERRAL_FICTIONAL_DATA
    || (!isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly)));
  const queryKey = useMemo(
    () => ['referral-graph', residentId ?? 'anonymous'] as const,
    [residentId],
  );

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const data = REFERRAL_FICTIONAL_DATA ? fictionalReferralGraph() : await invokeReferralFunction<ReferralGraphResponse | ReferralGraphFailure>(
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
    enabled: REFERRAL_FICTIONAL_DATA || (canUseReferralGraph && Boolean(residentId)),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  // 전체 그래프용 집단 배치 좌표를 서버에 요청한다(서버가 옛 버전이면 layout이 없어 null → 앱이 직접 계산).
  const loadClusterLayout = useCallback(async () => {
    if (REFERRAL_FICTIONAL_DATA) return null;
    const data = await invokeReferralFunction<{ ok?: boolean; layout?: unknown }>('get-referral-tree', {
      body: { mode: 'graph', withLayout: true },
      fallbackMessage: '추천 관계 배치를 불러오지 못했습니다.',
    });
    return data.ok === true ? data.layout ?? null : null;
  }, [invokeReferralFunction]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch,
    loadClusterLayout,
    canUseReferralGraph,
  };
}
