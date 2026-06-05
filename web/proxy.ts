import type { NextRequest } from 'next/server';

import { handleAdminWebProxyRequest } from './src/lib/admin-web-proxy-handler';

export function proxy(request: NextRequest) {
  return handleAdminWebProxyRequest(request);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sw.js|.*\\..*).*)'],
};
