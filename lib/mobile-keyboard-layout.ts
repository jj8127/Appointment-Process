export function normalizeKeyboardPadding(height: number): number {
  return Number.isFinite(height) ? Math.max(0, height) : 0;
}

export function getAndroidKeyboardFootprint({
  androidApiLevel,
  keyboardHeight,
  safeAreaBottom,
}: {
  androidApiLevel: number | string;
  keyboardHeight: number;
  safeAreaBottom: number;
}): number {
  const normalizedHeight = normalizeKeyboardPadding(keyboardHeight);
  const normalizedSafeArea = normalizeKeyboardPadding(safeAreaBottom);
  const parsedApiLevel = typeof androidApiLevel === 'number'
    ? androidApiLevel
    : Number.parseInt(androidApiLevel, 10);

  // Android 11+ reports IME height with the navigation-bar inset removed.
  // Restore the live bottom inset so the footprint reaches the React window edge.
  return normalizedHeight + (
    Number.isFinite(parsedApiLevel) && parsedApiLevel >= 30
      ? normalizedSafeArea
      : 0
  );
}

export function getKeyboardOverlapFromRestingFrame({
  keyboardFootprint,
  restingBottom,
  verticalOffset = 0,
  viewBottom,
}: {
  keyboardFootprint: number;
  restingBottom: number;
  verticalOffset?: number;
  viewBottom: number;
}): number {
  if (!Number.isFinite(restingBottom) || !Number.isFinite(viewBottom)) return 0;
  const normalizedFootprint = normalizeKeyboardPadding(keyboardFootprint);
  const nativeWindowShift = Math.max(0, restingBottom - viewBottom);
  const normalizedOffset = Number.isFinite(verticalOffset) ? verticalOffset : 0;

  return Math.max(
    0,
    normalizedFootprint - nativeWindowShift + normalizedOffset,
  );
}
