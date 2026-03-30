import type { FcProfile } from '../types/fc';

export type WorkflowStepNumber = 1 | 2 | 3 | 4 | 5;
export type AdminWorkflowStepNumber = 0 | WorkflowStepNumber;
export type FcHomeStepKey = 'consent' | 'docs' | 'hanwha' | 'url' | 'final';
export type FcHomeNextAction = {
  step: WorkflowStepNumber;
  key: FcHomeStepKey;
  route: string | null;
  title: string;
  subtitle: string;
  disabled: boolean;
};
export type AllowanceDisplayKey = 'missing' | 'entered' | 'prescreen' | 'approved' | 'rejected';
export type AllowanceDisplay = {
  key: AllowanceDisplayKey;
  label: string;
  color: 'gray' | 'orange' | 'blue' | 'green' | 'red';
};

type WorkflowProfile = Partial<
  Pick<
    FcProfile,
    | 'status'
    | 'temp_id'
    | 'allowance_date'
    | 'allowance_prescreen_requested_at'
    | 'allowance_reject_reason'
    | 'identity_completed'
    | 'resident_id_masked'
    | 'address'
    | 'hanwha_commission_date'
    | 'hanwha_commission_date_sub'
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

export const hasIdentityInfo = (
  profile?: WorkflowProfile | null,
) => Boolean(profile?.identity_completed || profile?.resident_id_masked || profile?.address);

export const hasHanwhaPdfMetadata = (
  profile?: WorkflowProfile | null,
) => hasText(profile?.hanwha_commission_pdf_path) && hasText(profile?.hanwha_commission_pdf_name);

export const getApprovedDocumentState = (profile?: WorkflowProfile | null) => {
  const docs = profile?.fc_documents ?? [];
  const allSubmitted =
    docs.length > 0 && docs.every((doc) => doc.storage_path && doc.storage_path !== 'deleted');
  const allApproved = allSubmitted && docs.every((doc) => doc.status === 'approved');

  return { docs, allSubmitted, allApproved };
};

export const getAllowanceDisplayState = (
  profile?: WorkflowProfile | null,
): AllowanceDisplay => {
  if (profile?.status === 'allowance-consented') {
    return { key: 'approved', label: '승인 완료', color: 'green' };
  }

  if (profile?.status === 'allowance-pending' && hasText(profile.allowance_reject_reason)) {
    return { key: 'rejected', label: '미승인', color: 'red' };
  }

  if (profile.allowance_prescreen_requested_at) {
    return { key: 'prescreen', label: '사전 심사 요청 완료', color: 'blue' };
  }

  if (!profile?.allowance_date) {
    return { key: 'missing', label: 'FC 수당 동의일 미입력', color: 'gray' };
  }

  return { key: 'entered', label: 'FC 수당 동의 입력 완료', color: 'orange' };
};

export const hasAllowancePassed = (
  profile?: WorkflowProfile | null,
) => {
  if (!profile) return false;
  const allowancePassedByStatus = profile.status ? ALLOWANCE_PASSED_STATUSES.includes(profile.status) : false;
  const allowancePassedByDate = Boolean(profile.allowance_date) && profile.status !== 'allowance-pending';

  return Boolean(profile.temp_id) && (allowancePassedByStatus || allowancePassedByDate);
};

export const getCommissionCompletionState = (
  profile?: WorkflowProfile | null,
) => {
  const lifeCompleted = Boolean(profile?.life_commission_completed || profile?.appointment_date_life);
  const nonlifeCompleted = Boolean(profile?.nonlife_commission_completed || profile?.appointment_date_nonlife);
  const bothCompleted = lifeCompleted && nonlifeCompleted;

  return { lifeCompleted, nonlifeCompleted, bothCompleted };
};

export const hasAppointmentWorkflowEvidence = (
  profile?: WorkflowProfile | null,
) =>
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

export const hasHanwhaApprovalEvidence = (
  profile?: WorkflowProfile | null,
) =>
  profile?.status === 'hanwha-commission-approved' ||
  profile?.status === 'appointment-completed' ||
  profile?.status === 'final-link-sent' ||
  Boolean(profile?.hanwha_commission_date);

export const hasHanwhaApprovedPdf = (
  profile?: WorkflowProfile | null,
) => hasHanwhaApprovalEvidence(profile) && hasHanwhaPdfMetadata(profile);

export const hasUrlStageAccess = (
  profile?: WorkflowProfile | null,
) => {
  if (!profile) return false;
  if (profile.status === 'appointment-completed' || profile.status === 'final-link-sent') return true;
  return hasHanwhaApprovedPdf(profile);
};

export const hasFinalCompletionEvidence = (
  profile?: WorkflowProfile | null,
) => {
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

const getFcHomeStepKey = (step: WorkflowStepNumber): FcHomeStepKey => {
  switch (step) {
    case 1:
      return 'consent';
    case 2:
      return 'docs';
    case 3:
      return 'hanwha';
    case 4:
      return 'url';
    default:
      return 'final';
  }
};

const getDocumentReviewState = (profile?: WorkflowProfile | null) => {
  const docs = profile?.fc_documents ?? [];
  const uploadedDocs = docs.filter((doc) => doc.storage_path && doc.storage_path !== 'deleted');
  const hasRejectedDocs = docs.some((doc) => doc.status === 'rejected');
  const hasPendingReview = uploadedDocs.some((doc) => doc.status !== 'approved' && doc.status !== 'rejected');
  const { allSubmitted, allApproved } = getApprovedDocumentState(profile);

  return {
    docs,
    requested: docs.length > 0,
    uploadedDocs,
    hasRejectedDocs,
    hasPendingReview,
    allSubmitted,
    allApproved,
  };
};

const getInsuranceActionState = (profile?: WorkflowProfile | null) => {
  const lifeScheduled = hasText(profile?.appointment_schedule_life);
  const nonlifeScheduled = hasText(profile?.appointment_schedule_nonlife);
  const lifeSubmitted = Boolean(profile?.appointment_date_life_sub);
  const nonlifeSubmitted = Boolean(profile?.appointment_date_nonlife_sub);
  const lifeApproved = Boolean(profile?.life_commission_completed || profile?.appointment_date_life);
  const nonlifeApproved = Boolean(profile?.nonlife_commission_completed || profile?.appointment_date_nonlife);

  const lifeCanSubmit = lifeScheduled && !lifeApproved && !lifeSubmitted;
  const nonlifeCanSubmit = nonlifeScheduled && !nonlifeApproved && !nonlifeSubmitted;
  const lifeAwaitingApproval = lifeSubmitted && !lifeApproved;
  const nonlifeAwaitingApproval = nonlifeSubmitted && !nonlifeApproved;
  const lifeMissingSchedule = !lifeApproved && !lifeSubmitted && !lifeScheduled;
  const nonlifeMissingSchedule = !nonlifeApproved && !nonlifeSubmitted && !nonlifeScheduled;

  return {
    lifeApproved,
    nonlifeApproved,
    lifeCanSubmit,
    nonlifeCanSubmit,
    lifeAwaitingApproval,
    nonlifeAwaitingApproval,
    lifeMissingSchedule,
    nonlifeMissingSchedule,
    hasActionableInput: lifeCanSubmit || nonlifeCanSubmit,
  };
};

export const getFcHomeNextAction = (profile?: WorkflowProfile | null): FcHomeNextAction => {
  const step = calcFcHomeWorkflowStep(profile);
  const key = getFcHomeStepKey(step);

  if (!profile) {
    return {
      step,
      key,
      route: '/consent',
      title: '수당동의',
      subtitle: '터치하여 바로 진행하세요',
      disabled: false,
    };
  }

  if (step === 1) {
    const allowanceDisplay = getAllowanceDisplayState(profile);
    if (!profile.temp_id) {
      return {
        step,
        key,
        route: '/consent',
        title: '수당동의',
        subtitle: '총무가 임시사번을 발급중입니다. 기다려주세요.',
        disabled: false,
      };
    }
    if (allowanceDisplay.key === 'rejected') {
      return {
        step,
        key,
        route: '/consent',
        title: '수당동의',
        subtitle: '반려 사유를 확인하고 다시 입력하세요',
        disabled: false,
      };
    }
    if (allowanceDisplay.key === 'prescreen') {
      return {
        step,
        key,
        route: '/consent',
        title: '수당동의',
        subtitle: '사전 심사 결과를 기다리는 중입니다.',
        disabled: false,
      };
    }
    if (allowanceDisplay.key === 'entered') {
      return {
        step,
        key,
        route: '/consent',
        title: '수당동의',
        subtitle: '총무가 사전 심사를 준비 중입니다.',
        disabled: false,
      };
    }
    return {
      step,
      key,
      route: '/consent',
      title: '수당동의',
      subtitle: '터치하여 바로 진행하세요',
      disabled: false,
    };
  }

  if (step === 2) {
    const docs = getDocumentReviewState(profile);
    if (!docs.requested) {
      return {
        step,
        key,
        route: '/docs-upload',
        title: '문서제출',
        subtitle: '총무가 필요한 서류를 검토 중입니다. 기다려주세요.',
        disabled: false,
      };
    }
    if (docs.hasRejectedDocs) {
      return {
        step,
        key,
        route: '/docs-upload',
        title: '문서제출',
        subtitle: '반려된 서류를 다시 제출하세요.',
        disabled: false,
      };
    }
    if (!docs.allSubmitted) {
      return {
        step,
        key,
        route: '/docs-upload',
        title: '문서제출',
        subtitle: '모든 문서를 제출하세요.',
        disabled: false,
      };
    }
    return {
      step,
      key,
      route: '/docs-upload',
      title: '문서제출',
      subtitle: '서류를 검토 중입니다. 기다려주세요.',
      disabled: false,
    };
  }

  if (step === 3) {
    const hanwhaRejected =
      profile.status === 'hanwha-commission-rejected' || hasText(profile.hanwha_commission_reject_reason);
    const hanwhaApproved = hasHanwhaApprovalEvidence(profile);
    const hanwhaApprovedPdf = hasHanwhaApprovedPdf(profile);
    const hanwhaSubmitted = Boolean(profile.hanwha_commission_date_sub);

    if (hanwhaRejected) {
      return {
        step,
        key,
        route: '/hanwha-commission',
        title: '한화 위촉 URL',
        subtitle: '반려 사유를 확인하고 개인 메신저 URL에서 다시 진행한 뒤 재제출하세요.',
        disabled: false,
      };
    }
    if (hanwhaApproved && !hanwhaApprovedPdf) {
      return {
        step,
        key,
        route: '/hanwha-commission',
        title: '한화 위촉 URL',
        subtitle: '총무가 가람in으로 승인 PDF를 전달 중입니다. 기다려주세요.',
        disabled: false,
      };
    }
    if (hanwhaSubmitted) {
      return {
        step,
        key,
        route: '/hanwha-commission',
        title: '한화 위촉 URL',
        subtitle: '총무가 위촉 여부를 검토중입니다.',
        disabled: false,
      };
    }
    return {
      step,
      key,
      route: '/hanwha-commission',
      title: '한화 위촉 URL',
      subtitle: '한화라이프랩 위촉 진행',
      disabled: false,
    };
  }

  if (step === 4) {
    const insurance = getInsuranceActionState(profile);
    const hasApprovedPdf = hasHanwhaApprovedPdf(profile);
    const hasAppointmentEvidence = hasAppointmentWorkflowEvidence(profile);

    if (!hasApprovedPdf && !hasAppointmentEvidence) {
      return {
        step,
        key,
        route: '/appointment',
        title: '생명/손해 위촉',
        subtitle: '한화 위촉 URL 승인 PDF 확인 후 진행할 수 있습니다.',
        disabled: false,
      };
    }

    if (insurance.lifeApproved && !insurance.nonlifeApproved) {
      if (insurance.nonlifeCanSubmit) {
        return {
          step,
          key,
          route: '/appointment',
          title: '생명/손해 위촉',
          subtitle: '생명 위촉은 완료되었습니다. 손해 위촉을 진행해 주세요.',
          disabled: false,
        };
      }
      if (insurance.nonlifeAwaitingApproval) {
        return {
          step,
          key,
          route: '/appointment',
          title: '생명/손해 위촉',
          subtitle: '손해 위촉 완료 여부를 총무가 검토중입니다.',
          disabled: false,
        };
      }
      return {
        step,
        key,
        route: '/appointment',
        title: '생명/손해 위촉',
        subtitle: '손해 위촉 차수를 입력중입니다. 기다려주세요.',
        disabled: false,
      };
    }

    if (!insurance.lifeApproved && insurance.nonlifeApproved) {
      if (insurance.lifeCanSubmit) {
        return {
          step,
          key,
          route: '/appointment',
          title: '생명/손해 위촉',
          subtitle: '손해 위촉은 완료되었습니다. 생명 위촉을 진행해 주세요.',
          disabled: false,
        };
      }
      if (insurance.lifeAwaitingApproval) {
        return {
          step,
          key,
          route: '/appointment',
          title: '생명/손해 위촉',
          subtitle: '생명 위촉 완료 여부를 총무가 검토중입니다.',
          disabled: false,
        };
      }
      return {
        step,
        key,
        route: '/appointment',
        title: '생명/손해 위촉',
        subtitle: '생명 위촉 차수를 입력중입니다. 기다려주세요.',
        disabled: false,
      };
    }

    if (insurance.hasActionableInput) {
      return {
        step,
        key,
        route: '/appointment',
        title: '생명/손해 위촉',
        subtitle: '터치하여 위촉을 진행해 주세요.',
        disabled: false,
      };
    }

    if (insurance.lifeAwaitingApproval || insurance.nonlifeAwaitingApproval) {
      return {
        step,
        key,
        route: '/appointment',
        title: '생명/손해 위촉',
        subtitle: '위촉 완료 여부를 총무가 검토중입니다.',
        disabled: false,
      };
    }

    return {
      step,
      key,
      route: '/appointment',
      title: '생명/손해 위촉',
      subtitle: '위촉 차수를 입력중입니다. 기다려주세요.',
      disabled: false,
    };
  }

  return {
    step,
    key,
    route: '/appointment',
    title: '완료',
    subtitle: '모든 위촉 과정이 끝났습니다.',
    disabled: false,
  };
};
