export type ReferralFunctionFailure = {
  code?: string | null;
  message?: string | null;
};

export const REFERRAL_RELOGIN_CODES = new Set([
  'missing_app_session',
  'expired_app_session',
  'invalid_app_session',
  'missing_bridge_token',
  'invalid_bridge_token',
  'expired_bridge_token',
  'unauthorized',
]);

const SESSION_ERROR_MESSAGE_BY_CODE: Record<string, string> = {
  missing_app_session: '추천인 기능을 사용하려면 다시 로그인해주세요.',
  expired_app_session: '세션이 만료되었습니다. 다시 로그인해주세요.',
  invalid_app_session: '세션이 유효하지 않습니다. 다시 로그인해주세요.',
  missing_bridge_token: '세션이 만료되었습니다. 다시 로그인해주세요.',
  invalid_bridge_token: '세션이 유효하지 않습니다. 다시 로그인해주세요.',
  expired_bridge_token: '세션이 만료되었습니다. 다시 로그인해주세요.',
  unauthorized: '추천인 기능을 사용하려면 다시 로그인해주세요.',
};

export function isReferralReloginCode(code?: string | null) {
  return Boolean(code && REFERRAL_RELOGIN_CODES.has(code));
}

export function toUserFacingReferralSessionMessage(code: string | undefined, fallback: string) {
  if (code && SESSION_ERROR_MESSAGE_BY_CODE[code]) {
    return SESSION_ERROR_MESSAGE_BY_CODE[code];
  }
  return fallback;
}

export function normalizeReferralFunctionFailure(
  failure: ReferralFunctionFailure,
  fallback: string,
) {
  const rawCode = typeof failure.code === 'string' && failure.code.trim()
    ? failure.code.trim()
    : undefined;
  const rawMessage = typeof failure.message === 'string' && failure.message.trim()
    ? failure.message.trim()
    : undefined;
  const message = toUserFacingReferralSessionMessage(rawCode, rawMessage ?? fallback);

  return {
    code: rawCode,
    message,
    needsRelogin: isReferralReloginCode(rawCode),
  };
}
