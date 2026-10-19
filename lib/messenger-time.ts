const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Time shown beside a chat bubble, e.g. "오후 10:52". */
export function formatMessengerTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/** Day divider label, e.g. "2026년 10월 15일 목요일". */
export function formatMessengerDayLabel(iso: string) {
  const date = toDate(iso);
  if (!date) return '';
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;
}

/**
 * In a newest-first (inverted) message list, the oldest message of each local day
 * carries that day's divider.
 */
export function startsMessengerDay<T>(
  messages: readonly T[],
  index: number,
  getCreatedAt: (message: T) => string,
) {
  const current = toDate(getCreatedAt(messages[index]));
  if (!current) return false;
  const older = index + 1 < messages.length ? toDate(getCreatedAt(messages[index + 1])) : null;
  return !older || !sameDay(current, older);
}

/** Conversation list time: today "오후 3:05", yesterday "어제", this year "10월 14일", older "2025. 10. 14.". */
export function formatMessengerListTime(iso: string | null, now: Date = new Date()) {
  const date = toDate(iso);
  if (!date) return '';
  if (sameDay(date, now)) return formatMessengerTime(iso as string);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return '어제';
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}월 ${date.getDate()}일`;
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}
