import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/auth', '/invite', '/favicon.ico', '/manifest.json'];
const SESSION_COOKIE_NAMES = ['session_role', 'session_resident', 'session_display', 'session_staff_type'] as const;

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function clearSessionCookies(response: NextResponse) {
  for (const cookieName of SESSION_COOKIE_NAMES) {
    response.cookies.set(cookieName, '', { path: '/', maxAge: 0 });
  }
  return response;
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
  const isStaffRole = role === 'admin' || role === 'manager';

  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = isStaffRole ? '/dashboard' : '/auth';
    if (hasSession && !isStaffRole) {
      return clearSessionCookies(NextResponse.redirect(url));
    }
    return NextResponse.redirect(url);
  }

  if (pathname === '/auth') {
    if (isStaffRole) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
    if (hasSession && !isStaffRole) {
      return clearSessionCookies(NextResponse.next());
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Block access to protected pages if no session info
  if (!role || !residentId) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth';
    return NextResponse.redirect(url);
  }

  // This web app is admin/manager-only. Clear stale FC cookies before redirecting.
  if (!isStaffRole) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth';
    return clearSessionCookies(NextResponse.redirect(url));
  }

  // /admin 경로는 admin role만 허용
  if (pathname.startsWith('/admin') && role !== 'admin') {
    const url = request.nextUrl.clone();
    url.pathname = '/auth';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sw.js|.*\\..*).*)'],
};
