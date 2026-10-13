import { getStoredAppSessionToken } from './request-board-api';
import { supabase } from './supabase';

export const STORE_IDENTITY_APP_SESSION_HEADER = 'x-app-session-token';

export type StoreIdentityPayload = {
  residentId: string;
  residentFront?: string;
  residentBack?: string;
  address: string;
  addressDetail?: string | null;
};

type StoreIdentityInvokeResult = {
  data: unknown;
  error: unknown;
};

type StoreIdentityDependencies = {
  getStoredAppSessionToken: () => Promise<string | null>;
  invoke: (
    name: 'store-identity',
    options: {
      body: StoreIdentityPayload;
      headers: Record<string, string>;
    },
  ) => Promise<StoreIdentityInvokeResult>;
};

export async function invokeStoreIdentity(
  payload: StoreIdentityPayload,
  dependencies: Partial<StoreIdentityDependencies> = {},
): Promise<StoreIdentityInvokeResult> {
  const loadToken = dependencies.getStoredAppSessionToken ?? getStoredAppSessionToken;
  const invoke = dependencies.invoke
    ?? ((name, options) => supabase.functions.invoke(name, options));
  const appSessionToken = String(await loadToken() ?? '').trim();
  if (!appSessionToken) {
    throw new Error('로그인 정보를 다시 확인한 후 다시 시도해주세요.');
  }

  return invoke('store-identity', {
    body: payload,
    headers: { [STORE_IDENTITY_APP_SESSION_HEADER]: appSessionToken },
  });
}
