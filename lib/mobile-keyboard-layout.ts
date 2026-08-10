export function normalizeKeyboardPadding(height: number): number {
  return Number.isFinite(height) ? Math.max(0, height) : 0;
}
