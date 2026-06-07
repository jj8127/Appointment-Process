import {
  getDesignerRejectionSummary,
  mergeDesignerRejectionReasonFromDetail,
  requestNeedsDesignerRejectionReasonHydration,
} from '@/lib/request-board-rejection-summary';

describe('request board rejection summary', () => {
  it('returns the typed designer rejection reason for rejected assignments', () => {
    expect(
      getDesignerRejectionSummary({
        request_designers: [
          { status: 'completed', rejection_reason: '완료 메모 아님' },
          {
            status: 'rejected',
            rejection_reason: '  인수 기준 부적합으로 설계 불가  ',
            designers: { users: { name: '김설계' } },
          },
        ],
      }),
    ).toEqual({
      designerName: '김설계',
      label: '김설계 거절 사유',
      reason: '인수 기준 부적합으로 설계 불가',
    });
  });

  it('keeps long rejection reasons intact so the UI can decide how many lines to show', () => {
    const longReason = '고객 병력 고지 내용과 상품 인수 기준이 맞지 않아 현재 조건으로는 설계 진행이 어렵습니다. 다른 담보 조건 검토가 필요합니다.';

    expect(
      getDesignerRejectionSummary({
        request_designers: [{ status: 'rejected', rejection_reason: longReason }],
      })?.reason,
    ).toBe(longReason);
  });

  it('does not show an empty reason block for blank or non-rejected assignments', () => {
    expect(
      getDesignerRejectionSummary({
        request_designers: [{ status: 'rejected', rejection_reason: '   ' }],
      }),
    ).toBeNull();

    expect(
      getDesignerRejectionSummary({
        request_designers: [{ status: 'completed', rejection_reason: '완료 사유' }],
      }),
    ).toBeNull();
  });

  it('detects rejected list items whose reason must be hydrated from detail', () => {
    expect(
      requestNeedsDesignerRejectionReasonHydration({
        request_designers: [{ status: 'rejected', rejection_reason: null }],
      }),
    ).toBe(true);

    expect(
      requestNeedsDesignerRejectionReasonHydration({
        request_designers: [{ status: 'rejected', rejection_reason: '이미 있음' }],
      }),
    ).toBe(false);
  });

  it('merges missing list rejection reasons from request detail assignments', () => {
    const merged = mergeDesignerRejectionReasonFromDetail(
      {
        id: 10,
        request_designers: [
          {
            id: 101,
            designer_id: 20,
            status: 'rejected',
            rejection_reason: null,
          },
        ],
      },
      {
        id: 10,
        request_designers: [
          {
            id: 101,
            designer_id: 20,
            status: 'rejected',
            rejection_reason: '상세 API에 있는 사유',
          },
        ],
      },
    );

    expect(getDesignerRejectionSummary(merged)?.reason).toBe('상세 API에 있는 사유');
  });
});
