import {
  BOARD_LIST_SORT_LABELS,
  buildBoardListParams,
  buildBoardInfiniteListQueryKey,
  buildBoardListQueryKey,
} from '@/lib/board-list-query';

describe('board list query contract', () => {
  it('includes category and sort choices in the board list query key for manager views', () => {
    expect(
      buildBoardListQueryKey({
        actorRole: 'manager',
        residentId: 'manager-1',
        selectedCategoryId: 'category-education',
        sortOption: 'comments',
        searchQuery: '',
      }),
    ).toEqual([
      'board-posts',
      'manager',
      'manager-1',
      'category-education',
      'comments',
      '',
    ]);
  });

  it('passes selected category, sort, and trimmed search to fetchBoardList params', () => {
    expect(
      buildBoardListParams({
        selectedCategoryId: 'category-notice',
        sortOption: 'latest',
        searchQuery: '  공지 검색  ',
      }),
    ).toEqual({
      limit: 20,
      categoryId: 'category-notice',
      sort: 'latest',
      search: '공지 검색',
    });
  });

  it('falls back to the unfiltered latest-created list when filters are blank', () => {
    expect(
      buildBoardListParams({
        selectedCategoryId: null,
        sortOption: null,
        searchQuery: '   ',
      }),
    ).toEqual({
      limit: 20,
      sort: 'created',
    });
  });

  it('keeps the visible sort labels shared across board surfaces', () => {
    expect(BOARD_LIST_SORT_LABELS).toEqual({
      created: '최신순',
      latest: '업데이트순',
      comments: '댓글많은순',
      reactions: '반응많은순',
    });
  });

  it('passes an opaque next-page cursor through unchanged', () => {
    expect(buildBoardListParams({ cursor: 'opaque:cursor+/= token', sortOption: 'comments' }))
      .toEqual({ limit: 20, sort: 'comments', cursor: 'opaque:cursor+/= token' });
    expect(buildBoardListParams({ cursor: null })).not.toHaveProperty('cursor');
  });

  it('separates infinite pages by signed-session scope, identity, filters, and page size', () => {
    const input = { actorRole: 'fc' as const, residentId: 'fictional-actor', sessionScope: 1 };
    const key = buildBoardInfiniteListQueryKey(input);
    expect(key).toEqual(['board-posts', 'fc', 'fictional-actor', null, 'created', '', 'infinite', 1, 20]);
    [
      { sessionScope: 2 }, { residentId: 'fictional-other' }, { actorRole: 'manager' as const },
      { selectedCategoryId: 'education' }, { sortOption: 'reactions' as const },
      { searchQuery: 'older post' }, { limit: 10 },
    ].forEach((change) => expect(buildBoardInfiniteListQueryKey({ ...input, ...change })).not.toEqual(key));
    expect(buildBoardInfiniteListQueryKey({ ...input, cursor: 'next-page' })).toEqual(key);
    expect(buildBoardInfiniteListQueryKey({ ...input, searchQuery: '  older post  ' }))
      .toEqual(buildBoardInfiniteListQueryKey({ ...input, searchQuery: 'older post' }));
  });
});
