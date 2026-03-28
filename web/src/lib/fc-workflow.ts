import type { FcProfile } from '../types/fc';

export type WorkflowStepNumber = 1 | 2 | 3 | 4 | 5;
export type AdminWorkflowStepNumber = 0 | WorkflowStepNumber;

type WorkflowProfile = Partial<
  Pick<
    FcProfile,
    | 'status'
    | 'temp_id'
    | 'allowance_date'
    | 'identity_completed'
    | 'resident_id_masked'
    | 'address'
    | 'hanwha_commission_date_sub'
    | 'hanwha_commission_date'
    | 'hanwha_commission_reject_reason'
    | 'hanwha_commission_pdf_path'
    | 'hanwha_commission_pdf_name'
    | 'appointment_url'
    | 'appointment_date'
    | 'appointment_schedule_life'
    | 'appointment_schedule_nonlife'
    | 'appointment_date_life'
    | 'appointment_date_nonlife'
    | 'appointment_date_life_sub'
    | 'appointment_date_nonlife_sub'
    | 'appointment_reject_reason_life'
    | 'appointment_reject_reason_nonlife'
    | 'life_commission_completed'
    | 'nonlife_commission_completed'
    | 'fc_documents'
  >
>;

export const HANWHA_APPROVED_STATUSES = [
  'hanwha-commission-approved',
  'appointment-completed',
  'final-link-sent',
] as const;

export const ALLOWANCE_PASSED_STATUSES: FcProfile['status'][] = [
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
];

export const hasText = (value?: string | null) => Boolean(String(value ?? '').trim());

export const hasIdentityInfo = (profile?: WorkflowProfile | null) =>
  Boolean(profile?.identity_completed || profile?.resident_id_masked || profile?.address);

export const hasHanwhaPdfMetadata = (profile?: WorkflowProfile | null) =>
  hasText(profile?.hanwha_commission_pdf_path) && hasText(profile?.hanwha_commission_pdf_name);

export const getApprovedDocumentState = (profile?: WorkflowProfile | null) => {
  const docs = profile?.fc_documents ?? [];
  const allSubmitted =
    docs.length > 0 && docs.every((doc) => doc.storage_path && doc.storage_path !== 'deleted');
  const allApproved = allSubmitted && docs.every((doc) => doc.status === 'approved');

  return { docs, allSubmitted, allApproved };
};

export const hasAllowancePassed = (profile?: WorkflowProfile | null) => {
  if (!profile) return false;
  const allowancePassedByStatus = profile.status ? ALLOWANCE_PASSED_STATUSES.includes(profile.status) : false;
  const allowancePassedByDate = Boolean(profile.allowance_date) && profile.status !== 'allowance-pending';

  return Boolean(profile.temp_id) && (allowancePassedByStatus || allowancePassedByDate);
};

export const getCommissionCompletionState = (profile?: WorkflowProfile | null) => {
  const lifeCompleted = Boolean(profile?.life_commission_completed || profile?.appointment_date_life);
  const nonlifeCompleted = Boolean(profile?.nonlife_commission_completed || profile?.appointment_date_nonlife);
  const bothCompleted = lifeCompleted && nonlifeCompleted;

  return { lifeCompleted, nonlifeCompleted, bothCompleted };
};

export const hasAppointmentWorkflowEvidence = (profile?: WorkflowProfile | null) =>
  Boolean(
    profile?.appointment_url ||
      profile?.appointment_date ||
      profile?.appointment_schedule_life ||
      profile?.appointment_schedule_nonlife ||
      profile?.appointment_date_life ||
      profile?.appointment_date_nonlife ||
      profile?.appointment_date_life_sub ||
      profile?.appointment_date_nonlife_sub ||
      profile?.appointment_reject_reason_life ||
      profile?.appointment_reject_reason_nonlife ||
      profile?.life_commission_completed ||
      profile?.nonlife_commission_completed,
  );

export const hasHanwhaApprovalEvidence = (profile?: WorkflowProfile | null) =>
  profile?.status === 'hanwha-commission-approved' ||
  profile?.status === 'appointment-completed' ||
  profile?.status === 'final-link-sent' ||
  Boolean(profile?.hanwha_commission_date);

export const hasHanwhaApprovedPdf = (profile?: WorkflowProfile | null) =>
  hasHanwhaApprovalEvidence(profile) && hasHanwhaPdfMetadata(profile);

export const hasUrlStageAccess = (profile?: WorkflowProfile | null) => {
  if (!profile) return false;
  if (profile.status === 'appointment-completed' || profile.status === 'final-link-sent') return true;
  return hasHanwhaApprovedPdf(profile);
};

export const hasFinalCompletionEvidence = (profile?: WorkflowProfile | null) => {
  const { bothCompleted } = getCommissionCompletionState(profile);
  return profile?.status === 'final-link-sent' || Boolean(profile?.appointment_date) || bothCompleted;
};

export const calcWorkflowStep = (profile?: WorkflowProfile | null): WorkflowStepNumber => {
  if (!profile) return 1;
  if (hasFinalCompletionEvidence(profile)) return 5;
  if (!hasAllowancePassed(profile)) return 1;

  const { allApproved } = getApprovedDocumentState(profile);
  if (!allApproved) return 2;
  if (!hasUrlStageAccess(profile)) return 3;
  return 4;
};

export const calcAdminWorkflowStep = (profile?: WorkflowProfile | null): AdminWorkflowStepNumber => {
  if (!profile) return 0;
  const workflowStep = calcWorkflowStep(profile);
  if (!hasIdentityInfo(profile) && workflowStep === 1) return 0;
  return workflowStep;
};

export const calcFcHomeWorkflowStep = (profile?: WorkflowProfile | null): WorkflowStepNumber =>
  calcWorkflowStep(profile);
