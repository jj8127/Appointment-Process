export const REQUEST_BOARD_PASSIVE_REFRESH_MIN_INTERVAL_MS = 10_000;

export const shouldSkipRequestBoardPassiveRefresh = ({
  force = false,
  nowMs,
  lastCompletedAtMs,
}: {
  force?: boolean;
  nowMs: number;
  lastCompletedAtMs: number;
}) =>
  !force
  && lastCompletedAtMs > 0
  && nowMs - lastCompletedAtMs < REQUEST_BOARD_PASSIVE_REFRESH_MIN_INTERVAL_MS;
