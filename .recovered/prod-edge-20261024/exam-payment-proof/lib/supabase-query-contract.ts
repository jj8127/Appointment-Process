export function requireSupabaseRows<T>(
  data: T[] | null | undefined,
  queryName: string,
): T[] {
  if (!Array.isArray(data)) {
    throw new Error(`${queryName}_query_contract_invalid`);
  }
  return data;
}

export function requireSupabaseRowsMatching<T>(
  data: unknown,
  queryName: string,
  isRow: (value: unknown) => value is T,
): T[] {
  const rows = requireSupabaseRows(
    data as unknown[] | null | undefined,
    queryName,
  );
  if (!rows.every(isRow)) {
    throw new Error(`${queryName}_row_contract_invalid`);
  }
  return rows;
}

export function requireSupabaseRowMatching<T>(
  data: unknown,
  queryName: string,
  isRow: (value: unknown) => value is T,
): T {
  if (!isRow(data)) {
    throw new Error(`${queryName}_row_contract_invalid`);
  }
  return data;
}

type SupabasePageResult = {
  data: unknown;
  error: unknown;
};

type CollectSupabaseRowsOptions<T> = {
  queryName: string;
  fetchPage: (from: number, to: number) => PromiseLike<SupabasePageResult>;
  isRow: (value: unknown) => value is T;
  pageSize?: number;
  maxRows?: number;
  rowKey?: (row: T) => string;
};

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_ROWS = 100_000;

export async function collectSupabaseRows<T>({
  queryName,
  fetchPage,
  isRow,
  pageSize = DEFAULT_PAGE_SIZE,
  maxRows = DEFAULT_MAX_ROWS,
  rowKey,
}: CollectSupabaseRowsOptions<T>): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0
    || !Number.isSafeInteger(maxRows) || maxRows < pageSize) {
    throw new Error(`${queryName}_pagination_contract_invalid`);
  }

  const rows: T[] = [];
  const seenKeys = rowKey ? new Set<string>() : null;
  for (let offset = 0; ; offset += pageSize) {
    const result = await fetchPage(offset, offset + pageSize - 1);
    if (result.error) throw result.error;
    const page = requireSupabaseRowsMatching(result.data, `${queryName}_page`, isRow);
    if (page.length > pageSize || rows.length + page.length > maxRows) {
      throw new Error(`${queryName}_pagination_contract_invalid`);
    }
    if (seenKeys) {
      for (const row of page) {
        const key = rowKey?.(row).trim() ?? '';
        if (!key || seenKeys.has(key)) {
          throw new Error(`${queryName}_row_identity_contract_invalid`);
        }
        seenKeys.add(key);
      }
    }
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function chunkSupabaseFilterValues<T>(values: readonly T[], batchSize = 100): T[][] {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new Error('supabase_filter_batch_contract_invalid');
  }

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    chunks.push(values.slice(index, index + batchSize));
  }
  return chunks;
}

const SUPABASE_COLUMN_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Limit a mutation receipt to the row identity and fields whose committed
 * values will be verified. The field names come from server-owned payloads,
 * but are still validated before becoming PostgREST select syntax.
 */
export function buildSupabaseMutationReceiptSelect(
  expected: Readonly<Record<string, unknown>>,
): string {
  const fields = ['id', ...Object.keys(expected).filter((field) => field !== 'id')];
  if (!fields.every((field) => SUPABASE_COLUMN_NAME.test(field))) {
    throw new Error('supabase_mutation_receipt_select_invalid');
  }
  return Array.from(new Set(fields)).join(',');
}
