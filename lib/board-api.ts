import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { getStoredAppSessionToken } from '@/lib/request-board-api';

export type BoardActorRole = 'admin' | 'manager' | 'fc';
export type BoardDisplayRole = 'admin' | 'manager' | 'fc' | 'developer';

export type BoardActor = {
  role: BoardActorRole;
  residentId: string;
  displayName: string;
};

export type BoardCategory = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
};

export type BoardListParams = {
  categoryId?: string;
  search?: string;
  sort?: 'created' | 'latest' | 'comments' | 'reactions';
  order?: 'asc' | 'desc';
  cursor?: string;
  limit?: number;
};

export type BoardListItem = {
  id: string;
  categoryId: string;
  title: string;
  contentPreview: string;
  authorName: string;
  authorRole: BoardDisplayRole;
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  isPinned: boolean;
  isMine: boolean;
  stats: {
    commentCount: number;
    reactionCount: number;
    attachmentCount: number;
    viewCount: number;
  };
  reactions?: {
    like: number;
    heart: number;
    check: number;
    smile: number;
  };
  attachments?: {
    id: string;
    fileType: 'image' | 'file';
    fileName: string;
    fileSize: number;
    storagePath: string;
    signedUrl?: string;
  }[];
};

export type BoardDetail = {
  post: {
    id: string;
    categoryId: string;
    title: string;
    content: string;
    authorName: string;
    authorRole: BoardDisplayRole;
    createdAt: string;
    updatedAt: string;
    editedAt?: string;
    isPinned: boolean;
    isMine: boolean;
    viewCount: number;
  };
  attachments: {
    id: string;
    fileType: 'image' | 'file';
    fileName: string;
    fileSize: number;
    mimeType?: string;
    storagePath: string;
    signedUrl?: string;
  }[];
  reactions: {
    like: number;
    heart: number;
    check: number;
    smile: number;
    myReaction?: 'like' | 'heart' | 'check' | 'smile' | null;
  };
  comments: {
    id: string;
    parentId?: string | null;
    content: string;
    authorName: string;
    authorRole: BoardDisplayRole;
    createdAt: string;
    editedAt?: string;
    stats: { likeCount: number; replyCount: number };
    isMine: boolean;
    isLiked: boolean;
  }[];
};

export type BoardPushDeliveryResult = {
  targetRole: 'admin' | 'fc';
  ok: boolean;
  sent: number;
  logged: boolean;
  failure?:
    | 'missing_configuration'
    | 'upstream_rejected'
    | 'invalid_response'
    | 'delivery_unconfirmed'
    | 'request_failed';
};

export type BoardWriteNotification = {
  ok: boolean;
  inbox: {
    ok: boolean;
    attempted: number;
  };
  push: {
    ok: boolean;
    attempted: number;
    confirmed: number;
    targets: BoardPushDeliveryResult[];
  };
};

export type BoardWriteResult = {
  saved: boolean;
  notification: BoardWriteNotification | null;
  notificationWarning: string | null;
};

export type BoardCreateResult = BoardWriteResult & {
  id: string;
};

type InvokeResult<T> = {
  ok: boolean;
  data?: T;
  message?: string;
  saved?: boolean;
  notification?: BoardWriteNotification;
  notificationWarning?: string | null;
};

export type BoardFunctionName =
  | 'board-attachment-delete'
  | 'board-attachment-finalize'
  | 'board-attachment-sign'
  | 'board-categories-list'
  | 'board-category-create'
  | 'board-category-update'
  | 'board-comment-create'
  | 'board-comment-delete'
  | 'board-comment-like-toggle'
  | 'board-comment-update'
  | 'board-create'
  | 'board-delete'
  | 'board-detail'
  | 'board-list'
  | 'board-pin'
  | 'board-reaction-toggle'
  | 'board-update';

type BoardInvokeOptions = {
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

type BoardInvokeTransport = (
  name: BoardFunctionName,
  options: BoardInvokeOptions,
) => Promise<{ data: unknown; error: unknown }>;

export class BoardSessionError extends Error {
  readonly code = 'missing_app_session';
  readonly status = 401;

  constructor(message = '게시판 세션이 없습니다. 다시 로그인해주세요.') {
    super(message);
    this.name = 'BoardSessionError';
  }
}

async function extractFunctionsErrorMessage(error: unknown): Promise<string | null> {
  if (!error || typeof error !== 'object') return null;
  const withContext = error as {
    context?: {
      bodyUsed?: boolean;
      json?: () => Promise<unknown>;
      text?: () => Promise<string>;
    };
  };
  const context = withContext.context;
  if (!context) return null;

  if (typeof context.json === 'function' && !context.bodyUsed) {
    try {
      const payload = await context.json() as { message?: string; code?: string } | null;
      if (payload?.message) return payload.message;
      if (payload?.code) return payload.code;
    } catch {
      // fall through to text parsing
    }
  }

  if (typeof context.text === 'function' && !context.bodyUsed) {
    try {
      const raw = await context.text();
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { message?: string; code?: string };
      if (parsed?.message) return parsed.message;
      if (parsed?.code) return parsed.code;
      return raw;
    } catch {
      return null;
    }
  }

  return null;
}

async function invokeBoardResponseWithDeps<T>(
  name: BoardFunctionName,
  body: Record<string, unknown>,
  deps: {
    getStoredAppSessionToken: () => Promise<string | null>;
    invoke: BoardInvokeTransport;
  },
): Promise<InvokeResult<T>> {
  const storedAppSessionToken = await deps.getStoredAppSessionToken();
  const appSessionToken = String(storedAppSessionToken ?? '').trim();
  if (!appSessionToken) {
    throw new BoardSessionError();
  }

  const { data, error } = await deps.invoke(name, {
    body,
    headers: {
      'x-app-session-token': appSessionToken,
    },
  });
  if (error) {
    const message = await extractFunctionsErrorMessage(error);
    if (message) {
      throw new Error(message);
    }
    const status = (error as { context?: { status?: number } })?.context?.status;
    const fallback = status === 400
      ? '요청이 올바르지 않습니다. 첨부파일 개수/용량을 확인해주세요.'
      : null;
    const rawMessage = typeof (error as { message?: unknown })?.message === 'string'
      ? (error as { message: string }).message
      : null;
    throw new Error(fallback ?? rawMessage ?? '요청에 실패했습니다.');
  }
  const payload = data as InvokeResult<T> | null;
  if (!payload?.ok) {
    throw new Error(payload?.message ?? '요청에 실패했습니다.');
  }
  return payload;
}

export async function invokeBoardWithDeps<T>(
  name: BoardFunctionName,
  body: Record<string, unknown>,
  deps: {
    getStoredAppSessionToken: () => Promise<string | null>;
    invoke: BoardInvokeTransport;
  },
): Promise<T> {
  const payload = await invokeBoardResponseWithDeps<T>(name, body, deps);
  return payload.data as T;
}

function normalizeBoardWriteResult(payload: InvokeResult<unknown>): BoardWriteResult {
  const notification = payload.notification ?? null;
  const explicitWarning = typeof payload.notificationWarning === 'string'
    && payload.notificationWarning.trim()
    ? payload.notificationWarning.trim()
    : null;

  return {
    // Older compatible Edge responses did not expose `saved`, while `ok: true`
    // already meant that the durable write completed.
    saved: payload.saved !== false,
    notification,
    notificationWarning: explicitWarning
      ?? (notification?.ok === false ? 'notification_delivery_incomplete' : null),
  };
}

export async function invokeBoardWriteWithDeps<T>(
  name: 'board-create' | 'board-update',
  body: Record<string, unknown>,
  deps: {
    getStoredAppSessionToken: () => Promise<string | null>;
    invoke: BoardInvokeTransport;
  },
): Promise<{ data: T } & BoardWriteResult> {
  const payload = await invokeBoardResponseWithDeps<T>(name, body, deps);
  return {
    data: payload.data as T,
    ...normalizeBoardWriteResult(payload),
  };
}

async function invokeBoard<T>(name: BoardFunctionName, body: Record<string, unknown>): Promise<T> {
  return invokeBoardWithDeps<T>(name, body, {
    getStoredAppSessionToken,
    invoke: async (functionName, options) => {
      const { data, error } = await supabase.functions.invoke(functionName, options);
      return { data, error };
    },
  });
}

async function invokeBoardWrite<T>(
  name: 'board-create' | 'board-update',
  body: Record<string, unknown>,
): Promise<{ data: T } & BoardWriteResult> {
  return invokeBoardWriteWithDeps<T>(name, body, {
    getStoredAppSessionToken,
    invoke: async (functionName, options) => {
      const { data, error } = await supabase.functions.invoke(functionName, options);
      return { data, error };
    },
  });
}

export function buildBoardActor(session: {
  role: 'admin' | 'fc' | 'manager' | null;
  residentId: string;
  displayName: string;
  readOnly?: boolean;
}): BoardActor | null {
  if (!session.role || !session.residentId) return null;
  if (session.role === 'manager') {
    return {
      role: 'manager',
      residentId: session.residentId,
      displayName: session.displayName ?? '',
    };
  }
  if (session.role === 'admin' && session.readOnly) {
    return {
      role: 'manager',
      residentId: session.residentId,
      displayName: session.displayName ?? '',
    };
  }
  return {
    role: session.role,
    residentId: session.residentId,
    displayName: session.displayName ?? '',
  };
}

export async function fetchBoardList(actor: BoardActor, params: BoardListParams) {
  return invokeBoard<{ items: BoardListItem[]; nextCursor?: string | null }>('board-list', {
    actor,
    ...params,
  });
}

export async function fetchBoardCategories(actor: BoardActor) {
  return invokeBoard<BoardCategory[]>('board-categories-list', { actor });
}

export async function fetchBoardDetail(actor: BoardActor, postId: string) {
  return invokeBoard<BoardDetail>('board-detail', { actor, postId });
}

export async function createBoardPost(
  actor: BoardActor,
  payload: { categoryId: string; title: string; content: string },
): Promise<BoardCreateResult> {
  const result = await invokeBoardWrite<{ id: string }>('board-create', { actor, ...payload });
  return {
    id: result.data.id,
    saved: result.saved,
    notification: result.notification,
    notificationWarning: result.notificationWarning,
  };
}

export async function updateBoardPost(actor: BoardActor, payload: {
  postId: string;
  categoryId?: string;
  title?: string;
  content?: string;
  attachmentOrder?: string[];
}): Promise<BoardWriteResult> {
  const result = await invokeBoardWrite<null>('board-update', { actor, ...payload });
  return {
    saved: result.saved,
    notification: result.notification,
    notificationWarning: result.notificationWarning,
  };
}

export function getBoardNotificationWarningMessage(notificationWarning?: string | null) {
  if (!notificationWarning) return null;
  logger.warn('[board] notification delivery unconfirmed', { notificationWarning });
  return null;
}

export async function deleteBoardPost(actor: BoardActor, postId: string) {
  return invokeBoard<null>('board-delete', { actor, postId });
}

export async function pinBoardPost(actor: BoardActor, postId: string, isPinned: boolean) {
  return invokeBoard<null>('board-pin', { actor, postId, isPinned });
}

export async function createBoardComment(actor: BoardActor, payload: { postId: string; content: string; parentId?: string }) {
  return invokeBoard<{ id: string }>('board-comment-create', { actor, ...payload });
}

export async function updateBoardComment(actor: BoardActor, payload: { commentId: string; content: string }) {
  return invokeBoard<null>('board-comment-update', { actor, ...payload });
}

export async function deleteBoardComment(actor: BoardActor, commentId: string) {
  return invokeBoard<null>('board-comment-delete', { actor, commentId });
}

export async function toggleBoardReaction(actor: BoardActor, postId: string, reactionType: 'like' | 'heart' | 'check' | 'smile') {
  return invokeBoard<{ myReaction: 'like' | 'heart' | 'check' | 'smile' | null }>('board-reaction-toggle', {
    actor,
    postId,
    reactionType,
  });
}

export async function toggleCommentLike(actor: BoardActor, commentId: string) {
  return invokeBoard<{ liked: boolean; likeCount: number }>('board-comment-like-toggle', { actor, commentId });
}

export async function signBoardAttachments(
  actor: BoardActor,
  postId: string,
  files: {
    fileName: string;
    mimeType: string;
    fileSize: number;
    fileType: 'image' | 'file';
    storagePath?: string;
  }[],
) {
  return invokeBoard<{ storagePath: string; signedUrl: string }[]>('board-attachment-sign', {
    actor,
    postId,
    files,
  });
}

export async function finalizeBoardAttachments(
  actor: BoardActor,
  postId: string,
  files: {
    storagePath: string;
    fileName: string;
    fileSize: number;
    mimeType?: string;
    fileType: 'image' | 'file';
    sortOrder?: number;
  }[],
) {
  return invokeBoard<null>('board-attachment-finalize', { actor, postId, files });
}

export async function deleteBoardAttachments(actor: BoardActor, postId: string, attachmentIds: string[]) {
  return invokeBoard<null>('board-attachment-delete', { actor, postId, attachmentIds });
}

export function formatFileSize(bytes?: number) {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)}${units[idx]}`;
}

export function logBoardError(scope: string, error: unknown) {
  logger.error(`[board] ${scope} error`, error);
}
