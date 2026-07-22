export type ExamApplicantApplicationType = '신규신청' | '재신청';

export type ExamApplicantListItem = {
  created_at?: string | null;
  round_id?: string | null;
  affiliation: string;
  name: string;
  resident_id: string;
  address: string;
  phone: string;
  location_name: string;
  round_label: string;
  exam_date: string | null;
  exam_type?: string | null;
  fee_paid_date?: string | null;
  is_confirmed: boolean;
  is_third_exam?: boolean;
  application_type?: ExamApplicantApplicationType | string | null;
};

export type ExamApplicantFilterOption = {
  value: string;
  label: string;
};

export type ExamApplicantFilterItem = Pick<
  ExamApplicantListItem,
  'round_id' | 'round_label' | 'exam_date' | 'exam_type' | 'is_third_exam'
>;

export type ExamApplicantExportColumnKey =
  | 'affiliation'
  | 'name'
  | 'resident_id'
  | 'address'
  | 'phone'
  | 'application_created_at'
  | 'subject_display'
  | 'application_type'
  | 'life_exam_date'
  | 'life_location'
  | 'nonlife_exam_date'
  | 'nonlife_location'
  | 'third_exam'
  | 'fee_paid_date';

export type ExamApplicantExportColumn = {
  key: ExamApplicantExportColumnKey;
  title: string;
  minWidth: number;
};

export const EXAM_APPLICANT_EXPORT_COLUMNS: ExamApplicantExportColumn[] = [
  { key: 'affiliation', title: '소속', minWidth: 180 },
  { key: 'name', title: '응시자 이름', minWidth: 100 },
  { key: 'resident_id', title: '주민등록번호(전체)', minWidth: 150 },
  { key: 'address', title: '주소', minWidth: 420 },
  { key: 'phone', title: '전화번호', minWidth: 130 },
  { key: 'application_created_at', title: '시험 신청일', minWidth: 140 },
  { key: 'subject_display', title: '시험응시 과목', minWidth: 180 },
  { key: 'application_type', title: '시험 신청 구분', minWidth: 150 },
  { key: 'life_exam_date', title: '생명보험 응시일자', minWidth: 150 },
  { key: 'life_location', title: '생명보험 고사장', minWidth: 130 },
  { key: 'nonlife_exam_date', title: '손해보험 응시일자', minWidth: 150 },
  { key: 'nonlife_location', title: '손해보험 고사장', minWidth: 130 },
  { key: 'third_exam', title: '제3보험 포함 여부', minWidth: 130 },
  { key: 'fee_paid_date', title: '응시료 입금 날짜', minWidth: 170 },
];

export const EXAM_APPLICANT_TABLE_BADGE_STYLES = {
  root: {
    height: 'auto',
    minHeight: 28,
    maxWidth: '100%',
    paddingBlock: 4,
    overflow: 'visible',
  },
  label: {
    whiteSpace: 'normal',
    lineHeight: 1.25,
    overflow: 'visible',
    textOverflow: 'clip',
    wordBreak: 'keep-all',
    textAlign: 'center',
  },
} as const;

export const EXAM_APPLICANT_ALL_FILTER_VALUE = '__all__';

export const EXAM_APPLICANT_ALL_AFFILIATION_FILTER_VALUE = '전체';

export const EXAM_APPLICANT_PINNED_QUICK_AFFILIATIONS = [
  '2본부 박성훈',
  '6본부 김정수',
  '9본부 김주용',
  '10본부 한태균',
] as const;

const EXAM_APPLICANT_QUICK_AFFILIATION_ALIASES: Record<string, string> = {
  '6본부 김정수(박선희)': '6본부 김정수',
  '9본부 이현욱(김주용)': '9본부 김주용',
};

export function normalizeExamApplicantQuickAffiliation(value?: string | null): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim() || '-';
  return EXAM_APPLICANT_QUICK_AFFILIATION_ALIASES[normalized] ?? normalized;
}

function quickAffiliationOrder(value: string): number {
  const match = value.match(/^(\d+)본부(?:\s|$)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function buildExamApplicantQuickAffiliationOptions(
  rows: Array<{ affiliation?: string | null }>,
): string[] {
  const affiliations = new Set<string>(EXAM_APPLICANT_PINNED_QUICK_AFFILIATIONS);
  rows.forEach((row) => affiliations.add(normalizeExamApplicantQuickAffiliation(row.affiliation)));

  return [
    EXAM_APPLICANT_ALL_AFFILIATION_FILTER_VALUE,
    ...Array.from(affiliations).sort((a, b) => {
      const orderDiff = quickAffiliationOrder(a) - quickAffiliationOrder(b);
      return orderDiff || a.localeCompare(b, 'ko');
    }),
  ];
}

export function matchesExamApplicantQuickAffiliation(
  affiliation: string | null | undefined,
  selectedAffiliation: string,
): boolean {
  return selectedAffiliation === EXAM_APPLICANT_ALL_AFFILIATION_FILTER_VALUE
    || normalizeExamApplicantQuickAffiliation(affiliation) === selectedAffiliation;
}

const KOREAN_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const SUBJECT_FILTER_ORDER = ['life:base', 'life:third', 'nonlife:base', 'nonlife:third', 'unknown:base', 'unknown:third'];

function subjectFilterOrder(value: string): number {
  const index = SUBJECT_FILTER_ORDER.indexOf(value);
  return index === -1 ? SUBJECT_FILTER_ORDER.length : index;
}

export function getExamApplicantPrimarySubject(item: {
  exam_type?: string | null;
  round_label?: string | null;
}): 'life' | 'nonlife' | 'unknown' {
  if (item.exam_type === 'life') return 'life';
  if (item.exam_type === 'nonlife') return 'nonlife';

  const label = item.round_label ?? '';
  if (label.includes('손해')) return 'nonlife';
  if (label.includes('생명')) return 'life';
  return 'unknown';
}

export function getExamApplicantSubjectKey(item: {
  exam_type?: string | null;
  round_label?: string | null;
  is_third_exam?: boolean | null;
}): string {
  return `${getExamApplicantPrimarySubject(item)}:${item.is_third_exam ? 'third' : 'base'}`;
}

export function formatExamApplicantSubjectFilterLabel(subjectKey: string): string {
  switch (subjectKey) {
    case 'life:base':
      return '생명보험';
    case 'life:third':
      return '생명보험+제3보험';
    case 'nonlife:base':
      return '손해보험';
    case 'nonlife:third':
      return '손해보험+제3보험';
    default:
      return '미정';
  }
}

export function getExamApplicantRoundFilterValue(item: ExamApplicantFilterItem): string {
  const roundId = String(item.round_id ?? '').trim();
  if (roundId) return roundId;

  return [
    'missing-round',
    item.exam_date ?? '',
    item.round_label ?? '',
    getExamApplicantSubjectKey(item),
  ].join(':');
}

export function formatExamApplicantRoundFilterLabel(item: ExamApplicantFilterItem): string {
  const dateMatch = String(item.exam_date ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  const dateLabel = dateMatch ? dateMatch[1] : '날짜 미정';
  const roundLabel = item.round_label && item.round_label !== '-' ? item.round_label : '회차 미정';
  const subjectLabel = formatExamApplicantSubject(item);

  return `${dateLabel} · ${roundLabel} · ${subjectLabel}`;
}

export function buildExamApplicantSubjectFilterOptions(
  rows: ExamApplicantFilterItem[],
): ExamApplicantFilterOption[] {
  const optionByValue = new Map<string, ExamApplicantFilterOption>();

  for (const row of rows) {
    const value = getExamApplicantSubjectKey(row);
    if (!optionByValue.has(value)) {
      optionByValue.set(value, {
        value,
        label: formatExamApplicantSubjectFilterLabel(value),
      });
    }
  }

  return [
    { value: EXAM_APPLICANT_ALL_FILTER_VALUE, label: '전체' },
    ...Array.from(optionByValue.values()).sort((a, b) => {
      const orderDiff = subjectFilterOrder(a.value) - subjectFilterOrder(b.value);
      if (orderDiff !== 0) return orderDiff;
      return a.label.localeCompare(b.label);
    }),
  ];
}

export function buildExamApplicantRoundFilterOptions(
  rows: ExamApplicantFilterItem[],
  subjectFilterValue = EXAM_APPLICANT_ALL_FILTER_VALUE,
): ExamApplicantFilterOption[] {
  const optionByValue = new Map<string, ExamApplicantFilterOption>();

  for (const row of rows) {
    if (
      subjectFilterValue !== EXAM_APPLICANT_ALL_FILTER_VALUE &&
      getExamApplicantSubjectKey(row) !== subjectFilterValue
    ) {
      continue;
    }

    const value = getExamApplicantRoundFilterValue(row);
    if (!optionByValue.has(value)) {
      optionByValue.set(value, {
        value,
        label: formatExamApplicantRoundFilterLabel(row),
      });
    }
  }

  return [
    { value: EXAM_APPLICANT_ALL_FILTER_VALUE, label: '전체' },
    ...Array.from(optionByValue.values()).sort((a, b) => a.label.localeCompare(b.label)),
  ];
}

export function isExamApplicantRoundFilterValid(
  rows: ExamApplicantFilterItem[],
  subjectFilterValue: string,
  roundFilterValue: string,
): boolean {
  if (roundFilterValue === EXAM_APPLICANT_ALL_FILTER_VALUE) return true;

  return buildExamApplicantRoundFilterOptions(rows, subjectFilterValue).some(
    (option) => option.value === roundFilterValue,
  );
}

export function formatExamApplicantSubject(item: Pick<ExamApplicantListItem, 'exam_type' | 'round_label' | 'is_third_exam'>): string {
  const primarySubject = getExamApplicantPrimarySubject(item);
  const base =
    primarySubject === 'life'
      ? '생명보험'
      : primarySubject === 'nonlife'
        ? '손해보험'
        : '미정';

  if (!item.is_third_exam) {
    return base;
  }

  return `${base}+제3보험`;
}

export function formatExamApplicantSchedule(item: ExamApplicantListItem): string {
  const roundLabel = item.round_label && item.round_label !== '-' ? item.round_label : '';
  const dateParts = String(item.exam_date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!dateParts) {
    return roundLabel || '-';
  }

  const year = Number(dateParts[1]);
  const month = Number(dateParts[2]);
  const day = Number(dateParts[3]);
  const localDate = new Date(year, month - 1, day);
  const dateLabel = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} (${KOREAN_WEEKDAYS[localDate.getDay()]})`;

  return roundLabel ? `${roundLabel}: ${dateLabel}` : dateLabel;
}

export function formatExamApplicantReceptionStatus(item: Pick<ExamApplicantListItem, 'is_confirmed'>): string {
  return item.is_confirmed ? '접수 완료' : '미접수';
}

export function formatExamApplicantFeePaidDate(item: Pick<ExamApplicantListItem, 'fee_paid_date'>): string {
  const value = item.fee_paid_date ?? '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '-';
}

export function formatExamApplicantCreatedAt(item: Pick<ExamApplicantListItem, 'created_at'>): string {
  const value = item.created_at ?? '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '-';
}

export function getExamApplicantCellValue(
  item: ExamApplicantListItem,
  key: ExamApplicantExportColumnKey,
): string {
  const primarySubject = getExamApplicantPrimarySubject(item);
  const locationName = item.location_name || '-';

  switch (key) {
    case 'affiliation':
      return item.affiliation || '-';
    case 'name':
      return item.name || '-';
    case 'resident_id':
      return item.resident_id || '-';
    case 'address':
      return item.address || '-';
    case 'phone':
      return item.phone || '-';
    case 'application_created_at':
      return formatExamApplicantCreatedAt(item);
    case 'subject_display':
      return formatExamApplicantSubject(item);
    case 'application_type':
      return item.application_type || '신규신청';
    case 'life_exam_date':
      return primarySubject === 'life' ? formatExamApplicantSchedule(item) : '-';
    case 'life_location':
      return primarySubject === 'life' ? locationName : '-';
    case 'nonlife_exam_date':
      return primarySubject === 'nonlife' ? formatExamApplicantSchedule(item) : '-';
    case 'nonlife_location':
      return primarySubject === 'nonlife' ? locationName : '-';
    case 'third_exam':
      return item.is_third_exam ? '포함' : '-';
    case 'fee_paid_date':
      return formatExamApplicantFeePaidDate(item);
  }
}
