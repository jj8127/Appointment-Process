import { BoardApiError, fetchBoardDetail, invokeBoardWithDeps } from '../board-api';
import { getStoredAppSessionToken } from '../request-board-api';
import { supabase } from '../supabase';

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

  it.each([
    [403, 403],
    [500, 502],
  ])('maps HTTP %s to a safe retryable board failure', async (upstreamStatus, expectedStatus) => {
    await expect(invokeBoardWithDeps('board-categories-list', {}, {
      getStoredAppSessionToken: async () => 'fictional-token',
      invoke: async () => ({ data: null, error: { context: new Response(
        JSON.stringify({ message: '목록을 불러오지 못했습니다.' }), { status: upstreamStatus },
      ) } }),
    })).rejects.toMatchObject({ status: expectedStatus, needsRelogin: false });
  });

  it('never exposes raw transport or successful-envelope failure messages', async () => {
    const transportFailure = await invokeBoardWithDeps('board-list', {}, {
      getStoredAppSessionToken: async () => 'fictional-token',
      invoke: async () => ({
        data: null,
        error: {
          context: new Response(JSON.stringify({
            code: 'db_error',
            message: 'private relation and policy detail',
          }), { status: 500 }),
        },
      }),
    }).catch((failure: unknown) => failure);
    expect(transportFailure).toMatchObject({
      status: 502,
      code: 'board_upstream_failed',
      message: '게시판 요청을 처리하지 못했습니다.',
    });
    expect(String(transportFailure)).not.toContain('private relation');

    const envelopeFailure = await invokeBoardWithDeps('board-list', {}, {
      getStoredAppSessionToken: async () => 'fictional-token',
      invoke: async () => ({
        data: { ok: false, code: 'unknown_private_code', message: 'secret database detail' },
        error: null,
      }),
    }).catch((failure: unknown) => failure);
    expect(envelopeFailure).toMatchObject({
      status: 502,
      code: 'board_upstream_failed',
      message: '게시판 요청을 처리하지 못했습니다.',
    });
    expect(String(envelopeFailure)).not.toContain('secret database detail');
  });

  it('keeps a genuine successful empty list', async () => {
    await expect(invokeBoardWithDeps('board-list', {}, {
      getStoredAppSessionToken: async () => 'fictional-token',
      invoke: async () => ({ data: { ok: true, data: { items: [] } }, error: null }),
    })).resolves.toEqual({ items: [] });
  });

  it('stamps when the detail attachment URLs were signed so stale URLs can be re-signed', async () => {
    jest.mocked(getStoredAppSessionToken).mockResolvedValue('fictional-token');
    jest.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { ok: true, data: {
        post: {
          id: 'fictional-post', categoryId: 'fictional-category', title: '', content: '', authorName: '관리자',
          authorRole: 'admin', createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z',
          isPinned: false, isMine: false, viewCount: 0,
        },
        attachments: [],
        reactions: { like: 0, heart: 0, check: 0, smile: 0, myReaction: null },
        comments: [],
      } },
      error: null,
    } as never);
    const before = Date.now();

    const detail = await fetchBoardDetail({ role: 'fc', residentId: 'fictional' } as never, 'fictional-post');

    expect(detail.post.id).toBe('fictional-post');
    expect(detail.attachmentsSignedAt).toBeGreaterThanOrEqual(before);
    expect(detail.attachmentsSignedAt).toBeLessThanOrEqual(Date.now());
  });

  it('requires login without making a request when the signed token is missing', async () => {
    const invoke = jest.fn();
    await expect(invokeBoardWithDeps('board-detail', { postId: 'fictional-post' }, {
      getStoredAppSessionToken: async () => null, invoke,
    })).rejects.toMatchObject({ name: 'BoardSessionError', status: 401, needsRelogin: true });
    expect(invoke).not.toHaveBeenCalled();
  });
});
