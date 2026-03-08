import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '@/lib/logger';
import { registerPushToken } from '@/lib/notifications';
import {
  clearRequestBoardState,
  getStoredAppSessionToken,
  getStoredBridgeToken,
  rbCheckAuth,
} from '@/lib/request-board-api';
import {
  canUseRequestBoardSession,
  deriveRequestBoardFlags,
  shouldForceRequestBoardRelogin,
} from '@/lib/request-board-session';
import { safeStorage } from '@/lib/safe-storage';

type Role = 'admin' | 'fc' | null;
type RequestBoardRole = 'fc' | 'designer' | null;
type RequestBoardSyncStatus = 'idle' | 'syncing' | 'ready' | 'error' | 'needs_reauth';

type SessionState = {
  role: Role;
  residentId: string; // now stores phone number digits
  residentMask: string; // formatted phone number
  displayName: string;
  readOnly: boolean;
  isRequestBoardDesigner: boolean;
  requestBoardRole: RequestBoardRole;
};

type SessionContextValue = SessionState & {
  hydrated: boolean;
  requestBoardSyncStatus: RequestBoardSyncStatus;
  requestBoardSyncError: string | null;
  loginAs: (
    role: Role,
    residentId: string,
    displayName?: string,
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
  residentMask: '',
  displayName: '',
  readOnly: false,
  isRequestBoardDesigner: false,
  requestBoardRole: null,
};
const STORAGE_KEY = 'fc-onboarding/session';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [appSessionToken, setAppSessionToken] = useState<string | null>(null);
  const [requestBoardSyncStatus, setRequestBoardSyncStatus] = useState<RequestBoardSyncStatus>('idle');
  const [requestBoardSyncError, setRequestBoardSyncError] = useState<string | null>(null);
  const requestBoardSyncPromiseRef = useRef<Promise<{ ok: boolean; error?: string; needsRelogin?: boolean }> | null>(null);

  const clearSessionState = useCallback(async (options?: { clearAppSession?: boolean }) => {
    setState(initialState);
    if (options?.clearAppSession) {
      setAppSessionToken(null);
    }
    setRequestBoardSyncStatus('idle');
    setRequestBoardSyncError(null);
    try {
      await safeStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      logger.warn('Session clear failed', err);
    }
    await clearRequestBoardState({ clearAppSession: options?.clearAppSession });
  }, []);

  const syncRequestBoardFlags = useCallback((requestBoardRole: RequestBoardRole) => {
    setState((prev) => {
      const next = deriveRequestBoardFlags(prev.role, requestBoardRole);
      if (
        prev.requestBoardRole === next.requestBoardRole
        && prev.isRequestBoardDesigner === next.isRequestBoardDesigner
      ) {
        return prev;
      }
      return {
        ...prev,
        requestBoardRole: next.requestBoardRole,
        isRequestBoardDesigner: next.isRequestBoardDesigner,
      };
    });
  }, []);

  const ensureRequestBoardSession = useCallback(async (options?: { force?: boolean }) => {
    if (!hydrated) {
      return { ok: false, error: '세션 복원 중입니다.' };
    }

    if (!canUseRequestBoardSession(state.role, state.readOnly)) {
      setRequestBoardSyncStatus('idle');
      setRequestBoardSyncError(null);
      return { ok: true };
    }

    if (requestBoardSyncPromiseRef.current && !options?.force) {
      return requestBoardSyncPromiseRef.current;
    }

    const syncPromise = (async () => {
      setRequestBoardSyncStatus('syncing');
      setRequestBoardSyncError(null);

      const auth = await rbCheckAuth();
      if (auth.authenticated && auth.user) {
        const [bridgeToken, storedAppSessionToken] = await Promise.all([
          getStoredBridgeToken(),
          getStoredAppSessionToken(),
        ]);
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

        syncRequestBoardFlags(auth.user.role === 'designer' ? 'designer' : 'fc');
        setRequestBoardSyncStatus('ready');
        return { ok: true };
      }

      const error = auth.error ?? '가람Link 세션 동기화에 실패했습니다.';
      const needsRelogin = Boolean(auth.needsRelogin);
      setRequestBoardSyncStatus(needsRelogin ? 'needs_reauth' : 'error');
      setRequestBoardSyncError(error);
      return { ok: false, error, needsRelogin };
    })();

    requestBoardSyncPromiseRef.current = syncPromise;
    try {
      return await syncPromise;
    } finally {
      requestBoardSyncPromiseRef.current = null;
    }
  }, [appSessionToken, hydrated, state.readOnly, state.role, syncRequestBoardFlags]);

  useEffect(() => {
    const restore = async () => {
      try {
        const raw = await safeStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<SessionState> & { appSessionToken?: string | null };
          if (parsed.role && parsed.residentId) {
            const restoredRequestBoardRole =
              parsed.requestBoardRole === 'fc' || parsed.requestBoardRole === 'designer'
                ? parsed.requestBoardRole
                : null;
            setState({
              role: parsed.role,
              residentId: parsed.residentId,
              residentMask: computeMask(parsed.residentId),
              displayName: parsed.displayName ?? '',
              readOnly: Boolean(parsed.readOnly),
              ...deriveRequestBoardFlags(
                parsed.role,
                parsed.isRequestBoardDesigner !== undefined && !restoredRequestBoardRole
                  ? (parsed.isRequestBoardDesigner ? 'designer' : null)
                  : restoredRequestBoardRole,
              ),
            });
            const restoredAppSessionToken =
              typeof parsed.appSessionToken === 'string' && parsed.appSessionToken.trim()
                ? parsed.appSessionToken
                : await getStoredAppSessionToken();
            setAppSessionToken(restoredAppSessionToken ?? null);
          }
        }
      } catch (err) {
        logger.warn('Session restore failed', err);
      } finally {
        setHydrated(true);
      }
    };
    restore();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const persist = async () => {
      try {
        if (state.role && state.residentId) {
          const payload = {
            role: state.role,
            residentId: state.residentId,
            displayName: state.displayName,
            readOnly: state.readOnly,
            isRequestBoardDesigner: state.isRequestBoardDesigner,
            requestBoardRole: state.requestBoardRole,
            appSessionToken,
          };
          await safeStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } else {
          await safeStorage.removeItem(STORAGE_KEY);
        }
      } catch (err) {
        logger.warn('Session persist failed', err);
      }
    };
    persist();
  }, [appSessionToken, state, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (!canUseRequestBoardSession(state.role, state.readOnly)) {
      setRequestBoardSyncStatus('idle');
      setRequestBoardSyncError(null);
      return;
    }

    let cancelled = false;

    void ensureRequestBoardSession().then((result) => {
      if (cancelled || !result.needsRelogin) return;
      logger.warn('[session] request_board session requires re-login');
      void clearSessionState({ clearAppSession: true });
    });

    return () => {
      cancelled = true;
    };
  }, [clearSessionState, ensureRequestBoardSession, hydrated, state.readOnly, state.role, state.residentId]);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      hydrated,
      requestBoardSyncStatus,
      requestBoardSyncError,
      ensureRequestBoardSession,
      logout: () => {
        void clearSessionState({ clearAppSession: true });
      },
      loginAs: (
        role,
        residentId,
        displayName = '',
        readOnly = false,
        isRequestBoardDesigner = false,
        requestBoardRole = null,
        nextAppSessionToken = null,
      ) => {
        setState({
          role,
          residentId,
          residentMask: computeMask(residentId),
          displayName,
          readOnly,
          isRequestBoardDesigner,
          requestBoardRole,
        });
        setAppSessionToken(nextAppSessionToken);
        setRequestBoardSyncStatus('idle');
        setRequestBoardSyncError(null);
      },
    }),
    [
      clearSessionState,
      ensureRequestBoardSession,
      hydrated,
      requestBoardSyncError,
      requestBoardSyncStatus,
      state,
    ],
  );

  useEffect(() => {
    if (!hydrated) return;
    if (state.role && state.residentId) {
      const pushRole: 'admin' | 'fc' =
        state.requestBoardRole === 'designer'
          ? 'fc'
          : (state.role as 'admin' | 'fc');
      registerPushToken(pushRole, state.residentId, state.displayName);
    }
  }, [
    hydrated,
    state.role,
    state.residentId,
    state.displayName,
    state.isRequestBoardDesigner,
    state.requestBoardRole,
  ]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

export function maskResident(residentId: string) {
  return computeMask(residentId);
}
