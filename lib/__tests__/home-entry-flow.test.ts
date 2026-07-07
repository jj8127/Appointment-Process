import {
  APPLY_GATE_IDENTITY_ROUTE,
  HOME_LITE_PRIMARY_ACTION_ROUTE,
  buildApplyGateIdentityRoute,
  buildHomeEntryBreadcrumb,
  normalizeApplyGateNext,
} from '@/lib/home-entry-flow';

describe('home entry flow guardrails', () => {
  it('keeps the home-lite primary action on the apply gate route', () => {
    expect(HOME_LITE_PRIMARY_ACTION_ROUTE).toBe('/apply-gate');
  });

  it('builds the apply gate identity route with a safe next path', () => {
    expect(buildApplyGateIdentityRoute('/request-board')).toEqual({
      pathname: APPLY_GATE_IDENTITY_ROUTE,
      params: { next: '/request-board' },
    });
  });

  it('falls back when next is empty, external, or protocol-relative', () => {
    expect(normalizeApplyGateNext('')).toBe('/');
    expect(normalizeApplyGateNext('   ')).toBe('/');
    expect(normalizeApplyGateNext('https://example.com/path')).toBe('/');
    expect(normalizeApplyGateNext('//example.com/path')).toBe('/');
    expect(normalizeApplyGateNext(['//example.com/path', '/safe'])).toBe('/');
  });

  it('keeps route breadcrumbs specific and free of raw personal data', () => {
    const breadcrumb = buildHomeEntryBreadcrumb('home-lite.primary-required-info', {
      phone: '010-1234-5678',
      next: '/identity',
    });

    expect(breadcrumb).toMatchObject({
      category: 'navigation.home-entry',
      message: 'home-lite.primary-required-info',
      data: {
        action: 'home-lite.primary-required-info',
        next: '/identity',
      },
    });
    expect(JSON.stringify(breadcrumb)).not.toContain('010-1234-5678');
  });
});
