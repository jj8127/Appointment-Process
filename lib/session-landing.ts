import { resolveInsuranceServiceRoute } from '@/lib/service-home';

type SessionLandingRole = 'admin' | 'fc' | null;

type ResolveSessionLandingRouteInput = {
  role: SessionLandingRole;
  residentId: string | null | undefined;
  isRequestBoardDesigner: boolean;
  requestedService?: unknown;
};

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
