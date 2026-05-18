import { useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { DescendantNode } from '@/components/ReferralTreeNode';
import {
  computeReferralTreeTruncated,
  getDirectChildren,
  getNodeAbsoluteDepth,
  hasLoadedDirectChildren,
  normalizeSubtreeChildNodes,
  sortDescendants,
} from '@/lib/referral-tree';

import { useSession } from './use-session';
import { useReferralAppSession } from './use-referral-app-session';

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

export function useReferralTree(opts: { fcId?: string; depth?: number }) {
  const { role, residentId, isRequestBoardDesigner, readOnly } = useSession();
  const { invokeReferralFunction } = useReferralAppSession();
  const queryClient = useQueryClient();
  const canUseReferralSelfService =
    !isRequestBoardDesigner && (role === 'fc' || (role === 'admin' && readOnly));
  const depth = Math.max(1, Math.min(3, Math.trunc(opts.depth ?? 2)));
  const inFlightLoadsRef = useRef(new Map<string, Promise<DescendantNode[]>>());
  const backgroundPrefetchQueueRef = useRef(Promise.resolve());
  const queryKey = useMemo(
    () => ['referral-tree', residentId, opts.fcId ?? 'self', depth] as const,
    [residentId, opts.fcId, depth],
  );
  const invokeReferralTree = useCallback(async (
    body: { fcId?: string; depth?: number },
  ) => {
    const data = await invokeReferralFunction<ReferralTreeResponse>('get-referral-tree', {
      body,
      fallbackMessage: '추천 관계를 불러오지 못했습니다.',
    });

    if (!data.root) {
      throw new Error(data.message ?? '추천 관계를 불러오지 못했습니다.');
    }

    const sortedDescendants = (data.descendants ?? []).slice().sort(sortDescendants);

    return {
      root: data.root,
      ancestors: data.ancestors ?? [],
      descendants: sortedDescendants,
      depth: Number(data.depth ?? body.depth ?? 2),
      truncated: computeReferralTreeTruncated({
        root: data.root,
        descendants: sortedDescendants,
      }),
    } satisfies ReferralTreeData;
  }, [invokeReferralFunction]);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      return invokeReferralTree({
        ...(opts.fcId ? { fcId: opts.fcId } : {}),
        depth,
      });
    },
    enabled: canUseReferralSelfService && Boolean(residentId),
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

      const mergedDescendants = mergeUniqueDescendants(current.descendants, nodes);

      return {
        ...current,
        descendants: mergedDescendants,
        truncated: computeReferralTreeTruncated({
          root: current.root,
          descendants: mergedDescendants,
        }),
      };
    });
  }, [queryClient, queryKey]);

  const hasLoadedChildrenOf = useCallback((fcId: string) => {
    const current = queryClient.getQueryData<ReferralTreeData>(queryKey);

    if (!current) {
      return false;
    }

    return hasLoadedDirectChildren(current, fcId);
  }, [queryClient, queryKey]);

  const loadChildrenOf = useCallback(async (fcId: string) => {
    const currentTree = queryClient.getQueryData<ReferralTreeData>(queryKey);
    if (currentTree && hasLoadedDirectChildren(currentTree, fcId)) {
      return getDirectChildren(currentTree.descendants, fcId);
    }

    const inFlightRequest = inFlightLoadsRef.current.get(fcId);
    if (inFlightRequest) {
      return inFlightRequest;
    }

    const fallbackParentDepth = currentTree ? getNodeAbsoluteDepth(currentTree, fcId) ?? 0 : 0;
    const request = (async () => {
      const subtree = await invokeReferralTree({ fcId, depth: 1 });
      const fallbackChildNodes = normalizeSubtreeChildNodes(
        subtree.descendants,
        fcId,
        fallbackParentDepth,
      );

      queryClient.setQueryData<ReferralTreeData | undefined>(queryKey, (current) => {
        if (!current) {
          return current;
        }

        const parentDepth = getNodeAbsoluteDepth(current, fcId) ?? fallbackParentDepth;
        const childNodes = normalizeSubtreeChildNodes(subtree.descendants, fcId, parentDepth);
        const mergedDescendants = mergeUniqueDescendants(current.descendants, childNodes);
        const nextRoot = current.root.fcId === subtree.root.fcId
          ? {
            ...current.root,
            directInviteeCount: subtree.root.directInviteeCount ?? current.root.directInviteeCount,
            totalDescendantCount: subtree.root.totalDescendantCount ?? current.root.totalDescendantCount,
          }
          : current.root;
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
          root: nextRoot,
          descendants: updatedDescendants,
          truncated: computeReferralTreeTruncated({
            root: nextRoot,
            descendants: updatedDescendants,
          }),
        };
      });

      const nextTree = queryClient.getQueryData<ReferralTreeData>(queryKey);
      if (!nextTree) {
        return fallbackChildNodes;
      }

      return getDirectChildren(nextTree.descendants, fcId);
    })().finally(() => {
      inFlightLoadsRef.current.delete(fcId);
    });

    inFlightLoadsRef.current.set(fcId, request);
    return request;
  }, [invokeReferralTree, queryClient, queryKey]);

  const prefetchVisibleChildrenOf = useCallback((fcId: string) => {
    const currentTree = queryClient.getQueryData<ReferralTreeData>(queryKey);
    if (!currentTree) {
      return;
    }

    const candidates = getDirectChildren(currentTree.descendants, fcId)
      .filter((node) => node.directInviteeCount > 0)
      .filter((node) => !hasLoadedDirectChildren(currentTree, node.fcId))
      .map((node) => node.fcId);

    if (candidates.length === 0) {
      return;
    }

    for (const candidateId of candidates) {
      backgroundPrefetchQueueRef.current = backgroundPrefetchQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await loadChildrenOf(candidateId);
          } catch {
            // Retry happens on explicit user expand.
          }
        });
    }
  }, [loadChildrenOf, queryClient, queryKey]);

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch,
    loadChildrenOf,
    hasLoadedChildrenOf,
    prefetchVisibleChildrenOf,
    mergeDescendants,
  };
}
