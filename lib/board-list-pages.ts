import type { InfiniteData } from '@tanstack/react-query';

import type { BoardListItem } from '@/lib/board-api';

export type BoardListPage = { items: BoardListItem[]; nextCursor?: string | null };
export type BoardListPages = InfiniteData<BoardListPage, string | null>;

/** Preserve page order while showing repeated pinned posts only once. */
export function mergeBoardListPages(data: BoardListPages | undefined): BoardListItem[] {
  const items = new Map<string, BoardListItem>();
  data?.pages.forEach((page) => page.items.forEach((item) => items.set(item.id, item)));
  return [...items.values()];
}

export function patchBoardListViewCount(
  data: BoardListPages | undefined,
  postId: string,
  viewCount: number,
): BoardListPages | undefined {
  if (!data?.pages) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const items = page.items.map((item) => {
      if (item.id !== postId || item.stats.viewCount === viewCount) return item;
      changed = true;
      pageChanged = true;
      return { ...item, stats: { ...item.stats, viewCount } };
    });
    return pageChanged ? { ...page, items } : page;
  });
  return changed ? { ...data, pages } : data;
}
