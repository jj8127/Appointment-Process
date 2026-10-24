export type QueryRowGuard<Row> = (value: unknown) => value is Row;

export function parseQueryRows<Row>(
  value: unknown,
  guard: QueryRowGuard<Row>,
): Row[] | null {
  return Array.isArray(value) && value.every(guard) ? value : null;
}

export function parseQueryCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}
