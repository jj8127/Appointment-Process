import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { logger } from '@/lib/logger';
import { registerPushToken } from '@/lib/notifications';
import { clearRequestBoardState } from '@/lib/request-board-api';
import { safeStorage } from '@/lib/safe-storage';

type Role = 'admin' | 'fc' | null;
type RequestBoardRole = 'fc' | 'designer' | null;

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
  loginAs: (
    role: Role,
    residentId: string,
    displayName?: string,
    readOnly?: boolean,
    isRequestBoardDesigner?: boolean,
    requestBoardRole?: RequestBoardRole,
  ) => void;
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

  useEffect(() => {
    const restore = async () => {
      try {
        const raw = await safeStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<SessionState>;
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
              isRequestBoardDesigner:
                parsed.isRequestBoardDesigner !== undefined
                  ? Boolean(parsed.isRequestBoardDesigner)
                  : restoredRequestBoardRole === 'designer',
              requestBoardRole: restoredRequestBoardRole,
            });
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
  }, [state, hydrated]);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      hydrated,
      logout: () => {
        setState(initialState);
        safeStorage.removeItem(STORAGE_KEY).catch((err) => logger.warn('Session clear failed', err));
        clearRequestBoardState().catch((err) => logger.warn('request_board session clear failed', err));
      },
      loginAs: (
        role,
        residentId,
        displayName = '',
        readOnly = false,
        isRequestBoardDesigner = false,
        requestBoardRole = null,
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
      },
    }),
    [hydrated, state],
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
