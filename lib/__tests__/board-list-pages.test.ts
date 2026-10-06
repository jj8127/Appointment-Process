import type { BoardListItem } from '@/lib/board-api';
import { mergeBoardListPages, patchBoardListViewCount, type BoardListPages } from '@/lib/board-list-pages';

const item = (id: string, viewCount = 0) => ({ id, stats: { viewCount, commentCount: 2 } }) as BoardListItem;

describe('board paged list cache', () => {
  it('keeps the older 21st post and deduplicates pins without changing their position', () => {
    const data: BoardListPages = {
      pages: [
        { items: [item('pin'), ...Array.from({ length: 20 }, (_, index) => item(`post-${index + 1}`))], nextCursor: 'page-2' },
        { items: [item('pin', 3), item('post-21')], nextCursor: null },
      ],
      pageParams: [null, 'page-2'],
    };
    const merged = mergeBoardListPages(data);
    expect(merged).toHaveLength(22);
    expect(merged[0].id).toBe('pin');
    expect(merged[0].stats.viewCount).toBe(3);
    expect(merged[21].id).toBe('post-21');
  });

  it('patches every cached occurrence of a viewed post and preserves cursor metadata and unrelated pages', () => {
    const data: BoardListPages = {
      pages: [
        { items: [item('pin'), item('first')], nextCursor: 'page-2' },
        { items: [item('pin'), item('post-21')], nextCursor: 'page-3' },
        { items: [item('last')], nextCursor: null },
      ],
      pageParams: [null, 'page-2', 'page-3'],
    };
    const patched = patchBoardListViewCount(data, 'pin', 7)!;
    expect(patched.pages[0].items[0].stats).toEqual({ viewCount: 7, commentCount: 2 });
    expect(patched.pages[1].items[0].stats.viewCount).toBe(7);
    expect(patched.pages[0].nextCursor).toBe('page-2');
    expect(patched.pages[2]).toBe(data.pages[2]);
    expect(patched.pageParams).toBe(data.pageParams);
    expect(data.pages[0].items[0].stats.viewCount).toBe(0);
    expect(patchBoardListViewCount(patched, 'pin', 7)).toBe(patched);
    expect(patchBoardListViewCount(data, 'missing', 7)).toBe(data);
    expect(patchBoardListViewCount(undefined, 'pin', 7)).toBeUndefined();
  });
});
