export type BoardListSort = 'created' | 'latest' | 'comments' | 'reactions';
export type BoardListOrder = 'asc' | 'desc';

type Cursor = {
  version: 1;
  sort: BoardListSort;
  order: BoardListOrder;
  id: string;
  value: string | number;
  createdAt?: string;
};

export type BoardListPagination = {
  sort: BoardListSort;
  order: BoardListOrder;
  limit: number;
  cursor: Cursor | { legacyTimestamp: string } | null;
};

const PREFIX = 'board-page-v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Keep the original database precision; converting to Date would lose microseconds.
const isTimestamp = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value));
const isCount = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0;

export function parseBoardListPagination(input: {
  sort?: unknown; order?: unknown; limit?: unknown; cursor?: unknown;
}): { ok: true; pagination: BoardListPagination } | { ok: false } {
  const sort = input.sort ?? 'created';
  const order = input.order ?? 'desc';
  const requestedLimit = input.limit ?? 20;
  if (typeof sort !== 'string' || !['created', 'latest', 'comments', 'reactions'].includes(sort)
    || typeof order !== 'string' || !['asc', 'desc'].includes(order)
    || typeof requestedLimit !== 'number' || !Number.isFinite(requestedLimit)
    || !Number.isInteger(requestedLimit)) return { ok: false };
  const pagination: BoardListPagination = {
    sort: sort as BoardListSort, order: order as BoardListOrder,
    limit: Math.min(Math.max(requestedLimit, 1), 50), cursor: null,
  };
  if (input.cursor === undefined || input.cursor === null || input.cursor === '') {
    return { ok: true, pagination };
  }
  if (typeof input.cursor !== 'string' || input.cursor.length > 1500) return { ok: false };
  if (!input.cursor.startsWith(PREFIX)) {
    if ((sort !== 'created' && sort !== 'latest') || !isTimestamp(input.cursor)) return { ok: false };
    pagination.cursor = { legacyTimestamp: input.cursor };
    return { ok: true, pagination };
  }
  try {
    const cursor = JSON.parse(decodeURIComponent(input.cursor.slice(PREFIX.length))) as Cursor;
    if (!cursor || cursor.version !== 1 || cursor.sort !== sort || cursor.order !== order
      || typeof cursor.id !== 'string' || !UUID.test(cursor.id)) return { ok: false };
    if (sort === 'comments' || sort === 'reactions') {
      if (!isCount(cursor.value) || !isTimestamp(cursor.createdAt)) return { ok: false };
    } else if (!isTimestamp(cursor.value)) return { ok: false };
    pagination.cursor = cursor;
    return { ok: true, pagination };
  } catch {
    return { ok: false };
  }
}

export function boardListSortOrders({ sort, order }: BoardListPagination) {
  const field = sort === 'comments' ? 'comment_count' : sort === 'reactions' ? 'reaction_count'
    : sort === 'latest' ? 'updated_at' : 'created_at';
  const primary = { field, ascending: order === 'asc' };
  return sort === 'comments' || sort === 'reactions'
    ? [primary, { field: 'created_at', ascending: false }, { field: 'id', ascending: false }]
    : [primary, { field: 'id', ascending: primary.ascending }];
}

export function boardListCursorFilter(pagination: BoardListPagination): string | null {
  const { cursor, sort, order } = pagination;
  if (!cursor) return null;
  const [primary] = boardListSortOrders(pagination);
  const operator = order === 'asc' ? 'gt' : 'lt';
  if ('legacyTimestamp' in cursor) return `${primary.field}.${operator}.${cursor.legacyTimestamp}`;
  const afterValue = `${primary.field}.${operator}.${cursor.value}`;
  const equalValue = `${primary.field}.eq.${cursor.value}`;
  if (sort === 'comments' || sort === 'reactions') {
    return `${afterValue},and(${equalValue},created_at.lt.${cursor.createdAt}),and(${equalValue},created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
  }
  return `${afterValue},and(${equalValue},id.${operator}.${cursor.id})`;
}

export function boardListNextCursor(row: Record<string, unknown>, pagination: BoardListPagination): string {
  const { sort, order } = pagination;
  const [primary] = boardListSortOrders(pagination);
  const cursor: Cursor = {
    version: 1, sort, order, id: String(row.id), value: row[primary.field] as string | number,
    ...((sort === 'comments' || sort === 'reactions') ? { createdAt: row.created_at as string } : {}),
  };
  return PREFIX + encodeURIComponent(JSON.stringify(cursor));
}
