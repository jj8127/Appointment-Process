import {
  invokeStoreIdentity,
  STORE_IDENTITY_APP_SESSION_HEADER,
  type StoreIdentityPayload,
} from '@/lib/store-identity-api';

jest.mock('@/lib/request-board-api', () => ({
  getStoredAppSessionToken: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const payload: StoreIdentityPayload = {
  residentId: '01012345678',
  residentFront: '900101',
  residentBack: '1234568',
  address: '서울시 테스트구',
  addressDetail: '101호',
};

describe('store identity signed-session caller', () => {
  it('fails before network I/O when the signed app session is absent', async () => {
    const invoke = jest.fn();
    await expect(invokeStoreIdentity(payload, {
      getStoredAppSessionToken: async () => null,
      invoke,
    })).rejects.toThrow('로그인 정보를 다시 확인');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('attaches only the trimmed stored app-session token to the request', async () => {
    const invoke = jest.fn(async () => ({ data: { ok: true }, error: null }));
    await invokeStoreIdentity(payload, {
      getStoredAppSessionToken: async () => '  signed-fc-session  ',
      invoke,
    });
    expect(invoke).toHaveBeenCalledWith('store-identity', {
      body: payload,
      headers: { [STORE_IDENTITY_APP_SESSION_HEADER]: 'signed-fc-session' },
    });
  });
});
