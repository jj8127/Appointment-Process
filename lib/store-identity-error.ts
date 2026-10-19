import { getSupabaseFunctionErrorResponse } from './supabase-function-error';

const INVALID_RESIDENT_INPUT_MESSAGE = '주민번호를 잘못 입력했습니다. 다시 확인해주세요.';
const INVALID_IDENTITY_INPUT_MESSAGE = '입력한 주민번호 또는 주소를 다시 확인해주세요.';
const INVALID_LOGIN_STATE_MESSAGE = '로그인 정보를 다시 확인한 후 다시 시도해주세요.';
const STORE_IDENTITY_GENERIC_MESSAGE = '신원 정보 저장에 실패했습니다. 잠시 후 다시 시도해주세요.';

export type StoreIdentityReceipt = {
  ok: true;
  residentId: string;
  identityCompleted: true;
};

export function requireStoreIdentityReceipt(
  value: unknown,
  expectedResidentId: string,
): StoreIdentityReceipt {
  const normalizedResidentId = expectedResidentId.replace(/\D/g, '');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(STORE_IDENTITY_GENERIC_MESSAGE);
  }
  const receipt = value as Record<string, unknown>;
  if (
    receipt.ok !== true
    || receipt.identityCompleted !== true
    || typeof receipt.residentId !== 'string'
    || receipt.residentId.replace(/\D/g, '') !== normalizedResidentId
  ) {
    throw new Error(STORE_IDENTITY_GENERIC_MESSAGE);
  }
  return receipt as StoreIdentityReceipt;
}

export async function extractFunctionErrorMessage(
  err: unknown,
  fallback = STORE_IDENTITY_GENERIC_MESSAGE,
): Promise<string> {
  const response = getSupabaseFunctionErrorResponse(err);
  if (response?.status === 401 || response?.status === 403 || response?.status === 404) {
    return INVALID_LOGIN_STATE_MESSAGE;
  }
  if (typeof response?.status === 'number' && response.status >= 500) {
    return fallback;
  }
  if (typeof response?.text === 'function') {
    try {
      const reader = response.clone?.() ?? response;
      const text = await reader.text?.();
      if (text) return mapStoreIdentityErrorMessage(text);
    } catch {
      // An unreadable error body is not evidence of invalid resident input.
    }
  }
  return fallback;
}

export function mapStoreIdentityErrorMessage(rawMessage: string | null | undefined): string {
  const normalized = String(rawMessage ?? '').trim();
  if (!normalized) return STORE_IDENTITY_GENERIC_MESSAGE;

  const lower = normalized.toLowerCase();

  if (lower.includes('invalid resident number')) {
    return INVALID_RESIDENT_INPUT_MESSAGE;
  }

  if (lower.includes('resident number required') || lower.includes('invalid payload')) {
    return INVALID_IDENTITY_INPUT_MESSAGE;
  }

  if (lower.includes('fc profile not found') || lower.includes('resident_id is required')) {
    return INVALID_LOGIN_STATE_MESSAGE;
  }

  if (normalized === INVALID_LOGIN_STATE_MESSAGE) {
    return INVALID_LOGIN_STATE_MESSAGE;
  }

  if (lower.includes('missing required environment variable')) {
    return STORE_IDENTITY_GENERIC_MESSAGE;
  }

  if (normalized === INVALID_RESIDENT_INPUT_MESSAGE || normalized === INVALID_IDENTITY_INPUT_MESSAGE) {
    return normalized;
  }
  return STORE_IDENTITY_GENERIC_MESSAGE;
}

export function toResidentInputAlertMessage(errorMessage?: string | null): string {
  const normalized = String(errorMessage ?? '').trim();
  if (!normalized) return INVALID_RESIDENT_INPUT_MESSAGE;

  if (
    normalized.includes('주민등록번호') ||
    normalized.includes('외국인등록번호') ||
    normalized.includes('주민번호')
  ) {
    return INVALID_RESIDENT_INPUT_MESSAGE;
  }

  return normalized;
}
