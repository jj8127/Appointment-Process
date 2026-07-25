import {
  formatMissingExamApplicationFields,
  getMissingExamApplicationFields,
} from '@/lib/exam-application-validation';

describe('exam application validation', () => {
  it('lists all missing fields in the order the FC sees them', () => {
    expect(
      getMissingExamApplicationFields({
        hasApplicationTarget: false,
        hasPaymentProof: false,
        selectedRoundId: null,
        selectedLocationId: null,
        hasSelectedSubject: false,
      }),
    ).toEqual([
      '신청 대상 FC',
      '입금 내역 캡처',
      '시험 일정',
      '응시 지역',
      '응시 과목',
    ]);
  });

  it('treats undefined string values as missing selections', () => {
    expect(
      getMissingExamApplicationFields({
        hasApplicationTarget: true,
        hasPaymentProof: true,
        selectedRoundId: 'undefined',
        selectedLocationId: 'null',
        hasSelectedSubject: true,
      }),
    ).toEqual(['시험 일정', '응시 지역']);
  });

  it('formats missing fields for a compact mobile alert', () => {
    expect(formatMissingExamApplicationFields(['시험 일정', '응시 지역'])).toBe(
      '다음 항목을 선택해주세요.\n- 시험 일정\n- 응시 지역',
    );
    expect(formatMissingExamApplicationFields([])).toBeNull();
  });
});
