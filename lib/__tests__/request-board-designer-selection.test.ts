import {
  getDesignerSelectionConfirmState,
  getDesignerSelectionFooterBottomPadding,
} from '@/lib/request-board-designer-selection';

describe('request board designer selection action', () => {
  it('disables completion until at least one designer is selected', () => {
    expect(getDesignerSelectionConfirmState(0)).toEqual({
      disabled: true,
      label: '설계매니저 선택 완료',
    });
  });

  it('shows selected count in the completion action', () => {
    expect(getDesignerSelectionConfirmState(1)).toEqual({
      disabled: false,
      label: '1명 선택 완료',
    });

    expect(getDesignerSelectionConfirmState(3)).toEqual({
      disabled: false,
      label: '3명 선택 완료',
    });
  });

  it('keeps the completion action above the system navigation area', () => {
    expect(getDesignerSelectionFooterBottomPadding(0, { minimumPadding: 72 })).toBe(72);
    expect(getDesignerSelectionFooterBottomPadding(8, { minimumPadding: 72 })).toBe(72);
    expect(getDesignerSelectionFooterBottomPadding(24, { minimumPadding: 72 })).toBe(72);
    expect(getDesignerSelectionFooterBottomPadding(84, { minimumPadding: 72 })).toBe(96);
  });

  it('does not reserve the Android navigation fallback when the keyboard already lifts the sheet', () => {
    expect(getDesignerSelectionFooterBottomPadding(0, {
      keyboardVisible: true,
      minimumPadding: 72,
    })).toBe(20);
  });
});
