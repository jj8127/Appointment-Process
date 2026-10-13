export const FC_STATUSES = [
  'draft',
  'temp-id-issued',
  'allowance-pending',
  'allowance-consented',
  'docs-requested',
  'docs-pending',
  'docs-submitted',
  'docs-rejected',
  'docs-approved',
  'hanwha-commission-review',
  'hanwha-commission-rejected',
  'hanwha-commission-approved',
  'appointment-completed',
  'final-link-sent',
] as const;

export type FcStatus = (typeof FC_STATUSES)[number];

export type FcStatusUpdateExtra = Record<string, string | boolean | null>;

const ALLOWANCE_STATUS_EXTRA_FIELDS = new Set([
  'allowance_date',
  'allowance_prescreen_requested_at',
  'allowance_reject_reason',
]);
const HANWHA_STATUS_EXTRA_FIELDS = new Set([
  'hanwha_commission_date_sub',
  'hanwha_commission_date',
  'hanwha_commission_reject_reason',
  'hanwha_commission_pdf_path',
  'hanwha_commission_pdf_name',
]);

export function buildFcDocWorkflowResetPayload(): FcStatusUpdateExtra {
  return {
    hanwha_commission_date_sub: null,
    hanwha_commission_date: null,
    hanwha_commission_reject_reason: null,
    hanwha_commission_pdf_path: null,
    hanwha_commission_pdf_name: null,
    dawichok_url_sent_at: null,
    dawichok_url_sent_by: null,
    appointment_url: null,
    appointment_date: null,
    appointment_schedule_life: null,
    appointment_schedule_nonlife: null,
    appointment_date_life_sub: null,
    appointment_date_nonlife_sub: null,
    appointment_reject_reason_life: null,
    appointment_reject_reason_nonlife: null,
    appointment_date_life: null,
    appointment_date_nonlife: null,
    life_commission_completed: false,
    nonlife_commission_completed: false,
  };
}

const DOC_WORKFLOW_RESET_EXTRA_FIELDS = new Set(
  Object.keys(buildFcDocWorkflowResetPayload()),
);
const BOOLEAN_STATUS_EXTRA_FIELDS = new Set([
  'life_commission_completed',
  'nonlife_commission_completed',
]);

const FC_STATUS_SET = new Set<string>(FC_STATUSES);

export function isFcStatus(value: unknown): value is FcStatus {
  return typeof value === 'string' && FC_STATUS_SET.has(value);
}

export function parseFcStatusUpdateExtra(
  status: unknown,
  value: unknown,
): FcStatusUpdateExtra | null {
  if (!isFcStatus(status)) return null;
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  if ('status' in raw && raw.status !== status) return null;
  const allowedFields = status === 'allowance-pending' || status === 'allowance-consented'
    ? ALLOWANCE_STATUS_EXTRA_FIELDS
    : status === 'hanwha-commission-approved' || status === 'hanwha-commission-rejected'
      ? HANWHA_STATUS_EXTRA_FIELDS
      : status === 'docs-pending'
        ? DOC_WORKFLOW_RESET_EXTRA_FIELDS
        : new Set<string>();
  const normalized: FcStatusUpdateExtra = {};

  for (const [field, fieldValue] of Object.entries(raw)) {
    if (field === 'status') continue;
    if (!allowedFields.has(field)) return null;
    if (BOOLEAN_STATUS_EXTRA_FIELDS.has(field)) {
      if (typeof fieldValue !== 'boolean') return null;
    } else if (fieldValue !== null && typeof fieldValue !== 'string') {
      return null;
    }
    normalized[field] = fieldValue as string | boolean | null;
  }

  return normalized;
}
