export const ADMIN_WEB_PUBLIC_PATHS = [
  '/account-deletion',
  '/auth',
  '/invite',
  '/reset-password',
  '/favicon.ico',
  '/manifest.json',
] as const;

export function isAdminWebPublicPath(pathname: string) {
  return ADMIN_WEB_PUBLIC_PATHS.some((publicPath) => (
    pathname === publicPath || pathname.startsWith(`${publicPath}/`)
  ));
}
