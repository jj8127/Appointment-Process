import { safeStorage } from '@/lib/safe-storage';

const PENDING_KEY = 'fc-onboarding/pending-referral-code';

export async function savePendingReferralCode(code: string): Promise<void> {
  await safeStorage.setItem(PENDING_KEY, code.trim().toUpperCase());
}

// 읽고 즉시 삭제 — 다음 가입에 혼입 방지
export async function consumePendingReferralCode(): Promise<string | null> {
  const code = await safeStorage.getItem(PENDING_KEY);
  if (code) await safeStorage.removeItem(PENDING_KEY);
  return code;
}
