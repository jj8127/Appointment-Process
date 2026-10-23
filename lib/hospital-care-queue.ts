/**
 * Care request labels and the staff answer queue, shared by the app and the admin web
 * (`@shared/lib/hospital-care-queue`). Keep this file free of app-only imports.
 */
export const CARE_REQUEST_STATUSES = { requested: '접수됨', reviewing: '확인 중', confirmed: '확정', adjusted: '일정 조정', declined: '진행 어려움', cancelled: '취소함' } as const;
export const CARE_TYPES = { full_day: '24시간 간병', day_time: '주간 간병' } as const;
export const CONTACT_TIMES = { morning: '오전', afternoon: '오후', evening: '저녁', anytime: '언제든' } as const;
export type HospitalCareRequest = {
  id: string; hospitalId: string; hospitalName: string; desiredStart: string; careType: keyof typeof CARE_TYPES;
  contactTime: keyof typeof CONTACT_TIMES; status: keyof typeof CARE_REQUEST_STATUSES; staffNote: string | null; respondedAt: string | null; createdAt: string;
};
export type AdminCareRequest = HospitalCareRequest & {
  memberName: string | null; memberPhone: string | null;
  firstContactDueAt: string; firstContactAt: string | null; decidedAt: string | null; careStartedAt: string | null;
};
export type CareMetrics = {
  requests: number; firstContactDue: number; firstContactOnTime: number; overdueNow: number;
  medianFirstContactMinutes: number | null; medianDecisionMinutes: number | null; confirmed: number; started: number;
};
export type CareMilestone = 'first_contact' | 'care_started';
export const CARE_DECISIONS = ['reviewing', 'confirmed', 'adjusted', 'declined'] as const;
export type CareDecision = (typeof CARE_DECISIONS)[number];
/** The member is told why, so these two decisions need a note. */
export const decisionNeedsNote = (decision: CareDecision) => decision === 'adjusted' || decision === 'declined';

export const CARE_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatCareDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return `${month}월 ${day}일 (${CARE_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]})`;
}

/** "10월 22일 14:05" in Seoul time (UTC+9, no daylight saving). */
export function formatCareTime(value: string) {
  const date = new Date(Date.parse(value) + 9 * 3600000);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export function minutesLabel(minutes: number) {
  if (minutes < 60) return `${minutes}분`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간`;
  return `${Math.floor(minutes / 1440)}일`;
}

export function elapsedLabel(createdAt: string, now = Date.now()) {
  return `${minutesLabel(Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60000)))} 경과`;
}

type FirstContactFields = Pick<AdminCareRequest, 'firstContactAt' | 'firstContactDueAt' | 'status'>;

/** Minutes until the first-contact deadline (negative once overdue); null once staff reached the member or the request left the queue. */
export function firstContactMinutesLeft(request: FirstContactFields, now = Date.now()) {
  if (request.firstContactAt || !['requested', 'reviewing'].includes(request.status)) return null;
  return Math.floor((Date.parse(request.firstContactDueAt) - now) / 60000);
}

/** First-contact countdown for an unanswered request; null once staff reached the member. */
export function firstContactLabel(request: FirstContactFields, now = Date.now()) {
  const left = firstContactMinutesLeft(request, now);
  if (left === null) return null;
  return left >= 0 ? `첫 연락 ${minutesLabel(left)} 남음` : `첫 연락 기한 ${minutesLabel(-left)} 초과`;
}

/** Waiting requests first, by first-contact due time; everything else keeps the server order (newest first). */
export function careQueue(requests: AdminCareRequest[]) {
  const open = requests.filter((item) => item.status === 'requested' || item.status === 'reviewing')
    .sort((a, b) => Date.parse(a.firstContactDueAt) - Date.parse(b.firstContactDueAt));
  const rest = requests.filter((item) => !open.includes(item));
  return { open, rest, confirmed: requests.filter((item) => item.status === 'confirmed'), all: [...open, ...rest] };
}

export const formatCarePhone = (phone: string) => phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
export const carePercent = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}%` : '-';
export const careMedian = (value: number | null) => value === null ? '-' : minutesLabel(Math.round(value));
