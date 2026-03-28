export type CommissionCompletionStatus = 'none' | 'life_only' | 'nonlife_only' | 'both';

export const LEGACY_APPOINTMENT_TERMINAL_STATUSES = ['appointment-completed', 'final-link-sent'] as const;
export function normalizeCommissionStatus(input?: string): CommissionCompletionStatus {
  if (input === 'life_only' || input === 'nonlife_only' || input === 'both') return input;
  return 'none';
}

export function isLegacyAppointmentTerminalStatus(input?: string | null): boolean {
  return LEGACY_APPOINTMENT_TERMINAL_STATUSES.includes(String(input ?? '') as (typeof LEGACY_APPOINTMENT_TERMINAL_STATUSES)[number]);
}

export function hasHanwhaPdfMetadata(
  profile?: { hanwha_commission_pdf_path?: string | null; hanwha_commission_pdf_name?: string | null } | null,
): boolean {
  return Boolean(String(profile?.hanwha_commission_pdf_path ?? '').trim() && String(profile?.hanwha_commission_pdf_name ?? '').trim());
}

export function canSubmitInsuranceCommission(
  profile?: {
    status?: string | null;
    hanwha_commission_pdf_path?: string | null;
    hanwha_commission_pdf_name?: string | null;
  } | null,
): boolean {
  if (!profile) return false;
  if (isLegacyAppointmentTerminalStatus(profile.status)) return true;
  return profile.status === 'hanwha-commission-approved' && hasHanwhaPdfMetadata(profile);
}

export function buildWorkflowResetPayload(): Record<string, unknown> {
  return {
    life_commission_completed: false,
    nonlife_commission_completed: false,
    appointment_url: null,
    appointment_date: null,
    appointment_schedule_life: null,
    appointment_schedule_nonlife: null,
    appointment_date_life: null,
    appointment_date_nonlife: null,
    appointment_date_life_sub: null,
    appointment_date_nonlife_sub: null,
    appointment_reject_reason_life: null,
    appointment_reject_reason_nonlife: null,
    docs_deadline_at: null,
    docs_deadline_last_notified_at: null,
    hanwha_commission_date_sub: null,
    hanwha_commission_date: null,
    hanwha_commission_reject_reason: null,
    hanwha_commission_pdf_path: null,
    hanwha_commission_pdf_name: null,
  };
}

export function mapCommissionToProfileState(input: CommissionCompletionStatus): {
  status: 'draft' | 'final-link-sent';
  lifeCompleted: boolean;
  nonlifeCompleted: boolean;
} {
  // Legacy signup input is still accepted, but the new onboarding flow always starts from draft.
  return { status: 'draft', lifeCompleted: false, nonlifeCompleted: false };
}
