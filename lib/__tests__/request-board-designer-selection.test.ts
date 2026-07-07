import {
  sortRequestBoardDesigners,
  getDesignerSelectionConfirmState,
  getDesignerSelectionFooterBottomPadding,
} from '@/lib/request-board-designer-selection';
import type { RbDesigner } from '@/lib/request-board-api';

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

  it('sorts life insurers first then by company and designer name in Korean order', () => {
    const designers: RbDesigner[] = [
      {
        id: 1,
        company_name: '현대해상',
        contact_name: '최익순',
        users: { id: 1, name: '최익순' },
      },
      {
        id: 2,
        company_name: '흥국생명',
        contact_name: '조자경',
        contact_region: '2본부',
        users: { id: 2, name: '조자경' },
      },
      {
        id: 3,
        company_name: '교보생명',
        contact_name: '이다희',
        users: { id: 3, name: '이다희' },
      },
      {
        id: 4,
        company_name: '메리츠화재',
        contact_name: '신해린',
        users: { id: 4, name: '신해린' },
      },
      {
        id: 5,
        company_name: 'KB라이프',
        contact_name: '안희수',
        users: { id: 5, name: '안희수' },
      },
      {
        id: 6,
        company_name: '흥국생명',
        contact_name: '위성훈',
        contact_region: '1,8본부',
        users: { id: 6, name: '위성훈' },
      },
      {
        id: 7,
        company_name: 'IBK연금',
        contact_name: '강승규',
        users: { id: 7, name: '강승규' },
      },
      {
        id: 8,
        company_name: '흥국생명',
        contact_name: '김정선',
        contact_region: '3,4,6,7본부',
        users: { id: 8, name: '김정선' },
      },
    ];

    const sorted = sortRequestBoardDesigners(designers);
    expect(sorted.map((designer) => `${designer.contact_name} · ${designer.company_name}`)).toEqual([
      '이다희 · 교보생명',
      '김정선 · 흥국생명',
      '위성훈 · 흥국생명',
      '조자경 · 흥국생명',
      '강승규 · IBK연금',
      '안희수 · KB라이프',
      '신해린 · 메리츠화재',
      '최익순 · 현대해상',
    ]);
  });
});
