import { resolveInsuranceServiceRoute, resolveServiceInformationKey } from '@/lib/service-home';

type SessionLandingRole = 'admin' | 'fc' | null;

type ResolveSessionLandingRouteInput = {
  role: SessionLandingRole;
  residentId: string | null | undefined;
  isRequestBoardDesigner: boolean;
  requestedService?: unknown;
};

/** Preserve a known service intent without accepting a caller supplied redirect URL. */
export function resolvePlatformAuthRoute(service: unknown, destination: 'login' | 'signup' | 'service' = 'service') {
  const key = resolveServiceInformationKey(service);
  const pathname = destination === 'login' ? '/services/login' : destination === 'signup' ? '/services/signup' : '/services/[service]';
  if (key && key !== 'help' && key !== 'hospital') return { pathname, params: { service: key } } as const;
  return destination === 'service' ? '/services/account' as const : pathname;
}

export function resolveSessionLandingRoute({
  role,
  residentId,
  isRequestBoardDesigner,
  requestedService,
}: ResolveSessionLandingRouteInput) {
  if (!role) {
    return null;
  }

  if (isRequestBoardDesigner) {
    return '/request-board' as const;
  }

  if (role === 'admin') {
    return requestedService === 'insurance'
      ? resolveInsuranceServiceRoute({ role, hydrated: true, isRequestBoardDesigner })
      : '/' as const;
  }

  if (role === 'fc' && residentId) {
    return requestedService === 'insurance'
      ? resolveInsuranceServiceRoute({ role, hydrated: true, isRequestBoardDesigner })
      : '/' as const;
  }

  return null;
}
