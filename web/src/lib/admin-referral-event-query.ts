export const REFERRAL_EVENT_FC_ID_CHUNK_SIZE = 40;

export function chunkReferralEventFcIds(
  fcIds: readonly string[],
  chunkSize = REFERRAL_EVENT_FC_ID_CHUNK_SIZE,
): string[][] {
  const safeChunkSize = Number.isInteger(chunkSize) && chunkSize > 0
    ? chunkSize
    : REFERRAL_EVENT_FC_ID_CHUNK_SIZE;
  const uniqueIds = Array.from(
    new Set(fcIds.map((value) => value.trim()).filter(Boolean)),
  );
  const chunks: string[][] = [];

  for (let index = 0; index < uniqueIds.length; index += safeChunkSize) {
    chunks.push(uniqueIds.slice(index, index + safeChunkSize));
  }

  return chunks;
}

export function mergeReferralEventChunks<T extends { id: string; created_at: string }>(
  chunks: readonly (readonly T[])[],
): T[] {
  const uniqueById = new Map<string, T>();

  for (const chunk of chunks) {
    for (const row of chunk) {
      if (!uniqueById.has(row.id)) {
        uniqueById.set(row.id, row);
      }
    }
  }

  return Array.from(uniqueById.values()).sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
}
