import type { RbDesigner } from '@/lib/request-board-api';

const LIFE_COMPANY_HINTS = ['생명', '라이프', '연금'] as const;
const NONLIFE_COMPANY_HINTS = ['손해', '손보', '화재', '해상'] as const;
const LIFE_COMPANY_ALIASES = new Set(['라이나생명', '미래에셋']);

const designerCompanyNameCollator = new Intl.Collator('ko-KR', {
  sensitivity: 'base',
  numeric: true,
});

const normalizeDesignerCompanyForSort = (value?: string | null) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/보험주식회사/g, '보험')
    .replace(/주식회사/g, '')
    .toLowerCase();

const getDesignerCompanyForSort = (designer: Pick<RbDesigner, 'company_name'>) =>
  normalizeDesignerCompanyForSort(designer.company_name);

const getDesignerNameForSort = (designer: Pick<RbDesigner, 'contact_name' | 'users'>) =>
  String(designer.contact_name ?? designer.users?.name ?? '').trim();

const normalizeDesignerCompanyAlias = (normalizedCompany: string) => {
  if (normalizedCompany === '라이나') return '라이나생명';
  if (normalizedCompany === '미래에셋생명') return '미래에셋';
  return normalizedCompany;
};

const resolveDesignerCompanyGroupOrder = (normalizedCompany: string) => {
  const comparableCompany = normalizeDesignerCompanyAlias(normalizedCompany);

  if (LIFE_COMPANY_ALIASES.has(comparableCompany)) {
    return 0;
  }

  if (LIFE_COMPANY_HINTS.some((hint) => normalizedCompany.includes(hint))) {
    return 0;
  }

  if (NONLIFE_COMPANY_HINTS.some((hint) => normalizedCompany.includes(hint))) {
    return 1;
  }

  return 2;
};

export function sortRequestBoardDesigners<T extends RbDesigner>(designers: T[]): T[] {
  return [...designers].sort((left, right) => {
    const leftCompany = getDesignerCompanyForSort(left);
    const rightCompany = getDesignerCompanyForSort(right);
    const groupCompare =
      resolveDesignerCompanyGroupOrder(leftCompany) - resolveDesignerCompanyGroupOrder(rightCompany);

    if (groupCompare !== 0) {
      return groupCompare;
    }

    const companyCompare = designerCompanyNameCollator.compare(leftCompany, rightCompany);
    if (companyCompare !== 0) {
      return companyCompare;
    }

    const leftName = getDesignerNameForSort(left);
    const rightName = getDesignerNameForSort(right);

    return designerCompanyNameCollator.compare(leftName, rightName);
  });
}

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
