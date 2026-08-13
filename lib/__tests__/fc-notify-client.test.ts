import {
  buildFcNotifyInvokeOptions,
  FC_NOTIFY_APP_SESSION_HEADER,
  FC_NOTIFY_FUNCTION_NAME,
  FcNotifySessionError,
  invokeFcNotifyForDelivery,
  invokeFcNotifyWithDeps,
} from '../fc-notify-client';
import { getStoredAppSessionToken } from '../request-board-api';
import { supabase } from '../supabase';

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
  beforeEach(() => {
    jest.clearAllMocks();
  });
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

  it('fails closed before network I/O when a notify payload lacks an exact typed target', async () => {
    (getStoredAppSessionToken as jest.Mock).mockResolvedValue('app-session');

    await expect(
      invokeFcNotifyForDelivery({
        type: 'notify',
        target_role: 'admin',
        target_id: null,
        title: 'title',
        body: 'body',
      }),
    ).resolves.toEqual({
      confirmed: false,
      notificationStored: false,
      reason: 'invalid_recipient',
    });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('allows a valid typed notify target through the authenticated transport', async () => {
    (getStoredAppSessionToken as jest.Mock).mockResolvedValue('app-session');
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: { ok: true, logged: true, sent: 1 },
      error: null,
    });
    const fcId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    await expect(
      invokeFcNotifyForDelivery({
        type: 'notify',
        target_role: 'admin',
        target_id: null,
        title: 'title',
        body: 'body',
        target: { version: 1, kind: 'fc_profile', fcId },
      }),
    ).resolves.toEqual({
      confirmed: true,
      notificationStored: true,
      sent: 1,
      state: 'stored_and_pushed',
    });
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
  });
});
