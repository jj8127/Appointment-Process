import { FcProfile } from '@shared/types/fc';

export const STATUS_LABELS: Record<FcProfile['status'] | string, string> = {
  draft: '임시사번 미발급',
  'temp-id-issued': '임시번호 발급 완료',
  'allowance-pending': '수당동의 검토 중',
  'allowance-consented': '수당동의 완료',
  'docs-requested': '서류 요청',
  'docs-pending': '서류 대기',
  'docs-submitted': '서류 제출됨',
  'docs-rejected': '반려',
  'docs-approved': '위촉 URL 진행',
  'appointment-completed': '위촉 완료',
  'final-link-sent': '최종 완료',
};

export const STEP_LABELS: Record<string, string> = {
  step1: '1단계 인적사항',
  step2: '2단계 수당동의',
  step3: '3단계 문서제출',
  step4: '4단계 위촉 진행',
  step5: '5단계 완료',
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

export const calcStep = (profile: FcProfile) => {
  const hasBasicInfo =
    Boolean(profile.name && profile.affiliation && profile.resident_id_masked) &&
    Boolean(profile.email || profile.address);
  if (!hasBasicInfo) return 1;

  const hasAllowance = Boolean(profile.allowance_date) && profile.status !== 'allowance-pending';
  if (!hasAllowance) return 2;

  const docs = profile.fc_documents ?? [];
  const totalDocs = docs.length;
  const uploaded = docs.filter((d) => d.storage_path && d.storage_path !== 'deleted').length;
  const approvedStatuses: FcProfile['status'][] = ['docs-approved', 'appointment-completed', 'final-link-sent'];
  const isApproved = approvedStatuses.includes(profile.status);
  const docsComplete = totalDocs > 0 && uploaded === totalDocs;

  if (!docsComplete && !isApproved) return 3;
  if (!isApproved) return 3;

  const appointmentDone =
    Boolean(profile.appointment_date_life) && Boolean(profile.appointment_date_nonlife);
  if (!appointmentDone) return 4;

  return 5;
};
