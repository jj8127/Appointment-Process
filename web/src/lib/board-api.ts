import { logger } from '@/lib/logger';
import { redactSensitiveText } from '@/lib/sensitive-text';

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

async function invokeBoardResponse<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<InvokeResult<T>> {
  const response = await fetch('/api/board', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify({ functionName: name, body }),
  });

  let payload: InvokeResult<T> | null = null;
  try {
    payload = await response.json() as InvokeResult<T>;
  } catch {
    throw new Error('게시판 요청을 처리하지 못했습니다.');
  }

  if (!response.ok || !payload?.ok) {
    const fallback = response.status === 400
      ? '요청이 올바르지 않습니다. 첨부파일 개수/용량을 확인해주세요.'
      : '요청에 실패했습니다.';
    throw new Error(payload?.message ?? fallback);
  }
  return payload;
}

async function invokeBoard<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const payload = await invokeBoardResponse<T>(name, body);
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

async function invokeBoardWrite<T>(
  name: 'board-create' | 'board-update',
  body: Record<string, unknown>,
): Promise<{ data: T } & BoardWriteResult> {
  const payload = await invokeBoardResponse<T>(name, body);
  return {
    data: payload.data as T,
    ...normalizeBoardWriteResult(payload),
  };
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

function sanitizeBoardListItem(item: BoardListItem): BoardListItem {
  return {
    ...item,
    title: redactSensitiveText(item.title, '게시글'),
    contentPreview: redactSensitiveText(item.contentPreview),
    authorName: redactSensitiveText(item.authorName, '작성자'),
    attachments: item.attachments?.map((attachment) => ({
      ...attachment,
      fileName: redactSensitiveText(attachment.fileName, 'file'),
    })),
  };
}

function sanitizeBoardDetail(detail: BoardDetail): BoardDetail {
  return {
    ...detail,
    post: {
      ...detail.post,
      title: redactSensitiveText(detail.post.title, '게시글'),
      content: redactSensitiveText(detail.post.content),
      authorName: redactSensitiveText(detail.post.authorName, '작성자'),
    },
    attachments: detail.attachments.map((attachment) => ({
      ...attachment,
      fileName: redactSensitiveText(attachment.fileName, 'file'),
    })),
    comments: detail.comments.map((comment) => ({
      ...comment,
      content: redactSensitiveText(comment.content),
      authorName: redactSensitiveText(comment.authorName, '작성자'),
    })),
  };
}

export async function fetchBoardList(actor: BoardActor, params: BoardListParams) {
  const result = await invokeBoard<{ items: BoardListItem[]; nextCursor?: string | null }>('board-list', {
    actor,
    ...params,
  });
  return {
    ...result,
    items: result.items.map(sanitizeBoardListItem),
  };
}

export async function fetchBoardCategories(actor: BoardActor) {
  return invokeBoard<BoardCategory[]>('board-categories-list', { actor });
}

export async function fetchBoardDetail(actor: BoardActor, postId: string) {
  const result = await invokeBoard<BoardDetail>('board-detail', { actor, postId });
  return sanitizeBoardDetail(result);
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
