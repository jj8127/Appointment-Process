export type ServiceHomeKey = 'care' | 'insurance' | 'telecom' | 'rental' | 'car' | 'hospital';

type ServiceSession = {
  role: 'admin' | 'fc' | null;
  hydrated: boolean;
  isRequestBoardDesigner: boolean;
};

export const INSURANCE_HOME_ROUTE = '/?mode=insurance' as const;
export const FAMILY_CARE_PROMOTION_URL = 'https://garam-public-web.vercel.app/family-care/' as const;
export const SERVICE_INFORMATION_KEYS = ['insurance', 'care', 'telecom', 'rental', 'car', 'hospital', 'help'] as const;

/** The service picker delegates FC identity checks to the existing apply gate. */
export function resolveInsuranceServiceRoute(session: ServiceSession) {
  if (!session.hydrated) return null;
  if (!session.role) return '/login?service=insurance' as const;
  if (session.isRequestBoardDesigner) return '/request-board' as const;
  if (session.role === 'admin') return INSURANCE_HOME_ROUTE;
  return { pathname: '/apply-gate', params: { next: INSURANCE_HOME_ROUTE } } as const;
}

/** Old administration links and notification receipts still address the insurance home. */
export function hasInsuranceHomeContext(params: {
  mode?: unknown;
  notificationId?: unknown;
  notificationTarget?: unknown;
}) {
  const hasReceipt = [params.notificationId, params.notificationTarget].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
  return hasReceipt || (typeof params.mode === 'string' && ['insurance', 'onboarding', 'exam'].includes(params.mode));
}

export function resolveServiceInformationKey(value: unknown): typeof SERVICE_INFORMATION_KEYS[number] | null {
  if (typeof value !== 'string') return null;
  return SERVICE_INFORMATION_KEYS.find((key) => key === value) ?? null;
}
