type SessionLandingRole = 'admin' | 'fc' | null;

type ResolveSessionLandingRouteInput = {
  role: SessionLandingRole;
  residentId: string | null | undefined;
  isRequestBoardDesigner: boolean;
};

export function resolveSessionLandingRoute({
  role,
  residentId,
  isRequestBoardDesigner,
}: ResolveSessionLandingRouteInput): '/request-board' | '/' | '/home-lite' | null {
  if (!role) {
    return null;
  }

  if (isRequestBoardDesigner) {
    return '/request-board';
  }

  if (role === 'admin') {
    return '/';
  }

  if (role === 'fc' && residentId) {
    return '/home-lite';
  }

  return null;
}
