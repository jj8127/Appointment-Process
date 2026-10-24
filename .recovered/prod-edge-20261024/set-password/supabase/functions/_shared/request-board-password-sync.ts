import {
  reportEdgeDiagnostic,
  type EdgeDiagnosticInput,
  type EdgeDiagnosticWriter,
} from './edge-diagnostic.ts';
import {
  createRequestBoardPasswordSyncAssertion,
  createRequestBoardPasswordSyncV2Assertion,
} from './request-board-auth.ts';

export type RequestBoardPasswordSyncRole = 'fc' | 'designer' | 'manager';
export type RequestBoardPasswordSyncInitiatorRole = 'self' | 'admin' | 'manager' | 'system';
export type RequestBoardPasswordSyncReason = 'login' | 'self-reset' | 'admin-reset' | 'bootstrap';

export type RequestBoardPasswordSyncOptions = {
  role: RequestBoardPasswordSyncRole;
  initiatorRole?: RequestBoardPasswordSyncInitiatorRole;
  syncReason?: RequestBoardPasswordSyncReason;
  name?: string | null;
  companyName?: string | null;
  affiliation?: string | null;
};

export type RequestBoardPasswordSyncUpstream = Readonly<{
  accountId: string;
  credentialVersion: number;
}>;

type SyncRequestParams = {
  syncUrl: string;
  syncV2Url?: string;
  requireV2?: boolean;
  syncToken: string;
  timeoutMs: number;
  logPrefix: string;
  phone: string;
  password: string;
  authAssertion?: string | null;
  operationId?: string | null;
  upstream?: RequestBoardPasswordSyncUpstream | null;
  options: RequestBoardPasswordSyncOptions;
};

type PasswordSyncFetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};

type PasswordSyncFetchInit = {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

type PasswordSyncFetch = (
  input: string,
  init: PasswordSyncFetchInit,
) => Promise<PasswordSyncFetchResponse>;

type PasswordSyncAbortController = {
  signal: AbortSignal;
  abort: () => void;
};

type PasswordSyncDeps = {
  fetchImpl: PasswordSyncFetch;
  createAbortController: () => PasswordSyncAbortController;
  setTimeoutImpl: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeoutImpl: (handle: unknown) => void;
  diagnostic: EdgeDiagnosticWriter;
};

export const buildRequestBoardPasswordSyncBody = (
  phone: string,
  password: string,
  options: RequestBoardPasswordSyncOptions,
  authAssertion?: string | null,
  v2?: {
    upstream: RequestBoardPasswordSyncUpstream;
    operationId: string;
  } | null,
) => ({
  phone,
  // Manager identity is bridge-only; do not forward its canonical password
  // across the Request Board trust boundary.
  ...(options.role === 'manager' ? {} : { password }),
  role: options.role,
  ...(options.name ? { name: options.name } : {}),
  ...(options.companyName ? { companyName: options.companyName } : {}),
  ...(
    (options.role === 'fc' || options.role === 'manager') && options.affiliation
      ? { affiliation: options.affiliation }
      : {}
  ),
  ...(options.initiatorRole ? { initiatorRole: options.initiatorRole } : {}),
  ...(options.syncReason ? { syncReason: options.syncReason } : {}),
  ...(v2 ? {
    upstream_account_id: v2.upstream.accountId,
    upstream_credential_version: v2.upstream.credentialVersion,
    operation_id: v2.operationId,
  } : {}),
  ...(authAssertion ? { authAssertion } : {}),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildFcPasswordSyncUpstream(
  fcId: string | null | undefined,
  sessionVersion: number | null | undefined,
): RequestBoardPasswordSyncUpstream | null {
  const normalizedId = String(fcId ?? '').trim().toLowerCase();
  if (
    !UUID.test(normalizedId)
    || !Number.isSafeInteger(sessionVersion)
    || Number(sessionVersion) < 0
  ) return null;
  return { accountId: `fc:${normalizedId}`, credentialVersion: Number(sessionVersion) };
}

export async function syncRequestBoardPasswordWithDeps({
  syncUrl,
  syncV2Url,
  requireV2,
  syncToken,
  timeoutMs,
  phone,
  password,
  authAssertion,
  operationId,
  upstream,
  options,
}: SyncRequestParams, {
  fetchImpl,
  createAbortController,
  setTimeoutImpl,
  clearTimeoutImpl,
  diagnostic,
}: PasswordSyncDeps) {
  const emitDiagnostic = (input: EdgeDiagnosticInput) => {
    try {
      diagnostic(input);
    } catch {
      // A diagnostic sink must not alter this best-effort bridge operation.
    }
  };

  const useV2 = Boolean(upstream && syncV2Url);
  const targetUrl = useV2 ? String(syncV2Url) : syncUrl;
  if (requireV2 === true && !useV2) {
    emitDiagnostic({
      event: 'request_board.password_sync',
      reason: 'request_failed',
      retryable: false,
      errorClass: 'authentication',
    });
    return;
  }
  if (!targetUrl || !syncToken) return;
  if (useV2 && (!operationId || !UUID.test(operationId))) {
    emitDiagnostic({
      event: 'request_board.password_sync',
      reason: 'request_failed',
      retryable: false,
      errorClass: 'authentication',
    });
    return;
  }

  if (!authAssertion) {
    emitDiagnostic({
      event: 'request_board.password_sync',
      reason: 'request_failed',
      retryable: false,
      errorClass: 'authentication',
    });
    return;
  }

  const controller = createAbortController();
  const timeout = setTimeoutImpl(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-bridge-token': syncToken,
      },
      body: JSON.stringify(
        buildRequestBoardPasswordSyncBody(
          phone,
          password,
          options,
          authAssertion,
          useV2 && upstream && operationId ? { upstream, operationId } : null,
        ),
      ),
      signal: controller.signal,
    });

    if (!response.ok) {
      emitDiagnostic({
        event: 'request_board.password_sync',
        reason: 'upstream_rejected',
        status: response.status,
        retryable: response.status >= 500,
        errorClass: 'upstream',
      });
      return;
    }

    const json = await response.json().catch(() => ({}));
    if (!(typeof json === 'object' && json !== null && 'success' in json && json.success === true)) {
      emitDiagnostic({
        event: 'request_board.password_sync',
        reason: 'invalid_response',
        errorClass: 'upstream',
      });
    }
  } catch {
    const timedOut = controller.signal.aborted === true;
    emitDiagnostic({
      event: 'request_board.password_sync',
      reason: timedOut ? 'timeout' : 'request_failed',
      retryable: true,
      errorClass: timedOut ? 'timeout' : 'network',
    });
  } finally {
    clearTimeoutImpl(timeout);
  }
}

export async function syncRequestBoardPassword(params: SyncRequestParams) {
  const useV2 = Boolean(params.upstream && params.syncV2Url);
  const operationId = useV2 ? crypto.randomUUID() : null;
  const authAssertion = useV2 && params.upstream && operationId
    ? await createRequestBoardPasswordSyncV2Assertion(
        params.phone,
        params.options.role,
        params.upstream.accountId,
        params.upstream.credentialVersion,
        operationId,
      )
    : params.requireV2 === true
      ? null
      : await createRequestBoardPasswordSyncAssertion(
          params.phone,
          params.options.role,
        );
  return syncRequestBoardPasswordWithDeps({
    ...params,
    authAssertion,
    operationId,
  }, {
    fetchImpl: (input, init) => fetch(input, init),
    createAbortController: () => new AbortController(),
    setTimeoutImpl: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
    clearTimeoutImpl: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    diagnostic: reportEdgeDiagnostic,
  });
}
