import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { resolveAdminWebRouteAccess } from './admin-web-route-access';
import { isAdminWebPublicPath } from './admin-web-public-paths';

const SESSION_COOKIE_NAMES = ['session_role', 'session_resident', 'session_display', 'session_staff_type'] as const;
const FC_GRAPH_SESSION_COOKIE = 'fc_graph_session';

function clearSessionCookies(response: NextResponse) {
  for (const cookieName of [...SESSION_COOKIE_NAMES, FC_GRAPH_SESSION_COOKIE]) {
    response.cookies.set(cookieName, '', { path: '/', maxAge: 0 });
  }
  return response;
}

function applyRouteDecision(request: NextRequest, decision: ReturnType<typeof resolveAdminWebRouteAccess>) {
  if (decision.type === 'allow') {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = decision.pathname;
  const response = NextResponse.redirect(url);
  return decision.clearSession ? clearSessionCookies(response) : response;
}

export function handleAdminWebProxyRequest(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isStaticAsset = /\.[^/]+$/.test(pathname);

  if (
    pathname.startsWith('/_next')
    || pathname.startsWith('/api')
    || pathname.startsWith('/static')
    || pathname.startsWith('/assets')
    || pathname === '/sw.js'
    || isStaticAsset
  ) {
    return NextResponse.next();
  }

  const role = request.cookies.get('session_role')?.value;
  const residentId = request.cookies.get('session_resident')?.value;
  const hasSession = Boolean(role && residentId);
  const hasFcGraphSession = Boolean(request.cookies.get(FC_GRAPH_SESSION_COOKIE)?.value);

  if (pathname === '/' || pathname === '/auth') {
    return applyRouteDecision(
      request,
      resolveAdminWebRouteAccess({
        pathname,
        role,
        hasSession,
        hasFcGraphSession,
      }),
    );
  }

  if (isAdminWebPublicPath(pathname)) {
    return NextResponse.next();
  }

  return applyRouteDecision(
    request,
    resolveAdminWebRouteAccess({
      pathname,
      role,
      hasSession,
      hasFcGraphSession,
    }),
  );
}
