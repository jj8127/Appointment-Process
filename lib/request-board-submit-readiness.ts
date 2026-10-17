/**
 * Everything that would stop a design request from being sent, in the order it appears on the
 * compose screen, so the FC sees each blocker before pressing submit instead of after.
 */

export type RequestReadinessKey = 'driving' | 'product' | 'request' | 'designer' | 'fcCode';

export type RequestReadinessItem = {
  key: RequestReadinessKey;
  label: string;
  /** null = cannot be checked yet (FC codes before a manager is chosen). */
  ok: boolean | null;
  detail: string;
  /** Submit-button text while this item is the first blocker. */
  action: string;
};

export type RequestReadinessInput = {
  drivingStatus: string | null | undefined;
  productCount: number;
  requestText: string;
  designerCount: number;
  /** Company names of chosen managers whose FC code is not registered. */
  companiesMissingFcCode: string[];
};

export function buildRequestReadiness(input: RequestReadinessInput): RequestReadinessItem[] {
  const hasDriving = String(input.drivingStatus ?? '').trim().length > 0;
  const hasRequest = input.requestText.trim().length > 0;
  const missingCodes = [...new Set(input.companiesMissingFcCode.filter(Boolean))];
  return [
    {
      key: 'driving',
      label: '운전구분',
      ok: hasDriving,
      detail: hasDriving ? String(input.drivingStatus).trim() : '고객 정보에 없음',
      action: '운전구분을 선택해주세요',
    },
    {
      key: 'product',
      label: '보험 상품',
      ok: input.productCount > 0,
      detail: input.productCount > 0 ? `${input.productCount}개 선택` : '선택 안 함',
      action: '보험 상품을 선택해주세요',
    },
    {
      key: 'request',
      label: '요청 내용',
      ok: hasRequest,
      detail: hasRequest ? '입력함' : '비어 있음',
      action: '요청 내용을 입력해주세요',
    },
    {
      key: 'designer',
      label: '설계매니저',
      ok: input.designerCount > 0,
      detail: input.designerCount > 0 ? `${input.designerCount}명 선택` : '선택 안 함',
      action: '설계매니저를 선택해주세요',
    },
    {
      key: 'fcCode',
      label: '설계코드',
      ok: input.designerCount === 0 ? null : missingCodes.length === 0,
      detail: input.designerCount === 0
        ? '설계매니저 선택 후 확인'
        : missingCodes.length === 0 ? '등록됨' : `${missingCodes.join(', ')} 코드 필요`,
      action: '설계코드를 등록해주세요',
    },
  ];
}

/** The first item that still blocks sending; pending checks count as blocking only after their prerequisite. */
export function firstRequestBlocker(items: RequestReadinessItem[]): RequestReadinessItem | null {
  return items.find((item) => item.ok === false) ?? null;
}

/** One request is created per product and manager pair; say so when that is more than one. */
export function describeRequestFanOut(productCount: number, designerCount: number): string | null {
  const total = productCount * designerCount;
  if (total <= 1) return null;
  return `상품 ${productCount} × 설계매니저 ${designerCount} = 의뢰 ${total}건`;
}
