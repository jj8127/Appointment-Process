export const HOME_LITE_PRIMARY_ACTION_ROUTE = '/apply-gate' as const;
export const APPLY_GATE_IDENTITY_ROUTE = '/identity' as const;
const DEFAULT_NEXT_ROUTE = '/' as const;

export type HomeEntryAction =
  | 'home-lite.primary-required-info'
  | 'apply-gate.start-identity'
  | 'apply-gate.return-home'
  | 'apply-gate.forward-completed';

type HomeEntryScreen = 'home-lite' | 'apply-gate';

type HomeEntryBreadcrumbData = {
  action: HomeEntryAction;
  screen: HomeEntryScreen;
  next?: string;
};

export type HomeEntryBreadcrumb = {
  category: 'navigation.home-entry';
  message: HomeEntryAction;
  level: 'info';
  data: HomeEntryBreadcrumbData;
};

export type ApplyGateIdentityRoute = {
  pathname: typeof APPLY_GATE_IDENTITY_ROUTE;
  params: { next: string };
};

const ACTION_SCREEN_MAP: Record<HomeEntryAction, HomeEntryScreen> = {
  'home-lite.primary-required-info': 'home-lite',
  'apply-gate.start-identity': 'apply-gate',
  'apply-gate.return-home': 'apply-gate',
  'apply-gate.forward-completed': 'apply-gate',
};

export const normalizeApplyGateNext = (next: unknown, fallback = DEFAULT_NEXT_ROUTE): string => {
  const value = Array.isArray(next) ? (next.length === 1 ? next[0] : undefined) : next;
  if (typeof value !== 'string') return fallback;

  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;
  if (trimmed.includes('\\')) return fallback;

  return trimmed;
};

export const buildApplyGateIdentityRoute = (next: unknown): ApplyGateIdentityRoute => ({
  pathname: APPLY_GATE_IDENTITY_ROUTE,
  params: { next: normalizeApplyGateNext(next) },
});

export const buildHomeEntryBreadcrumb = (
  action: HomeEntryAction,
  extra?: Record<string, unknown>,
): HomeEntryBreadcrumb => {
  const next = typeof extra?.next === 'string' ? normalizeApplyGateNext(extra.next) : undefined;
  const data: HomeEntryBreadcrumbData = {
    action,
    screen: ACTION_SCREEN_MAP[action],
  };

  if (next) data.next = next;

  return {
    category: 'navigation.home-entry',
    message: action,
    level: 'info',
    data,
  };
};
