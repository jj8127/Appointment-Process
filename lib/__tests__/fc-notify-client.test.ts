import {
  buildFcNotifyInvokeOptions,
  FC_NOTIFY_APP_SESSION_HEADER,
  FC_NOTIFY_FUNCTION_NAME,
  FcNotifySessionError,
  invokeFcNotifyWithDeps,
} from '../fc-notify-client';

jest.mock('../request-board-api', () => ({
  getStoredAppSessionToken: jest.fn(),
}));

jest.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

describe('fc-notify mobile client authentication contract', () => {
  it('adds only the custom app-session header for protected actions', () => {
    expect(buildFcNotifyInvokeOptions({ type: 'inbox_list', role: 'fc' }, '  signed-session  ')).toEqual({
      body: { type: 'inbox_list', role: 'fc' },
      headers: {
        [FC_NOTIFY_APP_SESSION_HEADER]: 'signed-session',
      },
    });
  });

  it('allows latest_notice without reading or attaching an app-session token', async () => {
    const getStoredAppSessionToken = jest.fn(async () => 'unused-session');
    const invoke = jest.fn(async () => ({ data: { ok: true }, error: null }));

    const result = await invokeFcNotifyWithDeps(
      { type: 'latest_notice' },
      { getStoredAppSessionToken, invoke },
    );

    expect(getStoredAppSessionToken).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(FC_NOTIFY_FUNCTION_NAME, {
      body: { type: 'latest_notice' },
    });
    expect(result).toEqual({ data: { ok: true }, error: null });
  });

  it('fails before network I/O when a protected action has no stored app session', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: null }));

    await expect(invokeFcNotifyWithDeps(
      { type: 'notify', target_role: 'admin' },
      {
        getStoredAppSessionToken: async () => null,
        invoke,
      },
    )).rejects.toMatchObject({
      name: 'FcNotifySessionError',
      code: 'missing_app_session',
      needsRelogin: true,
    } satisfies Partial<FcNotifySessionError>);

    expect(invoke).not.toHaveBeenCalled();
  });

  it('passes the protected request through unchanged after adding the session header', async () => {
    const body = {
      type: 'notify',
      target_role: 'admin',
      target_id: '01012345678',
      title: '알림',
      body: '내용',
    };
    const invoke = jest.fn(async () => ({ data: { ok: true }, error: null }));

    await invokeFcNotifyWithDeps(body, {
      getStoredAppSessionToken: async () => 'app-session',
      invoke,
    });

    expect(invoke).toHaveBeenCalledWith(FC_NOTIFY_FUNCTION_NAME, {
      body,
      headers: {
        [FC_NOTIFY_APP_SESSION_HEADER]: 'app-session',
      },
    });
  });
});
