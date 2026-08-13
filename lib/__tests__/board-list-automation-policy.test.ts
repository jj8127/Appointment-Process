import {
  AUTOMATION_BOARD_LIST_LIMIT,
  AUTOMATION_BOARD_LIST_SELECT,
  isCanonicalGeneralBoardCategory,
  validateAutomationBoardListRequest,
} from '../../supabase/functions/_shared/board-list-policy';

describe('board-list automation policy', () => {
  it('accepts only the canonical duplicate-check request shape', () => {
    expect(validateAutomationBoardListRequest({
      categoryId: 'category-general',
      sort: 'created',
      order: 'desc',
      limit: 50,
    })).toEqual({ ok: true, categoryId: 'category-general' });

    expect(AUTOMATION_BOARD_LIST_SELECT).toBe('id,title,created_at');
    expect(AUTOMATION_BOARD_LIST_LIMIT).toBe(20);
  });

  it.each([
    [{}, 'category_required'],
    [{ categoryId: '  ' }, 'category_required'],
    [{ categoryId: 'category-general', search: 'admin' }, 'search_forbidden'],
    [{ categoryId: 'category-general', cursor: '2026-07-01T00:00:00Z' }, 'cursor_forbidden'],
    [{ categoryId: 'category-general', sort: 'latest' }, 'sort_forbidden'],
    [{ categoryId: 'category-general', sort: 'comments' }, 'sort_forbidden'],
    [{ categoryId: 'category-general', order: 'asc' }, 'order_forbidden'],
  ])('rejects an over-broad automation request %#', (payload, reason) => {
    expect(validateAutomationBoardListRequest(payload)).toEqual({
      ok: false,
      reason,
    });
  });

  it('accepts only the requested active canonical general category row', () => {
    expect(isCanonicalGeneralBoardCategory({
      id: 'category-general',
      slug: 'general',
      is_active: true,
    }, 'category-general')).toBe(true);

    expect(isCanonicalGeneralBoardCategory({
      id: 'category-other',
      slug: 'general',
      is_active: true,
    }, 'category-general')).toBe(false);
    expect(isCanonicalGeneralBoardCategory({
      id: 'category-general',
      slug: 'garam-pick',
      is_active: true,
    }, 'category-general')).toBe(false);
    expect(isCanonicalGeneralBoardCategory({
      id: 'category-general',
      slug: 'general',
      is_active: false,
    }, 'category-general')).toBe(false);
  });
});
