import { getStoredAppSessionToken } from './request-board-api';
import { supabase } from './supabase';

export class MissingAdminActionSessionError extends Error {
  readonly code = 'missing_app_session';

  constructor() {
    super('관리자 기능을 사용하려면 다시 로그인해주세요.');
    this.name = 'MissingAdminActionSessionError';
  }
}

type AdminActionInvokeResult = {
  data: Record<string, unknown> | null;
  error: unknown;
};

type AdminActionClientDeps = {
  getStoredAppSessionToken: () => Promise<string | null>;
  invoke: (
    functionName: string,
    options: { body: Record<string, unknown> },
  ) => Promise<AdminActionInvokeResult>;
};

export async function invokeAdminActionWithDeps<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  actorPhone: string,
  action: string,
  payload: Record<string, unknown>,
  deps: AdminActionClientDeps,
): Promise<{ ok: true } & T> {
  const appSessionToken = String(await deps.getStoredAppSessionToken() ?? '').trim();
  if (!appSessionToken) {
    throw new MissingAdminActionSessionError();
  }

  const { data, error } = await deps.invoke('admin-action', {
    body: {
      adminPhone: actorPhone,
      appSessionToken,
      action,
      payload,
    },
  });

  if (error) {
    throw new Error(error instanceof Error ? error.message : '관리자 기능 호출에 실패했습니다.');
  }
  if (!data?.ok) {
    throw new Error(
      typeof data?.message === 'string'
        ? data.message
        : '처리 중 오류가 발생했습니다.',
    );
  }

  return data as { ok: true } & T;
}

export async function invokeAdminAction<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  actorPhone: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true } & T> {
  return invokeAdminActionWithDeps<T>(actorPhone, action, payload, {
    getStoredAppSessionToken,
    invoke: (functionName, options) => supabase.functions.invoke(functionName, options),
  });
}
