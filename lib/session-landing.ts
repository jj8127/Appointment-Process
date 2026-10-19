import { resolveInsuranceServiceRoute, resolveServiceInformationKey } from '@/lib/service-home';

type SessionLandingRole = 'admin' | 'fc' | null;

type ResolveSessionLandingRouteInput = {
  role: SessionLandingRole;
  residentId: string | null | undefined;
  isRequestBoardDesigner: boolean;
  requestedService?: unknown;
  isPlatformSignedIn?: boolean;
};

/** Preserve a known service intent without accepting a caller supplied redirect URL. */
export function resolvePlatformAuthRoute(service: unknown, destination: 'login' | 'signup' | 'service' = 'service') {
  const key = resolveServiceInformationKey(service);
  const pathname = destination === 'login' ? '/services/login' : destination === 'signup' ? '/services/signup' : '/services/[service]';
  if (key && key !== 'help' && key !== 'hospital') return { pathname, params: { service: key } } as const;
  return destination === 'service' ? '/services/account' as const : pathname;
}

/** Legacy app links retain insurance intent but cannot supply an arbitrary redirect. */
export function resolveLegacyAuthRoute(params: { service?: unknown; skipAuto?: unknown; referralNonce?: unknown }, destination: 'login' | 'signup') {
  const service = params.service === undefined ? 'insurance' : resolveServiceInformationKey(params.service);
  const route = resolvePlatformAuthRoute(service, destination);
  return { pathname: destination === 'login' ? '/services/login' as const : '/services/signup' as const, params: {
    ...(typeof route === 'string' ? {} : route.params),
    ...(params.skipAuto === '1' ? { skipAuto: '1' } : {}),
    ...(typeof params.referralNonce === 'string' ? { referralNonce: params.referralNonce } : {}),
  } };
}

export function resolveSessionLandingRoute({
  role,
  residentId,
  isRequestBoardDesigner,
  requestedService,
  isPlatformSignedIn = false,
}: ResolveSessionLandingRouteInput) {
  if (!role) {
    if (!isPlatformSignedIn) return null;
    return requestedService === 'insurance'
      ? resolveInsuranceServiceRoute({ role, hydrated: true, isRequestBoardDesigner, isPlatformSignedIn })
      : resolvePlatformAuthRoute(requestedService);
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
