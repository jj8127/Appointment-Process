import { FcProfile } from '@/types/fc';

// Date formatting utilities
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

export const formatKoreanDate = (d: Date): string =>
  `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;

export const toYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const parseYmd = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

export const normalizeDateInput = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (DATE_RE.test(trimmed)) return trimmed;
  const parsed = parseYmd(trimmed);
  return parsed ? toYmd(parsed) : null;
};

// Status and step labels
export const STATUS_LABELS: Record<FcProfile['status'], string> = {
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

export const STEP_KEYS = ['step1', 'step2', 'step3', 'step4', 'step5'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const STEP_LABELS: Record<StepKey, string> = {
  step1: '1단계 회원가입',
  step2: '2단계 수당동의',
  step3: '3단계 문서제출',
  step4: '4단계 위촉 진행',
  step5: '5단계 완료',
};

export const ADMIN_STEP_LABELS: Record<string, string> = {
  step2: '1단계 수당동의',
  step3: '2단계 문서제출',
  step4: '3단계 위촉 진행',
  step5: '4단계 완료',
};

// Step calculation logic
interface FcRow {
  name?: string | null;
  affiliation?: string | null;
  resident_id_masked?: string | null;
  email?: string | null;
  address?: string | null;
  status: FcProfile['status'];
  fc_documents?: {
    storage_path: string | null;
    status?: string | null;
  }[];
  appointment_date_life?: string | null;
  appointment_date_nonlife?: string | null;
}

export const calcStep = (profile: FcRow): number => {
  const hasBasicInfo =
    Boolean(profile.name && profile.affiliation && profile.resident_id_masked) &&
    Boolean(profile.email || profile.address);
  if (!hasBasicInfo) return 1;

  // [1단계] 수당 동의 완료 여부
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
  if (!allowancePassedStatuses.includes(profile.status)) {
    return 2; // 수당동의 단계
  }

  // [2단계] 서류 승인 여부
  const docs = profile.fc_documents ?? [];
  const allSubmitted =
    docs.length > 0 && docs.every((d) => d.storage_path && d.storage_path !== 'deleted');
  const allApproved = allSubmitted && docs.every((d) => d.status === 'approved');
  if (!allApproved) {
    return 3; // 서류 단계
  }

  // [3단계] 위촉 완료 여부
  const hasAppointment =
    Boolean(profile.appointment_date_life) || Boolean(profile.appointment_date_nonlife);
  if (!hasAppointment) {
    return 4; // 위촉 진행 단계
  }

  return 5; // 완료
};

export const getStepKey = (profile: FcRow): StepKey => {
  const step = calcStep(profile);
  return STEP_KEYS[step - 1];
};

// Document options
export const ALL_DOC_OPTIONS: string[] = Array.from(
  new Set([
    '주민등록등본(상세)',
    '최종학력증명서',
    '경력증명서',
    '자격증(손해사정사)',
    '자격증(FP)',
    '자격증(증권투자권유)',
    '자격증(펀드)',
    '자격증(파생상품)',
    '자격증(변액보험)',
  ])
).sort();

// Filter utilities
export interface FcRowWithStep extends FcRow {
  stepKey: StepKey;
  id: string;
}

export type FilterKey = 'all' | StepKey;

export interface FilterOption {
  key: FilterKey;
  label: string;
  predicate: (fc: FcRowWithStep) => boolean;
}

export const createFilterOptions = (role: string | null): FilterOption[] => {
  if (role === 'admin') {
    const adminKeys = ['step2', 'step3', 'step4', 'step5'] as const;
    return [
      { key: 'all', label: '전체', predicate: (_: FcRowWithStep) => true },
      ...adminKeys.map((key) => ({
        key,
        label: ADMIN_STEP_LABELS[key],
        predicate: (fc: FcRowWithStep) => fc.stepKey === key,
      })),
    ];
  }
  return [
    { key: 'all', label: '전체', predicate: (_: FcRowWithStep) => true },
    ...STEP_KEYS.map((key) => ({
      key,
      label: STEP_LABELS[key],
      predicate: (fc: FcRowWithStep) => fc.stepKey === key,
    })),
  ];
};
