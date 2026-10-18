export type CursorPaginationMetadata = {
  hasMore: boolean;
  nextCursor: string | null;
};

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Accepts the legacy response only when both cursor fields are absent. Once a
 * response opts into pagination, `has_more` is authoritative and its cursor
 * must agree with it exactly.
 */
export function parseOptionalCursorPaginationMetadata(
  value: Record<string, unknown>,
): CursorPaginationMetadata | null {
  const hasHasMore = hasOwn(value, 'has_more');
  const hasNextCursor = hasOwn(value, 'next_cursor');

  if (!hasHasMore && !hasNextCursor) {
    return { hasMore: false, nextCursor: null };
  }

  if (value.has_more === false && (!hasNextCursor || value.next_cursor === null)) {
    return { hasMore: false, nextCursor: null };
  }

  if (
    value.has_more === true
    && hasNextCursor
    && typeof value.next_cursor === 'string'
    && value.next_cursor.trim().length > 0
  ) {
    return { hasMore: true, nextCursor: value.next_cursor };
  }

  return null;
}
