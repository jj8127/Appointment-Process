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

type SyncRequestParams = {
  syncUrl: string;
  syncToken: string;
  timeoutMs: number;
  logPrefix: string;
  phone: string;
  password: string;
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
  warn: (...args: unknown[]) => void;
};

export const buildRequestBoardPasswordSyncBody = (
  phone: string,
  password: string,
  options: RequestBoardPasswordSyncOptions,
) => ({
  phone,
  password,
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
});

export async function syncRequestBoardPasswordWithDeps({
  syncUrl,
  syncToken,
  timeoutMs,
  logPrefix,
  phone,
  password,
  options,
}: SyncRequestParams, {
  fetchImpl,
  createAbortController,
  setTimeoutImpl,
  clearTimeoutImpl,
  warn,
}: PasswordSyncDeps) {
  if (!syncUrl || !syncToken) return;

  const controller = createAbortController();
  const timeout = setTimeoutImpl(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-bridge-token': syncToken,
      },
      body: JSON.stringify(buildRequestBoardPasswordSyncBody(phone, password, options)),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      warn(`[${logPrefix}] request_board sync failed: ${response.status} ${text.slice(0, 200)}`);
      return;
    }

    const json = await response.json().catch(() => ({}));
    if (!(typeof json === 'object' && json !== null && 'success' in json && json.success === true)) {
      warn(`[${logPrefix}] request_board sync error: ${JSON.stringify(json).slice(0, 200)}`);
    }
  } catch (error) {
    warn(`[${logPrefix}] request_board sync error:`, error);
  } finally {
    clearTimeoutImpl(timeout);
  }
}

export async function syncRequestBoardPassword(params: SyncRequestParams) {
  return syncRequestBoardPasswordWithDeps(params, {
    fetchImpl: (input, init) => fetch(input, init),
    createAbortController: () => new AbortController(),
    setTimeoutImpl: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
    clearTimeoutImpl: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    warn: (...args) => console.warn(...args),
  });
}
