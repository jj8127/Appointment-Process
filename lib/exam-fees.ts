export const EXAM_FEE_AMOUNT_LABEL = '2만원';

export type ExamFeeRow = {
  label: string;
  amount: typeof EXAM_FEE_AMOUNT_LABEL;
};

export const LIFE_EXAM_FEE_ROWS: ExamFeeRow[] = [
  { label: '생명보험', amount: EXAM_FEE_AMOUNT_LABEL },
  { label: '제3보험', amount: EXAM_FEE_AMOUNT_LABEL },
  { label: '생명보험 + 제3보험', amount: EXAM_FEE_AMOUNT_LABEL },
];

export const NONLIFE_EXAM_FEE_ROWS: ExamFeeRow[] = [
  { label: '손해보험', amount: EXAM_FEE_AMOUNT_LABEL },
  { label: '제3보험', amount: EXAM_FEE_AMOUNT_LABEL },
  { label: '손해보험 + 제3보험', amount: EXAM_FEE_AMOUNT_LABEL },
];
