import { getSeoulTodayIsoDate } from '@/lib/admin-assisted-signup-validation';

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
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** Selectable start dates from today (Seoul) for the next CARE_START_DAYS days. */
export function careStartOptions(now = new Date()) {
  const [year, month, day] = getSeoulTodayIsoDate(now).split('-').map(Number);
  return Array.from({ length: CARE_START_DAYS }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1, day + offset));
    const value = date.toISOString().slice(0, 10);
    const label = offset === 0 ? '오늘' : offset === 1 ? '내일' : `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    return { value, label, weekday: WEEKDAYS[date.getUTCDay()] };
  });
}

export function formatCareDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return `${month}월 ${day}일 (${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]})`;
}
