import {
  getDesignerRequestDetailActions,
  normalizeDesignerRejectReason,
} from '@/lib/request-board-review-actions';

describe('request board review designer actions', () => {
  it('allows a designer to accept or reject a pending assignment from detail', () => {
    expect(
      getDesignerRequestDetailActions({
        isRequestBoardDesigner: true,
        assignmentStatus: 'pending',
      }),
    ).toEqual({
      canRespond: true,
      canAccept: true,
      canReject: true,
    });
  });

  it('keeps reject available for accepted assignments but prevents duplicate accept', () => {
    expect(
      getDesignerRequestDetailActions({
        isRequestBoardDesigner: true,
        assignmentStatus: 'accepted',
      }),
    ).toEqual({
      canRespond: true,
      canAccept: false,
      canReject: true,
    });
  });

  it('hides designer response buttons for non-designers and closed assignments', () => {
    expect(
      getDesignerRequestDetailActions({
        isRequestBoardDesigner: false,
        assignmentStatus: 'pending',
      }).canRespond,
    ).toBe(false);

    expect(
      getDesignerRequestDetailActions({
        isRequestBoardDesigner: true,
        assignmentStatus: 'completed',
      }).canRespond,
    ).toBe(false);
  });

  it('requires a real designer rejection reason before calling the reject API', () => {
    expect(normalizeDesignerRejectReason(' 인수 기준 부적합 ')).toBe('인수 기준 부적합');
    expect(normalizeDesignerRejectReason('')).toBeNull();
    expect(normalizeDesignerRejectReason('   ')).toBeNull();
    expect(normalizeDesignerRejectReason(null)).toBeNull();
  });
});
