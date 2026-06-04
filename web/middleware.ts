import { NextRequest, NextResponse } from 'next/server';

import { resolveAdminWebRouteAccess } from './src/lib/admin-web-route-access';
import { isAdminWebPublicPath } from './src/lib/admin-web-public-paths';

const SESSION_COOKIE_NAMES = ['session_role', 'session_resident', 'session_display', 'session_staff_type'] as const;

function clearSessionCookies(response: NextResponse) {
  for (const cookieName of SESSION_COOKIE_NAMES) {
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isStaticAsset = /\.[^/]+$/.test(pathname);

  // Skip static assets and API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/assets') ||
    pathname === '/sw.js' ||
    isStaticAsset
  ) {
    return NextResponse.next();
  }

  const role = request.cookies.get('session_role')?.value;
  const residentId = request.cookies.get('session_resident')?.value;
  const hasSession = Boolean(role && residentId);

  if (pathname === '/' || pathname === '/auth') {
    return applyRouteDecision(
      request,
      resolveAdminWebRouteAccess({ pathname, role, hasSession }),
    );
  }

  if (isAdminWebPublicPath(pathname)) {
    return NextResponse.next();
  }

  return applyRouteDecision(
    request,
    resolveAdminWebRouteAccess({ pathname, role, hasSession }),
  );
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sw.js|.*\\..*).*)'],
};
