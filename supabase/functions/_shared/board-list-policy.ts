export const AUTOMATION_BOARD_LIST_SELECT = 'id,title,created_at';
export const AUTOMATION_BOARD_LIST_LIMIT = 20;

export type AutomationBoardListRequest = {
  categoryId?: unknown;
  search?: unknown;
  sort?: unknown;
  order?: unknown;
  cursor?: unknown;
  limit?: unknown;
};

export type AutomationBoardListPolicyResult =
  | { ok: true; categoryId: string }
  | {
      ok: false;
      reason:
        | 'category_required'
        | 'search_forbidden'
        | 'cursor_forbidden'
        | 'sort_forbidden'
        | 'order_forbidden';
    };

export function validateAutomationBoardListRequest(
  input: AutomationBoardListRequest,
): AutomationBoardListPolicyResult {
  const categoryId = typeof input.categoryId === 'string' ? input.categoryId.trim() : '';
  if (!categoryId) return { ok: false, reason: 'category_required' };
  if (String(input.search ?? '').trim()) return { ok: false, reason: 'search_forbidden' };
  if (String(input.cursor ?? '').trim()) return { ok: false, reason: 'cursor_forbidden' };
  if (input.sort !== undefined && input.sort !== 'created') {
    return { ok: false, reason: 'sort_forbidden' };
  }
  if (input.order !== undefined && input.order !== 'desc') {
    return { ok: false, reason: 'order_forbidden' };
  }
  return { ok: true, categoryId };
}

export function isCanonicalGeneralBoardCategory(
  category: { id?: unknown; slug?: unknown; is_active?: unknown } | null | undefined,
  requestedCategoryId: string,
) {
  return Boolean(
    category
    && category.id === requestedCategoryId
    && category.slug === 'general'
    && category.is_active === true,
  );
}
