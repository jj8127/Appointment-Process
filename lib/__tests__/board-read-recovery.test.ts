import { BoardApiError, invokeBoardWithDeps } from '../board-api';

jest.mock('../supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('../request-board-api', () => ({ getStoredAppSessionToken: jest.fn() }));

describe('board read recovery metadata', () => {
  it('keeps an HTTP session failure actionable after reading its safe server message', async () => {
    const error = await invokeBoardWithDeps('board-detail', { postId: 'fictional-post' }, {
      getStoredAppSessionToken: async () => 'fictional-token',
      invoke: async () => ({ data: null, error: { context: new Response(
        JSON.stringify({ code: 'expired_app_session', message: '세션이 만료되었습니다. 다시 로그인해주세요.' }),
        { status: 401 },
      ) } }),
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(BoardApiError);
    expect(error).toMatchObject({ status: 401, code: 'expired_app_session', needsRelogin: true, message: '세션이 만료되었습니다. 다시 로그인해주세요.' });
  });

  it.each(['missing_app_session', 'expired_app_session', 'invalid_app_session'])(
    'preserves structured %s instead of replacing it with an empty result', async (code) => {
      await expect(invokeBoardWithDeps('board-list', {}, {
        getStoredAppSessionToken: async () => 'fictional-token',
        invoke: async () => ({ data: { ok: false, code, message: '다시 로그인해주세요.' }, error: null }),
      })).rejects.toMatchObject({ code, needsRelogin: true });
    },
  );

  it.each([403, 500])('keeps HTTP %s as a retryable read failure rather than requiring login', async (status) => {
    await expect(invokeBoardWithDeps('board-categories-list', {}, {
      getStoredAppSessionToken: async () => 'fictional-token',
      invoke: async () => ({ data: null, error: { context: new Response(
        JSON.stringify({ message: '목록을 불러오지 못했습니다.' }), { status },
      ) } }),
    })).rejects.toMatchObject({ status, needsRelogin: false });
  });

  it('keeps a genuine successful empty list', async () => {
    await expect(invokeBoardWithDeps('board-list', {}, {
      getStoredAppSessionToken: async () => 'fictional-token',
      invoke: async () => ({ data: { ok: true, data: { items: [] } }, error: null }),
    })).resolves.toEqual({ items: [] });
  });

  it('requires login without making a request when the signed token is missing', async () => {
    const invoke = jest.fn();
    await expect(invokeBoardWithDeps('board-detail', { postId: 'fictional-post' }, {
      getStoredAppSessionToken: async () => null, invoke,
    })).rejects.toMatchObject({ name: 'BoardSessionError', status: 401, needsRelogin: true });
    expect(invoke).not.toHaveBeenCalled();
  });
});
