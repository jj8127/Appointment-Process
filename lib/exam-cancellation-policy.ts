export const EXAM_CANCELLATION_DEADLINE_MESSAGE =
  '마감된 시험입니다. 취소·변경은 관리자에게 문의해 주세요';
export const EXAM_CANCELLATION_DEADLINE_UNAVAILABLE_MESSAGE =
  '시험 마감일을 확인할 수 없습니다. 취소·변경은 관리자에게 문의해 주세요';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ExamCancellationDeadlineState = 'open' | 'closed' | 'unavailable';

/** registration_deadline is a date: the whole deadline day is open in Asia/Seoul. */
export function getExamCancellationDeadlineState(
  registrationDeadline: string | null | undefined,
  now = new Date(),
): ExamCancellationDeadlineState {
  if (!registrationDeadline || !/^\d{4}-\d{2}-\d{2}$/.test(registrationDeadline)) {
    return 'unavailable';
  }
  const deadlineDate = new Date(`${registrationDeadline}T00:00:00.000Z`);
  if (
    Number.isNaN(deadlineDate.getTime())
    || deadlineDate.toISOString().slice(0, 10) !== registrationDeadline
    || Number.isNaN(now.getTime())
  ) {
    return 'unavailable';
  }
  // Shift by the fixed Korea offset, then read UTC so device timezone never changes policy.
  const todayKst = new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
  return todayKst > registrationDeadline ? 'closed' : 'open';
}

export function getExamSelfCancellationDeadlineMessage(
  registrationDeadline: string | null | undefined,
  now = new Date(),
): string | null {
  const state = getExamCancellationDeadlineState(registrationDeadline, now);
  if (state === 'closed') return EXAM_CANCELLATION_DEADLINE_MESSAGE;
  if (state === 'unavailable') return EXAM_CANCELLATION_DEADLINE_UNAVAILABLE_MESSAGE;
  return null;
}

/** Refresh a mounted history card exactly when the next KST date starts. */
export function getMillisecondsUntilNextKstDay(now = new Date()): number {
  const elapsedToday = ((now.getTime() + KST_OFFSET_MS) % DAY_MS + DAY_MS) % DAY_MS;
  return DAY_MS - elapsedToday;
}
