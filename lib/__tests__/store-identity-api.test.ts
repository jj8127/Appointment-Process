import {
  invokeStoreIdentity,
  STORE_IDENTITY_APP_SESSION_HEADER,
  type StoreIdentityPayload,
} from '@/lib/store-identity-api';
import { FunctionsHttpError } from '@supabase/functions-js';
import { extractFunctionErrorMessage, mapStoreIdentityErrorMessage } from '@/lib/store-identity-error';

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
  it.each([401, 403])('maps SDK HTTP %s to a fixed login message without reading the body', async (status) => {
    const response = new Response('Private upstream diagnostic', { status });
    const error = new FunctionsHttpError(response);
    const message = await extractFunctionErrorMessage(error);
    expect(mapStoreIdentityErrorMessage(message)).toBe('로그인 정보를 다시 확인한 후 다시 시도해주세요.');
    expect(response.bodyUsed).toBe(false);
  });

  it('reads allowed validation errors from the SDK Response without consuming it', async () => {
    const response = new Response('Invalid resident number', { status: 400 });
    const message = await extractFunctionErrorMessage(new FunctionsHttpError(response));
    expect(message).toBe('주민번호를 잘못 입력했습니다. 다시 확인해주세요.');
    expect(response.bodyUsed).toBe(false);
  });

  it('never exposes arbitrary upstream or transport details as resident-input errors', async () => {
    const fallback = '신원 정보 저장에 실패했습니다. 잠시 후 다시 시도해주세요.';
    for (const status of [400, 500]) {
      expect(await extractFunctionErrorMessage(new FunctionsHttpError(
        new Response('Private upstream diagnostic', { status }),
      ))).toBe(fallback);
    }
    expect(mapStoreIdentityErrorMessage('Edge Function returned a non-2xx status code')).toBe(fallback);
    expect(mapStoreIdentityErrorMessage('Private upstream diagnostic')).toBe(fallback);
  });

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
