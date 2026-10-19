import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { logger } from '@/lib/logger';
import { getNotificationPreferences } from '@/lib/notification-preferences-api';
import {
  getPushPermissionStatus,
  registerPushToken,
  unregisterDevicePushToken,
} from '@/lib/notifications';
import {
  captureAppSessionOwner,
  clearAuth,
  clearRequestBoardState,
  getStoredAppSessionToken,
  getStoredBridgeToken,
  rbCheckAuth,
  persistAuthChange,
  setAppSessionToken as persistStoredAppSessionToken,
} from '@/lib/request-board-api';
import {
  canUseRequestBoardSession,
  deriveRequestBoardFlags,
  shouldForceRequestBoardRelogin,
} from '@/lib/request-board-session';
import { buildPushRegistrationAttemptKey } from '@/lib/push-registration';
import { createReadScope } from '@/lib/request-board-read-state';
import { safeStorage } from '@/lib/safe-storage';
import { sensitiveTokenStorage } from '@/lib/secure-token-storage';
import { platformRequest } from '@/lib/platform-api';
import { startSessionLogout } from '@/lib/session-logout';
import { normalizeStaffType, type StaffType } from '@/lib/staff-identity';
import { isValidMobilePhone, normalizePhone } from '@/lib/validation';
import { useReadAttempt } from '@/lib/use-read-attempt';

type Role = 'admin' | 'fc' | null;
type RequestBoardRole = 'fc' | 'designer' | null;
type RequestBoardSyncStatus = 'idle' | 'syncing' | 'ready' | 'error' | 'needs_reauth';
export type PlatformMemberIdentity = { id: string; name: string };

type SessionState = {
  role: Role;
  residentId: string; // now stores phone number digits
  displayName: string;
  staffType: StaffType;
  readOnly: boolean;
  isRequestBoardDesigner: boolean;
  requestBoardRole: RequestBoardRole;
};

type SessionContextValue = SessionState & {
  residentMask: string;
  hydrated: boolean;
  appSessionToken: string | null;
  platformMember: PlatformMemberIdentity | null;
  platformSessionToken: string | null;
  platformHydrated: boolean;
  isPlatformSignedIn: boolean;
  loginPlatformMember: (member: PlatformMemberIdentity, token: string) => Promise<void>;
  requestBoardSyncStatus: RequestBoardSyncStatus;
  requestBoardSyncError: string | null;
  replaceAppSessionToken: (token: string | null) => Promise<void>;
  loginAs: (
    role: Role,
    residentId: string,
    displayName?: string,
    staffType?: StaffType,
    readOnly?: boolean,
    isRequestBoardDesigner?: boolean,
    requestBoardRole?: RequestBoardRole,
    appSessionToken?: string | null,
  ) => void;
  ensureRequestBoardSession: (options?: { force?: boolean }) => Promise<{
    ok: boolean;
    error?: string;
    needsRelogin?: boolean;
  }>;
  logout: () => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

const computeMask = (raw: string) => {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
};

const initialState: SessionState = {
  role: null,
  residentId: '',
  displayName: '',
  staffType: null,
  readOnly: false,
  isRequestBoardDesigner: false,
  requestBoardRole: null,
};
const STORAGE_KEY = 'fc-onboarding/session';
const PLATFORM_MEMBER_KEY = 'fc-onboarding/platform-member';
const PLATFORM_TOKEN_KEY = 'fc-onboarding.platform-session-token';

function normalizeStoredRole(rawRole: unknown, readOnly: boolean): Pick<SessionState, 'role' | 'readOnly'> | null {
  if (rawRole === 'fc' || rawRole === 'admin') {
    return { role: rawRole, readOnly };
  }

  // Backward compatibility: older manager sessions were persisted as role='manager'.
  if (rawRole === 'manager') {
    return { role: 'admin', readOnly: true };
  }

  return null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [appSessionToken, setAppSessionTokenState] = useState<string | null>(null);
  const [platformMember, setPlatformMember] = useState<PlatformMemberIdentity | null>(null);
  const [platformSessionToken, setPlatformSessionToken] = useState<string | null>(null);
  const beginPlatformChange = useReadAttempt();
  const [pushRegistrationRevision, setPushRegistrationRevision] = useState(0);
  const [requestBoardSyncStatus, setRequestBoardSyncStatus] = useState<RequestBoardSyncStatus>('idle');
  const [requestBoardSyncError, setRequestBoardSyncError] = useState<string | null>(null);
  const requestBoardSyncPromiseRef = useRef<{
    isCurrent: () => boolean;
    promise: Promise<{ ok: boolean; error?: string; needsRelogin?: boolean }>;
  } | null>(null);
  const sessionScope = JSON.stringify([state.role, state.residentId, state.readOnly, state.staffType]);
  const sessionScopeRef = useRef(createReadScope());
  sessionScopeRef.current.setScope(sessionScope);
  const beginTokenReplacement = useReadAttempt();
  const lastPushRegistrationKeyRef = useRef<string | null>(null);
  const suppressedPushRegistrationKeyRef = useRef<string | null>(null);
  const pushRegistrationForegroundRefreshKeyRef = useRef<string | null>(null);
  const pushRegistrationPromiseRef = useRef<{
    key: string;
    promise: ReturnType<typeof registerPushToken>;
  } | null>(null);

  const replaceAppSessionToken = useCallback(async (token: string | null) => {
    const ownsReplacement = beginTokenReplacement();
    try {
      const persistence = persistStoredAppSessionToken(token);
      const ownsStoredSession = captureAppSessionOwner();
      await persistence;
      if (!ownsReplacement() || !ownsStoredSession()) return;
      setAppSessionTokenState(token);
      setPushRegistrationRevision((current) => current + 1);
    } catch {
      logger.warn('[session] app session token persist failed');
    }
  }, [beginTokenReplacement]);

  const clearPlatformSession = useCallback(() => {
    beginPlatformChange();
    setPlatformMember(null);
    setPlatformSessionToken(null);
    return persistAuthChange(async () => {
      await sensitiveTokenStorage.removeItem(PLATFORM_TOKEN_KEY);
      await safeStorage.removeItem(PLATFORM_MEMBER_KEY);
    });
  }, [beginPlatformChange]);

  const clearSessionState = useCallback(async () => {
    sessionScopeRef.current.invalidate();
    setState(initialState);
    setAppSessionTokenState(null);
    setRequestBoardSyncStatus('idle');
    setRequestBoardSyncError(null);
    // Clear the trusted auth owner before waiting for ordinary session storage.
    await Promise.all([
      clearPlatformSession(),
      clearRequestBoardState({ clearAppSession: true }),
      safeStorage.removeItem(STORAGE_KEY).catch(() => logger.warn('Session clear failed')),
    ]);
  }, [clearPlatformSession]);

  const logoutSession = useCallback(() => {
    let cleanup = Promise.resolve();
    startSessionLogout({
      sessionToken: appSessionToken,
      clearLocalSession: () => { cleanup = clearSessionState(); return cleanup; },
      unregisterPushTokens: unregisterDevicePushToken,
      onLocalClearFailure: () => logger.warn('[session] local logout cleanup failed'),
      onPushUnregisterFailure: reason => logger.warn('[push] logout token unregister failed', { reason }),
    });
    return cleanup;
  }, [appSessionToken, clearSessionState]);

  const loginPlatformMember = useCallback(async (member: PlatformMemberIdentity, token: string) => {
    const cleanup = logoutSession();
    const isCurrent = beginPlatformChange();
    await cleanup;
    if (!isCurrent()) throw new Error('로그인 계정이 변경되었습니다. 다시 시도해주세요.');
    await persistAuthChange(async () => {
      await sensitiveTokenStorage.setItem(PLATFORM_TOKEN_KEY, token);
      await safeStorage.setItem(PLATFORM_MEMBER_KEY, JSON.stringify(member));
    });
    if (!isCurrent()) throw new Error('로그인 계정이 변경되었습니다. 다시 시도해주세요.');
    setPlatformMember(member);
    setPlatformSessionToken(token);
  }, [beginPlatformChange, logoutSession]);

  const ensureRequestBoardSession = useCallback(async (options?: { force?: boolean }) => {
    if (!hydrated) {
      return { ok: false, error: '세션 복원 중입니다.' };
    }

    const ownsSession = sessionScopeRef.current.captureOwner(sessionScope);
    const sessionChanged = { ok: false, error: '로그인 세션이 변경되었습니다. 다시 시도해주세요.' };
    if (!ownsSession()) return sessionChanged;

    if (!canUseRequestBoardSession(state.role, state.readOnly, state.staffType)) {
      setRequestBoardSyncStatus('idle');
      setRequestBoardSyncError(null);
      return { ok: true };
    }

    const pending = requestBoardSyncPromiseRef.current;
    if (pending?.isCurrent() && !options?.force) {
      return pending.promise;
    }

    const ownsAttempt = sessionScopeRef.current.issue();
    const ownsStoredSession = captureAppSessionOwner();
    const isCurrent = () => ownsSession() && ownsAttempt() && ownsStoredSession();
    if (!isCurrent()) return sessionChanged;

    const syncPromise = (async () => {
      setRequestBoardSyncStatus('syncing');
      setRequestBoardSyncError(null);

      let auth = await rbCheckAuth();
      if (!isCurrent()) return sessionChanged;
      if (auth.authenticated && auth.user) {
        const normalizedRequestBoardPhone = normalizePhone(auth.user.phone ?? '');
        if (normalizedRequestBoardPhone && normalizedRequestBoardPhone !== state.residentId) {
          logger.warn('[session] request_board auth user mismatch, refreshing bridge session');
          await clearAuth();
          if (!isCurrent()) return sessionChanged;
          auth = await rbCheckAuth();
          if (!isCurrent()) return sessionChanged;
        }
      }
      if (auth.authenticated && auth.user) {
        const [bridgeToken, storedAppSessionToken] = await Promise.all([
          getStoredBridgeToken(),
          getStoredAppSessionToken(),
        ]);
        if (!isCurrent()) return sessionChanged;
        const needsRelogin = shouldForceRequestBoardRelogin({
          authenticated: true,
          hasBridgeToken: Boolean(bridgeToken),
          hasAppSessionToken: Boolean(appSessionToken || storedAppSessionToken),
        });

        if (needsRelogin) {
          const error = '가람Link 연동 세션을 업그레이드하려면 다시 로그인해주세요.';
          setRequestBoardSyncStatus('needs_reauth');
          setRequestBoardSyncError(error);
          return { ok: false, error, needsRelogin: true };
        }

        const requestBoardRole = auth.user.role === 'designer' ? 'designer' : 'fc';
        setState((prev) => {
          const next = deriveRequestBoardFlags(prev.role, requestBoardRole);
          return prev.requestBoardRole === next.requestBoardRole
            && prev.isRequestBoardDesigner === next.isRequestBoardDesigner
            ? prev : { ...prev, ...next };
        });
        setRequestBoardSyncStatus('ready');
        return { ok: true };
      }

      const error = auth.error ?? '가람Link 세션 동기화에 실패했습니다.';
      const needsRelogin = Boolean(auth.needsRelogin);
      setRequestBoardSyncStatus(needsRelogin ? 'needs_reauth' : 'error');
      setRequestBoardSyncError(error);
      return { ok: false, error, needsRelogin };
    })();

    const flight = { isCurrent, promise: syncPromise };
    requestBoardSyncPromiseRef.current = flight;
    try {
      return await syncPromise;
    } finally {
      if (requestBoardSyncPromiseRef.current === flight) requestBoardSyncPromiseRef.current = null;
    }
  }, [appSessionToken, hydrated, sessionScope, state.readOnly, state.residentId, state.role, state.staffType]);

  useEffect(() => {
    let cancelled = false;
    const ownerScope = sessionScopeRef.current;
    const ownsStoredSession = captureAppSessionOwner();
    const ownsPlatformSession = beginPlatformChange();
    const isCurrent = () => !cancelled && ownsStoredSession() && ownsPlatformSession();
    const restore = async () => {
      try {
        const raw = await safeStorage.getItem(STORAGE_KEY);
        if (!isCurrent()) return;
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<SessionState> & { appSessionToken?: string | null };
          const rawResidentId = typeof parsed.residentId === 'string' ? parsed.residentId : '';
          const normalizedResidentId = normalizePhone(rawResidentId);
          const normalizedRole = normalizeStoredRole(parsed.role, Boolean(parsed.readOnly));
          if (normalizedRole && rawResidentId) {
            if (!isValidMobilePhone(normalizedResidentId)) {
              logger.warn('[session] dropping legacy session with non-phone residentId');
              await Promise.all([
                clearRequestBoardState({ clearAppSession: true }),
                safeStorage.removeItem(STORAGE_KEY),
              ]);
              return;
            }
            const restoredRequestBoardRole =
              parsed.requestBoardRole === 'fc' || parsed.requestBoardRole === 'designer'
                ? parsed.requestBoardRole
                : null;
            setState({
              role: normalizedRole.role,
              residentId: normalizedResidentId,
              displayName: parsed.displayName ?? '',
              staffType: normalizeStaffType(parsed.staffType),
              readOnly: normalizedRole.readOnly,
              ...deriveRequestBoardFlags(
                normalizedRole.role,
                parsed.isRequestBoardDesigner !== undefined && !restoredRequestBoardRole
                  ? (parsed.isRequestBoardDesigner ? 'designer' : null)
                  : restoredRequestBoardRole,
              ),
            });
            const securedAppSessionToken = await getStoredAppSessionToken();
            if (!isCurrent()) return;
            const legacyAppSessionToken =
              typeof parsed.appSessionToken === 'string' && parsed.appSessionToken.trim()
                ? parsed.appSessionToken
                : null;
            const restoredAppSessionToken = securedAppSessionToken ?? legacyAppSessionToken;
            if (!securedAppSessionToken && legacyAppSessionToken) {
              const persistence = persistStoredAppSessionToken(legacyAppSessionToken);
              const ownsMigration = captureAppSessionOwner();
              await persistence;
              if (cancelled || !ownsMigration()) return;
            }
            setAppSessionTokenState(restoredAppSessionToken ?? null);
            return;
          }
        }
        const [memberRaw, token] = await Promise.all([
          safeStorage.getItem(PLATFORM_MEMBER_KEY),
          sensitiveTokenStorage.getItem(PLATFORM_TOKEN_KEY),
        ]);
        if (!isCurrent() || !memberRaw || !token) return;
        const cached = JSON.parse(memberRaw) as PlatformMemberIdentity;
        if (!cached?.id || typeof cached.name !== 'string') return;
        try {
          const verified = await platformRequest<{ member: PlatformMemberIdentity }>('verify', {}, token);
          if (!isCurrent()) return;
          setPlatformMember({ id: verified.member.id, name: verified.member.name });
          setPlatformSessionToken(token);
        } catch (error) {
          if (!isCurrent()) return;
          const status = (error as { status?: number }).status;
          if (status === 401 || status === 403) await clearPlatformSession();
          else {
            // Cached identity supports an offline shell; every data read still requires the signed token.
            setPlatformMember(cached);
            setPlatformSessionToken(token);
          }
        }
      } catch {
        logger.warn('Session restore failed');
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };
    void restore();
    return () => { cancelled = true; ownerScope.invalidate(); };
  }, [beginPlatformChange, clearPlatformSession]);

  useEffect(() => {
    if (!hydrated) return;
    const persist = async () => {
      try {
        if (state.role && state.residentId) {
          const payload = {
            role: state.role,
            residentId: state.residentId,
            displayName: state.displayName,
            staffType: state.staffType,
            readOnly: state.readOnly,
            isRequestBoardDesigner: state.isRequestBoardDesigner,
            requestBoardRole: state.requestBoardRole,
          };
          await safeStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } else {
          await safeStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        logger.warn('Session persist failed');
      }
    };
    persist();
  }, [state, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (!canUseRequestBoardSession(state.role, state.readOnly, state.staffType)) {
      setRequestBoardSyncStatus('idle');
      setRequestBoardSyncError(null);
      return;
    }

    let cancelled = false;
    const ownsStoredSession = captureAppSessionOwner();
    const ownsSession = sessionScopeRef.current.captureOwner(sessionScope);

    void ensureRequestBoardSession().then((result) => {
      if (cancelled || !ownsStoredSession() || !ownsSession() || !result.needsRelogin) return;
      logger.warn('[session] request_board session requires re-login');
      void clearRequestBoardState({ clearAppSession: false });
    });

    return () => {
      cancelled = true;
    };
  }, [ensureRequestBoardSession, hydrated, sessionScope, state.readOnly, state.role, state.residentId, state.staffType]);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      residentMask: computeMask(state.residentId),
      hydrated,
      appSessionToken,
      platformMember,
      platformSessionToken,
      platformHydrated: hydrated,
      isPlatformSignedIn: Boolean(state.role || platformMember),
      loginPlatformMember,
      requestBoardSyncStatus,
      requestBoardSyncError,
      replaceAppSessionToken,
      ensureRequestBoardSession,
      logout: () => {
        void logoutSession();
      },
      loginAs: (
        role,
        residentId,
        displayName = '',
        staffType = null,
        readOnly = false,
        isRequestBoardDesigner = false,
        requestBoardRole = null,
        nextAppSessionToken = null,
      ) => {
        const normalizedResidentId = normalizePhone(residentId);
        void clearPlatformSession().catch(() => logger.warn('[session] platform cleanup failed'));
        sessionScopeRef.current.invalidate();
        setState({
          role,
          residentId: normalizedResidentId,
          displayName,
          staffType,
          readOnly,
          isRequestBoardDesigner,
          requestBoardRole,
        });
        // The login response installer already owns this signed token. Expose
        // it with the FC state, before clearing the last common token can
        // produce a transient signed-in state with no usable credential.
        setAppSessionTokenState(nextAppSessionToken);
        void replaceAppSessionToken(nextAppSessionToken);
        setRequestBoardSyncStatus('idle');
        setRequestBoardSyncError(null);
      },
    }),
    [
      appSessionToken,
      clearPlatformSession,
      ensureRequestBoardSession,
      hydrated,
      loginPlatformMember,
      logoutSession,
      platformMember,
      platformSessionToken,
      replaceAppSessionToken,
      requestBoardSyncError,
      requestBoardSyncStatus,
      state,
    ],
  );

  useEffect(() => {
    const pushRegistrationBaseKey = buildPushRegistrationAttemptKey({
      hydrated,
      role: state.role,
      residentId: state.residentId,
      requestBoardRole: state.requestBoardRole,
    });
    const pushRegistrationKey = pushRegistrationBaseKey
      ? `${pushRegistrationBaseKey}:${pushRegistrationRevision}`
      : null;

    if (!pushRegistrationKey || !appSessionToken) return;
    const completedForCurrentSession = lastPushRegistrationKeyRef.current === pushRegistrationKey;
    const suppressedForCurrentSession = suppressedPushRegistrationKeyRef.current === pushRegistrationKey;
    if (
      (completedForCurrentSession || suppressedForCurrentSession)
      && pushRegistrationForegroundRefreshKeyRef.current !== pushRegistrationKey
    ) return;

    const pushRole: 'admin' | 'fc' | 'manager' =
      state.requestBoardRole === 'designer'
        ? 'manager'
        : (state.role as 'admin' | 'fc');

    const retryDelaysMs = [1000, 2000, 5000, 10000] as const;
    let attempt = 0;
    let exhausted = false;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleAttempt = (delayMs: number) => {
      if (cancelled || timer || lastPushRegistrationKeyRef.current === pushRegistrationKey) return;
      timer = setTimeout(() => {
        timer = null;
        void runAttempt();
      }, delayMs);
    };

    const runAttempt = async () => {
      if (cancelled || lastPushRegistrationKeyRef.current === pushRegistrationKey) return;

      const permissionStatus = await getPushPermissionStatus();
      if (cancelled) return;
      if (permissionStatus !== 'granted') {
        // Boot/foreground refresh never opens the OS permission prompt. The
        // settings master-ON action must call registerPushToken with
        // { requestPermission: true } explicitly.
        suppressedPushRegistrationKeyRef.current = pushRegistrationKey;
        pushRegistrationForegroundRefreshKeyRef.current = pushRegistrationKey;
        return;
      }

      try {
        const preferences = await getNotificationPreferences();
        if (cancelled) return;
        if (!preferences.globalPushEnabled) {
          suppressedPushRegistrationKeyRef.current = pushRegistrationKey;
          // Re-check on the next foreground: turning push back ON on another device
          // must re-register this device too.
          pushRegistrationForegroundRefreshKeyRef.current = pushRegistrationKey;
          return;
        }
      } catch {
        attempt += 1;
        if (attempt < retryDelaysMs.length) scheduleAttempt(retryDelaysMs[attempt]);
        else {
          exhausted = true;
          logger.warn('[push] preference bootstrap retries exhausted');
        }
        return;
      }

      let registrationPromise = pushRegistrationPromiseRef.current;
      if (!registrationPromise || registrationPromise.key !== pushRegistrationKey) {
        const promise = registerPushToken(pushRole, state.residentId, state.displayName);
        registrationPromise = { key: pushRegistrationKey, promise };
        pushRegistrationPromiseRef.current = registrationPromise;
        void promise.finally(() => {
          if (pushRegistrationPromiseRef.current?.promise === promise) {
            pushRegistrationPromiseRef.current = null;
          }
        });
      }

      const result = await registrationPromise.promise;
      if (cancelled) return;

      if (result.ok) {
        suppressedPushRegistrationKeyRef.current = null;
        lastPushRegistrationKeyRef.current = pushRegistrationKey;
        pushRegistrationForegroundRefreshKeyRef.current = pushRegistrationKey;
        exhausted = false;
        return;
      }

      if (!result.retryable) {
        suppressedPushRegistrationKeyRef.current = null;
        lastPushRegistrationKeyRef.current = pushRegistrationKey;
        pushRegistrationForegroundRefreshKeyRef.current = result.reason === 'permission_denied'
          ? pushRegistrationKey
          : null;
        exhausted = false;
        return;
      }

      attempt += 1;
      if (attempt < retryDelaysMs.length) {
        scheduleAttempt(retryDelaysMs[attempt]);
      } else {
        exhausted = true;
        logger.warn('[push] registration retries exhausted', { reason: result.reason });
      }
    };

    if (!completedForCurrentSession) {
      scheduleAttempt(retryDelaysMs[attempt]);
    }

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const shouldRefreshCompletedRegistration =
        pushRegistrationForegroundRefreshKeyRef.current === pushRegistrationKey;
      if (
        nextState !== 'active'
        || (!exhausted && !shouldRefreshCompletedRegistration)
        || cancelled
      ) return;
      lastPushRegistrationKeyRef.current = null;
      suppressedPushRegistrationKeyRef.current = null;
      pushRegistrationForegroundRefreshKeyRef.current = null;
      attempt = 0;
      exhausted = false;
      scheduleAttempt(0);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      appStateSubscription.remove();
    };
  }, [
    hydrated,
    appSessionToken,
    pushRegistrationRevision,
    state.role,
    state.residentId,
    state.displayName,
    state.requestBoardRole,
  ]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
