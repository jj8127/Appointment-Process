import {
  isNotificationUuid,
  type NotificationOnboardingSection,
} from './notification-target';

export type RouteQueryParam = string | string[] | undefined;

const ONBOARDING_SECTIONS = new Set<NotificationOnboardingSection>([
  'home',
  'consent',
  'docs_upload',
  'hanwha_commission',
  'appointment',
]);

export function parseExactlyOneRouteString(
  value: RouteQueryParam,
): string | null {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    return null;
  }
  return value;
}

export function parseExactlyOneUuidRouteParam(
  value: RouteQueryParam,
): string | null {
  const parsed = parseExactlyOneRouteString(value);
  return parsed && isNotificationUuid(parsed) ? parsed.toLowerCase() : null;
}

export function parseExactlyOnePositiveIntegerRouteParam(
  value: RouteQueryParam,
): number | null {
  const parsed = parseExactlyOneRouteString(value);
  if (!parsed || !/^[1-9][0-9]*$/.test(parsed)) return null;
  const numeric = Number(parsed);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

export function parseExactlyOneOnboardingSectionRouteParam(
  value: RouteQueryParam,
): NotificationOnboardingSection | null {
  const parsed = parseExactlyOneRouteString(value);
  return parsed && ONBOARDING_SECTIONS.has(parsed as NotificationOnboardingSection)
    ? parsed as NotificationOnboardingSection
    : null;
}

export function hasPresentRouteParam(value: RouteQueryParam): boolean {
  return value !== undefined;
}

export function hasConflictingRouteParams(
  ...values: RouteQueryParam[]
): boolean {
  return values.filter(hasPresentRouteParam).length > 1;
}
