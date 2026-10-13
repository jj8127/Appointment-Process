/**
 * request_board API client for fc-onboarding-app.
 * Handles authentication, conversation listing, message fetch/send.
 */
import { logger } from './logger';
import { parseOptionalCursorPaginationMetadata } from './list-pagination-contract';
import { isPlainRecord } from './notification-target';
import { parsePresenceSnapshotList } from './presence-read-response';
import { getRequestBoardApiBaseUrl } from './request-board-url';
import { safeStorage } from './safe-storage';
import { sensitiveTokenStorage } from './secure-token-storage';
import { supabase } from './supabase';

const BASE_URL = getRequestBoardApiBaseUrl();
const REQUEST_BOARD_FETCH_TIMEOUT_MS = 8000;
const REQUEST_BOARD_NOTIFICATION_WRITE_TIMEOUT_MS = 30000;
const REQUEST_BOARD_MESSAGE_CONTEXT_MAX_ITEMS = 41;

export const REQUEST_BOARD_MESSAGE_CONTEXT_GUIDANCE =
  '메시지 위치를 확인할 수 없습니다. 대화방에서 다시 시도해 주세요.';

const STORAGE_KEY_TOKEN = 'rb_jwt_token';
const STORAGE_KEY_USER = 'rb_user';
const STORAGE_KEY_BRIDGE_TOKEN = 'rb_bridge_token';
const STORAGE_KEY_APP_SESSION_TOKEN = 'rb_app_session_token';
const REQUEST_BOARD_APP_RELOGIN_ERROR_CODES = new Set([
  'missing_session_token',
  'invalid_session_token',
  'invalid_bridge_token',
  'missing_app_session',
  'invalid_app_session',
  'expired_app_session',
  'expired_bridge_token',
]);

/* ─── Types ─── */

export type RbUser = {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: 'fc' | 'designer';
  affiliation?: string | null;
};

export type RbConversation = {
  id: number;
  primaryConversationId: number;
  conversationIds: number[];
  requestIds: number[];
  participantUserId: number | null;
  participantRole: 'fc' | 'designer';
  status: string;
  request: { id: number; customer_name: string; status: string } | null;
  fc: { id: number; name: string; phone: string | null; affiliation?: string | null } | null;
  designer: {
    id: number;
    company_name: string | null;
    users: { id: number; name: string; phone: string | null } | null;
  } | null;
  lastMessage: {
    id: number;
    message: string;
    sender_id: number;
    is_read: boolean;
    created_at: string;
  } | null;
  unreadCount: number;
};

export type RbAttachment = {
  id: number;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  created_at: string;
};

export type RbAttachmentMeta = {
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;
};

export type RbMessage = {
  id: number;
  request_designer_id: number;
  sender_id: number;
  message: string;
  is_read: boolean;
  created_at: string;
  deleted_at?: string | null;
  sender?: { id: number; name: string; role: string; affiliation?: string | null };
  message_attachments?: RbAttachment[];
};

export type RbDmConversation = {
  id: number;
  type: 'direct';
  participant: {
    id: number;
    name: string;
    role: string;
    phone: string | null;
    company_name?: string | null;
    affiliation?: string | null;
  } | null;
  lastMessage: {
    id: number;
    message: string;
    sender_id: number;
    is_read: boolean;
    created_at: string;
  } | null;
  unreadCount: number;
  created_at: string;
  updated_at: string;
};

export type RbPresenceSnapshot = {
  phone: string;
  garam_in_at: string | null;
  garam_link_at: string | null;
  last_seen_at: string | null;
  is_online: boolean;
  updated_at: string | null;
};

export type RbDmMessage = {
  id: number;
  direct_conversation_id: number;
  sender_id: number;
  message: string;
  is_read: boolean;
  created_at: string;
  deleted_at?: string | null;
  sender?: { id: number; name: string; role: string; affiliation?: string | null };
  direct_message_attachments?: RbAttachment[];
};

export type RbMessageContextPage<T extends RbMessage | RbDmMessage> = {
  messages: T[];
  hasBefore: boolean;
  hasAfter: boolean;
  anchorId: number;
  anchorFound: true;
};

export type RbMessageContextResult<T extends RbMessage | RbDmMessage> =
  | { success: true; data: RbMessageContextPage<T> }
  | { success: false; error: string; retryable: boolean };

export type RbMessengerRoomRef =
  | { type: 'request'; requestDesignerId: number }
  | { type: 'direct'; conversationId: number };

export type RbMessengerRoomPreference = {
  room: RbMessengerRoomRef;
  roomKey: string;
  displayLabel?: string;
  muted: boolean;
  pinnedAt?: string | null;
  leftAt?: string | null;
};

export type RbMessengerRoomPreferencesResult =
  | { success: true; data: { rooms: RbMessengerRoomPreference[] }; supported?: boolean }
  | { success: false; error: string; retryable: boolean };

export type RbMessengerRoomPreferenceResult =
  | { success: true; data: RbMessengerRoomPreference }
  | { success: false; error: string; retryable: boolean };

/* ─── Token Management ─── */

let cachedToken: string | null = null;
let cachedUser: RbUser | null = null;
let cachedBridgeToken: string | null = null;
let cachedAppSessionToken: string | null = null;
let authRevision = 0;
let bridgeRevision = 0;
let appSessionRevision = 0;
let authStorageWrite: Promise<void> = Promise.resolve();

/** Capture the app account before awaiting storage or session recovery. */
export function captureAppSessionOwner(): () => boolean {
  const revision = appSessionRevision;
  return () => revision === appSessionRevision;
}

let bridgeRefreshPromise: {
  authRevision: number;
  bridgeRevision: number;
  appSessionRevision: number;
  promise: Promise<RbBridgeRefreshResult>;
} | null = null;

const isAbortError = (err: unknown): err is Error =>
  err instanceof Error && err.name === 'AbortError';

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = REQUEST_BOARD_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getStoredToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    await authStorageWrite;
    if (cachedToken) return cachedToken;
    const revision = authRevision;
    const token = await sensitiveTokenStorage.getItem(STORAGE_KEY_TOKEN);
    if (revision === authRevision) cachedToken = token;
    return cachedToken;
  } catch {
    return null;
  }
}

export async function getStoredBridgeToken(): Promise<string | null> {
  if (cachedBridgeToken) return cachedBridgeToken;
  try {
    await authStorageWrite;
    if (cachedBridgeToken) return cachedBridgeToken;
    const revision = bridgeRevision;
    const token = await sensitiveTokenStorage.getItem(STORAGE_KEY_BRIDGE_TOKEN);
    if (revision === bridgeRevision) cachedBridgeToken = token;
    return cachedBridgeToken;
  } catch {
    return null;
  }
}

export async function getStoredAppSessionToken(): Promise<string | null> {
  if (cachedAppSessionToken) return cachedAppSessionToken;
  try {
    await authStorageWrite;
    if (cachedAppSessionToken) return cachedAppSessionToken;
    const revision = appSessionRevision;
    const token = await sensitiveTokenStorage.getItem(STORAGE_KEY_APP_SESSION_TOKEN);
    if (revision === appSessionRevision) cachedAppSessionToken = token;
    return cachedAppSessionToken;
  } catch {
    return null;
  }
}

export async function getStoredUser(): Promise<RbUser | null> {
  if (cachedUser) return cachedUser;
  try {
    await authStorageWrite;
    if (cachedUser) return cachedUser;
    const revision = authRevision;
    const raw = await safeStorage.getItem(STORAGE_KEY_USER);
    if (raw && revision === authRevision) {
      cachedUser = JSON.parse(raw);
      return cachedUser;
    }
  } catch { /* ignore */ }
  return null;
}

async function storeAuth(token: string, user: RbUser) {
  authRevision += 1;
  cachedToken = token;
  cachedUser = user;
  await persistAuthChange(async () => {
    await sensitiveTokenStorage.setItem(STORAGE_KEY_TOKEN, token);
    await safeStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
  });
}

export function persistAuthChange(write: () => Promise<void>): Promise<void> {
  const pending = authStorageWrite.then(write, write);
  authStorageWrite = pending.catch(() => {});
  return pending;
}

export async function setBridgeToken(token: string | null) {
  bridgeRevision += 1;
  cachedBridgeToken = token;
  await persistAuthChange(async () => {
    if (token) {
      await sensitiveTokenStorage.setItem(STORAGE_KEY_BRIDGE_TOKEN, token);
    } else {
      await sensitiveTokenStorage.removeItem(STORAGE_KEY_BRIDGE_TOKEN);
    }
  });
}

export async function setAppSessionToken(token: string | null) {
  appSessionRevision += 1;
  cachedAppSessionToken = token;
  await persistAuthChange(async () => {
    if (token) {
      await sensitiveTokenStorage.setItem(STORAGE_KEY_APP_SESSION_TOKEN, token);
    } else {
      await sensitiveTokenStorage.removeItem(STORAGE_KEY_APP_SESSION_TOKEN);
    }
  });
}

export async function clearAuth() {
  authRevision += 1;
  cachedToken = null;
  cachedUser = null;
  await persistAuthChange(async () => {
    await sensitiveTokenStorage.removeItem(STORAGE_KEY_TOKEN);
    await safeStorage.removeItem(STORAGE_KEY_USER);
  });
}

export async function clearRequestBoardState(options?: { clearAppSession?: boolean }) {
  // Advance every owner before yielding. The existing queue keeps storage writes
  // ordered, so a login started during cleanup always persists after this clear.
  await Promise.all([
    clearAuth(),
    setBridgeToken(null),
    ...(options?.clearAppSession ? [setAppSessionToken(null)] : []),
  ]);
}

type RbBridgeRefreshResult = {
  success: boolean;
  bridgeToken?: string;
  requestBoardRole?: 'fc' | 'designer' | null;
  error?: string;
  errorCode?: string;
  status?: number;
  retryable?: boolean;
};

const isRetryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

function bridgeRefreshFailure(
  errorCode = 'bridge_refresh_failed',
  message?: string,
  status?: number,
): RbBridgeRefreshResult {
  const needsRelogin = REQUEST_BOARD_APP_RELOGIN_ERROR_CODES.has(errorCode);
  const accessDenied = ['request_board_not_applicable', 'inactive_account', 'not_completed', 'not_found']
    .includes(errorCode);
  const failureStatus = status ?? (needsRelogin ? 401 : accessDenied ? 403 : 503);
  const retryable = isRetryableStatus(failureStatus);
  return {
    success: false,
    error: retryable
      ? '가람Link 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.'
      : message ?? '가람Link 세션 재동기화에 실패했습니다.',
    errorCode,
    status: failureStatus,
    retryable,
  };
}

async function refreshBridgeTokenFromAppSession(): Promise<RbBridgeRefreshResult> {
  const owner = { authRevision, bridgeRevision, appSessionRevision };
  const isCurrentOwner = () => owner.authRevision === authRevision
    && owner.bridgeRevision === bridgeRevision && owner.appSessionRevision === appSessionRevision;
  if (bridgeRefreshPromise && bridgeRefreshPromise.authRevision === owner.authRevision
    && bridgeRefreshPromise.bridgeRevision === owner.bridgeRevision
    && bridgeRefreshPromise.appSessionRevision === owner.appSessionRevision) {
    return bridgeRefreshPromise.promise;
  }

  const promise = (async () => {
    const sessionToken = await getStoredAppSessionToken();
    if (!isCurrentOwner()) return sessionChangedResult();
    if (!sessionToken) {
      return bridgeRefreshFailure('missing_session_token', '앱 세션 토큰이 없습니다.', 401);
    }

    try {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        code?: string;
        message?: string;
        requestBoardBridgeToken?: string;
        requestBoardRole?: 'fc' | 'designer' | null;
      }>('sync-request-board-session', {
        body: { sessionToken },
      });
      if (!isCurrentOwner()) return sessionChangedResult();

      if (error) {
        // FunctionsHttpError carries the canonical failure in its response body.
        const context = (error as { context?: Response }).context;
        if (context && typeof context.json === 'function') {
          const failure = await context.json().catch(() => null);
          return bridgeRefreshFailure(
            typeof failure?.code === 'string' ? failure.code : 'bridge_refresh_failed',
            typeof failure?.message === 'string' ? failure.message : undefined,
            context.status,
          );
        }
        return bridgeRefreshFailure('network_error');
      }

      if (!data?.ok || !data.requestBoardBridgeToken) {
        return bridgeRefreshFailure(data?.code, data?.message);
      }

      await setBridgeToken(data.requestBoardBridgeToken);
      if (owner.authRevision !== authRevision || owner.appSessionRevision !== appSessionRevision
        || owner.bridgeRevision + 1 !== bridgeRevision) return sessionChangedResult();
      return {
        success: true,
        bridgeToken: data.requestBoardBridgeToken,
        requestBoardRole:
          data.requestBoardRole === 'fc' || data.requestBoardRole === 'designer'
            ? data.requestBoardRole
            : null,
      };
    } catch {
      logger.warn('[rb-api] app session bridge refresh error');
      return bridgeRefreshFailure('network_error');
    }
  })();
  const flight = { ...owner, promise };
  bridgeRefreshPromise = flight;

  try {
    return await promise;
  } finally {
    if (bridgeRefreshPromise === flight) bridgeRefreshPromise = null;
  }
}

type RbBridgeLoginResult = {
  success: boolean;
  user?: RbUser;
  error?: string;
  errorCode?: string;
  status?: number;
  retryable?: boolean;
};

// A changed session ends this request so create callers cannot replay it under a new actor.
const sessionChangedResult = () => ({
  success: false as const,
  error: '로그인 정보가 변경되었습니다. 다시 시도해주세요.',
  errorCode: 'session_changed',
  code: 'session_changed',
  status: 409,
  retryable: false,
});

async function bridgeLogin(
  bridgeToken?: string,
  allowRefresh = true,
  expectedAuthRevision = authRevision,
  expectedAppSessionRevision = appSessionRevision,
): Promise<RbBridgeLoginResult> {
  const isCurrentOwner = () => expectedAuthRevision === authRevision
    && expectedAppSessionRevision === appSessionRevision;
  if (!isCurrentOwner()) return sessionChangedResult();
  let tokenFromStorage = bridgeToken ?? (await getStoredBridgeToken());
  if (!isCurrentOwner()) return sessionChangedResult();
  if (!tokenFromStorage) {
    const refreshed = await refreshBridgeTokenFromAppSession();
    if (!isCurrentOwner()) return sessionChangedResult();
    if (refreshed.success) {
      tokenFromStorage = refreshed.bridgeToken ?? (await getStoredBridgeToken());
    } else {
      return {
        success: false,
        error: refreshed.error ?? '브릿지 토큰이 없습니다.',
        errorCode: refreshed.errorCode ?? 'missing_bridge_token',
        status: refreshed.status,
        retryable: refreshed.retryable,
      };
    }
  }

  if (!tokenFromStorage) {
    return { success: false, error: '브릿지 토큰이 없습니다.', errorCode: 'missing_bridge_token' };
  }
  if (!isCurrentOwner()) return sessionChangedResult();

  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/auth/bridge-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bridgeToken: tokenFromStorage }),
    });
    const json = await res.json().catch(() => null);
    if (!isCurrentOwner()) return sessionChangedResult();

    if (isRetryableStatus(res.status)) {
      return bridgeRefreshFailure(typeof json?.code === 'string' ? json.code : 'bridge_login_failed', undefined, res.status);
    }
    if (res.status === 403 && json?.code !== 'SESSION_INVALID') {
      return bridgeRefreshFailure(
        typeof json?.code === 'string' ? json.code : 'bridge_access_denied',
        json?.error ?? json?.message ?? '브릿지 로그인 실패',
        403,
      );
    }

    if (!res.ok || !json?.success || !json.data?.token) {
      if (allowRefresh && !bridgeToken) {
        const refreshed = await refreshBridgeTokenFromAppSession();
        if (!isCurrentOwner()) return sessionChangedResult();
        if (refreshed.success && refreshed.bridgeToken && refreshed.bridgeToken !== tokenFromStorage) {
          return bridgeLogin(refreshed.bridgeToken, false, expectedAuthRevision, expectedAppSessionRevision);
        }
        if (!refreshed.success) {
          return {
            success: false,
            error: refreshed.error ?? json?.error ?? json?.message ?? '브릿지 로그인 실패',
            errorCode: refreshed.errorCode ?? 'bridge_login_failed',
            status: refreshed.status,
            retryable: refreshed.retryable,
          };
        }
      }

      const hasAppSessionToken = Boolean(await getStoredAppSessionToken());
      if (!isCurrentOwner()) return sessionChangedResult();
      return {
        success: false,
        error: json?.error ?? json?.message ?? '브릿지 로그인 실패',
        errorCode: typeof json?.code === 'string'
          ? json.code
          : res.status === 403 ? 'bridge_access_denied'
            : hasAppSessionToken ? 'bridge_login_failed' : 'invalid_bridge_token',
        status: res.status === 403 ? 403 : 401,
        retryable: false,
      };
    }

    const user: RbUser = {
      id: json.data.user.id,
      name: json.data.user.name,
      email: json.data.user.email,
      phone: json.data.user.phone,
      role: json.data.user.role,
      affiliation: json.data.user.affiliation ?? undefined,
    };
    if (!isCurrentOwner()) return sessionChangedResult();
    const storedAuthRevision = authRevision + 1;
    await storeAuth(json.data.token, user);
    if (storedAuthRevision !== authRevision || expectedAppSessionRevision !== appSessionRevision) return sessionChangedResult();
    return { success: true, user };
  } catch (err) {
    if (!isCurrentOwner()) return sessionChangedResult();
    logger.warn('[rb-api] bridge login error');
    return {
      success: false,
      error: isAbortError(err)
        ? '가람Link 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.'
        : '서버에 연결할 수 없습니다.',
      errorCode: 'network_error',
      status: 503,
      retryable: true,
    };
  }
}

export async function rbBridgeLogin(bridgeToken?: string) {
  return bridgeLogin(bridgeToken);
}

/* ─── HTTP helpers ─── */

type RbFetchOptions = RequestInit & {
  timeoutMs?: number;
  diagnosticPath?: string;
  suppressNotFoundWarning?: boolean;
  multipart?: { buildBody: () => FormData; label: string };
};

type RbFetchResult<T> = RbApiResult<T> & { authRevision?: number };

export type RbNotificationDelivery = {
  confirmed: boolean;
  sent: number;
  attempted: number;
  rejected: number;
};

export type RbApiResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
  status?: number;
  retryable?: boolean;
  warning?: 'notification_delivery_incomplete';
  notificationDelivery?: RbNotificationDelivery;
  next_cursor?: string | null;
  has_more?: boolean;
  limit?: number;
  pagination?: unknown;
};

export type RbListPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
};

type RbAuthRecovery =
  | { retry: true; authRevision: number; appSessionRevision: number }
  | { retry: false; result: RbApiResult<never> };

async function recoverRequestBoardAuth(
  expectedAuthRevision: number,
  allowRetry: boolean,
  expectedAppSessionRevision = appSessionRevision,
): Promise<RbAuthRecovery> {
  if (expectedAuthRevision !== authRevision || expectedAppSessionRevision !== appSessionRevision) {
    return { retry: false, result: sessionChangedResult() };
  }
  if (allowRetry) {
    const relogin = await bridgeLogin(undefined, true, expectedAuthRevision, expectedAppSessionRevision);
    if (relogin.success && expectedAuthRevision + 1 === authRevision && expectedAppSessionRevision === appSessionRevision) {
      return { retry: true, authRevision, appSessionRevision };
    }
    if (expectedAuthRevision !== authRevision || expectedAppSessionRevision !== appSessionRevision) {
      return { retry: false, result: sessionChangedResult() };
    }
    if (relogin.retryable || (relogin.status !== 401
      && !REQUEST_BOARD_APP_RELOGIN_ERROR_CODES.has(relogin.errorCode ?? ''))) {
      return {
        retry: false,
        result: {
          success: false,
          error: relogin.error,
          code: relogin.errorCode,
          status: relogin.status,
          retryable: relogin.retryable,
        },
      };
    }
  }
  await clearAuth();
  if (expectedAuthRevision + 1 !== authRevision || expectedAppSessionRevision !== appSessionRevision) {
    return { retry: false, result: sessionChangedResult() };
  }
  return {
    retry: false,
    result: {
      success: false,
      status: 401,
      retryable: false,
      error: '인증이 만료되었습니다. 앱에서 다시 로그인해주세요.',
    },
  };
}

export type RbListReadResource =
  | 'conversations'
  | 'direct-conversations'
  | 'designers'
  | 'direct-message-users'
  | 'messages'
  | 'direct-messages'
  | 'products'
  | 'customers'
  | 'fc-codes'
  | 'company-names'
  | 'requests';

export class RbListReadError extends Error {
  readonly resource: RbListReadResource;
  readonly status?: number;
  readonly retryable: boolean;
  readonly code?: string;

  constructor(
    resource: RbListReadResource,
    result: Pick<RbApiResult, 'retryable' | 'code' | 'status'>,
  ) {
    super(result.status === 401
      ? '인증이 만료되었습니다. 앱에서 다시 로그인해주세요.'
      : result.status === 403
        ? '접근 권한이 없습니다.'
        : '가람Link 데이터를 불러오지 못했습니다. 다시 시도해주세요.');
    this.name = 'RbListReadError';
    this.resource = resource;
    this.status = result.status;
    this.retryable = Boolean(result.retryable);
    if (result.code) this.code = result.code;
  }
}

export function hasIncompleteRequestBoardNotification(
  result: Pick<RbApiResult, 'warning' | 'notificationDelivery'>,
): boolean {
  return result.warning === 'notification_delivery_incomplete'
    || result.notificationDelivery?.confirmed === false;
}

async function rbFetch<T>(
  path: string,
  options: RbFetchOptions = {},
  allowRetry = true,
): Promise<RbFetchResult<T>> {
  const {
    timeoutMs = REQUEST_BOARD_FETCH_TIMEOUT_MS,
    diagnosticPath,
    suppressNotFoundWarning = false,
    multipart,
    ...requestOptions
  } = options;
  const requestAuthRevision = authRevision;
  const requestAppSessionRevision = appSessionRevision;
  const isCurrentRequest = () => requestAuthRevision === authRevision
    && requestAppSessionRevision === appSessionRevision;
  const token = await getStoredToken();
  if (!isCurrentRequest()) return sessionChangedResult();
  const headers: Record<string, string> = {
    ...(!multipart ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(requestOptions.headers as Record<string, string> ?? {}),
  };

  const url = `${BASE_URL}${path}`;
  const safeDiagnosticPath = diagnosticPath ?? path;

  try {
    const res = await fetchWithTimeout(url, {
      ...requestOptions,
      headers,
      ...(multipart ? { body: multipart.buildBody() } : {}),
    }, timeoutMs);
    if (!isCurrentRequest()) return sessionChangedResult();

    const forbidden = res.status === 403 ? await res.json().catch(() => null) : null;
    if (!isCurrentRequest()) return sessionChangedResult();
    if (res.status === 401 || (res.status === 403 && forbidden?.code === 'SESSION_INVALID')) {
      logger.warn(`[rb-api] invalid session: ${safeDiagnosticPath}`);
      const recovery = await recoverRequestBoardAuth(
        requestAuthRevision,
        allowRetry && path !== '/api/auth/bridge-login',
        requestAppSessionRevision,
      );
      if (recovery.retry && (recovery.authRevision !== authRevision || recovery.appSessionRevision !== appSessionRevision)) return sessionChangedResult();
      return recovery.retry ? rbFetch<T>(path, options, false) : recovery.result;
    }

    if (res.status === 403) {
      logger.warn(`[rb-api] 403 Forbidden: ${safeDiagnosticPath}`);
      return {
        success: false,
        status: 403,
        retryable: false,
        code: typeof forbidden?.code === 'string' ? forbidden.code : undefined,
        error: typeof forbidden?.error === 'string' ? forbidden.error
          : multipart && typeof forbidden?.message === 'string' ? forbidden.message : '접근 권한이 없습니다.',
      };
    }

    if (!res.ok) {
      if (!(suppressNotFoundWarning && res.status === 404)) {
        logger.warn(`[rb-api] HTTP ${res.status}: ${safeDiagnosticPath}`);
      }
      const retryable = isRetryableStatus(res.status);
      const fallbackError = multipart ? `${multipart.label} 실패 (${res.status})` : `서버 오류 (${res.status})`;
      try {
        const errJson = await res.json();
        if (!isCurrentRequest()) return sessionChangedResult();
        return {
          success: false,
          error: multipart
            ? (typeof errJson?.error === 'string' && errJson.error.trim())
              || (typeof errJson?.message === 'string' && errJson.message.trim()) || fallbackError
            : errJson.error ?? fallbackError,
          code: typeof errJson.code === 'string' ? errJson.code : undefined,
          retryable,
          status: res.status,
        };
      } catch {
        if (!isCurrentRequest()) return sessionChangedResult();
        return {
          success: false,
          error: fallbackError,
          retryable,
          status: res.status,
        };
      }
    }

    const json = await res.json();
    if (!isCurrentRequest()) return sessionChangedResult();

    if (!json.success) {
      logger.warn(`[rb-api] API error: ${safeDiagnosticPath}`, json.error);
    }

    return path === '/api/auth/me' ? { ...json, authRevision: requestAuthRevision } : json;
  } catch (err) {
    if (!isCurrentRequest()) return sessionChangedResult();
    logger.warn(`[rb-api] network error: ${safeDiagnosticPath}`, err);
    return {
      success: false,
      retryable: true,
      error: multipart ? `${multipart.label}에 실패했습니다.` : isAbortError(err)
        ? '가람Link 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.'
        : '서버에 연결할 수 없습니다.',
    };
  }
}

/* ─── Auth ─── */

export async function rbCheckAuth(): Promise<{
  authenticated: boolean;
  user?: RbUser;
  error?: string;
  needsRelogin?: boolean;
  status?: number;
  retryable?: boolean;
}> {
  const expectedAuthRevision = authRevision;
  const ownsAppSession = captureAppSessionOwner();
  const sessionChanged = { authenticated: false, ...sessionChangedResult(), needsRelogin: false };
  const token = await getStoredToken();
  if (expectedAuthRevision !== authRevision || !ownsAppSession()) return sessionChanged;
  if (!token) {
    const bridged = await bridgeLogin(undefined, true, expectedAuthRevision);
    if (!ownsAppSession()
      || (bridged.success ? expectedAuthRevision + 1 : expectedAuthRevision) !== authRevision) return sessionChanged;
    if (bridged.success && bridged.user) {
      return { authenticated: true, user: bridged.user };
    }
    return {
      authenticated: false,
      error: bridged.error,
      status: bridged.status,
      retryable: bridged.retryable,
      needsRelogin: !bridged.retryable && (bridged.status === 401
        || (bridged.status === 403 && bridged.errorCode === 'SESSION_INVALID')),
    };
  }

  const res = await rbFetch<RbUser>('/api/auth/me');
  if (!ownsAppSession()) return sessionChanged;
  if (res.success && res.data) {
    if (res.authRevision !== authRevision) {
      return sessionChanged;
    }
    const hasRecoveryToken = Boolean((await getStoredBridgeToken()) || (await getStoredAppSessionToken()));
    if (res.authRevision !== authRevision || !ownsAppSession()) {
      return sessionChanged;
    }
    cachedUser = res.data;
    if (!hasRecoveryToken) {
      return {
        authenticated: false,
        user: res.data,
        error: '가람Link 연동 세션을 업그레이드하려면 다시 로그인해주세요.',
        needsRelogin: true,
      };
    }
    return { authenticated: true, user: res.data };
  }
  return {
    authenticated: false,
    error: res.error,
    needsRelogin: res.status === 401,
    status: res.status,
    retryable: res.retryable,
  };
}

/* ─── Conversations (Request-based) ─── */

export async function rbGetConversationsOrThrow(): Promise<RbConversation[]> {
  return rbReadAllPagesOrThrow(
    '/api/messages/conversations',
    'conversations',
    'conversations',
    isRbConversation,
    (item) => String(item.primaryConversationId),
  );
}

export async function rbGetConversationsPageOrThrow(
  cursor?: string | null,
  limit = 30,
): Promise<RbListPage<RbConversation>> {
  return rbReadListPageOrThrow(
    '/api/messages/conversations',
    'conversations',
    'conversations',
    isRbConversation,
    (item) => String(item.primaryConversationId),
    cursor,
    limit,
  );
}

/* ─── Messages ─── */

type RbMessageContextKind = 'request' | 'direct';

const hasExactKeys = (
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean => {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actualKeys.length === expected.length
    && actualKeys.every((key, index) => key === expected[index]);
};

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isValidServerTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isValidContextSender = (value: unknown, senderId: number): boolean => {
  if (!isPlainRecord(value)) return false;
  return value.id === senderId
    && isPositiveSafeInteger(value.id)
    && typeof value.name === 'string'
    && value.name.length > 0
    && typeof value.role === 'string'
    && value.role.length > 0
    && (
      value.affiliation === undefined
      || value.affiliation === null
      || typeof value.affiliation === 'string'
    );
};

const isValidContextAttachment = (
  value: unknown,
  kind: RbMessageContextKind,
  messageId: number,
): boolean => {
  if (!isPlainRecord(value)) return false;
  const relationField = kind === 'request' ? 'message_id' : 'direct_message_id';
  return isPositiveSafeInteger(value.id)
    && value[relationField] === messageId
    && typeof value.file_name === 'string'
    && value.file_name.length > 0
    && typeof value.file_type === 'string'
    && value.file_type.length > 0
    && typeof value.file_size === 'number'
    && Number.isSafeInteger(value.file_size)
    && value.file_size >= 0
    && typeof value.file_url === 'string'
    && value.file_url.length > 0
    && isValidServerTimestamp(value.created_at);
};

const isValidMessageListItem = (
  value: unknown,
  kind: RbMessageContextKind,
  allowedRoomIds?: ReadonlySet<number>,
): value is RbMessage | RbDmMessage => {
  if (!isPlainRecord(value)) return false;
  const roomField = kind === 'request' ? 'request_designer_id' : 'direct_conversation_id';
  const attachmentsField = kind === 'request'
    ? 'message_attachments'
    : 'direct_message_attachments';
  if (
    !isPositiveSafeInteger(value.id)
    || !isPositiveSafeInteger(value[roomField])
    || (allowedRoomIds && !allowedRoomIds.has(value[roomField] as number))
    || !isPositiveSafeInteger(value.sender_id)
    || typeof value.message !== 'string'
    || typeof value.is_read !== 'boolean'
    || !isValidServerTimestamp(value.created_at)
    || (value.deleted_at !== undefined && value.deleted_at !== null)
    || (value.sender !== undefined && !isValidContextSender(value.sender, value.sender_id))
  ) return false;
  if (value[attachmentsField] !== undefined) {
    if (!Array.isArray(value[attachmentsField])) return false;
    const attachmentIds = new Set<number>();
    for (const attachment of value[attachmentsField]) {
      if (
        !isValidContextAttachment(attachment, kind, value.id)
        || !isPlainRecord(attachment)
        || attachmentIds.has(attachment.id as number)
      ) return false;
      attachmentIds.add(attachment.id as number);
    }
  }
  return true;
};

const isRbLastMessage = (value: unknown): boolean => (
  isPlainRecord(value)
  && isPositiveSafeInteger(value.id)
  && typeof value.message === 'string'
  && isPositiveSafeInteger(value.sender_id)
  && typeof value.is_read === 'boolean'
  && isValidServerTimestamp(value.created_at)
);

const isRbParticipant = (value: unknown): boolean => (
  isPlainRecord(value)
  && isPositiveSafeInteger(value.id)
  && isNonEmptyString(value.name)
  && isNullableString(value.phone)
  && (value.affiliation === undefined || isNullableString(value.affiliation))
);

const isRbConversation = (value: unknown): value is RbConversation => {
  if (!isPlainRecord(value)) return false;
  if (
    !isPositiveSafeInteger(value.id)
    || !isPositiveSafeInteger(value.primaryConversationId)
    || !Array.isArray(value.conversationIds)
    || value.conversationIds.length === 0
    || !value.conversationIds.every(isPositiveSafeInteger)
    || new Set(value.conversationIds).size !== value.conversationIds.length
    || !value.conversationIds.includes(value.primaryConversationId)
    || !Array.isArray(value.requestIds)
    || !value.requestIds.every(isPositiveSafeInteger)
    || new Set(value.requestIds).size !== value.requestIds.length
    || (value.participantUserId !== null && !isPositiveSafeInteger(value.participantUserId))
    || (value.participantRole !== 'fc' && value.participantRole !== 'designer')
    || !isNonEmptyString(value.status)
    || !isNonNegativeSafeInteger(value.unreadCount)
  ) return false;
  if (value.request !== null && (
    !isPlainRecord(value.request)
    || !isPositiveSafeInteger(value.request.id)
    || !isNonEmptyString(value.request.customer_name)
    || !isNonEmptyString(value.request.status)
  )) return false;
  if (value.fc !== null && !isRbParticipant(value.fc)) return false;
  if (value.designer !== null && (
    !isPlainRecord(value.designer)
    || !isPositiveSafeInteger(value.designer.id)
    || !isNullableString(value.designer.company_name)
    || (value.designer.users !== null && !isRbParticipant(value.designer.users))
  )) return false;
  return value.lastMessage === null || isRbLastMessage(value.lastMessage);
};

const isRbDmConversation = (value: unknown): value is RbDmConversation => (
  isPlainRecord(value)
  && isPositiveSafeInteger(value.id)
  && value.type === 'direct'
  && (value.participant === null || (
    isRbParticipant(value.participant)
    && isPlainRecord(value.participant)
    && isNonEmptyString(value.participant.role)
    && (value.participant.company_name === undefined || isNullableString(value.participant.company_name))
  ))
  && (value.lastMessage === null || isRbLastMessage(value.lastMessage))
  && isNonNegativeSafeInteger(value.unreadCount)
  && isValidServerTimestamp(value.created_at)
  && isValidServerTimestamp(value.updated_at)
);

const isValidContextMessage = (
  value: unknown,
  kind: RbMessageContextKind,
  roomId: number,
): value is RbMessage | RbDmMessage => {
  if (!isPlainRecord(value)) return false;
  const roomField = kind === 'request' ? 'request_designer_id' : 'direct_conversation_id';
  const attachmentsField = kind === 'request'
    ? 'message_attachments'
    : 'direct_message_attachments';
  if (
    !isPositiveSafeInteger(value.id)
    || value[roomField] !== roomId
    || !isPositiveSafeInteger(value.sender_id)
    || typeof value.message !== 'string'
    || typeof value.is_read !== 'boolean'
    || !isValidServerTimestamp(value.created_at)
    || (value.deleted_at !== undefined && value.deleted_at !== null)
    || !isValidContextSender(value.sender, value.sender_id)
    || !Array.isArray(value[attachmentsField])
  ) {
    return false;
  }

  const attachmentIds = new Set<number>();
  for (const attachment of value[attachmentsField]) {
    if (
      !isValidContextAttachment(attachment, kind, value.id)
      || !isPlainRecord(attachment)
      || attachmentIds.has(attachment.id as number)
    ) {
      return false;
    }
    attachmentIds.add(attachment.id as number);
  }
  return true;
};

export function buildRbMessageContextPath(
  kind: RbMessageContextKind,
  roomId: number,
  messageId: number,
): string {
  if (!isPositiveSafeInteger(roomId) || !isPositiveSafeInteger(messageId)) {
    throw new Error('positive safe integer room and message IDs are required');
  }
  return kind === 'request'
    ? `/api/messages/context?requestDesignerId=${roomId}&messageId=${messageId}`
    : `/api/direct-messages/context?conversationId=${roomId}&messageId=${messageId}`;
}

async function rbReadListOrThrow<T>(
  path: string,
  resource: RbListReadResource,
  loadedLabel: string,
  isItem: (value: unknown) => value is T,
  itemKey?: (item: T) => string,
): Promise<T[]> {
  const result = await rbFetch<unknown>(path);
  if (
    result.success
    && Array.isArray(result.data)
    && result.data.every(isItem)
    && (!itemKey || new Set(result.data.map(itemKey)).size === result.data.length)
  ) {
    logger.info(`[rb-api] ${loadedLabel} loaded: ${result.data.length} items`);
    return result.data;
  }
  logger.warn(`[rb-api] ${loadedLabel} failed`);
  throw new RbListReadError(resource, result);
}

function buildRbListPagePath(
  path: string,
  cursor: string | null | undefined,
  limit: number,
  extraQuery: readonly (readonly [string, string])[] = [],
) {
  const query = [`limit=${encodeURIComponent(String(limit))}`];
  if (cursor) query.push(`cursor=${encodeURIComponent(cursor)}`);
  extraQuery.forEach(([key, value]) => {
    query.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return `${path}?${query.join('&')}`;
}

async function rbReadListPageOrThrow<T>(
  path: string,
  resource: RbListReadResource,
  loadedLabel: string,
  isItem: (value: unknown) => value is T,
  itemKey: (item: T) => string,
  cursor?: string | null,
  limit = 30,
): Promise<RbListPage<T>> {
  const result = await rbFetch<unknown>(buildRbListPagePath(path, cursor, limit), {
    diagnosticPath: path,
  });
  if (
    result.success
    && Array.isArray(result.data)
    && result.data.every(isItem)
    && new Set(result.data.map(itemKey)).size === result.data.length
  ) {
    // Older GaramLink deployments ignore the requested page size and return
    // every conversation. Keep the compatibility read, but never hand an
    // unbounded legacy payload to React Native's list/render pipeline.
    // Older Request Board deployments ignore the requested page size and do
    // not provide a cursor. Preserve their complete response; otherwise the
    // truncated remainder cannot be requested. Current deployments enforce
    // `limit` server-side and return a cursor for the next page.
    const items = result.data;
    const pagination = parseOptionalCursorPaginationMetadata(result);
    if (!pagination) {
      throw new RbListReadError(resource, result);
    }
    logger.info(`[rb-api] ${loadedLabel} page loaded: ${items.length} items`);
    return {
      items,
      ...pagination,
      limit: Number.isSafeInteger(result.limit) ? Number(result.limit) : limit,
    };
  }
  logger.warn(`[rb-api] ${loadedLabel} page failed`);
  throw new RbListReadError(resource, result);
}

async function rbReadAllPagesOrThrow<T>(
  path: string,
  resource: RbListReadResource,
  loadedLabel: string,
  isItem: (value: unknown) => value is T,
  itemKey: (item: T) => string,
): Promise<T[]> {
  const items: T[] = [];
  const seenItems = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: RbListPage<T> = await rbReadListPageOrThrow<T>(
      path,
      resource,
      loadedLabel,
      isItem,
      itemKey,
      cursor,
      50,
    );
    for (const item of page.items) {
      const key = itemKey(item);
      if (seenItems.has(key)) throw new RbListReadError(resource, {});
      seenItems.add(key);
      items.push(item);
    }
    cursor = page.nextCursor;
    if (cursor && seenCursors.has(cursor)) {
      throw new Error('GaramLink conversation pagination did not advance');
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return items;
}

export function parseRbMessageContextPage(
  kind: 'request',
  roomId: number,
  messageId: number,
  value: unknown,
): RbMessageContextPage<RbMessage> | null;
export function parseRbMessageContextPage(
  kind: 'direct',
  roomId: number,
  messageId: number,
  value: unknown,
): RbMessageContextPage<RbDmMessage> | null;
export function parseRbMessageContextPage(
  kind: RbMessageContextKind,
  roomId: number,
  messageId: number,
  value: unknown,
): RbMessageContextPage<RbMessage | RbDmMessage> | null {
  if (
    !isPositiveSafeInteger(roomId)
    || !isPositiveSafeInteger(messageId)
    || !isPlainRecord(value)
    || !Array.isArray(value.messages)
    || value.messages.length === 0
    || value.messages.length > REQUEST_BOARD_MESSAGE_CONTEXT_MAX_ITEMS
    || typeof value.hasBefore !== 'boolean'
    || typeof value.hasAfter !== 'boolean'
    || value.anchorId !== messageId
    || value.anchorFound !== true
  ) {
    return null;
  }

  const messageIds = new Set<number>();
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  let previousId = 0;
  let anchorCount = 0;
  for (const message of value.messages) {
    if (!isValidContextMessage(message, kind, roomId) || messageIds.has(message.id)) {
      return null;
    }
    const timestamp = Date.parse(message.created_at);
    if (
      timestamp < previousTimestamp
      || (timestamp === previousTimestamp && message.id <= previousId)
    ) {
      return null;
    }
    previousTimestamp = timestamp;
    previousId = message.id;
    messageIds.add(message.id);
    if (message.id === messageId) anchorCount += 1;
  }
  if (anchorCount !== 1) return null;

  return {
    messages: value.messages as (RbMessage | RbDmMessage)[],
    hasBefore: value.hasBefore,
    hasAfter: value.hasAfter,
    anchorId: messageId,
    anchorFound: true,
  };
}

const messageContextFailure = (retryable = false) => ({
  success: false as const,
  error: REQUEST_BOARD_MESSAGE_CONTEXT_GUIDANCE,
  retryable,
});

export async function rbGetMessagesOrThrow(
  conversationIds: number[],
  limit = 50,
): Promise<RbMessage[]> {
  if (conversationIds.length === 0) return [];
  const allowedRoomIds = new Set(conversationIds);
  return rbReadListOrThrow(
    `/api/messages/by-conversations?ids=${conversationIds.join(',')}&markRead=true&limit=${limit}`,
    'messages',
    'messages',
    (value): value is RbMessage => isValidMessageListItem(value, 'request', allowedRoomIds),
    (item) => String(item.id),
  );
}

export async function rbMarkMessagesRead(conversationIds: readonly number[]) {
  const ids = Array.from(new Set(conversationIds));
  if (ids.length === 0 || ids.some((id) => !isPositiveSafeInteger(id))) {
    return { success: false as const, error: '유효한 대화방이 아닙니다.' };
  }
  for (let offset = 0; offset < ids.length; offset += 50) {
    const result = await rbFetch<{ conversationIds: number[] }>('/api/messages/read', {
      method: 'POST',
      diagnosticPath: '/api/messages/read',
      body: JSON.stringify({ conversationIds: ids.slice(offset, offset + 50) }),
    });
    if (!result.success) {
      return { success: false as const, error: result.error ?? '읽음 처리에 실패했습니다.' };
    }
  }
  return { success: true as const };
}

export async function rbGetMessageContext(
  requestDesignerId: number,
  messageId: number,
): Promise<RbMessageContextResult<RbMessage>> {
  if (!isPositiveSafeInteger(requestDesignerId) || !isPositiveSafeInteger(messageId)) {
    return messageContextFailure();
  }
  const path = buildRbMessageContextPath('request', requestDesignerId, messageId);
  const result = await rbFetch<unknown>(path, {
    method: 'GET',
    diagnosticPath: '/api/messages/context',
  });
  if (!result.success) {
    return messageContextFailure(Boolean(result.retryable));
  }
  const data = parseRbMessageContextPage(
    'request',
    requestDesignerId,
    messageId,
    result.data,
  );
  if (!data) {
    logger.warn('[rb-api] invalid response: /api/messages/context');
    return messageContextFailure();
  }
  return { success: true, data };
}

export async function rbSendMessage(
  requestDesignerId: number,
  message: string,
  attachments?: RbAttachmentMeta[],
  deliveryKey?: string,
): Promise<{ success: boolean; data?: RbMessage; error?: string }> {
  return rbFetch<RbMessage>(`/api/messages/${requestDesignerId}`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      ...(attachments?.length ? { attachments } : {}),
      ...(deliveryKey ? { deliveryKey } : {}),
    }),
  });
}

/* ─── DM Conversations ─── */

export async function rbDeleteMessage(
  messageId: number,
): Promise<{ success: boolean; error?: string }> {
  return rbFetch<undefined>(`/api/messages/message/${messageId}`, {
    method: 'DELETE',
  });
}

export async function rbGetDmConversationsOrThrow(): Promise<RbDmConversation[]> {
  return rbReadAllPagesOrThrow(
    '/api/direct-messages/conversations',
    'direct-conversations',
    'DM conversations',
    isRbDmConversation,
    (item) => String(item.id),
  );
}

export async function rbGetDmConversationsPageOrThrow(
  cursor?: string | null,
  limit = 30,
): Promise<RbListPage<RbDmConversation>> {
  return rbReadListPageOrThrow(
    '/api/direct-messages/conversations',
    'direct-conversations',
    'DM conversations',
    isRbDmConversation,
    (item) => String(item.id),
    cursor,
    limit,
  );
}

export async function rbGetPresence(
  phones: (string | null | undefined)[],
): Promise<RbPresenceSnapshot[]> {
  const normalizedPhones = Array.from(
    new Set(
      phones
        .map((phone) => String(phone ?? '').replace(/[^0-9]/g, ''))
        .filter((phone) => phone.length === 11)
    )
  ).slice(0, 100);

  if (normalizedPhones.length === 0) {
    return [];
  }

  const params = new URLSearchParams({ phones: normalizedPhones.join(',') });
  const res = await rbFetch<unknown>(`/api/presence?${params.toString()}`);
  if (res.success) {
    return parsePresenceSnapshotList(res.data, normalizedPhones);
  }
  logger.warn('[rb-api] presence fetch failed:', res.error);
  return [];
}

export async function rbGetDmMessagesOrThrow(
  conversationId: number,
  limit = 50,
): Promise<RbDmMessage[]> {
  return rbReadListOrThrow(
    `/api/direct-messages/${conversationId}?limit=${limit}`,
    'direct-messages',
    'DM messages',
    (value): value is RbDmMessage => isValidMessageListItem(
      value,
      'direct',
      new Set([conversationId]),
    ),
    (item) => String(item.id),
  );
}

export async function rbMarkDmMessagesRead(conversationId: number) {
  if (!isPositiveSafeInteger(conversationId)) {
    return { success: false as const, error: '유효한 대화방이 아닙니다.' };
  }
  const result = await rbFetch<{ conversationId: number }>(
    `/api/direct-messages/${conversationId}/read`,
    { method: 'POST', diagnosticPath: '/api/direct-messages/:conversationId/read' },
  );
  return result.success
    ? { success: true as const }
    : { success: false as const, error: result.error ?? '읽음 처리에 실패했습니다.' };
}

export async function rbGetDirectMessageContext(
  conversationId: number,
  messageId: number,
): Promise<RbMessageContextResult<RbDmMessage>> {
  if (!isPositiveSafeInteger(conversationId) || !isPositiveSafeInteger(messageId)) {
    return messageContextFailure();
  }
  const path = buildRbMessageContextPath('direct', conversationId, messageId);
  const result = await rbFetch<unknown>(path, {
    method: 'GET',
    diagnosticPath: '/api/direct-messages/context',
  });
  if (!result.success) {
    return messageContextFailure(Boolean(result.retryable));
  }
  const data = parseRbMessageContextPage(
    'direct',
    conversationId,
    messageId,
    result.data,
  );
  if (!data) {
    logger.warn('[rb-api] invalid response: /api/direct-messages/context');
    return messageContextFailure();
  }
  return { success: true, data };
}

export async function rbSendDmMessage(
  conversationId: number,
  message: string,
  attachments?: RbAttachmentMeta[],
): Promise<{ success: boolean; data?: RbDmMessage; error?: string }> {
  return rbFetch<RbDmMessage>(`/api/direct-messages/${conversationId}`, {
    method: 'POST',
    body: JSON.stringify({ message, ...(attachments?.length ? { attachments } : {}) }),
  });
}

export function parseRbMessengerRoomRef(value: unknown): RbMessengerRoomRef | null {
  if (!isPlainRecord(value)) return null;
  if (
    value.type === 'request'
    && hasExactKeys(value, ['type', 'requestDesignerId'])
    && isPositiveSafeInteger(value.requestDesignerId)
  ) {
    return { type: 'request', requestDesignerId: value.requestDesignerId };
  }
  if (
    value.type === 'direct'
    && hasExactKeys(value, ['type', 'conversationId'])
    && isPositiveSafeInteger(value.conversationId)
  ) {
    return { type: 'direct', conversationId: value.conversationId };
  }
  return null;
}

const isValidServerDerivedRoomKey = (room: RbMessengerRoomRef, roomKey: unknown): boolean => {
  if (typeof roomKey !== 'string') return false;
  if (room.type === 'direct') {
    return roomKey === `garamlink:direct:${room.conversationId}`;
  }
  const match = /^garamlink:request-peer:(fc|designer):([1-9][0-9]*)$/.exec(roomKey);
  return Boolean(match && isPositiveSafeInteger(Number(match[2])));
};

export function parseRbMessengerRoomPreference(
  value: unknown,
): RbMessengerRoomPreference | null {
  if (!isPlainRecord(value)) return null;
  const legacyKeys = value.displayLabel === undefined
    ? ['room', 'roomKey', 'muted']
    : ['room', 'roomKey', 'displayLabel', 'muted'];
  const currentKeys = value.displayLabel === undefined
    ? ['room', 'roomKey', 'muted', 'pinnedAt', 'leftAt']
    : ['room', 'roomKey', 'displayLabel', 'muted', 'pinnedAt', 'leftAt'];
  const legacy = hasExactKeys(value, legacyKeys);
  if (!legacy && !hasExactKeys(value, currentKeys)) return null;

  const room = parseRbMessengerRoomRef(value.room);
  if (
    !room
    || !isValidServerDerivedRoomKey(room, value.roomKey)
    || typeof value.muted !== 'boolean'
    || (!legacy && !(
      (value.pinnedAt === null || typeof value.pinnedAt === 'string')
      && (value.leftAt === null || typeof value.leftAt === 'string')
    ))
    || (typeof value.pinnedAt === 'string' && (
      !Number.isFinite(Date.parse(value.pinnedAt))
      || new Date(value.pinnedAt).toISOString() !== value.pinnedAt
    ))
    || (typeof value.leftAt === 'string' && (
      !Number.isFinite(Date.parse(value.leftAt))
      || new Date(value.leftAt).toISOString() !== value.leftAt
    ))
    || (
      value.displayLabel !== undefined
      && (
        typeof value.displayLabel !== 'string'
        || value.displayLabel.length === 0
        || value.displayLabel !== value.displayLabel.trim()
      )
    )
  ) {
    return null;
  }

  return {
    room,
    roomKey: value.roomKey as string,
    ...(value.displayLabel === undefined
      ? {}
      : { displayLabel: value.displayLabel as string }),
    muted: value.muted,
    ...(legacy ? {} : {
      pinnedAt: value.pinnedAt as string | null,
      leftAt: value.leftAt as string | null,
    }),
  };
}

export function parseRbMessengerRoomPreferencesPayload(
  value: unknown,
): { rooms: RbMessengerRoomPreference[] } | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['rooms']) || !Array.isArray(value.rooms)) {
    return null;
  }

  const rooms: RbMessengerRoomPreference[] = [];
  const roomKeys = new Set<string>();
  const roomRefs = new Set<string>();
  for (const item of value.rooms) {
    const preference = parseRbMessengerRoomPreference(item);
    if (!preference) return null;
    const roomRef = preference.room.type === 'request'
      ? `request:${preference.room.requestDesignerId}`
      : `direct:${preference.room.conversationId}`;
    if (roomKeys.has(preference.roomKey) || roomRefs.has(roomRef)) return null;
    roomKeys.add(preference.roomKey);
    roomRefs.add(roomRef);
    rooms.push(preference);
  }
  return { rooms };
}

export function buildRbMessengerRoomMutedPayload(
  room: unknown,
  muted: unknown,
): { room: RbMessengerRoomRef; muted: boolean } | null {
  const parsedRoom = parseRbMessengerRoomRef(room);
  return parsedRoom && typeof muted === 'boolean'
    ? { room: parsedRoom, muted }
    : null;
}

const roomPreferenceFailure = (action: 'load' | 'save', retryable = false) => ({
  success: false as const,
  error: action === 'load'
    ? '방 알림 설정을 불러오지 못했습니다. 다시 시도해 주세요.'
    : '방 알림 설정을 저장하지 못했습니다. 다시 시도해 주세요.',
  retryable,
});

let requestBoardRoomPreferencesSupported: boolean | null = null;

export async function rbGetMessengerRoomPreferences(): Promise<RbMessengerRoomPreferencesResult> {
  if (requestBoardRoomPreferencesSupported === false) {
    return { success: true, data: { rooms: [] }, supported: false };
  }
  const result = await rbFetch<unknown>('/api/notification-preferences/rooms', {
    method: 'GET',
    diagnosticPath: '/api/notification-preferences/rooms',
    suppressNotFoundWarning: true,
  });
  if (!result.success && result.status === 404) {
    requestBoardRoomPreferencesSupported = false;
    logger.info('[rb-api] room preferences unavailable; legacy server compatibility enabled');
    return { success: true, data: { rooms: [] }, supported: false };
  }
  if (!result.success) {
    return roomPreferenceFailure('load', Boolean(result.retryable));
  }
  const data = parseRbMessengerRoomPreferencesPayload(result.data);
  if (!data) {
    logger.warn('[rb-api] invalid response: /api/notification-preferences/rooms');
    return roomPreferenceFailure('load');
  }
  requestBoardRoomPreferencesSupported = true;
  return { success: true, data };
}

export async function rbSetMessengerRoomMuted(
  room: RbMessengerRoomRef,
  muted: boolean,
): Promise<RbMessengerRoomPreferenceResult> {
  const payload = buildRbMessengerRoomMutedPayload(room, muted);
  if (!payload) return roomPreferenceFailure('save');
  if (requestBoardRoomPreferencesSupported === false) {
    return {
      success: false,
      error: '가람Link 서버 업데이트 후 방 알림 설정을 사용할 수 있습니다.',
      retryable: false,
    };
  }

  const result = await rbFetch<unknown>('/api/notification-preferences/rooms', {
    method: 'PATCH',
    diagnosticPath: '/api/notification-preferences/rooms',
    body: JSON.stringify(payload),
  });
  if (!result.success) {
    return roomPreferenceFailure('save', Boolean(result.retryable));
  }
  const data = parseRbMessengerRoomPreference(result.data);
  if (!data) {
    logger.warn('[rb-api] invalid response: /api/notification-preferences/rooms');
    return roomPreferenceFailure('save');
  }
  return { success: true, data };
}

async function rbPatchMessengerRoomPreference(
  room: RbMessengerRoomRef,
  patch: { pinned: boolean } | { leave: true },
): Promise<RbMessengerRoomPreferenceResult> {
  const parsedRoom = parseRbMessengerRoomRef(room);
  if (!parsedRoom) return roomPreferenceFailure('save');
  if (requestBoardRoomPreferencesSupported === false) {
    return {
      success: false,
      error: '가람Link 서버 업데이트 후 채팅방 설정을 사용할 수 있습니다.',
      retryable: false,
    };
  }
  const result = await rbFetch<unknown>('/api/notification-preferences/rooms', {
    method: 'PATCH',
    diagnosticPath: '/api/notification-preferences/rooms',
    body: JSON.stringify({ room: parsedRoom, ...patch }),
  });
  if (!result.success) return roomPreferenceFailure('save', Boolean(result.retryable));
  const data = parseRbMessengerRoomPreference(result.data);
  return data ? { success: true, data } : roomPreferenceFailure('save');
}

export function rbSetMessengerRoomPinned(room: RbMessengerRoomRef, pinned: boolean) {
  return rbPatchMessengerRoomPreference(room, { pinned });
}

export function rbLeaveMessengerRoom(room: RbMessengerRoomRef) {
  return rbPatchMessengerRoomPreference(room, { leave: true });
}

/* ─── File Upload ─── */

export async function rbDeleteDmMessage(
  messageId: number,
): Promise<{ success: boolean; error?: string }> {
  return rbFetch<undefined>(`/api/direct-messages/message/${messageId}`, {
    method: 'DELETE',
  });
}

export async function rbUploadAttachments(
  files: { uri: string; name: string; type: string }[],
  allowRetry = true,
): Promise<RbApiResult<RbAttachmentMeta[]>> {
  const result = await rbFetch<{ attachments: RbAttachmentMeta[] }>('/api/messages/attachments/upload', {
    method: 'POST',
    multipart: {
      label: '파일 업로드',
      buildBody: () => {
        const formData = new FormData();
        for (const file of files) formData.append('files', file as any);
        return formData;
      },
    },
  }, allowRetry);
  if (!result.success) return { ...result, data: undefined };
  if (Array.isArray(result.data?.attachments)) return { success: true, data: result.data.attachments };
  return { success: false, error: result.error ?? result.message ?? '파일 업로드 실패' };
}

/* ─── Designers ─── */

export type RbDesigner = {
  id: number;
  company_name: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_region?: string | null;
  contact_position?: string | null;
  users: { id: number | null; name: string; email?: string; phone?: string; affiliation?: string | null } | null;
  designer_products?: { product_id: number; insurance_products: { id: number; name: string; icon?: string } }[];
};

export type RbInsuranceProduct = {
  id: number;
  name: string;
  icon?: string | null;
  display_order?: number | null;
  product_code?: string | null;
  product_group?: string | null;
};

export type RbCustomerProfile = {
  id: number;
  name: string;
  gender: 'male' | 'female';
  birthDate: string;
  phone: string;
  ssn: string;
  hasSeparatePolicyholder: boolean;
  policyholderName?: string;
  policyholderSsn?: string;
  policyholderPhone?: string;
  policyholderCarrier?: string;
  policyholderAddress?: string;
  carrier?: string;
  job?: string;
  drivingStatus?: string;
  income?: string;
  address?: string;
  email?: string;
  height?: string;
  weight?: string;
  referrer?: string;
  insuranceQualifications?: {
    property: boolean;
    life: boolean;
    third: boolean;
  };
  recentHospitalVisit?: string;
  currentMedication?: string;
  hospitalizationHistory?: string;
  majorDiseases?: string;
  requestDetails?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type RbSaveCustomerPayload = Omit<RbCustomerProfile, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: number;
};

export type RbCreateRequestPayload = {
  clientRequestKey: string;
  customerName: string;
  customerSsn: string;
  customerGender?: string;
  customerBirthDate?: string;
  customerPhone?: string;
  customerCarrier?: string;
  customerAddress?: string;
  customerJob?: string;
  customerDrivingStatus?: string;
  customerIncome?: string;
  customerEmail?: string;
  customerHeight?: string;
  customerWeight?: string;
  customerReferrer?: string;
  hasSeparatePolicyholder?: boolean;
  policyholderName?: string;
  policyholderSsn?: string;
  policyholderPhone?: string;
  policyholderCarrier?: string;
  policyholderAddress?: string;
  insuranceQualifications?: {
    property: boolean;
    life: boolean;
    third: boolean;
  };
  recentHospitalVisit?: string;
  currentMedication?: string;
  recentHospitalization?: string;
  hospitalizationHistory?: string;
  majorDiseases?: string;
  requestDetails?: string;
  productIds: number[];
  designerIds: number[];
  designerCodeSelections?: {
    designerId: number;
    companyName?: string | null;
    fcCodeName?: string | null;
    fcCodeValue?: string | null;
    fcCompanyCodeId?: number | null;
  }[];
};

export type RbRequestAttachmentInput = {
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;
  description?: string | null;
  expiryDate?: string | null;
};

export type RbRequestUploadFile = {
  uri: string;
  name: string;
  type: string;
};

const hasOnlyOptionalStrings = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => keys.every((key) => value[key] === undefined || isNullableString(value[key]));

const isRbDesigner = (value: unknown): value is RbDesigner => {
  if (
    !isPlainRecord(value)
    || !isPositiveSafeInteger(value.id)
    || !isNullableString(value.company_name)
    || value.users === undefined
    || !hasOnlyOptionalStrings(value, [
      'contact_name', 'contact_phone', 'contact_region', 'contact_position',
    ])
  ) return false;
  if (value.users !== null && value.users !== undefined) {
    if (
      !isPlainRecord(value.users)
      || (value.users.id !== null && !isPositiveSafeInteger(value.users.id))
      || !isNonEmptyString(value.users.name)
      || !hasOnlyOptionalStrings(value.users, ['email', 'phone'])
      || (value.users.affiliation !== undefined && !isNullableString(value.users.affiliation))
    ) return false;
  }
  if (value.designer_products !== undefined) {
    if (!Array.isArray(value.designer_products)) return false;
    const productIds = new Set<number>();
    for (const rawProduct of value.designer_products) {
      if (
        !isPlainRecord(rawProduct)
        || !isPositiveSafeInteger(rawProduct.product_id)
        || productIds.has(rawProduct.product_id)
        || !isPlainRecord(rawProduct.insurance_products)
        || rawProduct.insurance_products.id !== rawProduct.product_id
        || !isNonEmptyString(rawProduct.insurance_products.name)
        || (rawProduct.insurance_products.icon !== undefined
          && typeof rawProduct.insurance_products.icon !== 'string')
      ) return false;
      productIds.add(rawProduct.product_id);
    }
  }
  return true;
};

const isRbInsuranceProduct = (value: unknown): value is RbInsuranceProduct => (
  isPlainRecord(value)
  && isPositiveSafeInteger(value.id)
  && isNonEmptyString(value.name)
  && (value.icon === undefined || isNullableString(value.icon))
  && (value.display_order === undefined || value.display_order === null
    || isNonNegativeSafeInteger(value.display_order))
  && (value.product_code === undefined || isNullableString(value.product_code))
  && (value.product_group === undefined || isNullableString(value.product_group))
);

const CUSTOMER_OPTIONAL_STRING_FIELDS = [
  'policyholderName', 'policyholderSsn', 'policyholderPhone', 'policyholderCarrier',
  'policyholderAddress', 'carrier', 'job', 'drivingStatus', 'income', 'address',
  'email', 'height', 'weight', 'referrer', 'recentHospitalVisit', 'currentMedication',
  'hospitalizationHistory', 'majorDiseases', 'requestDetails', 'createdAt', 'updatedAt',
] as const;

const isRbCustomerProfile = (value: unknown): value is RbCustomerProfile => {
  if (
    !isPlainRecord(value)
    || !isPositiveSafeInteger(value.id)
    || !isNonEmptyString(value.name)
    || (value.gender !== 'male' && value.gender !== 'female')
    || !isNonEmptyString(value.birthDate)
    || typeof value.phone !== 'string'
    || typeof value.ssn !== 'string'
    || typeof value.hasSeparatePolicyholder !== 'boolean'
    || !hasOnlyOptionalStrings(value, CUSTOMER_OPTIONAL_STRING_FIELDS)
  ) return false;
  if (value.insuranceQualifications !== undefined) {
    if (
      !isPlainRecord(value.insuranceQualifications)
      || typeof value.insuranceQualifications.property !== 'boolean'
      || typeof value.insuranceQualifications.life !== 'boolean'
      || typeof value.insuranceQualifications.third !== 'boolean'
    ) return false;
  }
  return true;
};

export async function rbGetDesignersOrThrow(search?: string): Promise<RbDesigner[]> {
  const params = new URLSearchParams({ limit: '100' });
  if (search) params.set('search', search);
  return rbReadListOrThrow(
    `/api/designers?${params}`,
    'designers',
    'designers',
    isRbDesigner,
    (item) => String(item.id),
  );
}

export async function rbGetProductsOrThrow(): Promise<RbInsuranceProduct[]> {
  return rbReadListOrThrow(
    '/api/designers/products/list',
    'products',
    'products',
    isRbInsuranceProduct,
    (item) => String(item.id),
  );
}

export async function rbGetCustomersOrThrow(): Promise<RbCustomerProfile[]> {
  return rbReadListOrThrow(
    '/api/customers?ssnView=full',
    'customers',
    'customers',
    isRbCustomerProfile,
    (item) => String(item.id),
  );
}

export async function rbSaveCustomer(
  payload: RbSaveCustomerPayload,
): Promise<{ success: boolean; data?: RbCustomerProfile; error?: string }> {
  return rbFetch<RbCustomerProfile>('/api/customers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function rbDeleteCustomer(
  id: number,
): Promise<{ success: boolean; error?: string }> {
  return rbFetch<undefined>(`/api/customers/${id}`, { method: 'DELETE' });
}
export type RbDirectMessageUser = {
  id: number;
  name: string;
  role: 'fc' | 'designer';
  phone: string | null;
  company_name?: string | null;
  affiliation?: string | null;
};

const isRbDirectMessageUser = (value: unknown): value is RbDirectMessageUser => (
  isPlainRecord(value)
  && isPositiveSafeInteger(value.id)
  && isNonEmptyString(value.name)
  && (value.role === 'fc' || value.role === 'designer')
  && isNullableString(value.phone)
  && (value.company_name === undefined || isNullableString(value.company_name))
  && (value.affiliation === undefined || isNullableString(value.affiliation))
);

export async function rbGetDirectMessageUsersOrThrow(
  search?: string,
  role?: 'fc' | 'designer',
): Promise<RbDirectMessageUser[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (role) params.set('role', role);

  const query = params.toString();
  return rbReadListOrThrow(
    `/api/direct-messages/users${query ? `?${query}` : ''}`,
    'direct-message-users',
    'direct message users',
    isRbDirectMessageUser,
    (item) => String(item.id),
  );
}

/* ─── Create DM Conversation ─── */

export async function rbCreateDmConversation(
  participantId: number,
): Promise<{
  success: boolean;
  data?: {
    id: number;
    type: string;
    participant: {
      id: number;
      name: string;
      role: string;
      phone: string | null;
      company_name?: string | null;
      affiliation?: string | null;
    };
    isNew: boolean;
  };
  error?: string;
}> {
  return rbFetch('/api/direct-messages/conversations', {
    method: 'POST',
    body: JSON.stringify({ participantId }),
  });
}

/* ─── Unread Counts ─── */

export async function rbGetNotificationUnreadCount(): Promise<number> {
  const res = await rbFetch<{ count: number }>('/api/notifications/unread/count');
  return res.success ? Number(res.data?.count ?? 0) : 0;
}

/* ─── Request Stats ─── */

/* ─── Request List & Review ─── */

export type RbRequestAttachmentFull = {
  id: number;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  description?: string | null;
  expiry_date?: string | null;
  created_at: string;
};

export type RbDesignerAssignment = {
  id: number;
  designer_id: number;
  status: string;
  fc_code_name?: string | null;
  fc_code_value?: string | null;
  fc_decision: 'pending' | 'accepted' | 'rejected' | null;
  fc_decision_reason?: string | null;
  fc_decided_at?: string | null;
  design_url?: string | null;
  accepted_at?: string | null;
  completed_at?: string | null;
  processing_days?: number | null;
  rejection_reason?: string | null;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  request_attachments?: RbRequestAttachmentFull[];
  designers?: {
    id: number;
    company_name: string | null;
    users?: { id: number; name: string; email?: string } | null;
  } | null;
};

export type RbRequestListItem = {
  id: number;
  status: string;
  customer_name: string;
  has_separate_policyholder?: boolean | null;
  policyholder_name?: string | null;
  customer_display_name?: string | null;
  fc_code_name?: string | null;
  fc_code_value?: string | null;
  fc?: {
    id: number;
    name: string;
    email?: string | null;
    phone?: string | null;
    affiliation?: string | null;
  } | null;
  created_at: string;
  request_products?: {
    product_id: number;
    insurance_products?: { id: number; name: string; icon?: string | null } | null;
  }[];
  request_designers?: {
    id: number;
    designer_id: number;
    status: string;
    fc_company_code_id?: number | null;
    fc_code_name?: string | null;
    fc_code_value?: string | null;
    fc_decision?: 'pending' | 'accepted' | 'rejected' | null;
    completed_at?: string | null;
    rejection_reason?: string | null;
    designers?: {
      id: number;
      company_name: string | null;
      users?: { id: number; name: string } | null;
    } | null;
  }[];
};

type RbRequestListPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const RB_REQUEST_LIST_PAGE_SIZE = 100;
const RB_REQUEST_LIST_MAX_ROWS = 100_000;

const isRbOptionalNullableString = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === 'string';

const isRbRequestListUser = (value: unknown): boolean =>
  isPlainRecord(value)
  && isPositiveSafeInteger(value.id)
  && typeof value.name === 'string'
  && isRbOptionalNullableString(value.email)
  && isRbOptionalNullableString(value.phone);

const isRbRequestListDesigner = (value: unknown): boolean => {
  if (!isPlainRecord(value)
    || !isPositiveSafeInteger(value.id)
    || !isPositiveSafeInteger(value.designer_id)
    || typeof value.status !== 'string'
    || value.status.length === 0
    || (value.fc_company_code_id !== undefined
      && value.fc_company_code_id !== null
      && !isPositiveSafeInteger(value.fc_company_code_id))
    || !isRbOptionalNullableString(value.fc_code_name)
    || !isRbOptionalNullableString(value.fc_code_value)
    || !isRbOptionalNullableString(value.completed_at)
    || !isRbOptionalNullableString(value.rejection_reason)
    || (value.fc_decision !== undefined
      && value.fc_decision !== null
      && value.fc_decision !== 'pending'
      && value.fc_decision !== 'accepted'
      && value.fc_decision !== 'rejected')) {
    return false;
  }
  if (value.designers === undefined || value.designers === null) return true;
  if (!isPlainRecord(value.designers)
    || !isPositiveSafeInteger(value.designers.id)
    || !isRbOptionalNullableString(value.designers.company_name)) {
    return false;
  }
  return value.designers.users === undefined
    || value.designers.users === null
    || isRbRequestListUser(value.designers.users);
};

const isRbRequestListProduct = (value: unknown): boolean => {
  if (!isPlainRecord(value) || !isPositiveSafeInteger(value.product_id)) return false;
  if (value.insurance_products === null) return true;
  return isPlainRecord(value.insurance_products)
    && isPositiveSafeInteger(value.insurance_products.id)
    && typeof value.insurance_products.name === 'string'
    && isRbOptionalNullableString(value.insurance_products.icon);
};

const isRbRequestListFc = (value: unknown): boolean =>
  value === null
  || (isPlainRecord(value)
    && isPositiveSafeInteger(value.id)
    && typeof value.name === 'string'
    && isRbOptionalNullableString(value.email)
    && isRbOptionalNullableString(value.phone)
    && isRbOptionalNullableString(value.affiliation));

const isRbRequestListItem = (value: unknown): value is RbRequestListItem => {
  if (!isPlainRecord(value)
    || !isPositiveSafeInteger(value.id)
    || typeof value.status !== 'string'
    || value.status.length === 0
    || typeof value.customer_name !== 'string'
    || !isValidServerTimestamp(value.created_at)
    || !isRbOptionalNullableString(value.policyholder_name)
    || !isRbOptionalNullableString(value.customer_display_name)
    || !isRbOptionalNullableString(value.fc_code_name)
    || !isRbOptionalNullableString(value.fc_code_value)
    || (value.has_separate_policyholder !== undefined
      && value.has_separate_policyholder !== null
      && typeof value.has_separate_policyholder !== 'boolean')
    || (value.fc !== undefined && !isRbRequestListFc(value.fc))
    || !Array.isArray(value.request_products)
    || !value.request_products.every(isRbRequestListProduct)
    || !Array.isArray(value.request_designers)
    || !value.request_designers.every(isRbRequestListDesigner)) {
    return false;
  }
  const assignmentIds = value.request_designers.map((assignment) => (
    isPlainRecord(assignment) ? assignment.id : null
  ));
  return new Set(assignmentIds).size === assignmentIds.length;
};

const parseRbRequestListPagination = (
  value: unknown,
  requestedPage: number,
): RbRequestListPagination | null => {
  if (value === undefined) return null;
  if (!isPlainRecord(value)
    || value.page !== requestedPage
    || value.limit !== RB_REQUEST_LIST_PAGE_SIZE
    || !Number.isSafeInteger(value.total)
    || Number(value.total) < 0
    || !Number.isSafeInteger(value.totalPages)
    || Number(value.totalPages) < 0
    || Number(value.totalPages) !== Math.ceil(Number(value.total) / RB_REQUEST_LIST_PAGE_SIZE)
    || Number(value.total) > RB_REQUEST_LIST_MAX_ROWS) {
    return null;
  }
  return value as unknown as RbRequestListPagination;
};

function parseRbRequestListPage(
  result: RbApiResult<unknown>,
  requestedPage: number,
): { items: RbRequestListItem[]; pagination: RbRequestListPagination | null } {
  if (!result.success || result.data == null) throw new RbListReadError('requests', result);
  const payload = result.data;
  const payloadRecord = isPlainRecord(payload) ? payload : null;
  const rawItems = Array.isArray(payload)
    ? payload
    : payloadRecord?.requests ?? payloadRecord?.data;
  if (!Array.isArray(rawItems)
    || rawItems.length > RB_REQUEST_LIST_PAGE_SIZE
    || !rawItems.every(isRbRequestListItem)) {
    throw new RbListReadError('requests', result);
  }
  const rootHasPagination = Object.prototype.hasOwnProperty.call(result, 'pagination');
  const rawPagination = rootHasPagination ? result.pagination : payloadRecord?.pagination;
  const pagination = parseRbRequestListPagination(rawPagination, requestedPage);
  if (rawPagination !== undefined && pagination === null) {
    throw new RbListReadError('requests', result);
  }
  return { items: rawItems, pagination };
}

export type RbRequestDetail = {
  id: number;
  status: string;
  customer_name: string;
  customer_ssn?: string | null;
  has_separate_policyholder?: boolean | null;
  policyholder_name?: string | null;
  policyholder_ssn?: string | null;
  policyholder_phone?: string | null;
  policyholder_carrier?: string | null;
  policyholder_address?: string | null;
  customer_gender?: string | null;
  customer_phone?: string | null;
  customer_birth_date?: string | null;
  customer_carrier?: string | null;
  customer_address?: string | null;
  customer_job?: string | null;
  customer_driving_status?: string | null;
  customer_income?: string | null;
  customer_email?: string | null;
  customer_height?: string | null;
  customer_weight?: string | null;
  customer_referrer?: string | null;
  insurance_qualifications?: {
    property?: boolean;
    life?: boolean;
    third?: boolean;
  } | null;
  recent_hospital_visit?: string | null;
  current_medication?: string | null;
  recent_hospitalization?: string | null;
  major_diseases?: string | null;
  request_details?: string | null;
  fc_code_name?: string | null;
  fc_code_value?: string | null;
  account_holder?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  monthly_payment?: number | null;
  created_at: string;
  updated_at?: string;
  request_products?: {
    product_id: number;
    insurance_products?: { id: number; name: string; icon?: string | null } | null;
  }[];
  fc?: {
    id: number;
    name: string;
    email?: string | null;
    phone?: string | null;
    affiliation?: string | null;
  } | null;
  request_designers?: RbDesignerAssignment[];
};

const isRbOptionalTimestamp = (value: unknown): boolean =>
  value === undefined || value === null || isValidServerTimestamp(value);

const isRbRequestAttachmentFull = (value: unknown): value is RbRequestAttachmentFull =>
  isPlainRecord(value)
  && isPositiveSafeInteger(value.id)
  && typeof value.file_name === 'string'
  && typeof value.file_type === 'string'
  && isNonNegativeSafeInteger(value.file_size)
  && typeof value.file_url === 'string'
  && isRbOptionalNullableString(value.description)
  && isRbOptionalNullableString(value.expiry_date)
  && isValidServerTimestamp(value.created_at);

const isRbRequestDetailDesigner = (value: unknown): value is RbDesignerAssignment => {
  if (!isRbRequestListDesigner(value) || !isPlainRecord(value)) return false;
  if (
    (value.fc_decision !== null
      && value.fc_decision !== 'pending'
      && value.fc_decision !== 'accepted'
      && value.fc_decision !== 'rejected')
    || !isRbOptionalNullableString(value.fc_decision_reason)
    || !isRbOptionalTimestamp(value.fc_decided_at)
    || !isRbOptionalNullableString(value.design_url)
    || !isRbOptionalTimestamp(value.accepted_at)
    || !isRbOptionalTimestamp(value.completed_at)
    || (value.processing_days !== undefined
      && value.processing_days !== null
      && !isNonNegativeSafeInteger(value.processing_days))
    || !isRbOptionalNullableString(value.rejection_reason)
    || !isRbOptionalNullableString(value.cancel_reason)
    || !isRbOptionalTimestamp(value.cancelled_at)
    || (value.request_attachments !== undefined
      && (!Array.isArray(value.request_attachments)
        || !value.request_attachments.every(isRbRequestAttachmentFull)))
  ) {
    return false;
  }
  const attachmentIds = (value.request_attachments ?? []).map((attachment) => attachment.id);
  return new Set(attachmentIds).size === attachmentIds.length;
};

const REQUEST_DETAIL_NULLABLE_STRING_FIELDS = [
  'customer_ssn',
  'policyholder_name',
  'policyholder_ssn',
  'policyholder_phone',
  'policyholder_carrier',
  'policyholder_address',
  'customer_gender',
  'customer_phone',
  'customer_birth_date',
  'customer_carrier',
  'customer_address',
  'customer_job',
  'customer_driving_status',
  'customer_income',
  'customer_email',
  'customer_height',
  'customer_weight',
  'customer_referrer',
  'recent_hospital_visit',
  'current_medication',
  'recent_hospitalization',
  'major_diseases',
  'request_details',
  'fc_code_name',
  'fc_code_value',
  'account_holder',
  'bank_name',
  'account_number',
] as const;

const isRbRequestDetail = (value: unknown): value is RbRequestDetail => {
  if (!isPlainRecord(value) || !isRbRequestListItem(value)) return false;
  const detail = value as Record<string, unknown>;
  if (!REQUEST_DETAIL_NULLABLE_STRING_FIELDS.every((field) => (
    isRbOptionalNullableString(detail[field])
  ))) return false;
  if (detail.has_separate_policyholder !== undefined
    && detail.has_separate_policyholder !== null
    && typeof detail.has_separate_policyholder !== 'boolean') return false;
  if (detail.updated_at !== undefined && !isValidServerTimestamp(detail.updated_at)) return false;
  if (detail.monthly_payment !== undefined
    && detail.monthly_payment !== null
    && (typeof detail.monthly_payment !== 'number'
      || !Number.isFinite(detail.monthly_payment)
      || detail.monthly_payment < 0)) return false;
  if (detail.insurance_qualifications !== undefined && detail.insurance_qualifications !== null) {
    if (!isPlainRecord(detail.insurance_qualifications)) return false;
    for (const field of ['property', 'life', 'third'] as const) {
      const qualification = detail.insurance_qualifications[field];
      if (qualification !== undefined && typeof qualification !== 'boolean') return false;
    }
  }
  if (!Array.isArray(value.request_designers)
    || !value.request_designers.every(isRbRequestDetailDesigner)) return false;
  const assignmentIds = value.request_designers.map((assignment) => assignment.id);
  return new Set(assignmentIds).size === assignmentIds.length;
};

export async function rbCreateRequest(
  payload: RbCreateRequestPayload,
): Promise<RbApiResult<RbRequestDetail>> {
  const requestPayload: RbCreateRequestPayload = {
    ...payload,
    recentHospitalization: payload.recentHospitalization,
    hospitalizationHistory: payload.hospitalizationHistory,
  };
  if (!requestPayload.recentHospitalization && payload.hospitalizationHistory) {
    requestPayload.recentHospitalization = payload.hospitalizationHistory;
  }
  if (!requestPayload.hospitalizationHistory && payload.recentHospitalization) {
    requestPayload.hospitalizationHistory = payload.recentHospitalization;
  }
  const requestOptions: RbFetchOptions = {
    method: 'POST',
    body: JSON.stringify(requestPayload),
    timeoutMs: REQUEST_BOARD_NOTIFICATION_WRITE_TIMEOUT_MS,
  };
  const result = await rbFetch<RbRequestDetail>('/api/requests', requestOptions);
  const isStillProcessing = result.code === 'RB_REQUEST_CREATE_STILL_PROCESSING';
  if (result.success || (!result.retryable && !isStillProcessing)) {
    return result;
  }

  // The server deduplicates this replay by clientRequestKey. A bounded replay
  // recovers a committed create whose first response was lost without creating
  // another request or repeating notifications.
  if (isStillProcessing) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const replayResult = await rbFetch<RbRequestDetail>('/api/requests', requestOptions);
  if (replayResult.code !== 'RB_REQUEST_CREATE_STILL_PROCESSING') {
    return replayResult;
  }

  // A replay can race the original transaction while it is creating child
  // rows. Poll that explicit server state once; never retry other 409 errors.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return rbFetch<RbRequestDetail>('/api/requests', requestOptions);
}

export type RbMessageSearchResponse<T> =
  | { status: 'ready'; items: T[] }
  | { status: 'error'; items: []; error: string; retryable: boolean };

export function buildRbMessageSearchPath(
  kind: 'request' | 'direct',
  rawQuery: string,
  conversationIds: readonly number[] = [],
): string {
  const query = Array.from(rawQuery.trim()).slice(0, 100).join('');
  if (!query) throw new Error('search query is required');
  const ids = Array.from(new Set(conversationIds))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  const params = new URLSearchParams({ q: query, limit: '50' });
  if (kind === 'request' && ids.length > 0) {
    params.set('conversationIds', ids.join(','));
  }
  return kind === 'request'
    ? `/api/messages/search?${params.toString()}`
    : `/api/direct-messages/search?${params.toString()}`;
}

export function mapRbMessageSearchItems<T extends RbMessage | RbDmMessage>(
  kind: RbMessageContextKind,
  items: unknown,
): T[] | null {
  if (!Array.isArray(items) || items.length > 50) return null;
  const ids = new Set<number>();
  for (const item of items) {
    if (!isValidMessageListItem(item, kind) || ids.has(item.id)) return null;
    ids.add(item.id);
  }
  return items as T[];
}

function mapRbMessageSearchResponse<T extends RbMessage | RbDmMessage>(
  kind: RbMessageContextKind,
  result: RbApiResult<unknown>,
): RbMessageSearchResponse<T> {
  if (!result.success) {
    return {
      status: 'error',
      items: [],
      error: result.error ?? '가람Link 메시지를 검색하지 못했습니다.',
      retryable: Boolean(result.retryable),
    };
  }
  const items = mapRbMessageSearchItems<T>(kind, result.data);
  if (!items) {
    return {
      status: 'error',
      items: [],
      error: '가람Link 메시지 검색 응답이 올바르지 않습니다.',
      retryable: true,
    };
  }
  return {
    status: 'ready',
    items,
  };
}

export async function rbSearchMessages(
  query: string,
  conversationIds: readonly number[] = [],
): Promise<RbMessageSearchResponse<RbMessage>> {
  const path = buildRbMessageSearchPath('request', query, conversationIds);
  return mapRbMessageSearchResponse<RbMessage>('request', await rbFetch<unknown>(path, {
    method: 'GET',
    diagnosticPath: '/api/messages/search',
  }));
}

export async function rbSearchDirectMessages(
  query: string,
): Promise<RbMessageSearchResponse<RbDmMessage>> {
  const path = buildRbMessageSearchPath('direct', query);
  return mapRbMessageSearchResponse<RbDmMessage>('direct', await rbFetch<unknown>(path, {
    method: 'GET',
    diagnosticPath: '/api/direct-messages/search',
  }));
}

export async function rbGetRequestListOrThrow(): Promise<RbRequestListItem[]> {
  const rows: RbRequestListItem[] = [];
  const rowIds = new Set<number>();
  let expectedPagination: Pick<RbRequestListPagination, 'total' | 'totalPages'> | null = null;
  let paginationMode: 'known' | 'legacy' | null = null;

  for (let page = 1; ; page += 1) {
    if ((page - 1) * RB_REQUEST_LIST_PAGE_SIZE >= RB_REQUEST_LIST_MAX_ROWS) {
      throw new RbListReadError('requests', {});
    }
    const path = buildRbListPagePath(
      '/api/requests',
      null,
      RB_REQUEST_LIST_PAGE_SIZE,
      [
        ['page', String(page)],
        ['ssnView', 'masked'],
        ['includeAttachments', 'false'],
      ],
    );
    const result = await rbFetch<unknown>(path, { diagnosticPath: '/api/requests' });
    const parsed = parseRbRequestListPage(result, page);
    const nextMode = parsed.pagination ? 'known' : 'legacy';
    if (paginationMode !== null && paginationMode !== nextMode) {
      throw new RbListReadError('requests', result);
    }
    paginationMode = nextMode;

    if (parsed.pagination) {
      if (expectedPagination === null) {
        expectedPagination = {
          total: parsed.pagination.total,
          totalPages: parsed.pagination.totalPages,
        };
      } else if (
        parsed.pagination.total !== expectedPagination.total
        || parsed.pagination.totalPages !== expectedPagination.totalPages
      ) {
        throw new RbListReadError('requests', result);
      }
      const expectedPageLength = page < parsed.pagination.totalPages
        ? RB_REQUEST_LIST_PAGE_SIZE
        : Math.max(0, parsed.pagination.total - ((page - 1) * RB_REQUEST_LIST_PAGE_SIZE));
      if (parsed.items.length !== expectedPageLength) {
        throw new RbListReadError('requests', result);
      }
    }

    for (const row of parsed.items) {
      if (rowIds.has(row.id)) throw new RbListReadError('requests', result);
      rowIds.add(row.id);
      rows.push(row);
    }

    if (parsed.pagination) {
      if (page >= parsed.pagination.totalPages) {
        if (rows.length !== parsed.pagination.total) {
          throw new RbListReadError('requests', result);
        }
        return rows;
      }
    } else if (parsed.items.length < RB_REQUEST_LIST_PAGE_SIZE) {
      return rows;
    }
  }
}

export async function rbGetRequestDetail(id: number): Promise<RbRequestDetail> {
  const res = await rbFetch<unknown>(`/api/requests/${id}?ssnView=full`);
  if (!res.success || !isRbRequestDetail(res.data) || res.data.id !== id) {
    throw new RbListReadError('requests', res);
  }
  return res.data;
}

export async function rbApproveDesign(
  requestId: number,
  designerId: number,
): Promise<RbApiResult> {
  return rbFetch(`/api/requests/${requestId}/designers/${designerId}/fc-accept`, {
    method: 'POST',
  });
}

export async function rbRejectDesign(
  requestId: number,
  designerId: number,
  reason: string,
): Promise<RbApiResult> {
  return rbFetch(`/api/requests/${requestId}/designers/${designerId}/fc-reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function rbAcceptRequest(
  requestId: number,
  designerId: number,
  requestDesignerId?: number,
): Promise<RbApiResult<RbDesignerAssignment>> {
  return rbFetch<RbDesignerAssignment>(`/api/requests/${requestId}/designers/${designerId}/accept`, {
    method: 'POST',
    body: JSON.stringify({ requestDesignerId }),
  });
}

export async function rbRejectRequest(
  requestId: number,
  designerId: number,
  reason?: string,
  requestDesignerId?: number,
): Promise<RbApiResult<RbDesignerAssignment>> {
  return rbFetch<RbDesignerAssignment>(`/api/requests/${requestId}/designers/${designerId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason, requestDesignerId }),
  });
}

export async function rbCompleteRequest(
  requestId: number,
  designerId: number,
  payload?: {
    designUrl?: string;
    completionNote?: string;
    attachments?: RbRequestAttachmentInput[];
    requestDesignerId?: number;
  },
): Promise<RbApiResult<RbDesignerAssignment>> {
  return rbFetch<RbDesignerAssignment>(`/api/requests/${requestId}/designers/${designerId}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
}

export async function rbUploadRequestAttachments(
  requestId: number,
  designerId: number,
  payload: {
    files: RbRequestUploadFile[];
    metadata: {
      description?: string | null;
      expiryDate?: string | null;
    }[];
    requestDesignerId?: number;
  },
  allowRetry = true,
): Promise<RbApiResult<RbRequestAttachmentFull[]>> {
  const result = await rbFetch<RbRequestAttachmentFull[]>(
    `/api/requests/${requestId}/designers/${designerId}/attachments`,
    {
      method: 'POST',
      multipart: {
        label: '첨부파일 업로드',
        buildBody: () => {
          const formData = new FormData();
          for (const file of payload.files) formData.append('files', file as any);
          formData.append('metadata', JSON.stringify(payload.metadata));
          if (payload.requestDesignerId) formData.append('requestDesignerId', String(payload.requestDesignerId));
          return formData;
        },
      },
    },
    allowRetry,
  );
  if (!result.success) return result;
  if (Array.isArray(result.data)) return { success: true, data: result.data };
  return { success: false, error: result.error ?? result.message ?? '첨부파일 업로드 실패' };
}

/* ─── FC Company Codes ─── */

export type RbFcCode = {
  id: number;
  insurer_name: string;
  code_name?: string | null;
  code_value: string;
  is_active?: boolean;
  updated_at: string;
};

const isRbFcCode = (value: unknown): value is RbFcCode => (
  isPlainRecord(value)
  && isPositiveSafeInteger(value.id)
  && isNonEmptyString(value.insurer_name)
  && (value.code_name === undefined || isNullableString(value.code_name))
  && isNonEmptyString(value.code_value)
  && (value.is_active === undefined || typeof value.is_active === 'boolean')
  && isValidServerTimestamp(value.updated_at)
);

export async function rbGetFcCodesOrThrow(): Promise<RbFcCode[]> {
  return rbReadListOrThrow(
    '/api/fc-codes',
    'fc-codes',
    'fc-codes',
    isRbFcCode,
    (item) => String(item.id),
  );
}

export async function rbGetCompanyNamesOrThrow(): Promise<string[]> {
  return rbReadListOrThrow(
    '/api/fc-codes/company-names',
    'company-names',
    'company-names',
    isNonEmptyString,
    (item) => item,
  );
}

export async function rbCreateFcCode(
  insurerName: string,
  codeValue: string,
): Promise<{ success: boolean; data?: RbFcCode; error?: string; message?: string }> {
  return rbFetch<RbFcCode>('/api/fc-codes', {
    method: 'POST',
    body: JSON.stringify({ insurerName, codeValue }),
  });
}

export async function rbUpdateFcCode(
  id: number,
  payload: { insurerName?: string; codeValue?: string },
): Promise<{ success: boolean; data?: RbFcCode; error?: string }> {
  return rbFetch<RbFcCode>(`/api/fc-codes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function rbDeleteFcCode(
  id: number,
): Promise<{ success: boolean; error?: string }> {
  return rbFetch<undefined>(`/api/fc-codes/${id}`, { method: 'DELETE' });
}
