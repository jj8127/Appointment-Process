import {
  BoardSessionError,
  invokeBoardWithDeps,
  type BoardActor,
} from '../board-api';

jest.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

jest.mock('../request-board-api', () => ({
  getStoredAppSessionToken: jest.fn(),
}));

const actor: BoardActor = {
  role: 'fc',
  residentId: '01011112222',
  displayName: 'Test FC',
};

describe('mobile board caller authentication', () => {
  it('fails closed before invoking the Edge Function when no app session exists', async () => {
    const invoke = jest.fn();

    await expect(invokeBoardWithDeps('board-list', { actor }, {
      getStoredAppSessionToken: async () => null,
      invoke,
    })).rejects.toEqual(expect.objectContaining({
      name: 'BoardSessionError',
      code: 'missing_app_session',
      status: 401,
    }));

    expect(invoke).not.toHaveBeenCalled();
  });

  it('attaches the stored app session header while preserving the legacy body actor', async () => {
    const invoke = jest.fn(async () => ({
      data: { ok: true, data: { items: [] } },
      error: null,
    }));

    const result = await invokeBoardWithDeps<{ items: unknown[] }>('board-list', { actor, limit: 20 }, {
      getStoredAppSessionToken: async () => '  signed-app-session  ',
      invoke,
    });

    expect(result).toEqual({ items: [] });
    expect(invoke).toHaveBeenCalledWith('board-list', {
      body: { actor, limit: 20 },
      headers: {
        'x-app-session-token': 'signed-app-session',
      },
    });
  });

  it('uses a typed session error for missing mobile board authentication', () => {
    const error = new BoardSessionError();
    expect(error).toMatchObject({
      name: 'BoardSessionError',
      code: 'missing_app_session',
      status: 401,
    });
  });
});
