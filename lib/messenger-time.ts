// Messenger dates and times are always shown in Korea time, whatever time zone
// the device is set to. Korea has no daylight saving, so a fixed +9h shift is
// exact and avoids depending on the engine's Intl time zone data.
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** Messages from one sender inside this window share one time label. */
export const MESSENGER_RUN_WINDOW_MS = 60 * 1000;

type KstParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

function kst(date: Date): KstParts {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

function kstDayKey(date: Date) {
  const p = kst(date);
  return p.year * 10000 + p.month * 100 + p.day;
}

function kstMinuteKey(date: Date) {
  return Math.floor((date.getTime() + KST_OFFSET_MS) / MESSENGER_RUN_WINDOW_MS);
}

/** Time shown beside a chat bubble, e.g. "오후 3:05" (Korea time). */
export function formatMessengerTime(iso: string) {
  const date = toDate(iso);
  if (!date) return '';
  const { hour, minute } = kst(date);
  return `${hour < 12 ? '오전' : '오후'} ${((hour + 11) % 12) + 1}:${String(minute).padStart(2, '0')}`;
}

/** Day divider label, e.g. "2026년 10월 15일 목요일" (Korea time). */
export function formatMessengerDayLabel(iso: string) {
  const date = toDate(iso);
  if (!date) return '';
  const p = kst(date);
  return `${p.year}년 ${p.month}월 ${p.day}일 ${WEEKDAYS[p.weekday]}요일`;
}

/**
 * In a newest-first (inverted) message list, the oldest message of each Korea
 * day carries that day's divider.
 */
export function startsMessengerDay<T>(
  messages: readonly T[],
  index: number,
  getCreatedAt: (message: T) => string,
) {
  const current = toDate(getCreatedAt(messages[index]));
  if (!current) return false;
  const older = index + 1 < messages.length ? toDate(getCreatedAt(messages[index + 1])) : null;
  return !older || kstDayKey(current) !== kstDayKey(older);
}

/**
 * Position of a message inside a run of consecutive messages from one sender
 * sent in the same minute (KakaoTalk style), for a newest-first list.
 * `first`: the oldest of the run, which shows the sender's name and avatar.
 * `last`: the newest of the run, which shows the time.
 */
export function messengerRunPosition<T>(
  messages: readonly T[],
  index: number,
  getSenderKey: (message: T) => string | null | undefined,
  getCreatedAt: (message: T) => string,
): { first: boolean; last: boolean } {
  const sameRun = (a: T | undefined, b: T | undefined) => {
    if (!a || !b) return false;
    const keyA = getSenderKey(a);
    if (!keyA || keyA !== getSenderKey(b)) return false;
    const dateA = toDate(getCreatedAt(a));
    const dateB = toDate(getCreatedAt(b));
    return Boolean(dateA && dateB && kstMinuteKey(dateA) === kstMinuteKey(dateB));
  };
  const current = messages[index];
  return {
    first: !sameRun(current, messages[index + 1]),
    last: !sameRun(current, messages[index - 1]),
  };
}

/** Conversation list time: today "오후 3:05", yesterday "어제", this year "10월 14일", older "2025. 10. 14." (Korea time). */
export function formatMessengerListTime(iso: string | null, now: Date = new Date()) {
  const date = toDate(iso);
  if (!date) return '';
  const today = kstDayKey(now);
  const day = kstDayKey(date);
  if (day === today) return formatMessengerTime(iso as string);
  if (day === kstDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return '어제';
  const p = kst(date);
  if (p.year === kst(now).year) return `${p.month}월 ${p.day}일`;
  return `${p.year}. ${p.month}. ${p.day}.`;
}
