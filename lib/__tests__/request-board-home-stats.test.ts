import { buildFcRequestPipeline, computeRequestBoardHomeStats } from '@/lib/request-board-home-stats';

describe('request board home stats', () => {
  it('counts rejected designer assignments in the completed bucket for FC views', () => {
    const stats = computeRequestBoardHomeStats(
      [
        {
          request_products: [{ product_id: 10 }],
          request_designers: [{ status: 'rejected', fc_decision: null }],
        },
      ],
      false,
    );

    expect(stats).toMatchObject({
      total: 1,
      completed: 1,
      pending: 0,
      inProgress: 0,
    });
  });

  it('counts rejected assignments in the completed bucket for designer views', () => {
    const stats = computeRequestBoardHomeStats(
      [
        {
          status: 'rejected',
          assignmentStatus: 'rejected',
          completedAt: new Date().toISOString(),
          processingDays: 2,
        },
      ],
      true,
    );

    expect(stats).toMatchObject({
      total: 1,
      completed: 1,
      completedThisMonth: 1,
      avgDays: 2,
    });
  });

  it('shows FC requests as four steps without counting review-pending work as done', () => {
    const stats = computeRequestBoardHomeStats(
      [
        { request_products: [{ product_id: 1 }], request_designers: [{ status: 'pending', fc_decision: null }] },
        { request_products: [{ product_id: 2 }], request_designers: [{ status: 'accepted', fc_decision: null }] },
        { request_products: [{ product_id: 3 }], request_designers: [{ status: 'completed', fc_decision: 'pending' }] },
        { request_products: [{ product_id: 4 }], request_designers: [{ status: 'completed', fc_decision: 'accepted' }] },
      ],
      false,
    );
    expect(buildFcRequestPipeline(stats).map(({ key, count }) => [key, count])).toEqual([
      ['pending', 1],
      ['in_progress', 1],
      ['review_pending', 1],
      ['completed', 1],
    ]);
  });
});
