/**
 * request_board API client for fc-onboarding-app.
 * Handles authentication, conversation listing, message fetch/send.
 */
import { logger } from './logger';
import { safeStorage } from './safe-storage';

const BASE_URL = (
  process.env.EXPO_PUBLIC_REQUEST_BOARD_URL || 'https://requestboard-steel.vercel.app'
).replace(/\/$/, '');

const STORAGE_KEY_TOKEN = 'rb_jwt_token';
const STORAGE_KEY_USER = 'rb_user';

/* ─── Types ─── */

export type RbUser = {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: 'fc' | 'designer';
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
  fc: { id: number; name: string } | null;
  designer: {
    id: number;
    company_name: string | null;
    users: { id: number; name: string } | null;
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
  sender?: { id: number; name: string; role: string };
  message_attachments?: RbAttachment[];
};

export type RbDmConversation = {
  id: number;
  type: 'direct';
  participant: { id: number; name: string; role: string } | null;
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

export type RbDmMessage = {
  id: number;
  direct_conversation_id: number;
  sender_id: number;
  message: string;
  is_read: boolean;
  created_at: string;
  deleted_at?: string | null;
  sender?: { id: number; name: string; role: string };
  direct_message_attachments?: RbAttachment[];
};

/* ─── Token Management ─── */

let cachedToken: string | null = null;
let cachedUser: RbUser | null = null;

export async function getStoredToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = await safeStorage.getItem(STORAGE_KEY_TOKEN);
    return cachedToken;
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

export async function clearAuth() {
  cachedToken = null;
  cachedUser = null;
  await safeStorage.removeItem(STORAGE_KEY_TOKEN);
  await safeStorage.removeItem(STORAGE_KEY_USER);
}

/* ─── HTTP helpers ─── */

async function rbFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ success: boolean; data?: T; error?: string }> {
  const token = await getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const url = `${BASE_URL}${path}`;

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });

    // Only clear auth on 401 (token expired/invalid), NOT on 403 (forbidden/role mismatch)
    if (res.status === 401) {
      logger.warn(`[rb-api] 401 Unauthorized: ${path}`);
      await clearAuth();
      return { success: false, error: '인증이 만료되었습니다. 다시 로그인해주세요.' };
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
    return { success: false, error: '서버에 연결할 수 없습니다.' };
  }
}

/* ─── Auth ─── */

export async function rbLogin(
  phone: string,
  password: string,
): Promise<{ success: boolean; user?: RbUser; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
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
    };
    await storeAuth(json.data.token, user);
    logger.info(`[rb-api] login success: userId=${user.id}, role=${user.role}`);
    return { success: true, user };
  } catch (err) {
    logger.warn('[rb-api] login error', err);
    return { success: false, error: '서버에 연결할 수 없습니다.' };
  }
}

export async function rbCheckAuth(): Promise<{ authenticated: boolean; user?: RbUser }> {
  const token = await getStoredToken();
  if (!token) return { authenticated: false };

  const res = await rbFetch<RbUser>('/api/auth/me');
  if (res.success && res.data) {
    cachedUser = res.data;
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
  users: { id: number; name: string; email?: string; phone?: string } | null;
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

/* ─── Create DM Conversation ─── */

export async function rbCreateDmConversation(
  participantId: number,
): Promise<{ success: boolean; data?: { id: number; type: string; participant: { id: number; name: string; role: string }; isNew: boolean }; error?: string }> {
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
