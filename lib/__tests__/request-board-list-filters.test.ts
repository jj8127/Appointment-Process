import {
  getRequestBoardListBuckets,
  getRequestBoardPrimaryStatus,
  requestBoardListHasBucket,
} from '@/lib/request-board-list-filters';

describe('request board list filters', () => {
  it('uses assignment status for designer-side buckets when request status drifted', () => {
    const request = {
      status: 'in_progress',
      request_designers: [{ status: 'pending', fc_decision: null }],
    };

    expect(requestBoardListHasBucket(request, 'pending', true)).toBe(true);
    expect(requestBoardListHasBucket(request, 'in_progress', true)).toBe(false);
    expect(getRequestBoardPrimaryStatus(request, true)).toBe('pending');
  });

  it('keeps FC-side buckets based on request status', () => {
    const request = {
      status: 'in_progress',
      request_designers: [{ status: 'pending', fc_decision: null }],
    };

    expect(requestBoardListHasBucket(request, 'pending', false)).toBe(false);
    expect(requestBoardListHasBucket(request, 'in_progress', false)).toBe(true);
    expect(getRequestBoardPrimaryStatus(request, false)).toBe('in_progress');
  });

  it('keeps completed assignments that need FC review in the review bucket', () => {
    const request = {
      status: 'in_progress',
      request_designers: [{ status: 'completed', fc_decision: 'pending' }],
    };

    expect(getRequestBoardListBuckets(request, true)).toEqual(
      new Set(['completed', 'review_pending']),
    );
  });

  it('does not keep designer-rejected assignments stuck in the FC review bucket', () => {
    const request = {
      status: 'completed',
      request_designers: [{ status: 'rejected', fc_decision: null }],
    };

    expect(requestBoardListHasBucket(request, 'review_pending', false)).toBe(false);
    expect(requestBoardListHasBucket(request, 'review_pending', true)).toBe(false);
    expect(getRequestBoardListBuckets(request, false).has('review_pending')).toBe(false);
    expect(getRequestBoardListBuckets(request, true).has('review_pending')).toBe(false);
  });
});
