import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/auth', '/invite', '/favicon.ico', '/manifest.json'];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const role = request.cookies.get('session_role')?.value;
  const residentId = request.cookies.get('session_resident')?.value;

  // Block access to protected pages if no session info
  if (!role || !residentId) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth';
    return NextResponse.redirect(url);
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
