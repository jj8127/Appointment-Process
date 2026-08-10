export function normalizeKeyboardPadding(height: number): number {
  return Number.isFinite(height) ? Math.max(0, height) : 0;
}

export function getKeyboardFrameOverlap({
  keyboardTop,
  viewBottom,
  verticalOffset = 0,
}: {
  keyboardTop: number;
  viewBottom: number;
  verticalOffset?: number;
}): number {
  if (!Number.isFinite(keyboardTop) || !Number.isFinite(viewBottom)) {
    return 0;
  }
  const safeOffset = Number.isFinite(verticalOffset) ? verticalOffset : 0;
  return Math.max(0, viewBottom - (keyboardTop - safeOffset));
}
