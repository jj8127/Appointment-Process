import {
  REQUEST_BOARD_SESSION_REAUTH_MESSAGE,
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
});
