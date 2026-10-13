import {
  isPresenceSnapshot,
  normalizePresencePhone,
  presenceRowsMatchRequestedPhones,
  type PresenceSnapshot,
} from '../supabase/functions/_shared/presence-query-contract.ts';
import { chunkSupabaseFilterValues } from './supabase-query-contract.ts';

export function parsePresenceSnapshotList(
  value: unknown,
  requestedPhones: readonly string[],
): PresenceSnapshot[] {
  const normalizedPhones = Array.from(new Set(
    requestedPhones
      .map((phone) => normalizePresencePhone(phone))
      .filter((phone) => phone.length === 11),
  ));

  if (
    !Array.isArray(value)
    || value.length > normalizedPhones.length
    || !value.every(isPresenceSnapshot)
    || !presenceRowsMatchRequestedPhones(value, normalizedPhones, false)
  ) {
    throw new Error('활동 상태 조회 응답이 올바르지 않습니다.');
  }

  return value;
}

export async function collectPresenceSnapshotBatches(
  values: readonly (string | null | undefined)[],
  fetchBatch: (phones: string[]) => Promise<unknown>,
): Promise<PresenceSnapshot[]> {
  const normalizedPhones = Array.from(new Set(
    values
      .map((phone) => normalizePresencePhone(phone))
      .filter((phone) => phone.length === 11),
  ));
  if (normalizedPhones.length === 0) return [];

  const rows: PresenceSnapshot[] = [];
  for (const phoneBatch of chunkSupabaseFilterValues(normalizedPhones)) {
    rows.push(...parsePresenceSnapshotList(await fetchBatch(phoneBatch), phoneBatch));
  }
  return parsePresenceSnapshotList(rows, normalizedPhones);
}
