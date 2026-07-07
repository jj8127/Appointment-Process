export type ExamApplicationMissingField =
  | '응시료 납입 일자'
  | '시험 일정'
  | '응시 지역'
  | '응시 과목';

type ExamApplicationSelection = {
  feePaidDate?: Date | null;
  selectedRoundId?: string | null;
  selectedLocationId?: string | null;
  hasSelectedSubject: boolean;
};

const hasValue = (value?: string | null) => {
  const normalized = (value ?? '').trim();
  return normalized.length > 0 && normalized !== 'undefined' && normalized !== 'null';
};

export function getMissingExamApplicationFields({
  feePaidDate,
  selectedRoundId,
  selectedLocationId,
  hasSelectedSubject,
}: ExamApplicationSelection): ExamApplicationMissingField[] {
  const missing: ExamApplicationMissingField[] = [];

  if (!feePaidDate) missing.push('응시료 납입 일자');
  if (!hasValue(selectedRoundId)) missing.push('시험 일정');
  if (!hasValue(selectedLocationId)) missing.push('응시 지역');
  if (!hasSelectedSubject) missing.push('응시 과목');

  return missing;
}

export function formatMissingExamApplicationFields(fields: ExamApplicationMissingField[]): string | null {
  if (fields.length === 0) return null;
  return `다음 항목을 선택해주세요.\n${fields.map((field) => `- ${field}`).join('\n')}`;
}
