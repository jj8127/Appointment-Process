import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { buildBoardActor, fetchBoardList } from '@/lib/board-api';
import { buildBoardInfiniteListQueryKey, buildBoardListParams, type BoardListQueryInput } from '@/lib/board-list-query';
import { mergeBoardListPages, type BoardListPage, type BoardListPages } from '@/lib/board-list-pages';

import { useSession } from './use-session';

type Options = Pick<BoardListQueryInput, 'selectedCategoryId' | 'sortOption' | 'searchQuery' | 'limit'> & {
  sessionScope: number;
};

export function useBoardList(options: Options) {
  const { role, residentId, displayName, readOnly, hydrated } = useSession();
  const actor = useMemo(
    () => hydrated ? buildBoardActor({ role, residentId, displayName, readOnly }) : null,
    [hydrated, role, residentId, displayName, readOnly],
  );
  const query = useInfiniteQuery<BoardListPage, Error, BoardListPages, ReturnType<typeof buildBoardInfiniteListQueryKey>, string | null>({
    queryKey: buildBoardInfiniteListQueryKey({
      ...options,
      actorRole: actor?.role,
      residentId: actor?.residentId,
    }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => actor
      ? fetchBoardList(actor, buildBoardListParams({ ...options, cursor: pageParam }))
      : Promise.resolve({ items: [], nextCursor: null }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!actor,
  });
  const posts = useMemo(() => actor ? mergeBoardListPages(query.data) : [], [actor, query.data]);
  return { ...query, posts };
}
