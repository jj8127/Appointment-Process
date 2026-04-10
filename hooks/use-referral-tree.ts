import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { DescendantNode } from '@/components/ReferralTreeNode';
import { supabase } from '@/lib/supabase';

import { useSession } from './use-session';

export type ReferralTreeRoot = {
  fcId: string;
  name: string | null;
  affiliation: string | null;
  code: string | null;
  directInviteeCount?: number;
  totalDescendantCount?: number;
};

export type ReferralAncestorNode = {
  fcId: string;
  name: string | null;
  affiliation: string | null;
  code: string | null;
};

export type ReferralTreeData = {
  root: ReferralTreeRoot;
  ancestors: ReferralAncestorNode[];
  descendants: DescendantNode[];
  depth: number;
  truncated: boolean;
};

type ReferralTreeResponse = {
  ok: boolean;
  root?: ReferralTreeRoot;
  ancestors?: ReferralAncestorNode[];
  descendants?: DescendantNode[];
  depth?: number;
  truncated?: boolean;
  message?: string;
  code?: string;
};

function sortDescendants(a: DescendantNode, b: DescendantNode) {
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }

  return (a.name ?? '').localeCompare(b.name ?? '', 'ko');
}

function mergeUniqueDescendants(current: DescendantNode[], incoming: DescendantNode[]) {
  const map = new Map<string, DescendantNode>();

  for (const node of current) {
    map.set(node.fcId, node);
  }
  for (const node of incoming) {
    map.set(node.fcId, node);
  }

  return Array.from(map.values()).sort(sortDescendants);
}

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

async function invokeReferralTree(
  appSessionToken: string,
  body: { fcId?: string; depth?: number },
) {
  const { data, error } = await supabase.functions.invoke<ReferralTreeResponse>(
    'get-referral-tree',
    {
      body,
      headers: {
        'x-app-session-token': appSessionToken,
      },
    },
  );

  if (error) {
    throw await toFunctionError(error, '추천 관계를 불러오지 못했습니다.');
  }
  if (!data?.ok || !data.root) {
    throw new Error(data?.message ?? '추천 관계를 불러오지 못했습니다.');
  }

  return {
    root: data.root,
    ancestors: data.ancestors ?? [],
    descendants: (data.descendants ?? []).slice().sort(sortDescendants),
    depth: Number(data.depth ?? body.depth ?? 2),
    truncated: Boolean(data.truncated),
  } satisfies ReferralTreeData;
}

export function useReferralTree(opts: { fcId?: string; depth?: number }) {
  const { role, residentId, appSessionToken, isRequestBoardDesigner, readOnly } = useSession();
  const queryClient = useQueryClient();
  const canUseReferralSelfService =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));
  const depth = Math.max(1, Math.min(3, Math.trunc(opts.depth ?? 2)));
  const queryKey = useMemo(
    () => ['referral-tree', residentId, opts.fcId ?? 'self', depth] as const,
    [residentId, opts.fcId, depth],
  );

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!appSessionToken) {
        throw new Error('추천 관계를 확인하려면 다시 로그인해주세요.');
      }

      return invokeReferralTree(appSessionToken, {
        ...(opts.fcId ? { fcId: opts.fcId } : {}),
        depth,
      });
    },
    enabled: canUseReferralSelfService && Boolean(residentId) && Boolean(appSessionToken),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const mergeDescendants = useCallback((nodes: DescendantNode[]) => {
    if (nodes.length === 0) {
      return;
    }

    queryClient.setQueryData<ReferralTreeData | undefined>(queryKey, (current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        descendants: mergeUniqueDescendants(current.descendants, nodes),
      };
    });
  }, [queryClient, queryKey]);

  const loadChildrenOf = useCallback(async (fcId: string) => {
    if (!appSessionToken) {
      throw new Error('추천 관계를 확인하려면 다시 로그인해주세요.');
    }

    const subtree = await invokeReferralTree(appSessionToken, { fcId, depth: 1 });
    const childNodes = subtree.descendants.filter((node) => node.parentFcId === fcId);

    queryClient.setQueryData<ReferralTreeData | undefined>(queryKey, (current) => {
      if (!current) {
        return current;
      }

      const mergedDescendants = mergeUniqueDescendants(current.descendants, childNodes);
      const updatedDescendants = mergedDescendants.map((node) => (
        node.fcId === subtree.root.fcId
          ? {
            ...node,
            directInviteeCount: subtree.root.directInviteeCount ?? node.directInviteeCount,
            totalDescendantCount: subtree.root.totalDescendantCount ?? node.totalDescendantCount,
          }
          : node
      ));

      return {
        ...current,
        descendants: updatedDescendants,
        truncated: current.truncated || subtree.truncated,
      };
    });

    return childNodes;
  }, [appSessionToken, queryClient, queryKey]);

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch,
    loadChildrenOf,
    mergeDescendants,
  };
}
