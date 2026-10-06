export function flattenBoardListPages<T extends { id: string }>(
  pages: readonly { items: readonly T[] }[] | undefined,
): T[] {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      // Pinned posts can be returned on every page by older board-list versions.
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}
