import dayjs from 'dayjs';

export type ExamRoundSortable = {
  exam_date: string | null;
  registration_deadline: string;
  created_at?: string | null;
};

const parseDateForSort = (value: string | null | undefined): number => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = dayjs(value);
  if (!parsed.isValid()) return Number.NEGATIVE_INFINITY;
  return parsed.valueOf();
};

const compareDatesDesc = (left: string | null | undefined, right: string | null | undefined): number => {
  const leftDate = parseDateForSort(left);
  const rightDate = parseDateForSort(right);
  if (leftDate === Number.NEGATIVE_INFINITY && rightDate === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  return rightDate - leftDate;
};

export const compareExamRoundsNewestFirst = <T extends ExamRoundSortable>(
  left: T,
  right: T,
): number => {
  const byExamDate = compareDatesDesc(left.exam_date, right.exam_date);
  if (byExamDate !== 0) return byExamDate;

  const byDeadline = compareDatesDesc(left.registration_deadline, right.registration_deadline);
  if (byDeadline !== 0) return byDeadline;

  return compareDatesDesc(left.created_at, right.created_at);
};

export const sortExamRoundsNewestFirst = <T extends ExamRoundSortable>(
  rounds: readonly T[],
): T[] => {
  const entries = rounds.map((round, index) => ({ round, index }));
  return entries
    .sort((a, b) => {
      const bySchedule = compareExamRoundsNewestFirst(a.round, b.round);
      if (bySchedule !== 0) return bySchedule;
      return a.index - b.index;
    })
    .map((entry) => entry.round);
};
