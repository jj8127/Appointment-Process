import type { BoardActorRole, BoardListParams } from '@/lib/board-api';

export type BoardListSortOption = NonNullable<BoardListParams['sort']>;

export const BOARD_LIST_SORT_LABELS: Record<BoardListSortOption, string> = {
  created: '최신순',
  latest: '업데이트순',
  comments: '댓글많은순',
  reactions: '반응많은순',
};

type BoardListQueryInput = {
  actorRole?: BoardActorRole | null;
  residentId?: string | null;
  selectedCategoryId?: string | null;
  sortOption?: BoardListSortOption | null;
  searchQuery?: string | null;
  limit?: number;
};

const normalizeSearchQuery = (value?: string | null) => String(value ?? '').trim();

export function buildBoardListQueryKey({
  actorRole,
  residentId,
  selectedCategoryId,
  sortOption,
  searchQuery,
}: BoardListQueryInput) {
  return [
    'board-posts',
    actorRole ?? null,
    residentId ?? null,
    selectedCategoryId ?? null,
    sortOption ?? 'created',
    normalizeSearchQuery(searchQuery),
  ] as const;
}

export function buildBoardListParams({
  selectedCategoryId,
  sortOption,
  searchQuery,
  limit = 20,
}: BoardListQueryInput): BoardListParams {
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  const params: BoardListParams = {
    limit,
    sort: sortOption ?? 'created',
  };

  if (selectedCategoryId) {
    params.categoryId = selectedCategoryId;
  }
  if (normalizedSearchQuery) {
    params.search = normalizedSearchQuery;
  }

  return params;
}
