import {
  ExamPaymentProofApiError,
  listExamApplicationTargets,
} from '../exam-payment-proof-api';
import { supabase } from '../supabase';

jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.Mock;
const target = {
  fcId: 'fictional-fc-id',
  residentId: '01000000000',
  name: '테스트 FC',
  affiliation: '테스트 본부',
  phoneLast4: '0000',
};

function httpFailure(status: number, payload: Record<string, unknown>) {
  return {
    data: null,
    error: { context: new Response(JSON.stringify(payload), { status }) },
  };
}

describe('exam application target API', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('loads targets using the signed app session and list action', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, data: { targets: [target] } }, error: null });

    await expect(listExamApplicationTargets('  fictional-session  ')).resolves.toEqual([target]);
    expect(mockInvoke).toHaveBeenCalledWith('exam-payment-proof', {
      body: { action: 'list_targets' },
      headers: { 'x-app-session-token': 'fictional-session' },
    });
  });

  it('preserves an expired HTTP session code and its safe message for re-login', async () => {
    mockInvoke.mockResolvedValue(httpFailure(401, {
      ok: false,
      code: 'expired_app_session',
      message: '세션이 만료되었습니다. 다시 로그인해주세요.',
    }));

    await expect(listExamApplicationTargets('fictional-expired-session')).rejects.toMatchObject({
      name: 'ExamPaymentProofApiError',
      code: 'expired_app_session',
      message: '세션이 만료되었습니다. 다시 로그인해주세요.',
      needsRelogin: true,
    });
  });

  it('fails with a re-login error before invoking when the token is missing', async () => {
    await expect(listExamApplicationTargets('  ')).rejects.toMatchObject({
      name: 'ExamPaymentProofApiError',
      code: 'missing_app_session',
      needsRelogin: true,
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each(['missing_app_session', 'invalid_app_session', 'invalid_session', 'actor_not_found'])(
    'preserves the %s failure in an envelope',
    async (code) => {
      mockInvoke.mockResolvedValue({
        data: { ok: false, code, message: '로그인 정보를 다시 확인해주세요.' },
        error: null,
      });

      await expect(listExamApplicationTargets('fictional-session')).rejects.toMatchObject({
        code,
        message: '로그인 정보를 다시 확인해주세요.',
        needsRelogin: true,
      });
    },
  );

  it('allows retry after a temporary server failure without requesting re-login', async () => {
    mockInvoke
      .mockResolvedValueOnce(httpFailure(500, {
        ok: false,
        code: 'db_error',
        message: 'FC 목록을 불러오지 못했습니다.',
      }))
      .mockResolvedValueOnce({ data: { ok: true, data: { targets: [target] } }, error: null });

    await expect(listExamApplicationTargets('fictional-session')).rejects.toMatchObject({
      code: 'db_error',
      message: 'FC 목록을 불러오지 못했습니다.',
      needsRelogin: false,
    });
    await expect(listExamApplicationTargets('fictional-session')).resolves.toEqual([target]);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('keeps a successful empty list distinct from a request failure', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, data: { targets: [] } }, error: null });

    await expect(listExamApplicationTargets('fictional-session')).resolves.toEqual([]);
  });

  it.each([
    {},
    { targets: null },
    { targets: {} },
    { targets: [null] },
    { targets: [{ ...target, name: null }] },
  ])('rejects malformed target data rather than returning an empty list: %j', async (data) => {
    mockInvoke.mockResolvedValue({ data: { ok: true, data }, error: null });

    await expect(listExamApplicationTargets('fictional-session')).rejects.toMatchObject({
      name: 'ExamPaymentProofApiError',
      code: 'invalid_response',
      message: 'FC 목록을 불러오지 못했습니다. 다시 시도해주세요.',
      needsRelogin: false,
    });
  });

  it('keeps unexpected transport details out of the user-facing error', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('fictional raw transport details') });

    const failure = await listExamApplicationTargets('fictional-session').catch((error) => error);
    expect(failure).toBeInstanceOf(ExamPaymentProofApiError);
    expect(failure.message).toBe('시험 신청 서버에 연결하지 못했습니다.');
    expect(failure.needsRelogin).toBe(false);
  });
});
