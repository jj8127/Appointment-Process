import {
  boardListCursorFilter,
  boardListNextCursor,
  boardListSortOrders,
  parseBoardListPagination,
} from '../../supabase/functions/_shared/board-list-pagination';

const id = '00000000-0000-4000-8000-000000000021';
const timestamp = '2026-07-12T00:00:00.123456Z';
const row = { id, created_at: timestamp, updated_at: timestamp, comment_count: 7, reaction_count: 4 };
const pagination = (input: Parameters<typeof parseBoardListPagination>[0] = {}) => {
  const parsed = parseBoardListPagination(input);
  if (!parsed.ok) throw new Error('Invalid synthetic pagination fixture');
  return parsed.pagination;
};

describe('board list stable page boundaries', () => {
  it('keeps bounded defaults and accepts legacy date cursors without losing timestamp precision', () => {
    expect(pagination()).toEqual({ sort: 'created', order: 'desc', limit: 20, cursor: null });
    expect(pagination({ limit: 5000 }).limit).toBe(50);
    expect(boardListCursorFilter(pagination({ cursor: timestamp }))).toBe(`created_at.lt.${timestamp}`);
    expect(boardListCursorFilter(pagination({ sort: 'latest', order: 'asc', cursor: timestamp })))
      .toBe(`updated_at.gt.${timestamp}`);
  });

  it.each(['created', 'latest'] as const)('includes the post ID after a tied %s timestamp', (sort) => {
    const first = pagination({ sort });
    const cursor = boardListNextCursor(row, first);
    const next = pagination({ sort, cursor });
    const field = sort === 'latest' ? 'updated_at' : 'created_at';
    expect(boardListCursorFilter(next)).toBe(`${field}.lt.${timestamp},and(${field}.eq.${timestamp},id.lt.${id})`);
    expect(boardListSortOrders(next)).toEqual([
      { field, ascending: false }, { field: 'id', ascending: false },
    ]);
  });

  it.each(['comments', 'reactions'] as const)('continues tied %s ranks in both directions', (sort) => {
    const field = sort === 'comments' ? 'comment_count' : 'reaction_count';
    const count = row[field];
    for (const order of ['asc', 'desc'] as const) {
      const first = pagination({ sort, order });
      const next = pagination({ sort, order, cursor: boardListNextCursor(row, first) });
      expect(boardListCursorFilter(next)).toBe(`${field}.${order === 'asc' ? 'gt' : 'lt'}.${count},and(${field}.eq.${count},created_at.lt.${timestamp}),and(${field}.eq.${count},created_at.eq.${timestamp},id.lt.${id})`);
      expect(boardListSortOrders(next)).toEqual([
        { field, ascending: order === 'asc' },
        { field: 'created_at', ascending: false }, { field: 'id', ascending: false },
      ]);
    }
  });

  it('uses the ascending ID tie breaker with an ascending timestamp', () => {
    const first = pagination({ order: 'asc' });
    expect(boardListCursorFilter(pagination({ order: 'asc', cursor: boardListNextCursor(row, first) })))
      .toBe(`created_at.gt.${timestamp},and(created_at.eq.${timestamp},id.gt.${id})`);
  });

  it.each([
    { sort: ['created'] }, { sort: 'unknown' }, { order: 'unknown' }, { limit: 2.5 },
    { limit: NaN }, { limit: '20' }, { cursor: {} }, { cursor: 'invalid' },
    { cursor: 'board-page-v1:%not-json' }, { cursor: 'x'.repeat(1501) },
    { sort: 'comments', cursor: timestamp }, { cursor: `${timestamp},id.gt.fake` },
  ])('rejects malformed pagination before constructing database filters %#', (input) => {
    expect(parseBoardListPagination(input)).toEqual({ ok: false });
  });

  it('rejects wrong sort/order cursors and injected identifiers/counts/timestamps', () => {
    const cursor = boardListNextCursor(row, pagination());
    expect(parseBoardListPagination({ sort: 'latest', cursor })).toEqual({ ok: false });
    expect(parseBoardListPagination({ order: 'asc', cursor })).toEqual({ ok: false });
    const encode = (value: object) => 'board-page-v1:' + encodeURIComponent(JSON.stringify(value));
    const valid = { version: 1, sort: 'created', order: 'desc', id, value: timestamp };
    for (const invalid of [
      { ...valid, id: `${id},is_pinned.eq.true` },
      { ...valid, value: `${timestamp}),id.gt.fake` },
      { ...valid, version: 2 },
      { ...valid, sort: 'comments', value: '7', createdAt: timestamp },
      { ...valid, sort: 'comments', value: -1, createdAt: timestamp },
      { ...valid, sort: 'comments', value: 7, createdAt: 'invalid' },
    ]) {
      expect(parseBoardListPagination({ sort: invalid.sort, cursor: encode(invalid) })).toEqual({ ok: false });
    }
  });
});
