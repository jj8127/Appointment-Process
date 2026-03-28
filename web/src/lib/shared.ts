import {
  calcAdminWorkflowStep,
  calcWorkflowStep,
  getApprovedDocumentState,
  getCommissionCompletionState,
  hasAppointmentWorkflowEvidence,
  hasHanwhaApprovalEvidence,
  hasHanwhaPdfMetadata,
  hasIdentityInfo,
  hasText,
} from './fc-workflow';
import type { FcProfile } from '../types/fc';

type WorkflowColor = 'gray' | 'orange' | 'blue' | 'green' | 'red';
type WorkflowStepKey = 'step1' | 'step2' | 'step3' | 'step4' | 'step5';
type AdminWorkflowStepKey = 'step0' | WorkflowStepKey;
type WorkflowStepNumber = 1 | 2 | 3 | 4 | 5;
type AdminWorkflowStepNumber = 0 | WorkflowStepNumber;
type DocProgressKey = 'no-request' | 'requested' | 'in-progress' | 'rejected' | 'approved';
type HanwhaProgressKey = 'ready' | 'review' | 'rejected' | 'approved';
type AppointmentProgressKey = 'not-set' | 'in-progress' | 'fc-done' | 'approved';

type StatusDisplay = {
  label: string;
  color: WorkflowColor;
};

type WorkflowProfile = NonNullable<Parameters<typeof calcWorkflowStep>[0]>;
type AdminWorkflowProfile = NonNullable<Parameters<typeof calcAdminWorkflowStep>[0]>;

export const STATUS_LABELS: Record<FcProfile['status'] | string, string> = {
  draft: '임시사번 미발급',
  'temp-id-issued': '임시사번 발급 완료',
  'allowance-pending': '수당동의 대기',
  'allowance-consented': '수당동의 승인 완료',
  'docs-requested': '필수 서류 요청',
  'docs-pending': '서류 대기',
  'docs-submitted': '서류 제출됨',
  'docs-rejected': '서류 반려',
  'docs-approved': '한화 위촉 대기',
  'hanwha-commission-review': '한화 위촉 검토 중',
  'hanwha-commission-rejected': '한화 위촉 반려',
  'hanwha-commission-approved': '한화 위촉 승인 완료',
  'appointment-completed': '위촉 URL 진행 중',
  'final-link-sent': '완료',
};

const STATUS_COLORS: Partial<Record<FcProfile['status'], WorkflowColor>> = {
  draft: 'gray',
  'temp-id-issued': 'blue',
  'allowance-pending': 'gray',
  'allowance-consented': 'green',
  'docs-requested': 'blue',
  'docs-pending': 'orange',
  'docs-submitted': 'orange',
  'docs-rejected': 'red',
  'docs-approved': 'blue',
  'hanwha-commission-review': 'orange',
  'hanwha-commission-rejected': 'red',
  'hanwha-commission-approved': 'green',
  'appointment-completed': 'blue',
  'final-link-sent': 'green',
};

export const STEP_LABELS: Record<WorkflowStepKey, string> = {
  step1: '1단계 수당동의',
  step2: '2단계 문서제출',
  step3: '3단계 한화 위촉',
  step4: '4단계 위촉 URL',
  step5: '5단계 완료',
};

export const ADMIN_STEP_LABELS: Record<AdminWorkflowStepKey, string> = {
  step0: '0단계 사전등록',
  step1: '1단계 수당동의',
  step2: '2단계 문서제출',
  step3: '3단계 한화 위촉',
  step4: '4단계 위촉 URL',
  step5: '5단계 완료',
};

const STEP_COLORS: Record<WorkflowStepKey, WorkflowColor> = {
  step1: 'orange',
  step2: 'blue',
  step3: 'orange',
  step4: 'blue',
  step5: 'green',
};

const ADMIN_STEP_COLORS: Record<AdminWorkflowStepKey, WorkflowColor> = {
  step0: 'gray',
  ...STEP_COLORS,
};

export const DOC_OPTIONS: string[] = [
  '생명보험 합격증',
  '제3보험 합격증',
  '손해보험 합격증',
  '생명보험 수료증(신입)',
  '제3보험 수료증(신입)',
  '손해보험 수료증(신입)',
  '생명보험 수료증(경력)',
  '제3보험 수료증(경력)',
  '손해보험 수료증(경력)',
  '이클린',
  '경력증명서',
];

const getAllowancePendingSummary = (
  profile?:
    | {
        status?: FcProfile['status'];
        allowance_date?: string | null;
      }
    | null,
) => {
  if (profile?.status !== 'allowance-pending') {
    return null;
  }

  if (profile.allowance_date) {
    return { label: '수당동의 검토 중', color: 'orange' as const };
  }

  return { label: '수당동의 대기', color: 'gray' as const };
};

const isSignupCommissionComplete = (
  profile: Pick<
    FcProfile,
    | 'identity_completed'
    | 'resident_id_masked'
    | 'address'
    | 'temp_id'
    | 'allowance_date'
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
    | 'hanwha_commission_date_sub'
    | 'hanwha_commission_date'
    | 'hanwha_commission_reject_reason'
    | 'hanwha_commission_pdf_path'
    | 'hanwha_commission_pdf_name'
    | 'fc_documents'
  >,
) => {
  const { bothCompleted } = getCommissionCompletionState(profile);
  const { docs } = getApprovedDocumentState(profile);

  return Boolean(
    bothCompleted &&
      !hasIdentityInfo(profile) &&
      !profile.temp_id &&
      !profile.allowance_date &&
      !profile.appointment_url &&
      !profile.appointment_date &&
      !profile.appointment_schedule_life &&
      !profile.appointment_schedule_nonlife &&
      !profile.appointment_date_life &&
      !profile.appointment_date_nonlife &&
      !profile.appointment_date_life_sub &&
      !profile.appointment_date_nonlife_sub &&
      !profile.appointment_reject_reason_life &&
      !profile.appointment_reject_reason_nonlife &&
      !profile.hanwha_commission_date_sub &&
      !profile.hanwha_commission_date &&
      !profile.hanwha_commission_reject_reason &&
      !profile.hanwha_commission_pdf_path &&
      !profile.hanwha_commission_pdf_name &&
      docs.length === 0,
  );
};

const getWorkflowStepKey = (step: WorkflowStepNumber) => `step${step}` as WorkflowStepKey;

const getAdminWorkflowStepKey = (step: AdminWorkflowStepNumber) =>
  `step${step}` as AdminWorkflowStepKey;

const getAdminWorkflowStepNumber = (profile?: AdminWorkflowProfile | null): AdminWorkflowStepNumber => {
  return calcAdminWorkflowStep(profile);
};

export const getDocProgress = (profile?: WorkflowProfile | null) => {
  const docs = profile?.fc_documents ?? [];
  if (!docs.length) {
    return { key: 'no-request' as DocProgressKey, label: '요청 안함', color: 'gray' as WorkflowColor };
  }

  const rejected = docs.some((doc) => doc.status === 'rejected');
  if (rejected) {
    return { key: 'rejected' as DocProgressKey, label: '반려', color: 'red' as WorkflowColor };
  }

  const uploaded = docs.filter((doc) => doc.storage_path && doc.storage_path !== 'deleted');
  if (!uploaded.length) {
    return { key: 'requested' as DocProgressKey, label: '요청 완료', color: 'blue' as WorkflowColor };
  }

  const allApproved =
    uploaded.length === docs.length && uploaded.every((doc) => doc.status === 'approved');
  if (allApproved) {
    return { key: 'approved' as DocProgressKey, label: '모든 서류 승인', color: 'green' as WorkflowColor };
  }

  return { key: 'in-progress' as DocProgressKey, label: '제출 중', color: 'orange' as WorkflowColor };
};

export const getHanwhaProgress = (profile?: WorkflowProfile | null) => {
  const approved = hasHanwhaApprovalEvidence(profile);
  if (approved) {
    if (hasHanwhaPdfMetadata(profile) || hasAppointmentWorkflowEvidence(profile)) {
      return { key: 'approved' as HanwhaProgressKey, label: '승인 완료', color: 'green' as WorkflowColor };
    }
    return {
      key: 'approved' as HanwhaProgressKey,
      label: '승인 완료 (PDF 대기)',
      color: 'orange' as WorkflowColor,
    };
  }

  if (profile?.status === 'hanwha-commission-rejected' || hasText(profile?.hanwha_commission_reject_reason)) {
    return { key: 'rejected' as HanwhaProgressKey, label: '반려', color: 'red' as WorkflowColor };
  }

  if (profile?.status === 'hanwha-commission-review' || Boolean(profile?.hanwha_commission_date_sub)) {
    return { key: 'review' as HanwhaProgressKey, label: '검토 중', color: 'orange' as WorkflowColor };
  }

  return { key: 'ready' as HanwhaProgressKey, label: '진행 대기', color: 'blue' as WorkflowColor };
};

export const getAppointmentProgress = (profile: WorkflowProfile | null | undefined, type: 'life' | 'nonlife') => {
  const schedule =
    type === 'life' ? profile?.appointment_schedule_life : profile?.appointment_schedule_nonlife;
  const approvedByDate =
    type === 'life' ? profile?.appointment_date_life : profile?.appointment_date_nonlife;
  const approvedByFlag =
    type === 'life' ? profile?.life_commission_completed : profile?.nonlife_commission_completed;
  const submitted =
    type === 'life' ? profile?.appointment_date_life_sub : profile?.appointment_date_nonlife_sub;

  if (approvedByDate || approvedByFlag) {
    return { key: 'approved' as AppointmentProgressKey, label: '승인완료', color: 'green' as WorkflowColor };
  }
  if (submitted) {
    return { key: 'fc-done' as AppointmentProgressKey, label: '승인 대기', color: 'orange' as WorkflowColor };
  }
  if (schedule) {
    return { key: 'in-progress' as AppointmentProgressKey, label: '진행중', color: 'blue' as WorkflowColor };
  }
  return { key: 'not-set' as AppointmentProgressKey, label: '미입력', color: 'gray' as WorkflowColor };
};

export const calcStep = (profile?: WorkflowProfile | null): WorkflowStepNumber => {
  return calcWorkflowStep(profile);
};

export const getStepDisplay = (profile?: WorkflowProfile | null) => {
  const step = calcStep(profile);
  const key = getWorkflowStepKey(step);

  return {
    step,
    key,
    label: STEP_LABELS[key],
    color: STEP_COLORS[key],
  };
};

export const getAdminStepDisplay = (profile?: AdminWorkflowProfile | null) => {
  const step = getAdminWorkflowStepNumber(profile);
  const key = getAdminWorkflowStepKey(step);

  return {
    step,
    key,
    label: ADMIN_STEP_LABELS[key],
    color: ADMIN_STEP_COLORS[key],
  };
};

export const getSummaryStatus = (profile?: WorkflowProfile | null): StatusDisplay => {
  const step = calcStep(profile);

  if (step === 5) {
    if (profile && isSignupCommissionComplete(profile)) {
      return { label: '가입 시 위촉 완료', color: 'green' };
    }
    return { label: '완료', color: 'green' };
  }

  if (step === 1) {
    if (!profile?.temp_id) {
      return { label: '임시사번 미발급', color: 'gray' };
    }

    const allowancePendingSummary = getAllowancePendingSummary(profile);
    if (allowancePendingSummary) {
      return allowancePendingSummary;
    }

    return { label: '수당동의 대기', color: 'gray' };
  }

  if (step === 2) {
    const doc = getDocProgress(profile);
    if (doc.key === 'no-request') return { label: '서류 요청 안함', color: 'gray' };
    if (doc.key === 'requested') return { label: '서류 제출 대기', color: 'orange' };
    if (doc.key === 'rejected') return { label: '서류 반려', color: 'red' };
    if (doc.key === 'approved') return { label: '모든 서류 승인', color: 'green' };
    return { label: '서류 제출 중', color: 'orange' };
  }

  if (step === 3) {
    const hanwha = getHanwhaProgress(profile);
    if (hanwha.key === 'ready') return { label: '한화 위촉 대기', color: 'blue' };
    if (hanwha.key === 'review') return { label: '한화 위촉 검토 중', color: 'orange' };
    if (hanwha.key === 'rejected') return { label: '한화 위촉 반려', color: 'red' };
    return { label: '한화 위촉 승인 완료 (PDF 대기)', color: 'orange' };
  }

  const life = getAppointmentProgress(profile, 'life');
  const nonlife = getAppointmentProgress(profile, 'nonlife');
  const anyApproved = life.key === 'approved' || nonlife.key === 'approved';
  const anySubmitted = life.key === 'fc-done' || nonlife.key === 'fc-done';
  const anySchedule = life.key === 'in-progress' || nonlife.key === 'in-progress';
  const hasRejectReason = Boolean(
    profile?.appointment_reject_reason_life || profile?.appointment_reject_reason_nonlife,
  );

  if (anySubmitted) return { label: '위촉 URL 검토 중', color: 'orange' };
  if (anyApproved || anySchedule || hasRejectReason || hasText(profile?.appointment_url)) {
    return { label: '위촉 URL 진행 중', color: 'blue' };
  }
  return { label: '위촉 URL 대기', color: 'blue' };
};

export const getStatusDisplay = (
  profile: Pick<
    FcProfile,
    | 'status'
    | 'allowance_date'
    | 'temp_id'
    | 'fc_documents'
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
  >,
): StatusDisplay => {
  const allowancePendingSummary = getAllowancePendingSummary(profile);
  if (allowancePendingSummary) {
    return allowancePendingSummary;
  }

  const fcProfile = profile as FcProfile;
  const summary = getSummaryStatus(fcProfile);
  if (summary.label) {
    return summary;
  }

  return {
    label: STATUS_LABELS[profile.status] ?? profile.status,
    color: STATUS_COLORS[profile.status] ?? 'gray',
  };
};

export const getStatusLabel = (
  profile: Parameters<typeof getStatusDisplay>[0],
) => getStatusDisplay(profile).label;

export const getAdminStep = (profile?: AdminWorkflowProfile | null) => getAdminStepDisplay(profile).label;
