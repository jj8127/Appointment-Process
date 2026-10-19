import { safeStorage } from '@/lib/safe-storage';

const PENDING_KEY = 'fc-onboarding/pending-referral-code';
const CARE_PENDING_KEY = 'fc-onboarding/pending-care-referral-code';
let storageWork: Promise<unknown> = Promise.resolve();

export function normalizeReferralInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^(?:[A-Z0-9]{8}|[A-Z0-9]{12})$/.test(code) ? code : null;
}

export function parseReferralInvite(url: string | null): { code: string; service?: 'care' } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'hanwhafcpass:' || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
    const path = `${parsed.hostname}${parsed.pathname}`.replace(/^\/+|\/+$/g, '');
    const codes = parsed.searchParams.getAll('code');
    const services = parsed.searchParams.getAll('service');
    const code = codes.length === 1 ? normalizeReferralInviteCode(codes[0]) : null;
    if (!code || services.length > 1) return null;
    if (path === 'services/signup' && services[0] === 'care') return { code, service: 'care' };
    if (path === 'signup' && services.length === 0) return { code };
  } catch { /* Malformed links are optional input, not startup failures. */ }
  return null;
}

function serializeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageWork.then(operation, operation);
  storageWork = result.catch(() => {});
  return result;
}

export function savePendingReferralCode(code: string, service?: 'care'): Promise<void> {
  return serializeStorage(async () => {
    const normalized = normalizeReferralInviteCode(code);
    if (!normalized) return;
    await safeStorage.setItem(service === 'care' ? CARE_PENDING_KEY : PENDING_KEY, normalized);
  });
}

// 목적별로 읽고 즉시 삭제 — FC 가입과 공통 가입 사이에 혼입하지 않는다.
export function consumePendingReferralCode(service?: 'care'): Promise<string | null> {
  return serializeStorage(async () => {
    const key = service === 'care' ? CARE_PENDING_KEY : PENDING_KEY;
    const code = await safeStorage.getItem(key);
    if (code) await safeStorage.removeItem(key);
    return normalizeReferralInviteCode(code);
  });
}

export function clearPendingReferralCodes(): Promise<void> {
  return serializeStorage(async () => {
    await safeStorage.removeItem(PENDING_KEY);
    await safeStorage.removeItem(CARE_PENDING_KEY);
  });
}
