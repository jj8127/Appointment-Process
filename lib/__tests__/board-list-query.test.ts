import {
  BOARD_LIST_SORT_LABELS,
  buildBoardListParams,
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
});
