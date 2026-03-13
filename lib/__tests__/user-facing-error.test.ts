import {
  inferAlertVariantFromTitle,
  inferUserFacingAlertFallback,
  toUserFacingAlertMessage,
} from '@/lib/user-facing-error';

describe('toUserFacingAlertMessage', () => {
  it('replaces technical edge-function messages with the provided fallback', () => {
    expect(
      toUserFacingAlertMessage(
        'Edge Function returned a non-2xx status code',
        '저장 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
      ),
    ).toBe('저장 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
  });

  it('keeps already user-friendly Korean messages unchanged', () => {
    expect(
      toUserFacingAlertMessage(
        '인증 코드가 일치하지 않습니다. 다시 확인해주세요.',
        '인증에 실패했습니다.',
      ),
    ).toBe('인증 코드가 일치하지 않습니다. 다시 확인해주세요.');
  });

  it('maps auth-related technical messages to a login hint', () => {
    expect(
      toUserFacingAlertMessage(
        'permission denied for table fc_profiles',
        '저장에 실패했습니다.',
      ),
    ).toBe('로그인 상태 또는 권한을 확인한 뒤 다시 시도해주세요.');
  });
});

describe('inferUserFacingAlertFallback', () => {
  it('returns a save-specific fallback for save alerts', () => {
    expect(inferUserFacingAlertFallback('저장 실패')).toBe(
      '저장 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
    );
  });
});

describe('inferAlertVariantFromTitle', () => {
  it('marks input-check alerts as warnings', () => {
    expect(inferAlertVariantFromTitle('입력 확인')).toBe('warning');
  });

  it('marks failure alerts as errors', () => {
    expect(inferAlertVariantFromTitle('저장 실패')).toBe('error');
  });
});
