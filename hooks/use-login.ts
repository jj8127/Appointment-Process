import { router } from 'expo-router';
import { useSession } from '@/hooks/use-session';
import { captureAppSessionOwner, clearRequestBoardState, setAppSessionToken, setBridgeToken } from '@/lib/request-board-api';
import { setPendingAssistedPasswordChange } from '@/lib/pending-assisted-password-change';
import { clearSavedLoginCredentials } from '@/lib/saved-login-credentials';
import { parseLoginSuccessResponse } from '@/lib/login-response-contract';
import { resolvePlatformAuthRoute } from '@/lib/session-landing';

export type LoginResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  role?: 'admin' | 'fc' | 'manager';
  residentId?: string;
  displayName?: string;
  staffType?: 'admin' | 'developer' | null;
  requestBoardBridgeToken?: string;
  appSessionToken?: string;
  passwordChangeToken?: string;
  passwordChangeExpiresAt?: string;
  requestBoardRole?: 'fc' | 'designer' | null;
};

export function useLogin() {
  const { loginAs } = useSession();

  // Common login and explicit insurance enrollment install the same signed response.
  const acceptLoginResponse = async (data: LoginResponse, expectedResidentId = data.residentId ?? '', isCurrent = () => true) => {
    const success = parseLoginSuccessResponse(data, expectedResidentId);
    const readOnly = success.role === 'manager';
    const nextRole = success.role === 'admin' || success.role === 'manager' ? 'admin' : 'fc';
    const requestBoardRole = success.requestBoardRole;
    if (!isCurrent()) return null;
    const clearing = clearRequestBoardState({ clearAppSession: true });
    const ownsClearedSession = captureAppSessionOwner();
    await clearing;
    if (!isCurrent() || !ownsClearedSession()) return null;
    const storing = setAppSessionToken(success.appSessionToken);
    const ownsInstalledSession = captureAppSessionOwner();
    await storing;
    if (!isCurrent() || !ownsInstalledSession()) return null;
    await setBridgeToken(success.requestBoardBridgeToken);
    if (!isCurrent() || !ownsInstalledSession()) return null;
    loginAs(nextRole, success.residentId, success.displayName, success.staffType,
      readOnly, requestBoardRole === 'designer' && nextRole === 'fc', requestBoardRole, success.appSessionToken);
    return nextRole;
  };

  const handleLoginRejection = async (data: LoginResponse, service?: unknown, isCurrent = () => true) => {
    if (!isCurrent()) return false;
    if (data.code === 'password_change_required' && data.passwordChangeToken?.trim()) {
      const clearing = clearRequestBoardState({ clearAppSession: true });
      const ownsClearedSession = captureAppSessionOwner();
      await clearing;
      if (!isCurrent() || !ownsClearedSession()) return false;
      await clearSavedLoginCredentials().catch(() => undefined);
      if (!isCurrent() || !ownsClearedSession()) return false;
      setPendingAssistedPasswordChange(data.passwordChangeToken, data.passwordChangeExpiresAt ?? null);
      router.replace({ pathname: '/first-password-change', params: {
        ...(typeof service === 'string' ? { service } : {}),
      } });
      return true;
    }
    if (data.code === 'not_completed' || data.code === 'not_found') {
      if (data.role === 'admin' || data.role === 'manager') return false;
      router.replace(resolvePlatformAuthRoute(service, 'signup'));
      return true;
    }
    if (data.code === 'needs_password_setup') {
      router.replace({ pathname: '/reset-password', params: {
        audience: 'platform', ...(typeof service === 'string' ? { service } : {}),
      } });
      return true;
    }
    return false;
  };

  return {
    acceptLoginResponse,
    handleLoginRejection,
  };
}
