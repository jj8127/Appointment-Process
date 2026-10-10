import {
  REQUEST_BOARD_SESSION_REAUTH_MESSAGE,
  isRequestBoardSessionReauthError,
  toRequestBoardSessionErrorMessage,
} from '@/lib/request-board-session-error';

describe('request board session error copy', () => {
  it('maps technical edge-function failures to the GaramLink re-login guidance', () => {
    expect(
      toRequestBoardSessionErrorMessage('Edge Function returned a non-2xx status code'),
    ).toBe(REQUEST_BOARD_SESSION_REAUTH_MESSAGE);
  });

  it('maps app-session and bridge failures to the same guidance', () => {
    expect(
      toRequestBoardSessionErrorMessage('invalid_session_token'),
    ).toBe(REQUEST_BOARD_SESSION_REAUTH_MESSAGE);

    expect(
      toRequestBoardSessionErrorMessage('브릿지 로그인 실패'),
    ).toBe(REQUEST_BOARD_SESSION_REAUTH_MESSAGE);
  });

  it('keeps explicit role-not-applicable guidance instead of suggesting re-login', () => {
    expect(
      toRequestBoardSessionErrorMessage('총무 계정은 가람Link 요청 주체가 아닙니다.'),
    ).toBe('총무 계정은 가람Link 요청 주체가 아닙니다.');
  });

  it('uses the caller fallback for unrelated unknown errors', () => {
    expect(
      toRequestBoardSessionErrorMessage(null, '의뢰 목록을 불러오지 못했습니다.'),
    ).toBe('의뢰 목록을 불러오지 못했습니다.');
  });

  it.each([
    { status: 403, code: 'ACCOUNT_INACTIVE', message: 'Bridge account is inactive.' },
    { status: 503, code: 'invalid_app_session', retryable: true, message: 'Edge Function returned a non-2xx status code' },
    { needsRelogin: false, message: 'Bridge permission denied.' },
  ])('preserves structured permission or service failures: %j', (error) => {
    expect(isRequestBoardSessionReauthError(error)).toBe(false);
    expect(toRequestBoardSessionErrorMessage(error)).toBe(error.message);
  });

  it.each([
    { status: 401, message: 'Login expired.' },
    { status: 403, code: 'SESSION_INVALID', message: 'Signed JWT expired.' },
    { needsRelogin: true, message: 'Login required.' },
  ])('uses re-login guidance for structured authentication failures: %j', (error) => {
    expect(isRequestBoardSessionReauthError(error)).toBe(true);
    expect(toRequestBoardSessionErrorMessage(error)).toBe(REQUEST_BOARD_SESSION_REAUTH_MESSAGE);
  });
});
