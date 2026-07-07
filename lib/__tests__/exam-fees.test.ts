import {
  EXAM_FEE_AMOUNT_LABEL,
  LIFE_EXAM_FEE_ROWS,
  NONLIFE_EXAM_FEE_ROWS,
} from '../exam-fees';

describe('exam fee labels', () => {
  it('keeps all exam fee options at 2만원', () => {
    expect(EXAM_FEE_AMOUNT_LABEL).toBe('2만원');
    expect(LIFE_EXAM_FEE_ROWS).toEqual([
      { label: '생명보험', amount: '2만원' },
      { label: '제3보험', amount: '2만원' },
      { label: '생명보험 + 제3보험', amount: '2만원' },
    ]);
    expect(NONLIFE_EXAM_FEE_ROWS).toEqual([
      { label: '손해보험', amount: '2만원' },
      { label: '제3보험', amount: '2만원' },
      { label: '손해보험 + 제3보험', amount: '2만원' },
    ]);
  });
});
