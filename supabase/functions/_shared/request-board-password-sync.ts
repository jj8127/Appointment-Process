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

const buildRequestBody = (
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

export async function syncRequestBoardPassword({
  syncUrl,
  syncToken,
  timeoutMs,
  logPrefix,
  phone,
  password,
  options,
}: SyncRequestParams) {
  if (!syncUrl || !syncToken) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-bridge-token': syncToken,
      },
      body: JSON.stringify(buildRequestBody(phone, password, options)),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[${logPrefix}] request_board sync failed: ${response.status} ${text.slice(0, 200)}`);
      return;
    }

    const json = await response.json().catch(() => ({}));
    if (!json?.success) {
      console.warn(`[${logPrefix}] request_board sync error: ${JSON.stringify(json).slice(0, 200)}`);
    }
  } catch (error) {
    console.warn(`[${logPrefix}] request_board sync error:`, error);
  } finally {
    clearTimeout(timeout);
  }
}
