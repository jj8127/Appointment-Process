'use client';

import { useRouter } from 'next/navigation';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

type Role = 'admin' | 'fc' | null;

type SessionState = {
    role: Role;
    residentId: string;
    residentMask: string;
    displayName: string;
};

type SessionContextValue = SessionState & {
    hydrated: boolean;
    loginAs: (role: Role, residentId: string, displayName?: string) => void;
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

const initialState: SessionState = { role: null, residentId: '', residentMask: '', displayName: '' };
const STORAGE_KEY = 'fc-onboarding/session';

export function SessionProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<SessionState>(initialState);
    const [hydrated, setHydrated] = useState(false);
    const router = useRouter();

    useEffect(() => {
        const restore = () => {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw) as Partial<SessionState>;
                    if (parsed.role && parsed.residentId) {
                        setState({
                            role: parsed.role,
                            residentId: parsed.residentId,
                            residentMask: computeMask(parsed.residentId),
                            displayName: parsed.displayName ?? '',
                        });
                    }
                }
            } catch (err) {
                console.warn('Session restore failed', err);
            } finally {
                setHydrated(true);
            }
        };
        restore();
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        const persist = () => {
            try {
                if (state.role && state.residentId) {
                    const payload = {
                        role: state.role,
                        residentId: state.residentId,
                        displayName: state.displayName,
                    };
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
                } else {
                    localStorage.removeItem(STORAGE_KEY);
                }
            } catch (err) {
                console.warn('Session persist failed', err);
            }
        };
        persist();
    }, [state, hydrated]);

    const value = useMemo<SessionContextValue>(
        () => ({
            ...state,
            hydrated,
            loginAs: (role, residentId, displayName = '') => {
                setState({ role, residentId, residentMask: computeMask(residentId), displayName });
            },
            logout: () => {
                setState(initialState);
                localStorage.removeItem(STORAGE_KEY);
                router.replace('/auth');
            },
        }),
        [hydrated, state, router],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
    const ctx = useContext(SessionContext);
    if (!ctx) throw new Error('useSession must be used within SessionProvider');
    return ctx;
}
