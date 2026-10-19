import { QueryReadError } from '@/lib/query-read-error';
import { isHttpsResponseUrl } from '@/lib/user-intent-policy';
import { isFcStatus } from '@shared/lib/fc-status';
import type { FcProfile, LicenseStatus } from '@/types/fc';

export type AdminDocumentRow = {
  id: string;
  fc_id: string;
  doc_type: string;
  file_name: string | null;
  storage_path: string | null;
  status: string;
  reviewer_note: string | null;
  created_at: string;
  fc_profiles: { name: string | null; phone: string | null; affiliation: string | null };
};

export type AdminCleanupPendingResponse = Record<string, unknown> & {
  ok: true;
  cleanupPending: boolean;
};

export type AdminFcDocumentDetail = NonNullable<FcProfile['fc_documents']>[number] & {
  id: string;
  status: string;
  created_at: string;
};

export type AdminFcProfileDetail = Omit<FcProfile, 'fc_documents'> & {
  step?: string;
  admin_memo: string | null;
  fc_documents: AdminFcDocumentDetail[];
};

const ADMIN_FC_BROWSER_COLUMNS = [
  'id',
  'temp_id',
  'name',
  'affiliation',
  'phone',
  'recommender',
  'recommender_fc_id',
  'email',
  'address',
  'address_detail',
  'career_type',
  'allowance_date',
  'allowance_prescreen_requested_at',
  'allowance_reject_reason',
  'docs_deadline_at',
  'docs_deadline_last_notified_at',
  'hanwha_commission_date_sub',
  'hanwha_commission_date',
  'hanwha_commission_reject_reason',
  'hanwha_commission_pdf_path',
  'hanwha_commission_pdf_name',
  'dawichok_url_sent_at',
  'dawichok_url_sent_by',
  'appointment_url',
  'appointment_date',
  'appointment_schedule_life',
  'appointment_schedule_nonlife',
  'appointment_date_life',
  'appointment_date_nonlife',
  'appointment_date_life_sub',
  'appointment_date_nonlife_sub',
  'appointment_reject_reason_life',
  'appointment_reject_reason_nonlife',
  'life_commission_completed',
  'nonlife_commission_completed',
  'license_statuses',
  'status',
  'identity_completed',
  'signup_completed',
  'created_at',
] as const;

const ADMIN_FC_DOCUMENT_COLUMNS = [
  'id',
  'fc_id',
  'doc_type',
  'storage_path',
  'file_name',
  'status',
  'reviewer_note',
  'created_at',
] as const;

export const ADMIN_FC_LIST_SELECT = [
  ...ADMIN_FC_BROWSER_COLUMNS,
  'fc_credentials(password_set_at)',
  `fc_documents(${ADMIN_FC_DOCUMENT_COLUMNS.join(',')})`,
].join(',');

export const ADMIN_FC_DETAIL_SELECT = [
  ...ADMIN_FC_BROWSER_COLUMNS,
  'admin_memo',
  `fc_documents(${ADMIN_FC_DOCUMENT_COLUMNS.join(',')})`,
].join(',');

type DocumentProfile = {
  id: string;
  name?: string | null;
  phone?: string | null;
  affiliation?: string | null;
  fc_documents: Omit<AdminDocumentRow, 'fc_profiles'>[];
};

const LICENSE_STATUS_SET = new Set<LicenseStatus>(['third', 'life', 'nonlife', 'none']);
const OPTIONAL_NULLABLE_STRING_FIELDS = [
  'recommender', 'recommender_fc_id', 'email', 'address', 'address_detail', 'resident_id_masked',
  'temp_id', 'allowance_date', 'allowance_prescreen_requested_at', 'allowance_reject_reason',
  'docs_deadline_at', 'docs_deadline_last_notified_at', 'hanwha_commission_date_sub',
  'hanwha_commission_date', 'hanwha_commission_reject_reason', 'hanwha_commission_pdf_path',
  'hanwha_commission_pdf_name', 'dawichok_url_sent_at', 'dawichok_url_sent_by', 'appointment_url',
  'appointment_date', 'appointment_schedule_life', 'appointment_schedule_nonlife', 'appointment_date_life',
  'appointment_date_nonlife', 'appointment_date_life_sub', 'appointment_date_nonlife_sub',
  'appointment_reject_reason_life', 'appointment_reject_reason_nonlife',
] as const satisfies readonly (keyof FcProfile)[];
const OPTIONAL_NULLABLE_BOOLEAN_FIELDS = [
  'identity_completed', 'life_commission_completed', 'nonlife_commission_completed',
  'is_tour_seen', 'signup_completed',
] as const satisfies readonly (keyof FcProfile)[];

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);
const isOptionalNullableString = (value: unknown) => value === undefined || value === null || typeof value === 'string';
const isOptionalNullableBoolean = (value: unknown) => value === undefined || value === null || typeof value === 'boolean';

export function isAdminCleanupPendingResponse(value: unknown): value is AdminCleanupPendingResponse {
  return isRecord(value) && value.ok === true && typeof value.cleanupPending === 'boolean';
}

function isFcDocument(value: unknown): value is NonNullable<FcProfile['fc_documents']>[number] {
  return isRecord(value)
    && typeof value.doc_type === 'string'
    && (value.storage_path === null || typeof value.storage_path === 'string')
    && isOptionalNullableString(value.file_name)
    && isOptionalNullableString(value.status)
    && isOptionalNullableString(value.reviewer_note);
}

export function isAdminFcProfile(value: unknown): value is FcProfile {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || typeof value.phone !== 'string'
    || typeof value.affiliation !== 'string'
    || typeof value.created_at !== 'string'
    || !isFcStatus(value.status)) return false;
  if (!OPTIONAL_NULLABLE_STRING_FIELDS.every((field) => isOptionalNullableString(value[field]))) return false;
  if (!OPTIONAL_NULLABLE_BOOLEAN_FIELDS.every((field) => isOptionalNullableBoolean(value[field]))) return false;
  if (value.career_type !== undefined && value.career_type !== null && value.career_type !== '신입' && value.career_type !== '경력') return false;
  if (value.license_statuses !== undefined && value.license_statuses !== null
    && (!Array.isArray(value.license_statuses) || !value.license_statuses.every((item) => LICENSE_STATUS_SET.has(item as LicenseStatus)))) return false;
  return value.fc_documents === undefined
    || (Array.isArray(value.fc_documents) && value.fc_documents.every(isFcDocument));
}

function isAdminFcListProfile(
  value: unknown,
): value is FcProfile & { fc_documents: NonNullable<FcProfile['fc_documents']> } {
  return isAdminFcProfile(value) && Array.isArray(value.fc_documents);
}

function isAdminDocumentRecord(value: unknown): value is Omit<AdminDocumentRow, 'fc_profiles'> {
  if (!isFcDocument(value) || !isRecord(value)) return false;
  const record: Record<string, unknown> = value;
  return typeof record.id === 'string'
    && typeof record.fc_id === 'string'
    && typeof record.status === 'string'
    && typeof record.created_at === 'string';
}

function isAdminFcDocumentDetail(value: unknown): value is AdminFcDocumentDetail {
  if (!isFcDocument(value) || !isRecord(value)) return false;
  const record: Record<string, unknown> = value;
  return typeof record.id === 'string'
    && typeof record.status === 'string'
    && typeof record.created_at === 'string';
}

export function isAdminFcProfileDetail(value: unknown): value is AdminFcProfileDetail {
  if (!isAdminFcProfile(value) || !isRecord(value)) return false;
  const record: Record<string, unknown> = value;
  if (record.admin_memo !== null && typeof record.admin_memo !== 'string') return false;
  if (record.step !== undefined && typeof record.step !== 'string') return false;
  return Array.isArray(record.fc_documents)
    && record.fc_documents.every(isAdminFcDocumentDetail);
}

function isDocumentProfile(value: unknown): value is DocumentProfile {
  return isAdminFcListProfile(value)
    && value.fc_documents.every(isAdminDocumentRecord);
}

function parseAdminFcListPayload<T>(payload: unknown, isRow: (value: unknown) => value is T): T[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : null;
  if (!rows || !rows.every((value) => isAdminFcListProfile(value) && isRow(value))) return null;
  return rows;
}

export async function fetchAdminFcList<T>(isRow: (value: unknown) => value is T): Promise<T[]> {
  const response = await fetch('/api/admin/list', { credentials: 'same-origin', cache: 'no-store' });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new QueryReadError(response.status);
  const data = parseAdminFcListPayload(payload, isRow);
  if (!data) throw new QueryReadError();
  return data;
}

export async function fetchAdminDocuments(): Promise<AdminDocumentRow[]> {
  const profiles = await fetchAdminFcList(isDocumentProfile);
  return profiles.flatMap((profile) => profile.fc_documents.map((doc) => ({
    ...doc,
    fc_id: profile.id,
    fc_profiles: {
      name: profile.name ?? null,
      phone: profile.phone ?? null,
      affiliation: profile.affiliation ?? null,
    },
  }))).sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export async function signAdminDocument(fcId: string, path: string): Promise<string> {
  const response = await fetch('/api/admin/fc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ action: 'signDoc', payload: { fcId, path } }),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; signedUrl?: string } | null;
  if (!response.ok || data?.ok !== true || !isHttpsResponseUrl(data.signedUrl)) {
    throw new Error(response.status === 401
      ? '파일을 보려면 다시 로그인해주세요.'
      : '파일을 불러오지 못했습니다. 다시 시도해주세요.');
  }
  return data.signedUrl;
}
