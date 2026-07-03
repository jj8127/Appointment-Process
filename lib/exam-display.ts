import { formatPhone, normalizePhone } from '@/lib/validation';

export type ExamRoundRefLike = {
  exam_type?: 'life' | 'nonlife' | null;
  exam_date?: string | null;
  round_label?: string | null;
};

export type ExamLocationRefLike = {
  location_name?: string | null;
};

export type ExamRegistrationDisplayLike = {
  exam_rounds?: ExamRoundRefLike | ExamRoundRefLike[] | null;
  exam_locations?: ExamLocationRefLike | ExamLocationRefLike[] | null;
};

export function formatExamResidentNumber(num: string | null | undefined) {
  if (!num) return '-';
  const clean = num.replace(/[^0-9]/g, '');
  if (clean.length === 13) return `${clean.slice(0, 6)}-${clean.slice(6)}`;
  return num;
}

export function normalizeExamSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

export function buildExamPhoneCandidates(value: string | null | undefined) {
  const raw = String(value ?? '').trim();
  const digits = normalizePhone(raw);
  const formatted = digits.length === 11 ? formatPhone(digits) : '';
  return Array.from(new Set([raw, digits, formatted].filter(Boolean)));
}

export function formatExamYmd(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function buildExamInfo(reg: ExamRegistrationDisplayLike): string {
  const round = normalizeExamSingle(reg.exam_rounds);
  const loc = normalizeExamSingle(reg.exam_locations);
  const examDateStr = round?.exam_date ?? null;
  let ymPart = '';
  let datePart = '';

  if (examDateStr) {
    const d = new Date(examDateStr);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    ymPart = `${y}년 ${m}월`;
    datePart = `${m}/${day}`;
  }

  const roundLabel = round?.round_label ?? '';
  const locName = loc?.location_name ?? '';

  if (ymPart && datePart && roundLabel && locName) {
    return `${ymPart} ${roundLabel} : ${datePart} [${locName}]`;
  }
  if (ymPart && roundLabel) return `${ymPart} ${roundLabel}`;
  if (datePart && locName) return `${datePart} [${locName}]`;
  return roundLabel || locName || '-';
}
