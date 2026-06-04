export const FC_GRAPH_DASHBOARD_PATH = '/dashboard/referrals/graph';

export type AdminWebSessionRole = 'admin' | 'manager' | 'fc' | string | null | undefined;

export type AdminWebRouteDecision =
  | { type: 'allow' }
  | { type: 'redirect'; pathname: string; clearSession?: boolean };

type RouteAccessInput = {
  pathname: string;
  role: AdminWebSessionRole;
  hasSession: boolean;
};

function isStaffRole(role: AdminWebSessionRole) {
  return role === 'admin' || role === 'manager';
}

function isFcRole(role: AdminWebSessionRole) {
  return role === 'fc';
}

export function resolveAdminWebRouteAccess({
  pathname,
  role,
  hasSession,
}: RouteAccessInput): AdminWebRouteDecision {
  const staffRole = isStaffRole(role);
  const fcRole = isFcRole(role);
  const recognizedRole = staffRole || fcRole;

  if (pathname === '/') {
    if (staffRole) {
      return { type: 'redirect', pathname: '/dashboard' };
    }
    if (fcRole) {
      return { type: 'redirect', pathname: FC_GRAPH_DASHBOARD_PATH };
    }
    return {
      type: 'redirect',
      pathname: '/auth',
      clearSession: hasSession && !recognizedRole,
    };
  }

  if (pathname === '/auth') {
    if (staffRole) {
      return { type: 'redirect', pathname: '/dashboard' };
    }
    if (fcRole) {
      return { type: 'redirect', pathname: FC_GRAPH_DASHBOARD_PATH };
    }
    return { type: 'allow' };
  }

  if (!hasSession) {
    return { type: 'redirect', pathname: '/auth' };
  }

  if (fcRole) {
    if (pathname === FC_GRAPH_DASHBOARD_PATH) {
      return { type: 'allow' };
    }
    return { type: 'redirect', pathname: FC_GRAPH_DASHBOARD_PATH };
  }

  if (!staffRole) {
    return { type: 'redirect', pathname: '/auth', clearSession: true };
  }

  if (pathname.startsWith('/admin') && role !== 'admin') {
    return { type: 'redirect', pathname: '/auth' };
  }

  return { type: 'allow' };
}
