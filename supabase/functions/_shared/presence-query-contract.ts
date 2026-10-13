export type PresenceTableRow = {
  phone: string;
  garam_in_at: string | null;
  garam_link_at: string | null;
  updated_at: string;
};

export type PresenceSnapshot = {
  phone: string;
  garam_in_at: string | null;
  garam_link_at: string | null;
  updated_at: string | null;
  last_seen_at: string | null;
  is_online: boolean;
};

export type PresenceMutationSnapshot = PresenceSnapshot & {
  applied: boolean;
};

export type PhoneRow = { phone: string };

export function normalizePresencePhone(input: string | null | undefined) {
  return String(input ?? "").replace(/[^0-9]/g, "");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isTimestampOrNull = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === "string" && Number.isFinite(new Date(value).getTime()));

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(new Date(value).getTime());

function isCanonicalPresencePhone(value: unknown): value is string {
  return typeof value === "string" &&
    normalizePresencePhone(value) === value &&
    value.length === 11;
}

export function samePresenceTimestamp(
  actual: string | null,
  expected: string | null,
): boolean {
  if (actual === null || expected === null) return actual === expected;
  return new Date(actual).getTime() === new Date(expected).getTime();
}

function expectedLastSeenAt(value: {
  garam_in_at: string | null;
  garam_link_at: string | null;
}): string | null {
  const timestamps = [value.garam_in_at, value.garam_link_at]
    .filter((candidate): candidate is string => candidate !== null)
    .map((candidate) => new Date(candidate).getTime());
  return timestamps.length === 0
    ? null
    : new Date(Math.max(...timestamps)).toISOString();
}

export function isPresenceTableRow(value: unknown): value is PresenceTableRow {
  return isRecord(value) &&
    isCanonicalPresencePhone(value.phone) &&
    isTimestampOrNull(value.garam_in_at) &&
    isTimestampOrNull(value.garam_link_at) &&
    isTimestamp(value.updated_at);
}

export function isPresenceSnapshot(value: unknown): value is PresenceSnapshot {
  if (
    !isRecord(value) ||
    !isCanonicalPresencePhone(value.phone) ||
    !isTimestampOrNull(value.garam_in_at) ||
    !isTimestampOrNull(value.garam_link_at) ||
    !isTimestampOrNull(value.updated_at) ||
    !isTimestampOrNull(value.last_seen_at) ||
    typeof value.is_online !== "boolean"
  ) {
    return false;
  }

  const isMissingRow = value.updated_at === null;
  if (isMissingRow) {
    return value.garam_in_at === null &&
      value.garam_link_at === null &&
      value.last_seen_at === null &&
      value.is_online === false;
  }

  return samePresenceTimestamp(
    value.last_seen_at,
    expectedLastSeenAt({
      garam_in_at: value.garam_in_at,
      garam_link_at: value.garam_link_at,
    }),
  );
}

export function isPresenceMutationSnapshot(
  value: unknown,
): value is PresenceMutationSnapshot {
  if (!isPresenceSnapshot(value)) return false;
  const row = value as unknown as Record<string, unknown>;
  return value.updated_at !== null && typeof row.applied === "boolean";
}

export function isPresencePhoneRow(value: unknown): value is PhoneRow {
  return isRecord(value) &&
    isCanonicalPresencePhone(value.phone);
}

export function isExactTouchPresenceReceipt(
  value: unknown,
  requestedPhone: string,
): value is PresenceSnapshot {
  return isPresenceSnapshot(value) &&
    value.phone === requestedPhone &&
    value.garam_in_at !== null &&
    value.updated_at !== null &&
    samePresenceTimestamp(value.garam_in_at, value.updated_at) &&
    value.is_online;
}

export function isExactStalePresenceReceipt(
  value: unknown,
  requestedPhone: string,
  expectedAt: string | null,
  staleAt: string,
): value is PresenceMutationSnapshot {
  if (!isPresenceMutationSnapshot(value) || value.phone !== requestedPhone) {
    return false;
  }
  if (value.applied) {
    return samePresenceTimestamp(value.garam_in_at, staleAt);
  }
  return expectedAt !== null && !samePresenceTimestamp(value.garam_in_at, expectedAt);
}

export function presenceRowsMatchRequestedPhones(
  rows: Array<{ phone: string }>,
  requestedPhones: string[],
  requireComplete: boolean,
): boolean {
  const requested = new Set(requestedPhones);
  const returned = rows.map((row) => normalizePresencePhone(row.phone));
  return returned.every((phone) => requested.has(phone)) &&
    presenceRowsHaveUniquePhones(rows) &&
    (!requireComplete || returned.length === requested.size);
}

export function presenceRowsHaveUniquePhones(
  rows: Array<{ phone: string }>,
): boolean {
  return new Set(rows.map((row) => normalizePresencePhone(row.phone))).size ===
    rows.length;
}

export function mergePresenceSnapshots(
  phones: string[],
  snapshots: PresenceSnapshot[],
): PresenceSnapshot[] {
  const snapshotByPhone = new Map(
    snapshots.map((snapshot) =>
      [
        normalizePresencePhone(snapshot.phone),
        snapshot,
      ] as const
    ),
  );

  return Array.from(
    new Set(
      phones
        .map((phone) => normalizePresencePhone(phone))
        .filter((phone) => phone.length === 11),
    ),
  ).map((phone) =>
    snapshotByPhone.get(phone) ?? {
      phone,
      garam_in_at: null,
      garam_link_at: null,
      updated_at: null,
      last_seen_at: null,
      is_online: false,
    }
  );
}
