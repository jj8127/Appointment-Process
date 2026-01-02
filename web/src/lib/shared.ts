import { FcProfile } from '../types/fc';

export const STATUS_LABELS: Record<FcProfile['status'] | string, string> = {
  draft: '임시사번 미발급',
  'temp-id-issued': '임시사번 발급 완료',
  'allowance-pending': '수당동의 검토 중',
  'allowance-consented': '수당동의 승인 완료',
  'docs-requested': '필수 서류 요청',
  'docs-pending': '서류 대기',
  'docs-submitted': '서류 제출됨',
  'docs-rejected': '서류 반려',
  'docs-approved': '서류 승인 완료',
  'appointment-completed': '위촉 완료(승인 대기)',
  'final-link-sent': '최종 완료',
};

export const STEP_LABELS: Record<string, string> = {
  step1: '1단계 인적사항',
  step2: '2단계 수당동의',
  step3: '3단계 문서제출',
  step4: '4단계 위촉 진행',
  step5: '5단계 완료',
};

export const ADMIN_STEP_LABELS: Record<string, string> = {
  step0: '0단계 사전등록',
  step1: '1단계 수당동의',
  step2: '2단계 문서제출',
  step3: '3단계 위촉 진행',
  step4: '4단계 완료',
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

type DocProgressKey = 'no-request' | 'requested' | 'in-progress' | 'rejected' | 'approved';
type AppointmentProgressKey = 'not-set' | 'in-progress' | 'fc-done' | 'approved';

export const getDocProgress = (profile: FcProfile) => {
  const docs = profile.fc_documents ?? [];
  if (!docs.length) {
    return { key: 'no-request' as DocProgressKey, label: '요청 안함', color: 'gray' };
  }

  const rejected = docs.some((d) => d.status === 'rejected');
  if (rejected) {
    return { key: 'rejected' as DocProgressKey, label: '반려', color: 'red' };
  }

  const uploaded = docs.filter((d) => d.storage_path && d.storage_path !== 'deleted');
  if (!uploaded.length) {
    return { key: 'requested' as DocProgressKey, label: '요청 완료', color: 'blue' };
  }

  const allApproved = uploaded.length === docs.length && uploaded.every((d) => d.status === 'approved');
  if (allApproved) {
    return { key: 'approved' as DocProgressKey, label: '모든 서류 승인', color: 'green' };
  }

  return { key: 'in-progress' as DocProgressKey, label: '제출 중', color: 'orange' };
};

export const getAppointmentProgress = (profile: FcProfile, type: 'life' | 'nonlife') => {
  const schedule =
    type === 'life' ? profile.appointment_schedule_life : profile.appointment_schedule_nonlife;
  const approved =
    type === 'life' ? profile.appointment_date_life : profile.appointment_date_nonlife;
  const submitted =
    type === 'life' ? profile.appointment_date_life_sub : profile.appointment_date_nonlife_sub;

  if (approved) {
    return { key: 'approved' as AppointmentProgressKey, label: '승인완료', color: 'green' };
  }
  if (submitted) {
    return { key: 'fc-done' as AppointmentProgressKey, label: '위촉 승인 대기', color: 'orange' };
  }
  if (schedule) {
    return { key: 'in-progress' as AppointmentProgressKey, label: '진행중', color: 'blue' };
  }
  return { key: 'not-set' as AppointmentProgressKey, label: '미입력', color: 'gray' };
};

export const getSummaryStatus = (profile: FcProfile) => {
  const step = calcStep(profile);
  if (step <= 2) {
    if (!profile.temp_id) {
      return { label: '임시사번 미발급', color: 'gray' };
    }
    if (profile.status === 'allowance-consented') {
      return { label: '수당동의 승인 완료', color: 'green' };
    }
    if (profile.status === 'allowance-pending') {
      return { label: '수당동의 검토 중', color: 'orange' };
    }
    return { label: '수당동의 대기', color: 'gray' };
  }

  const doc = getDocProgress(profile);
  if (doc.key === 'no-request') return { label: '서류 요청 안함', color: 'gray' };
  if (doc.key === 'requested') return { label: '서류 제출 대기', color: 'orange' };
  if (doc.key === 'rejected') return { label: '서류 반려', color: 'red' };
  if (doc.key === 'in-progress') return { label: '', color: 'orange' };

  const life = getAppointmentProgress(profile, 'life');
  const nonlife = getAppointmentProgress(profile, 'nonlife');
  const anyApproved = life.key === 'approved' || nonlife.key === 'approved';
  const anySubmitted = life.key === 'fc-done' || nonlife.key === 'fc-done';
  const anySchedule = life.key === 'in-progress' || nonlife.key === 'in-progress';
  const allApproved = life.key === 'approved' && nonlife.key === 'approved';

  if (allApproved) return { label: '최종 완료', color: 'green' };
  if (anySubmitted) return { label: '', color: 'orange' };
  if (anySchedule || anyApproved) return { label: '', color: 'blue' };
  return { label: '위촉 차수 미입력', color: 'gray' };
};

export const calcStep = (profile: FcProfile) => {
  const hasBasicInfo =
    Boolean(profile.name && profile.affiliation && profile.resident_id_masked) &&
    Boolean(profile.email || profile.address);
  if (!hasBasicInfo) return 1;

  const allowancePassedStatuses: FcProfile['status'][] = [
    'allowance-consented',
    'docs-requested',
    'docs-pending',
    'docs-submitted',
    'docs-rejected',
    'docs-approved',
    'appointment-completed',
    'final-link-sent',
  ];
  if (!allowancePassedStatuses.includes(profile.status)) return 2;

  const docs = profile.fc_documents ?? [];
  const allSubmitted =
    docs.length > 0 && docs.every((d) => d.storage_path && d.storage_path !== 'deleted');
  const allApproved = allSubmitted && docs.every((d) => d.status === 'approved');
  if (!allApproved) return 3;

  if (profile.status !== 'final-link-sent') return 4;

  return 5;
};

export const getAdminStep = (profile: FcProfile) => {
  if (!profile.identity_completed) return '0단계 사전등록';
  const rawStep = calcStep(profile);
  // FC Step 1 (Info) and Step 2 (Allowance) -> Admin Step 1 (Allowance)
  if (rawStep <= 2) return '1단계 수당동의';
  if (rawStep === 3) return '2단계 문서제출';
  if (rawStep === 4) return '3단계 위촉 진행';
  return '4단계 완료';
};
