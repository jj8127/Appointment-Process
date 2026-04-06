'use client';

import { useRouter } from 'next/navigation';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { logger } from '@/lib/logger';
import { normalizeStaffType, type StaffType } from '@/lib/staff-identity';
type Role = 'admin' | 'manager' | 'fc' | null;

type SessionState = {
    role: Role;
    residentId: string;
    residentMask: string;
    displayName: string;
    staffType: StaffType;
};

type SessionContextValue = SessionState & {
    hydrated: boolean;
    loginAs: (role: Role, residentId: string, displayName?: string, staffType?: StaffType) => void;
    logout: (options?: { redirectTo?: string | null }) => void;
    isReadOnly: boolean; // manager는 읽기 전용
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);
const COOKIE_ROLE = 'session_role';
const COOKIE_RESIDENT = 'session_resident';
const COOKIE_DISPLAY = 'session_display';
const COOKIE_STAFF_TYPE = 'session_staff_type';

function isRole(value: unknown): value is Exclude<Role, null> {
    return value === 'admin' || value === 'manager' || value === 'fc';
}

const computeMask = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
};

const initialState: SessionState = { role: null, residentId: '', residentMask: '', displayName: '', staffType: null };
const STORAGE_KEY = 'fc-onboarding/session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30일

function parseCookie(name: string) {
    if (typeof document === 'undefined') return '';
    const prefix = `${name}=`;
    const entry = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(prefix));
    if (!entry) return '';
    try {
        return decodeURIComponent(entry.slice(prefix.length));
    } catch {
        return '';
    }
}

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

function readSessionFromCookies(): SessionState | null {
    const role = parseCookie(COOKIE_ROLE);
    const residentId = parseCookie(COOKIE_RESIDENT);
    if (!isRole(role) || !residentId) return null;
    return {
        role,
        residentId,
        residentMask: computeMask(residentId),
        displayName: parseCookie(COOKIE_DISPLAY),
        staffType: normalizeStaffType(parseCookie(COOKIE_STAFF_TYPE)),
    };
}

function readSessionFromStorage(): SessionState | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const decoded = deobfuscate(raw);
        const parsed = JSON.parse(decoded) as Partial<SessionState>;
        if (!isRole(parsed.role) || !parsed.residentId) return null;
        return {
            role: parsed.role,
            residentId: parsed.residentId,
            residentMask: computeMask(parsed.residentId),
            displayName: parsed.displayName ?? '',
            staffType: normalizeStaffType(parsed.staffType),
        };
    } catch (err) {
        logger.warn('Session restore failed', err);
        return null;
    }
}

function writeCookies(snapshot: Pick<SessionState, 'role' | 'residentId' | 'displayName' | 'staffType'> | null) {
    if (!snapshot?.role || !snapshot.residentId) {
        document.cookie = getCookieString(COOKIE_ROLE, '', 0);
        document.cookie = getCookieString(COOKIE_RESIDENT, '', 0);
        document.cookie = getCookieString(COOKIE_DISPLAY, '', 0);
        document.cookie = getCookieString(COOKIE_STAFF_TYPE, '', 0);
        return;
    }

    document.cookie = getCookieString(COOKIE_ROLE, snapshot.role);
    document.cookie = getCookieString(COOKIE_RESIDENT, snapshot.residentId);
    document.cookie = getCookieString(COOKIE_DISPLAY, snapshot.displayName ?? '');
    document.cookie = getCookieString(COOKIE_STAFF_TYPE, snapshot.staffType ?? '');
}

export function SessionProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<SessionState>(initialState);
    const [hydrated, setHydrated] = useState(false);
    const router = useRouter();

    useEffect(() => {
        const restore = () => {
            try {
                // Middleware uses cookies as the server-side session source of truth.
                // Restore that snapshot first so protected routes and client state stay aligned.
                const snapshot = readSessionFromCookies() ?? readSessionFromStorage();
                if (snapshot) {
                    setState(snapshot);
                    writeCookies(snapshot);
                }
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
                        staffType: state.staffType,
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

    // Keep cookies in sync with the in-memory session so server routes can validate admin actions.
    useEffect(() => {
        if (!hydrated) return;

        if (state.role && state.residentId) {
            writeCookies(state);
        } else {
            writeCookies(null);
        }
    }, [hydrated, state]);

    const value = useMemo<SessionContextValue>(
        () => ({
            ...state,
            hydrated,
            isReadOnly: state.role === 'manager', // manager는 읽기 전용
            loginAs: (role, residentId, displayName = '', staffType = null) => {
                setState({ role, residentId, residentMask: computeMask(residentId), displayName, staffType });
                writeCookies({
                    role,
                    residentId,
                    displayName,
                    staffType,
                });
            },
            logout: (options) => {
                setState(initialState);
                localStorage.removeItem(STORAGE_KEY);
                writeCookies(null);
                if (options?.redirectTo !== null) {
                    router.replace(options?.redirectTo ?? '/auth');
                }
            },
        }),
        [hydrated, router, state],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
    const ctx = useContext(SessionContext);
    if (!ctx) throw new Error('useSession must be used within SessionProvider');
    return ctx;
}
