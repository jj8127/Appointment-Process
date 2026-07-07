export const REQUEST_BOARD_SESSION_REAUTH_MESSAGE =
  '가람Link 연동 세션이 만료되었거나 연결 정보가 갱신되지 않았습니다. 앱에서 다시 로그인한 뒤 설계요청을 다시 열어주세요.';

const SESSION_ERROR_PATTERNS = [
  'edge function',
  'functionshttperror',
  'non-2xx',
  'missing_session_token',
  'invalid_session_token',
  'expired_session',
  'invalid_bridge_token',
  'bridge_login_failed',
  'missing_bridge_token',
  'request_board session',
  'request_board auth',
  '브릿지',
  'bridge',
  '앱 세션 토큰',
  '가람link 세션',
  '가람link 계정 연결',
  '가람link 연동 세션',
  '세션 재동기화',
  '세션 동기화',
  '인증이 만료',
  '유효하지 않은 브릿지',
];

const NON_REAUTH_PATTERNS = [
  'request_board_not_applicable',
  '요청 주체가 아닙니다',
  '총무 계정은',
  '회원가입이 완료되지 않았습니다',
  '비활성화된 계정입니다',
  '계정을 찾을 수 없습니다',
];

function extractMessage(input: unknown): string | null {
  if (typeof input === 'string') return input.trim() || null;
  if (input instanceof Error) return input.message.trim() || null;
  if (input && typeof input === 'object' && 'message' in input) {
    const message = (input as { message?: unknown }).message;
    if (typeof message === 'string') return message.trim() || null;
  }
  return null;
}

export function isRequestBoardSessionReauthError(input: unknown): boolean {
  const message = extractMessage(input);
  if (!message) return false;

  const lower = message.toLowerCase();
  if (NON_REAUTH_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()))) {
    return false;
  }

  return SESSION_ERROR_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}

export function toRequestBoardSessionErrorMessage(
  input: unknown,
  fallback = REQUEST_BOARD_SESSION_REAUTH_MESSAGE,
): string {
  const message = extractMessage(input);
  if (!message) return fallback;
  if (isRequestBoardSessionReauthError(message)) return REQUEST_BOARD_SESSION_REAUTH_MESSAGE;
  return message;
}
