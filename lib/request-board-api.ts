/**
 * request_board API client for fc-onboarding-app.
 * Handles authentication, conversation listing, message fetch/send.
 */
import { logger } from './logger';
import { getRequestBoardApiBaseUrl } from './request-board-url';
import { safeStorage } from './safe-storage';
import { supabase } from './supabase';

const BASE_URL = getRequestBoardApiBaseUrl();
const REQUEST_BOARD_FETCH_TIMEOUT_MS = 8000;

const STORAGE_KEY_TOKEN = 'rb_jwt_token';
const STORAGE_KEY_USER = 'rb_user';
const STORAGE_KEY_BRIDGE_TOKEN = 'rb_bridge_token';
const STORAGE_KEY_APP_SESSION_TOKEN = 'rb_app_session_token';

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

/* ─── Token Management ─── */

let cachedToken: string | null = null;
let cachedUser: RbUser | null = null;
let cachedBridgeToken: string | null = null;
let cachedAppSessionToken: string | null = null;
let bridgeRefreshPromise: Promise<{
  success: boolean;
  bridgeToken?: string;
  requestBoardRole?: 'fc' | 'designer' | null;
  error?: string;
  errorCode?: string;
}> | null = null;

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
    cachedToken = await safeStorage.getItem(STORAGE_KEY_TOKEN);
    return cachedToken;
  } catch {
    return null;
  }
}

export async function getStoredBridgeToken(): Promise<string | null> {
  if (cachedBridgeToken) return cachedBridgeToken;
  try {
    cachedBridgeToken = await safeStorage.getItem(STORAGE_KEY_BRIDGE_TOKEN);
    return cachedBridgeToken;
  } catch {
    return null;
  }
}

export async function getStoredAppSessionToken(): Promise<string | null> {
  if (cachedAppSessionToken) return cachedAppSessionToken;
  try {
    cachedAppSessionToken = await safeStorage.getItem(STORAGE_KEY_APP_SESSION_TOKEN);
    return cachedAppSessionToken;
  } catch {
    return null;
  }
}

export async function getStoredUser(): Promise<RbUser | null> {
  if (cachedUser) return cachedUser;
  try {
    const raw = await safeStorage.getItem(STORAGE_KEY_USER);
    if (raw) {
      cachedUser = JSON.parse(raw);
      return cachedUser;
    }
  } catch { /* ignore */ }
  return null;
}

async function storeAuth(token: string, user: RbUser) {
  cachedToken = token;
  cachedUser = user;
  await safeStorage.setItem(STORAGE_KEY_TOKEN, token);
  await safeStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
}

export async function setBridgeToken(token: string | null) {
  cachedBridgeToken = token;
  if (token) {
    await safeStorage.setItem(STORAGE_KEY_BRIDGE_TOKEN, token);
  } else {
    await safeStorage.removeItem(STORAGE_KEY_BRIDGE_TOKEN);
  }
}

export async function setAppSessionToken(token: string | null) {
  cachedAppSessionToken = token;
  if (token) {
    await safeStorage.setItem(STORAGE_KEY_APP_SESSION_TOKEN, token);
  } else {
    await safeStorage.removeItem(STORAGE_KEY_APP_SESSION_TOKEN);
  }
}

export async function clearAuth() {
  cachedToken = null;
  cachedUser = null;
  await safeStorage.removeItem(STORAGE_KEY_TOKEN);
  await safeStorage.removeItem(STORAGE_KEY_USER);
}

export async function clearRequestBoardState(options?: { clearAppSession?: boolean }) {
  await clearAuth();
  await setBridgeToken(null);
  if (options?.clearAppSession) {
    await setAppSessionToken(null);
  }
}

type RbBridgeRefreshResult = {
  success: boolean;
  bridgeToken?: string;
  requestBoardRole?: 'fc' | 'designer' | null;
  error?: string;
  errorCode?: string;
};

async function refreshBridgeTokenFromAppSession(): Promise<RbBridgeRefreshResult> {
  if (bridgeRefreshPromise) return bridgeRefreshPromise;

  bridgeRefreshPromise = (async () => {
    const sessionToken = await getStoredAppSessionToken();
    if (!sessionToken) {
      return {
        success: false,
        error: '앱 세션 토큰이 없습니다.',
        errorCode: 'missing_session_token',
      };
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

      if (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '가람Link 세션 재동기화에 실패했습니다.',
          errorCode: 'network_error',
        };
      }

      if (!data?.ok || !data.requestBoardBridgeToken) {
        return {
          success: false,
          error: data?.message ?? '가람Link 세션 재동기화에 실패했습니다.',
          errorCode: data?.code ?? 'bridge_refresh_failed',
        };
      }

      await setBridgeToken(data.requestBoardBridgeToken);
      return {
        success: true,
        bridgeToken: data.requestBoardBridgeToken,
        requestBoardRole:
          data.requestBoardRole === 'fc' || data.requestBoardRole === 'designer'
            ? data.requestBoardRole
            : null,
      };
    } catch (err) {
      logger.warn('[rb-api] app session bridge refresh error', err);
      return {
        success: false,
        error: '가람Link 세션 재동기화 중 오류가 발생했습니다.',
        errorCode: 'network_error',
      };
    }
  })();

  try {
    return await bridgeRefreshPromise;
  } finally {
    bridgeRefreshPromise = null;
  }
}

type RbBridgeLoginResult = {
  success: boolean;
  user?: RbUser;
  error?: string;
  errorCode?: string;
};

async function bridgeLogin(
  bridgeToken?: string,
  allowRefresh = true,
): Promise<RbBridgeLoginResult> {
  let tokenFromStorage = bridgeToken ?? (await getStoredBridgeToken());
  if (!tokenFromStorage) {
    const refreshed = await refreshBridgeTokenFromAppSession();
    if (refreshed.success) {
      tokenFromStorage = refreshed.bridgeToken ?? (await getStoredBridgeToken());
    } else {
      return {
        success: false,
        error: refreshed.error ?? '브릿지 토큰이 없습니다.',
        errorCode: refreshed.errorCode ?? 'missing_bridge_token',
      };
    }
  }

  if (!tokenFromStorage) {
    return { success: false, error: '브릿지 토큰이 없습니다.', errorCode: 'missing_bridge_token' };
  }

  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/auth/bridge-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bridgeToken: tokenFromStorage }),
    });
    const json = await res.json();

    if (!json.success || !json.data?.token) {
      if (allowRefresh && !bridgeToken) {
        const refreshed = await refreshBridgeTokenFromAppSession();
        if (refreshed.success && refreshed.bridgeToken && refreshed.bridgeToken !== tokenFromStorage) {
          return bridgeLogin(refreshed.bridgeToken, false);
        }
        if (!refreshed.success) {
          return {
            success: false,
            error: refreshed.error ?? json.error ?? json.message ?? '브릿지 로그인 실패',
            errorCode: refreshed.errorCode ?? 'bridge_login_failed',
          };
        }
      }

      const hasAppSessionToken = Boolean(await getStoredAppSessionToken());
      return {
        success: false,
        error: json.error ?? json.message ?? '브릿지 로그인 실패',
        errorCode: hasAppSessionToken ? 'bridge_login_failed' : 'invalid_bridge_token',
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
    await storeAuth(json.data.token, user);
    return { success: true, user };
  } catch (err) {
    logger.warn('[rb-api] bridge login error', err);
    return {
      success: false,
      error: isAbortError(err)
        ? '가람Link 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.'
        : '서버에 연결할 수 없습니다.',
      errorCode: 'network_error',
    };
  }
}

export async function rbBridgeLogin(bridgeToken?: string) {
  return bridgeLogin(bridgeToken);
}

/* ─── HTTP helpers ─── */

async function rbFetch<T>(
  path: string,
  options: RequestInit = {},
  allowRetry = true,
): Promise<{ success: boolean; data?: T; error?: string }> {
  const token = await getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const url = `${BASE_URL}${path}`;

  try {
    const res = await fetchWithTimeout(url, {
      ...options,
      headers,
    });

    // Only clear auth on 401 (token expired/invalid), NOT on 403 (forbidden/role mismatch)
    if (res.status === 401) {
      logger.warn(`[rb-api] 401 Unauthorized: ${path}`);
      if (allowRetry && path !== '/api/auth/bridge-login') {
        const relogin = await bridgeLogin();
        if (relogin.success) {
          return rbFetch<T>(path, options, false);
        }
      }
      await clearAuth();
      return { success: false, error: '인증이 만료되었습니다. 앱에서 다시 로그인해주세요.' };
    }

    if (res.status === 403) {
      logger.warn(`[rb-api] 403 Forbidden: ${path}`);
      return { success: false, error: '접근 권한이 없습니다.' };
    }

    if (!res.ok) {
      logger.warn(`[rb-api] HTTP ${res.status}: ${path}`);
      try {
        const errJson = await res.json();
        return { success: false, error: errJson.error ?? `서버 오류 (${res.status})` };
      } catch {
        return { success: false, error: `서버 오류 (${res.status})` };
      }
    }

    const json = await res.json();

    if (!json.success) {
      logger.warn(`[rb-api] API error: ${path}`, json.error);
    }

    return json;
  } catch (err) {
    logger.warn(`[rb-api] network error: ${path}`, err);
    return {
      success: false,
      error: isAbortError(err)
        ? '가람Link 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.'
        : '서버에 연결할 수 없습니다.',
    };
  }
}

/* ─── Auth ─── */

export async function rbLogin(
  phone: string,
  password: string,
): Promise<{ success: boolean; user?: RbUser; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone.trim(), password }),
    });
    const json = await res.json();

    if (!json.success || !json.data?.token) {
      return { success: false, error: json.error ?? json.message ?? '로그인 실패' };
    }

    const user: RbUser = {
      id: json.data.user.id,
      name: json.data.user.name,
      email: json.data.user.email,
      phone: json.data.user.phone,
      role: json.data.user.role,
      affiliation: json.data.user.affiliation ?? undefined,
    };
    await storeAuth(json.data.token, user);
    logger.info(`[rb-api] login success: userId=${user.id}, role=${user.role}`);
    return { success: true, user };
  } catch (err) {
    logger.warn('[rb-api] login error', err);
    return {
      success: false,
      error: isAbortError(err)
        ? '가람Link 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.'
        : '서버에 연결할 수 없습니다.',
    };
  }
}

export async function rbCheckAuth(): Promise<{
  authenticated: boolean;
  user?: RbUser;
  error?: string;
  needsRelogin?: boolean;
}> {
  const token = await getStoredToken();
  if (!token) {
    const bridged = await bridgeLogin();
    if (bridged.success && bridged.user) {
      return { authenticated: true, user: bridged.user };
    }
    return {
      authenticated: false,
      error: bridged.error,
      needsRelogin: bridged.errorCode === 'missing_session_token'
        || bridged.errorCode === 'invalid_session_token'
        || bridged.errorCode === 'invalid_bridge_token'
        || bridged.errorCode === 'request_board_not_applicable'
        || bridged.errorCode === 'not_found'
        || bridged.errorCode === 'inactive_account'
        || bridged.errorCode === 'not_completed'
        || bridged.errorCode === 'bridge_refresh_failed',
    };
  }

  const res = await rbFetch<RbUser>('/api/auth/me');
  if (res.success && res.data) {
    cachedUser = res.data;
    const hasRecoveryToken = Boolean((await getStoredBridgeToken()) || (await getStoredAppSessionToken()));
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
  await clearAuth();
  return { authenticated: false };
}

/* ─── Conversations (Request-based) ─── */

export async function rbGetConversations(): Promise<RbConversation[]> {
  const res = await rbFetch<RbConversation[]>('/api/messages/conversations');
  if (res.success && res.data) {
    logger.info(`[rb-api] conversations loaded: ${res.data.length} items`);
    return res.data;
  }
  logger.warn('[rb-api] conversations failed:', res.error);
  return [];
}

/* ─── Messages ─── */

export async function rbGetMessages(
  conversationIds: number[],
  limit = 50,
): Promise<RbMessage[]> {
  if (conversationIds.length === 0) return [];
  const ids = conversationIds.join(',');
  const res = await rbFetch<RbMessage[]>(
    `/api/messages/by-conversations?ids=${ids}&markRead=true&limit=${limit}`,
  );
  if (res.success && res.data) {
    return res.data;
  }
  logger.warn(`[rb-api] messages fetch failed for ids=${ids}:`, res.error);
  return [];
}

export async function rbSendMessage(
  requestDesignerId: number,
  message: string,
  attachments?: RbAttachmentMeta[],
): Promise<{ success: boolean; data?: RbMessage; error?: string }> {
  return rbFetch<RbMessage>(`/api/messages/${requestDesignerId}`, {
    method: 'POST',
    body: JSON.stringify({ message, ...(attachments?.length ? { attachments } : {}) }),
  });
}

/* ─── DM Conversations ─── */

export async function rbGetDmConversations(): Promise<RbDmConversation[]> {
  const res = await rbFetch<RbDmConversation[]>('/api/direct-messages/conversations');
  if (res.success && res.data) {
    logger.info(`[rb-api] DM conversations loaded: ${res.data.length} items`);
    return res.data;
  }
  logger.warn('[rb-api] DM conversations failed:', res.error);
  return [];
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
  const res = await rbFetch<RbPresenceSnapshot[]>(`/api/presence?${params.toString()}`);
  if (res.success && res.data) {
    return res.data;
  }
  logger.warn('[rb-api] presence fetch failed:', res.error);
  return [];
}

export async function rbGetDmMessages(
  conversationId: number,
  limit = 50,
): Promise<RbDmMessage[]> {
  const res = await rbFetch<RbDmMessage[]>(
    `/api/direct-messages/${conversationId}?limit=${limit}`,
  );
  if (res.success && res.data) {
    return res.data;
  }
  logger.warn(`[rb-api] DM messages fetch failed for id=${conversationId}:`, res.error);
  return [];
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

/* ─── File Upload ─── */

export async function rbUploadAttachments(
  files: { uri: string; name: string; type: string }[],
): Promise<{ success: boolean; data?: RbAttachmentMeta[]; error?: string }> {
  const token = await getStoredToken();
  const formData = new FormData();

  for (const file of files) {
    formData.append('files', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any);
  }

  try {
    const res = await fetch(`${BASE_URL}/api/messages/attachments/upload`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // Do NOT set Content-Type - fetch auto-sets multipart/form-data with boundary
      },
      body: formData,
    });

    if (res.status === 401) {
      await clearAuth();
      return { success: false, error: '인증이 만료되었습니다.' };
    }

    if (!res.ok) {
      logger.warn(`[rb-api] upload failed: HTTP ${res.status}`);
      return { success: false, error: `파일 업로드 실패 (${res.status})` };
    }

    const json = await res.json();
    if (json.success && json.data?.attachments) {
      logger.info(`[rb-api] uploaded ${json.data.attachments.length} files`);
      return { success: true, data: json.data.attachments };
    }
    return { success: false, error: json.error ?? '파일 업로드 실패' };
  } catch (err) {
    logger.warn('[rb-api] upload error', err);
    return { success: false, error: '파일 업로드에 실패했습니다.' };
  }
}

/* ─── Designers ─── */

export type RbDesigner = {
  id: number;
  company_name: string | null;
  users: { id: number; name: string; email?: string; phone?: string; affiliation?: string | null } | null;
  designer_products?: { product_id: number; insurance_products: { id: number; name: string; icon?: string } }[];
};

export async function rbGetDesigners(search?: string): Promise<RbDesigner[]> {
  const params = new URLSearchParams({ limit: '100' });
  if (search) params.set('search', search);
  const res = await rbFetch<RbDesigner[]>(`/api/designers?${params}`);
  if (res.success && res.data) {
    logger.info(`[rb-api] designers loaded: ${res.data.length} items`);
    return res.data;
  }
  logger.warn('[rb-api] designers failed:', res.error);
  return [];
}

export type RbDirectMessageUser = {
  id: number;
  name: string;
  role: 'fc' | 'designer';
  phone: string | null;
  company_name?: string | null;
  affiliation?: string | null;
};

export async function rbGetDirectMessageUsers(
  search?: string,
  role?: 'fc' | 'designer',
): Promise<RbDirectMessageUser[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (role) params.set('role', role);

  const query = params.toString();
  const res = await rbFetch<RbDirectMessageUser[]>(`/api/direct-messages/users${query ? `?${query}` : ''}`);
  if (res.success && res.data) {
    logger.info(`[rb-api] direct message users loaded: ${res.data.length} items`);
    return res.data;
  }
  logger.warn('[rb-api] direct message users failed:', res.error);
  return [];
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

export async function rbGetUnreadCount(): Promise<number> {
  const [msg, dm] = await Promise.all([
    rbFetch<{ count: number }>('/api/messages/unread/count'),
    rbFetch<{ count: number }>('/api/direct-messages/unread/count'),
  ]);
  return (msg.data?.count ?? 0) + (dm.data?.count ?? 0);
}

/* ─── Request Stats ─── */

export type RbRequestSummary = {
  id: number;
  status?: string;
  assignmentStatus?: string;
  completedAt?: string | null;
  completed_at?: string | null;
  processingDays?: number;
  processing_days?: number;
  customer_name?: string;
  request_designers?: { status: string; fc_decision?: string | null }[];
};

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
  created_at: string;
  request_products?: {
    product_id: number;
    insurance_products?: { id: number; name: string; icon?: string | null } | null;
  }[];
  request_designers?: {
    id: number;
    designer_id: number;
    status: string;
    fc_decision: 'pending' | 'accepted' | 'rejected' | null;
    completed_at?: string | null;
    designers?: {
      id: number;
      company_name: string | null;
      users?: { id: number; name: string } | null;
    } | null;
  }[];
};

export type RbRequestDetail = {
  id: number;
  status: string;
  customer_name: string;
  customer_ssn?: string | null;
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

export async function rbGetRequestList(): Promise<RbRequestListItem[]> {
  const res = await rbFetch<unknown>('/api/requests?limit=100&page=1');
  if (!res.success || res.data == null) return [];
  if (Array.isArray(res.data)) return res.data as RbRequestListItem[];
  const obj = res.data as Record<string, unknown>;
  const arr = obj.requests ?? obj.data;
  return Array.isArray(arr) ? (arr as RbRequestListItem[]) : [];
}

export async function rbGetRequestDetail(id: number): Promise<RbRequestDetail | null> {
  const res = await rbFetch<RbRequestDetail>(`/api/requests/${id}`);
  if (!res.success || !res.data) return null;
  return res.data;
}

export async function rbApproveDesign(
  requestId: number,
  designerId: number,
): Promise<{ success: boolean; error?: string; message?: string }> {
  return rbFetch(`/api/requests/${requestId}/designers/${designerId}/fc-accept`, {
    method: 'POST',
  });
}

export async function rbRejectDesign(
  requestId: number,
  designerId: number,
  reason: string,
): Promise<{ success: boolean; error?: string; message?: string }> {
  return rbFetch(`/api/requests/${requestId}/designers/${designerId}/fc-reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function rbGetRequests(): Promise<RbRequestSummary[]> {
  const res = await rbFetch<unknown>('/api/requests?limit=500&page=1');
  if (!res.success || res.data == null) return [];
  if (Array.isArray(res.data)) return res.data as RbRequestSummary[];
  const obj = res.data as Record<string, unknown>;
  const arr = obj.requests ?? obj.data;
  return Array.isArray(arr) ? (arr as RbRequestSummary[]) : [];
}

/* ─── FC Company Codes ─── */

export type RbFcCode = {
  id: number;
  insurer_name: string;
  code_value: string;
  is_active?: boolean;
  updated_at: string;
};

export async function rbGetFcCodes(): Promise<RbFcCode[]> {
  const res = await rbFetch<RbFcCode[]>('/api/fc-codes');
  if (res.success && Array.isArray(res.data)) return res.data;
  return [];
}

export async function rbGetCompanyNames(): Promise<string[]> {
  const res = await rbFetch<string[]>('/api/fc-codes/company-names');
  if (res.success && Array.isArray(res.data)) return res.data;
  return [];
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
