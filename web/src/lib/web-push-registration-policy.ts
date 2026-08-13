import { isAdminWebPublicPath } from './admin-web-public-paths';

type AutoWebPushRegistrationInput = {
  pathname: string | null | undefined;
  role: string | null | undefined;
  residentId: string | null | undefined;
};

export function shouldAutoRegisterWebPush({
  pathname,
  role,
  residentId,
}: AutoWebPushRegistrationInput) {
  if (!pathname || isAdminWebPublicPath(pathname)) {
    return false;
  }

  return Boolean(role && residentId);
}
