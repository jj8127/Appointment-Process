'use client';

import { useRouter } from 'next/navigation';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { logger } from '@/lib/logger';
type Role = 'admin' | 'manager' | 'fc' | null;

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
    isReadOnly: boolean; // manager는 읽기 전용
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);
const COOKIE_ROLE = 'session_role';
const COOKIE_RESIDENT = 'session_resident';
const COOKIE_DISPLAY = 'session_display';

const computeMask = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
};

const initialState: SessionState = { role: null, residentId: '', residentMask: '', displayName: '' };
const STORAGE_KEY = 'fc-onboarding/session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30일

// Security: Cookie configuration with security flags
const getCookieString = (name: string, value: string, maxAge: number = COOKIE_MAX_AGE) => {
    const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const secureFlag = isSecure ? 'Secure;' : '';
    // Note: HttpOnly cannot be set via document.cookie (requires server-side Set-Cookie header)
    return `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Strict; ${secureFlag}`;
};

// Security: Simple obfuscation for localStorage (not cryptographically secure, but better than plaintext)
// For true security, use server-side session tokens with HttpOnly cookies
const obfuscate = (text: string): string => {
    if (typeof window === 'undefined') return text;
    return btoa(encodeURIComponent(text));
};

const deobfuscate = (encoded: string): string => {
    if (typeof window === 'undefined') return encoded;
    try {
        return decodeURIComponent(atob(encoded));
    } catch {
        return '';
    }
};

export function SessionProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<SessionState>(initialState);
    const [hydrated, setHydrated] = useState(false);
    const router = useRouter();

    useEffect(() => {
        const restore = () => {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    // Security: Decode obfuscated session data
                    const decoded = deobfuscate(raw);
                    const parsed = JSON.parse(decoded) as Partial<SessionState>;
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
                logger.warn('Session restore failed', err);
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
                    // Security: Obfuscate session data before storing in localStorage
                    const encoded = obfuscate(JSON.stringify(payload));
                    localStorage.setItem(STORAGE_KEY, encoded);
                } else {
                    localStorage.removeItem(STORAGE_KEY);
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
            isReadOnly: state.role === 'manager', // manager는 읽기 전용
            loginAs: (role, residentId, displayName = '') => {
                setState({ role, residentId, residentMask: computeMask(residentId), displayName });
                // Security: Set cookies with Secure and SameSite flags
                // Note: For production, consider server-side session tokens with HttpOnly cookies
                document.cookie = getCookieString(COOKIE_ROLE, role ?? '');
                document.cookie = getCookieString(COOKIE_RESIDENT, residentId ?? '');
                document.cookie = getCookieString(COOKIE_DISPLAY, displayName ?? '');
            },
            logout: () => {
                setState(initialState);
                localStorage.removeItem(STORAGE_KEY);
                // Clear cookies with same security settings
                document.cookie = getCookieString(COOKIE_ROLE, '', 0);
                document.cookie = getCookieString(COOKIE_RESIDENT, '', 0);
                document.cookie = getCookieString(COOKIE_DISPLAY, '', 0);
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
