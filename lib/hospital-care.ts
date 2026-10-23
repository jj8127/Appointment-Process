import { getSeoulTodayIsoDate } from '@/lib/admin-assisted-signup-validation';
import { CARE_WEEKDAYS } from '@/lib/hospital-care-queue';

export { CARE_WEEKDAYS, formatCareDate, formatCareTime } from '@/lib/hospital-care-queue';

/**
 * Checklist sent with a confirmed care reservation. Draft compiled from public
 * hospital admission guides; the operator reviews the final wording.
 */
export const CARE_PRECAUTIONS = [
  '입원 병동과 호실이 정해지면 상담원에게 알려 주세요.',
  '간병인 출입증과 보호자 등록 방법은 병동 간호사실에서 확인해 주세요.',
  '복용 중인 약, 알레르기, 거동 상태는 간병 시작 날 간병인에게 직접 알려 주세요.',
  '세면도구, 물티슈, 기저귀 같은 개인 위생용품을 준비해 주세요.',
  '꽃, 화분, 외부 음식처럼 반입이 제한되는 물품은 병원 규정을 따라 주세요.',
  '면회 시간과 마스크 착용 같은 감염 예방 규정은 병원 안내를 따라 주세요.',
  '주사, 약 조절 같은 의료행위는 간병인이 할 수 없습니다. 의료진에게 요청해 주세요.',
  '간병 비용과 정산 방법은 간병 시작 전에 상담원과 확인해 주세요.',
] as const;

/** Matches HOSPITAL_CARE_PUSH_DATA in supabase/functions/_shared/hospital-care-push.ts. */
export const isHospitalCarePushData = (data: unknown) =>
  typeof data === 'object' && data !== null && (data as { kind?: unknown }).kind === 'hospital_care';

export const CARE_START_DAYS = 30;

/** Selectable start dates from today (Seoul) for the next CARE_START_DAYS days. */
export function careStartOptions(now = new Date()) {
  const [year, month, day] = getSeoulTodayIsoDate(now).split('-').map(Number);
  return Array.from({ length: CARE_START_DAYS }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1, day + offset));
    const value = date.toISOString().slice(0, 10);
    const label = offset === 0 ? '오늘' : offset === 1 ? '내일' : `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    return { value, label, weekday: CARE_WEEKDAYS[date.getUTCDay()] };
  });
}

export type CareCalendarCell = { day: number; value: string | null; today: boolean; sunday: boolean } | null;

/** Month grids (Sunday first) covering the selectable start dates; days outside the window have no value. Weeks that end before the window are left out. */
export function careCalendarMonths(options: { value: string; label: string }[]) {
  const selectable = new Set(options.map((option) => option.value));
  const today = options.find((option) => option.label === '오늘')?.value;
  return [...new Set(options.map((option) => option.value.slice(0, 7)))].map((key) => {
    const [year, month] = key.split('-').map(Number);
    const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells: CareCalendarCell[] = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= days; day++) {
      const value = `${key}-${String(day).padStart(2, '0')}`;
      cells.push({ day, value: selectable.has(value) ? value : null, today: value === today, sunday: (lead + day - 1) % 7 === 0 });
    }
    const first = options[0]?.value ?? '';
    const weeks: CareCalendarCell[][] = [];
    for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
    const kept = weeks.filter((week) => week.some((cell) => cell && `${key}-${String(cell.day).padStart(2, '0')}` >= first));
    return { key, label: `${year}.${String(month).padStart(2, '0')}`, cells: kept.flat() };
  });
}

/** One tone per status, shared by the member and staff screens. */
export const CARE_STATUS_TONES = {
  requested: { bg: '#f1f3f5', fg: '#374151' },
  reviewing: { bg: '#e3edff', fg: '#1d4ed8' },
  adjusted: { bg: '#fff1dc', fg: '#9a3412' },
  confirmed: { bg: '#dcf5e7', fg: '#047857' },
  declined: { bg: '#fde4e4', fg: '#b91c1c' },
  cancelled: { bg: '#f1f3f5', fg: '#4b5563' },
} as const;
