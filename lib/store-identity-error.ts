type FunctionErrorLike = {
  message?: string;
  context?: {
    response?: Response;
    body?: unknown;
  };
};

const INVALID_RESIDENT_INPUT_MESSAGE = '주민번호를 잘못 입력했습니다. 다시 확인해주세요.';
const INVALID_IDENTITY_INPUT_MESSAGE = '입력한 주민번호 또는 주소를 다시 확인해주세요.';
const INVALID_LOGIN_STATE_MESSAGE = '로그인 정보를 다시 확인한 후 다시 시도해주세요.';
const STORE_IDENTITY_GENERIC_MESSAGE = '신원 정보 저장에 실패했습니다. 잠시 후 다시 시도해주세요.';

export async function extractFunctionErrorMessage(
  err: unknown,
  fallback = STORE_IDENTITY_GENERIC_MESSAGE,
): Promise<string> {
  const functionError = err as FunctionErrorLike | null | undefined;
  if (!functionError) return fallback;

  const context = functionError.context ?? {};
  const response = context.response;
  if (response) {
    try {
      const text = await response.text();
      if (text) return text;
    } catch {
      // Ignore response body parsing failures and continue with other fallbacks.
    }
  }

  const body = context.body;
  if (typeof body === 'string' && body) return body;
  if (body && typeof body === 'object' && 'message' in body) {
    return String((body as { message?: unknown }).message ?? fallback);
  }

  return functionError.message ?? fallback;
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

  if (lower.includes('non-2xx') || lower.includes('edge function')) {
    return INVALID_RESIDENT_INPUT_MESSAGE;
  }

  if (lower.includes('missing required environment variable')) {
    return STORE_IDENTITY_GENERIC_MESSAGE;
  }

  return normalized;
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
