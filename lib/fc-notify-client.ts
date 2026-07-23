import { getStoredAppSessionToken } from './request-board-api';
import { supabase } from './supabase';
import {
  classifyFcNotifyDeliveryFromInvoke,
  type FcNotifyDeliveryResult,
} from './fc-notify-delivery-result';

export {
  classifyFcNotifyDeliveryFromInvoke,
  classifyFcNotifyDeliveryResult,
  type FcNotifyDeliveryResult,
  type FcNotifyTransportResult,
} from './fc-notify-delivery-result';

export const FC_NOTIFY_FUNCTION_NAME = 'fc-notify';
export const FC_NOTIFY_APP_SESSION_HEADER = 'x-app-session-token';
export const FC_NOTIFY_PUBLIC_ACTION = 'latest_notice';

type FcNotifyBody = {
  type: string;
};

type FcNotifyOpenBody = FcNotifyBody & {
  [key: string]: unknown;
};

type FcNotifyDefaultResponse = {
  ok?: boolean;
  logged?: boolean;
  message?: string;
  notifications?: Record<string, unknown>[];
  sent?: number;
};

export type FcNotifyInvokeOptions<TBody extends FcNotifyBody> = {
  body: TBody;
  headers?: Record<string, string>;
};

export class FcNotifySessionError extends Error {
  readonly code = 'missing_app_session';
  readonly needsRelogin = true;

  constructor() {
    super('알림 기능을 사용하려면 다시 로그인해주세요.');
    this.name = 'FcNotifySessionError';
  }
}

export function buildFcNotifyInvokeOptions<TBody extends FcNotifyBody>(
  body: TBody,
  appSessionToken: string | null | undefined,
): FcNotifyInvokeOptions<TBody> {
  if (body.type === FC_NOTIFY_PUBLIC_ACTION) {
    return { body };
  }

  const token = String(appSessionToken ?? '').trim();
  if (!token) {
    throw new FcNotifySessionError();
  }

  return {
    body,
    headers: {
      [FC_NOTIFY_APP_SESSION_HEADER]: token,
    },
  };
}

export async function invokeFcNotifyWithDeps<
  TResult,
  TBody extends FcNotifyBody,
>(
  body: TBody,
  deps: {
    getStoredAppSessionToken: () => Promise<string | null>;
    invoke: (
      functionName: typeof FC_NOTIFY_FUNCTION_NAME,
      options: FcNotifyInvokeOptions<TBody>,
    ) => Promise<TResult>;
  },
): Promise<TResult> {
  const appSessionToken = body.type === FC_NOTIFY_PUBLIC_ACTION
    ? null
    : await deps.getStoredAppSessionToken();
  const options = buildFcNotifyInvokeOptions(body, appSessionToken);
  return deps.invoke(FC_NOTIFY_FUNCTION_NAME, options);
}

export function invokeFcNotify<
  TResponse = FcNotifyDefaultResponse,
  TBody extends FcNotifyBody = FcNotifyOpenBody,
>(body: TBody) {
  return invokeFcNotifyWithDeps(body, {
    getStoredAppSessionToken,
    invoke: (_functionName, options) =>
      supabase.functions.invoke<TResponse>(FC_NOTIFY_FUNCTION_NAME, options),
  });
}

export async function invokeFcNotifyForDelivery<TBody extends FcNotifyBody>(
  body: TBody,
): Promise<FcNotifyDeliveryResult> {
  return classifyFcNotifyDeliveryFromInvoke(
    () => invokeFcNotify<unknown, TBody>(body),
  );
}
