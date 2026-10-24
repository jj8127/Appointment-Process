export const GROUP_CHAT_DATA_API_BATCH_SIZE = 100;

export type GroupChatDataApiResult<T> = {
  data: T[] | null;
  error: unknown;
};

export type GroupChatDataApiCollection<T> =
  | { ok: true; data: T[] }
  | { ok: false };

export function chunkGroupChatDataApiValues<T>(
  values: readonly T[],
  batchSize = GROUP_CHAT_DATA_API_BATCH_SIZE,
): T[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('group_chat_data_api_batch_size_invalid');
  }

  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize));
  }
  return batches;
}

export async function collectGroupChatDataApiBatches<TInput, TOutput>(
  values: readonly TInput[],
  loadBatch: (batch: TInput[]) => Promise<GroupChatDataApiResult<TOutput>>,
): Promise<GroupChatDataApiCollection<TOutput>> {
  const batches = chunkGroupChatDataApiValues(values);
  if (batches.length === 0) return { ok: true, data: [] };

  const results = await Promise.all(batches.map((batch) => loadBatch(batch)));
  if (results.some((result) => result.error)) return { ok: false };

  return {
    ok: true,
    data: results.flatMap((result) => result.data ?? []),
  };
}

export async function collectGroupChatDataApiPages<TOutput>(
  loadPage: (
    from: number,
    to: number,
  ) => Promise<GroupChatDataApiResult<TOutput>>,
  pageSize = GROUP_CHAT_DATA_API_BATCH_SIZE,
): Promise<GroupChatDataApiCollection<TOutput>> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError('group_chat_data_api_page_size_invalid');
  }

  const data: TOutput[] = [];
  for (let from = 0; ;) {
    const result = await loadPage(from, from + pageSize - 1);
    if (result.error) return { ok: false };

    const page = result.data ?? [];
    if (page.length === 0) return { ok: true, data };
    data.push(...page);
    from += page.length;
  }
}
