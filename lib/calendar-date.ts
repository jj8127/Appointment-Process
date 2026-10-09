/** A calendar date is not an instant. Construct it in the user's local calendar. */
export function parseCalendarDate(value?: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 12);
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return date;
}

export function formatCalendarDate(value?: string | null): string {
  if (!value) return '미정';
  // Rendering must never interpret a date-only value as a UTC timestamp.
  return value;
}

export function formatExamCalendarDate(examDate?: string | null, examMonth?: string | null): string {
  if (examDate) return formatCalendarDate(examDate);
  const month = parseCalendarDate(examMonth);
  return month ? `${month.getFullYear()}년 ${month.getMonth() + 1}월 · 시험일 미정` : '시험일 미정';
}
