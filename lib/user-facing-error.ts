const TECHNICAL_MESSAGE_PATTERNS = [
  'edge function',
  'functionshttperror',
  'non-2xx',
  'failed to send a request to the edge function',
  'failed to fetch',
  'fetch failed',
  'network request failed',
  'network error',
  'typeerror: fetch',
  'internal server error',
  'body stream already read',
];

function extractErrorMessage(input: unknown): string | null {
  if (typeof input === 'string') {
    return input.trim() || null;
  }

  if (input instanceof Error) {
    return input.message.trim() || null;
  }

  if (input && typeof input === 'object' && 'message' in input) {
    const message = (input as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message.trim() || null;
    }
  }

  return null;
}

export function toUserFacingAlertMessage(
  input: unknown,
  fallback: string,
): string {
  const message = extractErrorMessage(input);
  if (!message) return fallback;

  const normalized = message.trim();
  const lower = normalized.toLowerCase();
  const hasKorean = /[가-힣]/.test(normalized);
  const hasTechnicalPattern = TECHNICAL_MESSAGE_PATTERNS.some((pattern) => lower.includes(pattern));

  if (hasKorean && !hasTechnicalPattern) {
    return normalized;
  }

  if (
    lower.includes('jwt') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('not authorized') ||
    lower.includes('permission denied') ||
    lower.includes('row-level security') ||
    lower.includes('rls')
  ) {
    return '로그인 상태 또는 권한을 확인한 뒤 다시 시도해주세요.';
  }

  if (
    lower.includes('duplicate key') ||
    lower.includes('unique constraint') ||
    lower.includes('already exists') ||
    lower.includes('duplicate')
  ) {
    return '이미 등록된 정보이거나 중복된 요청입니다. 입력 내용을 다시 확인해주세요.';
  }

  if (
    lower.includes('invalid input') ||
    lower.includes('invalid payload') ||
    lower.includes('invalid json') ||
    lower.includes('malformed')
  ) {
    return '입력한 내용을 다시 확인해주세요.';
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborterror') ||
    lower.includes('deadline exceeded')
  ) {
    return '처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.';
  }

  if (hasTechnicalPattern) {
    return fallback;
  }

  return normalized;
}

export function inferUserFacingAlertFallback(title: string | null | undefined): string {
  const normalized = String(title ?? '').trim();

  if (normalized.includes('로그인')) {
    return '로그인 처리 중 문제가 발생했습니다. 다시 시도해주세요.';
  }
  if (normalized.includes('불러오기') || normalized.includes('조회')) {
    return '정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (normalized.includes('저장') || normalized.includes('등록')) {
    return '저장 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (normalized.includes('삭제')) {
    return '삭제 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (normalized.includes('업로드')) {
    return '업로드 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (normalized.includes('열기')) {
    return '열기 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (normalized.includes('전송')) {
    return '전송 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (normalized.includes('인증')) {
    return '인증 처리 중 문제가 발생했습니다. 다시 시도해주세요.';
  }
  if (normalized.includes('신청') || normalized.includes('요청') || normalized.includes('처리')) {
    return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
  }

  return '요청을 처리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
}

export function inferAlertVariantFromTitle(title: string | null | undefined): 'info' | 'success' | 'warning' | 'error' {
  const normalized = String(title ?? '').trim();

  if (
    normalized.includes('완료') ||
    normalized.includes('성공') ||
    normalized.includes('승인 완료') ||
    normalized.includes('등록 완료')
  ) {
    return 'success';
  }

  if (
    normalized.includes('입력') ||
    normalized.includes('확인') ||
    normalized.includes('주의') ||
    normalized.includes('알림')
  ) {
    return 'warning';
  }

  if (
    normalized.includes('실패') ||
    normalized.includes('오류') ||
    normalized.includes('불가') ||
    normalized.includes('권한') ||
    normalized.includes('접근')
  ) {
    return 'error';
  }

  return 'info';
}
