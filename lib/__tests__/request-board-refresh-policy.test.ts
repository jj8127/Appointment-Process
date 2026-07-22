import {
  REQUEST_BOARD_PASSIVE_REFRESH_MIN_INTERVAL_MS,
  shouldSkipRequestBoardPassiveRefresh,
} from '@/lib/request-board-refresh-policy';

describe('request board refresh policy', () => {
  it('coalesces passive mount, focus, and app-active refreshes inside the freshness window', () => {
    expect(
      shouldSkipRequestBoardPassiveRefresh({
        nowMs: 15_000,
        lastCompletedAtMs: 10_000,
      }),
    ).toBe(true);

    expect(
      shouldSkipRequestBoardPassiveRefresh({
        nowMs: 10_000 + REQUEST_BOARD_PASSIVE_REFRESH_MIN_INTERVAL_MS,
        lastCompletedAtMs: 10_000,
      }),
    ).toBe(false);
  });

  it('never suppresses explicit refreshes or the first load', () => {
    expect(
      shouldSkipRequestBoardPassiveRefresh({
        force: true,
        nowMs: 10_001,
        lastCompletedAtMs: 10_000,
      }),
    ).toBe(false);
    expect(
      shouldSkipRequestBoardPassiveRefresh({
        nowMs: 1,
        lastCompletedAtMs: 0,
      }),
    ).toBe(false);
  });
});
