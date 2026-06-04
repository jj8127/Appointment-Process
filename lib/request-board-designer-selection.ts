export function getDesignerSelectionConfirmState(selectedCount: number) {
  const count = Math.max(0, Math.floor(selectedCount));

  return {
    disabled: count === 0,
    label: count > 0 ? `${count}명 선택 완료` : '설계매니저 선택 완료',
  };
}

type DesignerSelectionFooterOptions = {
  keyboardVisible?: boolean;
  minimumPadding?: number;
};

export function getDesignerSelectionFooterBottomPadding(
  bottomInset: number,
  options: DesignerSelectionFooterOptions = {},
) {
  const inset = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0;
  const minimumPadding = Number.isFinite(options.minimumPadding)
    ? Math.max(20, options.minimumPadding ?? 20)
    : 20;

  if (options.keyboardVisible) {
    return Math.max(20, inset + 8);
  }

  return Math.max(minimumPadding, inset + 12);
}
