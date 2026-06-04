import dayjs from 'dayjs';

export type ExamRoundSortable = {
  exam_date: string | null;
  registration_deadline: string;
};

const parseDateForSort = (value: string | null | undefined): number => {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = dayjs(value);
  if (!parsed.isValid()) return Number.POSITIVE_INFINITY;
  return parsed.valueOf();
};

const compareDatesAsc = (left: string | null | undefined, right: string | null | undefined): number => {
  const leftDate = parseDateForSort(left);
  const rightDate = parseDateForSort(right);
  if (leftDate === Number.POSITIVE_INFINITY && rightDate === Number.POSITIVE_INFINITY) {
    return 0;
  }
  return leftDate - rightDate;
};

export const compareExamRoundsByExamDateThenDeadline = <T extends ExamRoundSortable>(
  left: T,
  right: T,
): number => {
  const leftHasExamDate = Boolean(left.exam_date);
  const rightHasExamDate = Boolean(right.exam_date);

  if (leftHasExamDate && !rightHasExamDate) return -1;
  if (!leftHasExamDate && rightHasExamDate) return 1;

  const byExamDate = compareDatesAsc(left.exam_date, right.exam_date);
  if (byExamDate !== 0) return byExamDate;

  return compareDatesAsc(left.registration_deadline, right.registration_deadline);
};

export const sortExamRoundsByExamDateThenDeadline = <T extends ExamRoundSortable>(
  rounds: readonly T[],
): T[] => {
  const entries = rounds.map((round, index) => ({ round, index }));
  return entries
    .sort((a, b) => {
      const bySchedule = compareExamRoundsByExamDateThenDeadline(a.round, b.round);
      if (bySchedule !== 0) return bySchedule;
      return a.index - b.index;
    })
    .map((entry) => entry.round);
};
