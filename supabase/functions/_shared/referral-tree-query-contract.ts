import { parseQueryRows } from './query-result-contract.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);
const isNullableUuid = (value: unknown): value is string | null =>
  value === null || isUuid(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableNonEmptyString = (value: unknown): value is string | null =>
  value === null || (isString(value) && value.trim().length > 0);
const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export function normalizeReferralPhone(value: unknown) {
  return typeof value === 'string' ? value.replace(/[^0-9]/g, '') : '';
}

function isCalendarDateOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function hasUniqueValues<Row>(rows: Row[], read: (row: Row) => string) {
  return new Set(rows.map(read)).size === rows.length;
}

function rowsBelongToRequestedSet<Row>(
  rows: Row[],
  requestedValues: string[],
  read: (row: Row) => string,
  requireComplete: boolean,
) {
  const requested = new Set(requestedValues);
  const returned = rows.map(read);
  return returned.every((value) => requested.has(value)) &&
    new Set(returned).size === returned.length &&
    (!requireComplete || returned.length === requested.size);
}

export type ReferralProfileRow = {
  id: string;
  name: string;
  phone: string;
  affiliation: string;
  recommender_fc_id: string | null;
  is_manager_referral_shadow: boolean;
  signup_completed: boolean;
  appointment_date_life: string | null;
  appointment_date_nonlife: string | null;
  life_commission_completed: boolean;
  nonlife_commission_completed: boolean;
};

function isReferralProfileRow(value: unknown): value is ReferralProfileRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    isString(value.name) &&
    isString(value.phone) &&
    isString(value.affiliation) &&
    isNullableUuid(value.recommender_fc_id) &&
    typeof value.is_manager_referral_shadow === 'boolean' &&
    typeof value.signup_completed === 'boolean' &&
    isCalendarDateOrNull(value.appointment_date_life) &&
    isCalendarDateOrNull(value.appointment_date_nonlife) &&
    typeof value.life_commission_completed === 'boolean' &&
    typeof value.nonlife_commission_completed === 'boolean';
}

export function parseReferralProfilesForIds(
  value: unknown,
  requestedIds: string[],
  requireComplete = true,
): ReferralProfileRow[] | null {
  const rows = parseQueryRows(value, isReferralProfileRow);
  if (!rows || !rowsBelongToRequestedSet(rows, requestedIds, (row) => row.id, requireComplete)) {
    return null;
  }
  return rows;
}

export function parseReferralProfilesForPhone(
  value: unknown,
  requestedPhone: string,
): ReferralProfileRow[] | null {
  const rows = parseQueryRows(value, isReferralProfileRow);
  if (!rows || rows.length > 1 ||
    rows.some((row) => normalizeReferralPhone(row.phone) !== requestedPhone)) {
    return null;
  }
  return rows;
}

export type ReferralCodeHistoryRow = { id: string; fc_id: string };

function isReferralCodeHistoryRow(value: unknown): value is ReferralCodeHistoryRow {
  return isRecord(value) && isUuid(value.id) && isUuid(value.fc_id);
}

export function parseReferralCodeHistoryRows(
  value: unknown,
  requestedFcIds: string[],
): ReferralCodeHistoryRow[] | null {
  const rows = parseQueryRows(value, isReferralCodeHistoryRow);
  const requested = new Set(requestedFcIds);
  if (!rows || !hasUniqueValues(rows, (row) => row.id) ||
    rows.some((row) => !requested.has(row.fc_id))) {
    return null;
  }
  return rows;
}

export type ActiveReferralCodeRow = {
  id: string;
  fc_id: string;
  code: string;
  created_at: string;
};

function isActiveReferralCodeRow(value: unknown): value is ActiveReferralCodeRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.fc_id) &&
    typeof value.code === 'string' && value.code.trim().length > 0 &&
    isTimestamp(value.created_at);
}

export function parseActiveReferralCodeRows(
  value: unknown,
  requestedFcIds: string[],
): ActiveReferralCodeRow[] | null {
  const rows = parseQueryRows(value, isActiveReferralCodeRow);
  const requested = new Set(requestedFcIds);
  if (!rows || !hasUniqueValues(rows, (row) => row.id) ||
    !hasUniqueValues(rows, (row) => row.fc_id) ||
    rows.some((row) => !requested.has(row.fc_id))) {
    return null;
  }
  return rows;
}

export type ReferralAdminPhoneRow = { id: string; phone: string };

function isReferralAdminPhoneRow(value: unknown): value is ReferralAdminPhoneRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    normalizeReferralPhone(value.phone).length === 11;
}

export function parseReferralAdminPhoneRows(value: unknown): ReferralAdminPhoneRow[] | null {
  const rows = parseQueryRows(value, isReferralAdminPhoneRow);
  if (!rows || !hasUniqueValues(rows, (row) => row.id) ||
    !hasUniqueValues(rows, (row) => normalizeReferralPhone(row.phone))) {
    return null;
  }
  return rows;
}

export type ReferralChildRow = {
  id: string;
  recommender_fc_id: string;
  is_manager_referral_shadow: boolean;
};

function isReferralChildRow(value: unknown): value is ReferralChildRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.recommender_fc_id) &&
    typeof value.is_manager_referral_shadow === 'boolean';
}

export function parseReferralChildRows(
  value: unknown,
  requestedParentIds: string[],
): ReferralChildRow[] | null {
  const rows = parseQueryRows(value, isReferralChildRow);
  const requested = new Set(requestedParentIds);
  if (!rows || !hasUniqueValues(rows, (row) => row.id) ||
    rows.some((row) => !requested.has(row.recommender_fc_id) || row.id === row.recommender_fc_id)) {
    return null;
  }
  return rows;
}

export function parseReferralChildProfiles(
  value: unknown,
  requestedParentIds: string[],
): ReferralChildProfileRow[] | null {
  const rows = parseQueryRows(value, isReferralChildProfileRow);
  const requested = new Set(requestedParentIds);
  if (!rows || !hasUniqueValues(rows, (row) => row.id) || rows.some((row) =>
    row.recommender_fc_id === null ||
    !requested.has(row.recommender_fc_id) ||
    row.id === row.recommender_fc_id
  )) {
    return null;
  }
  return rows;
}

export type ReferralChildProfileRow = ReferralProfileRow & {
  recommender_fc_id: string;
};

function isReferralChildProfileRow(value: unknown): value is ReferralChildProfileRow {
  return isReferralProfileRow(value) && isUuid(value.recommender_fc_id);
}

export type ReferralManagerAccountRow = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
};

function isReferralManagerAccountRow(value: unknown): value is ReferralManagerAccountRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    isString(value.name) &&
    normalizeReferralPhone(value.phone).length === 11 &&
    typeof value.active === 'boolean';
}

export function parseReferralManagerAccountRows(
  value: unknown,
  requestedPhone: string,
  requiredActive?: boolean,
): ReferralManagerAccountRow[] | null {
  const rows = parseQueryRows(value, isReferralManagerAccountRow);
  if (!rows || rows.length > 1 || rows.some((row) =>
    normalizeReferralPhone(row.phone) !== requestedPhone ||
    (requiredActive !== undefined && row.active !== requiredActive)
  )) {
    return null;
  }
  return rows;
}

export type ReferralAdminAccountRow = {
  id: string;
  phone: string;
  staff_type: 'admin' | 'developer';
  active: boolean;
};

function isReferralAdminAccountRow(value: unknown): value is ReferralAdminAccountRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    normalizeReferralPhone(value.phone).length === 11 &&
    (value.staff_type === 'admin' || value.staff_type === 'developer') &&
    typeof value.active === 'boolean';
}

export function parseReferralAdminAccountRows(
  value: unknown,
  requestedPhone: string,
  requiredActive?: boolean,
): ReferralAdminAccountRow[] | null {
  const rows = parseQueryRows(value, isReferralAdminAccountRow);
  if (!rows || rows.length > 1 || rows.some((row) =>
    normalizeReferralPhone(row.phone) !== requestedPhone ||
    (requiredActive !== undefined && row.active !== requiredActive)
  )) {
    return null;
  }
  return rows;
}

export type ReferralTreeRow = {
  fc_id: string;
  name: string;
  affiliation: string;
  active_code: string | null;
  parent_fc_id: string | null;
  node_depth: number;
  relationship_source: 'linked' | 'root';
  direct_invitee_count: number;
  total_descendant_count: number;
  is_ancestor: boolean;
};

function isReferralTreeRow(value: unknown): value is ReferralTreeRow {
  return isRecord(value) &&
    isUuid(value.fc_id) &&
    isString(value.name) &&
    isString(value.affiliation) &&
    isNullableNonEmptyString(value.active_code) &&
    isNullableUuid(value.parent_fc_id) &&
    Number.isSafeInteger(value.node_depth) &&
    (value.relationship_source === 'linked' || value.relationship_source === 'root') &&
    isNonNegativeInteger(value.direct_invitee_count) &&
    isNonNegativeInteger(value.total_descendant_count) &&
    value.total_descendant_count >= value.direct_invitee_count &&
    typeof value.is_ancestor === 'boolean';
}

export function parseReferralTreeRows(
  value: unknown,
  requestedRootFcId: string,
  maxDepth: number,
): ReferralTreeRow[] | null {
  const rows = parseQueryRows(value, isReferralTreeRow);
  if (!rows || !hasUniqueValues(rows, (row) => row.fc_id)) return null;
  if (rows.length === 0) return rows;

  const rootRows = rows.filter((row) => row.fc_id === requestedRootFcId);
  if (rootRows.length !== 1) return null;
  const root = rootRows[0];
  if (root.node_depth !== 0 || root.parent_fc_id !== null ||
    root.relationship_source !== 'root' || root.is_ancestor) {
    return null;
  }

  const byId = new Map(rows.map((row) => [row.fc_id, row]));
  const ancestorDepths: number[] = [];
  for (const row of rows) {
    if (row === root) continue;
    if (row.relationship_source !== 'linked') return null;
    if (row.is_ancestor) {
      if (row.parent_fc_id !== null || row.node_depth >= 0 || row.node_depth < -10 ||
        row.direct_invitee_count !== 0 || row.total_descendant_count !== 0) {
        return null;
      }
      ancestorDepths.push(row.node_depth);
      continue;
    }
    if (row.node_depth < 1 || row.node_depth > maxDepth || row.parent_fc_id === null) {
      return null;
    }
    const parent = byId.get(row.parent_fc_id);
    if (!parent || parent.is_ancestor || parent.node_depth !== row.node_depth - 1) {
      return null;
    }
  }
  ancestorDepths.sort((left, right) => right - left);
  if (ancestorDepths.some((nodeDepth, index) => nodeDepth !== -(index + 1))) {
    return null;
  }
  return rows;
}
