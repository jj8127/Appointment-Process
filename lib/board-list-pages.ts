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

function markViewed(page: BoardListPage, postId: string, viewCount: number): BoardListPage {
  let changed = false;
  const items = page.items.map((item) => {
    if (item.id !== postId || (item.stats.viewCount === viewCount && item.isRead)) return item;
    changed = true;
    return { ...item, isRead: true, stats: { ...item.stats, viewCount } };
  });
  return changed ? { ...page, items } : page;
}

/** Opening a post updates its view count and marks it read in every cached page. */
export function patchBoardListViewedPost(
  data: BoardListPages | undefined,
  postId: string,
  viewCount: number,
): BoardListPages | undefined {
  if (!data?.pages) return data;
  const pages = data.pages.map((page) => markViewed(page, postId, viewCount));
  return pages.some((page, index) => page !== data.pages[index]) ? { ...data, pages } : data;
}

/** Same as {@link patchBoardListViewedPost} for single-page lists such as the FC home preview. */
export function patchBoardListPageViewedPost(
  page: BoardListPage | undefined,
  postId: string,
  viewCount: number,
): BoardListPage | undefined {
  return page?.items ? markViewed(page, postId, viewCount) : page;
}
