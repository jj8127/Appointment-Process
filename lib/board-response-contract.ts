import { isCredentialFreeHttpsUrl } from './external-url.ts';
import { CANONICAL_BOARD_CATEGORIES } from '../supabase/functions/_shared/board-categories.ts';

export type BoardAttachmentSignRow = {
  storagePath: string;
  signedUrl: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isString = (value: unknown): value is string => typeof value === 'string';
const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);
const isOptionalString = (value: unknown) => value === undefined || isString(value);
const isNonNegativeInteger = (value: unknown) => (
  Number.isSafeInteger(value) && Number(value) >= 0
);
const isDisplayRole = (value: unknown) => (
  value === 'admin' || value === 'manager' || value === 'fc' || value === 'developer'
);
const isReactionType = (value: unknown) => (
  value === 'like' || value === 'heart' || value === 'check' || value === 'smile'
);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOARD_NOTIFICATION_EVENT_PATTERN = /^board-post:[0-9a-f]{64}$/;

function isBoardUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
function hasUniqueStringValues(values: unknown[]): boolean {
  return values.every(isString) && new Set(values).size === values.length;
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function sameUuid(actual: unknown, expected: unknown): boolean {
  return isBoardUuid(actual)
    && isBoardUuid(expected)
    && actual.toLowerCase() === expected.toLowerCase();
}

function isBoardAttachment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id)
    && (value.fileType === 'image' || value.fileType === 'file')
    && typeof value.fileName === 'string'
    && isNonNegativeInteger(value.fileSize)
    && isNonEmptyString(value.storagePath)
    && (value.mimeType === undefined || typeof value.mimeType === 'string')
    && (value.signedUrl === undefined || isCredentialFreeHttpsUrl(value.signedUrl));
}

type ReactionCounts = {
  like: number;
  heart: number;
  check: number;
  smile: number;
  myReaction?: unknown;
};

function isReactionCounts(value: unknown, includeMine = false): value is ReactionCounts {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.like)
    || !isNonNegativeInteger(value.heart)
    || !isNonNegativeInteger(value.check)
    || !isNonNegativeInteger(value.smile)) return false;
  return !includeMine
    || value.myReaction === undefined
    || value.myReaction === null
    || isReactionType(value.myReaction);
}

function isBoardListItem(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.categoryId)
    && isString(value.title)
    && isString(value.contentPreview)
    && isString(value.authorName)
    && isDisplayRole(value.authorRole)
    && isNonEmptyString(value.createdAt)
    && isNonEmptyString(value.updatedAt)
    && isOptionalString(value.editedAt)
    && typeof value.isPinned === 'boolean'
    && typeof value.isMine === 'boolean'
    && isRecord(value.stats)
    && isNonNegativeInteger(value.stats.commentCount)
    && isNonNegativeInteger(value.stats.reactionCount)
    && isNonNegativeInteger(value.stats.attachmentCount)
    && isNonNegativeInteger(value.stats.viewCount)
    && isReactionCounts(value.reactions)
    && value.stats.reactionCount === value.reactions.like
      + value.reactions.heart
      + value.reactions.check
      + value.reactions.smile
    && Array.isArray(value.attachments)
    && value.stats.attachmentCount === value.attachments.length
    && value.attachments.every(isBoardAttachment)
    && hasUniqueStringValues(value.attachments.map((attachment) => (
      isRecord(attachment) ? attachment.id : undefined
    )));
}

function isBoardComment(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && (value.parentId === undefined || value.parentId === null || isString(value.parentId))
    && isString(value.content)
    && isString(value.authorName)
    && isDisplayRole(value.authorRole)
    && isNonEmptyString(value.createdAt)
    && isOptionalString(value.editedAt)
    && isRecord(value.stats)
    && isNonNegativeInteger(value.stats.likeCount)
    && isNonNegativeInteger(value.stats.replyCount)
    && typeof value.isMine === 'boolean'
    && typeof value.isLiked === 'boolean';
}

export function hasValidBoardCategories(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== CANONICAL_BOARD_CATEGORIES.length) return false;
  const canonicalBySlug = new Map<string, (typeof CANONICAL_BOARD_CATEGORIES)[number]>(
    CANONICAL_BOARD_CATEGORIES.map((category) => [category.slug, category]),
  );
  return value.every((category) => {
    if (!isRecord(category)
      || !isNonEmptyString(category.id)
      || !isNonEmptyString(category.slug)
      || category.isActive !== true) return false;
    const canonical = canonicalBySlug.get(category.slug);
    return canonical !== undefined
      && category.name === canonical.name
      && category.sortOrder === canonical.sortOrder;
  })
    && hasUniqueStringValues(value.map((category) => (
      isRecord(category) ? category.id : undefined
    )))
    && hasUniqueStringValues(value.map((category) => (
      isRecord(category) ? category.slug : undefined
    )));
}

export function hasValidBoardListAttachmentUrls(value: unknown): boolean {
  if (!isRecord(value)
    || !Array.isArray(value.items)
    || (value.nextCursor !== undefined
      && value.nextCursor !== null
      && !isNonEmptyString(value.nextCursor))) {
    return false;
  }
  return value.items.every(isBoardListItem)
    && hasUniqueStringValues(value.items.map((item) => (
      isRecord(item) ? item.id : undefined
    )));
}

export function hasValidBoardDetailAttachmentUrls(
  value: unknown,
  expectedPostId?: string,
): boolean {
  if (!isRecord(value)
    || !isRecord(value.post)
    || !isNonEmptyString(value.post.id)
    || (expectedPostId !== undefined && value.post.id !== expectedPostId)
    || !isNonEmptyString(value.post.categoryId)
    || !isString(value.post.title)
    || !isString(value.post.content)
    || !isString(value.post.authorName)
    || !isDisplayRole(value.post.authorRole)
    || !isNonEmptyString(value.post.createdAt)
    || !isNonEmptyString(value.post.updatedAt)
    || !isOptionalString(value.post.editedAt)
    || typeof value.post.isPinned !== 'boolean'
    || typeof value.post.isMine !== 'boolean'
    || !isNonNegativeInteger(value.post.viewCount)
    || !Array.isArray(value.attachments)
    || !value.attachments.every(isBoardAttachment)
    || !hasUniqueStringValues(value.attachments.map((attachment) => (
      isRecord(attachment) ? attachment.id : undefined
    )))
    || !isReactionCounts(value.reactions, true)
    || !Array.isArray(value.comments)
    || !value.comments.every(isBoardComment)
    || !hasUniqueStringValues(value.comments.map((comment) => (
      isRecord(comment) ? comment.id : undefined
    )))) return false;

  const commentIds = new Set(value.comments.map((comment) => (
    isRecord(comment) ? comment.id : undefined
  )));
  return value.comments.every((comment) => (
    isRecord(comment)
    && (comment.parentId === undefined
      || comment.parentId === null
      || commentIds.has(comment.parentId))
  ));
}

export function parseBoardAttachmentSignRows(
  value: unknown,
  expectedStoragePaths: readonly (string | undefined)[],
): BoardAttachmentSignRow[] | null {
  if (!Array.isArray(value) || value.length !== expectedStoragePaths.length) return null;
  const storagePaths = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index];
    if (!isRecord(row)
      || !isNonEmptyString(row.storagePath)
      || !isCredentialFreeHttpsUrl(row.signedUrl)) return null;
    const expectedPath = expectedStoragePaths[index]?.trim();
    if (expectedPath && row.storagePath !== expectedPath) return null;
    storagePaths.add(row.storagePath);
  }
  return storagePaths.size === value.length ? value as BoardAttachmentSignRow[] : null;
}

function boardRequestActorResidentId(request: Record<string, unknown>): string | null {
  return isRecord(request.actor) && isNonEmptyString(request.actor.residentId)
    ? request.actor.residentId
    : null;
}

function boardPinReceipt(data: unknown, request: Record<string, unknown>): boolean {
  if (!isRecord(data)
    || !sameUuid(data.postId, request.postId)
    || typeof request.isPinned !== 'boolean'
    || data.isPinned !== request.isPinned) return false;
  const residentId = boardRequestActorResidentId(request);
  return request.isPinned
    ? isTimestamp(data.pinnedAt)
      && residentId !== null
      && data.pinnedByResidentId === residentId
    : data.pinnedAt === null && data.pinnedByResidentId === null;
}

function boardCommentUpdateReceipt(data: unknown, request: Record<string, unknown>): boolean {
  const requestedContent = typeof request.content === 'string' ? request.content.trim() : '';
  return isRecord(data)
    && sameUuid(data.commentId, request.commentId)
    && requestedContent.length > 0
    && data.content === requestedContent
    && isTimestamp(data.editedAt);
}

function boardCommentDeleteReceipt(data: unknown, request: Record<string, unknown>): boolean {
  return isRecord(data)
    && sameUuid(data.commentId, request.commentId)
    && isBoardUuid(data.postId);
}

function boardAttachmentDeleteReceipt(data: unknown, request: Record<string, unknown>): boolean {
  if (!isRecord(data)
    || !sameUuid(data.postId, request.postId)
    || data.cleanupPending !== false
    || !Array.isArray(request.attachmentIds)
    || request.attachmentIds.length === 0
    || !request.attachmentIds.every(isBoardUuid)
    || new Set(request.attachmentIds.map((id) => String(id).toLowerCase())).size
      !== request.attachmentIds.length
    || !Array.isArray(data.deletedAttachments)
    || data.deletedAttachments.length !== request.attachmentIds.length) return false;
  const requestedIds = new Set(
    request.attachmentIds.map((id) => String(id).toLowerCase()),
  );
  const receiptIds = new Set<string>();
  const receiptPaths = new Set<string>();
  for (const attachment of data.deletedAttachments) {
    if (!isRecord(attachment)
      || !isBoardUuid(attachment.id)
      || !requestedIds.has(attachment.id.toLowerCase())
      || !isNonEmptyString(attachment.storagePath)) return false;
    receiptIds.add(attachment.id.toLowerCase());
    receiptPaths.add(attachment.storagePath);
  }
  return receiptIds.size === requestedIds.size
    && receiptPaths.size === request.attachmentIds.length;
}

function boardCategoryUpdateReceipt(data: unknown, request: Record<string, unknown>): boolean {
  const hasRequestedField = request.name !== undefined
    || request.slug !== undefined
    || request.sortOrder !== undefined
    || request.isActive !== undefined;
  if (!isRecord(data)
    || !hasRequestedField
    || !sameUuid(data.id, request.id)
    || !isNonEmptyString(data.name)
    || !isNonEmptyString(data.slug)
    || !Number.isSafeInteger(data.sortOrder)
    || data.isActive !== true) return false;
  if (request.name !== undefined && data.name !== String(request.name).trim()) return false;
  if (request.slug !== undefined && data.slug !== String(request.slug).trim()) return false;
  if (request.sortOrder !== undefined && data.sortOrder !== request.sortOrder) return false;
  return request.isActive === undefined || request.isActive === true;
}

function boardReactionToggleReceipt(data: unknown, request: Record<string, unknown>): boolean {
  const residentId = boardRequestActorResidentId(request);
  return isRecord(data)
    && sameUuid(data.postId, request.postId)
    && residentId !== null
    && data.residentId === residentId
    && isReactionType(request.reactionType)
    && (data.myReaction === null || data.myReaction === request.reactionType);
}

function boardCommentLikeToggleReceipt(data: unknown, request: Record<string, unknown>): boolean {
  const residentId = boardRequestActorResidentId(request);
  return isRecord(data)
    && sameUuid(data.commentId, request.commentId)
    && residentId !== null
    && data.residentId === residentId
    && typeof data.liked === 'boolean'
    && isNonNegativeInteger(data.likeCount);
}

function boardDeleteReceipt(data: unknown, request: Record<string, unknown>): boolean {
  return isRecord(data)
    && sameUuid(data.postId, request.postId)
    && data.cleanupPending === false;
}

function boardAttachmentFinalizeReceipt(data: unknown, request: Record<string, unknown>): boolean {
  if (!isRecord(data)
    || !sameUuid(data.postId, request.postId)
    || !Array.isArray(request.files)
    || request.files.length === 0
    || !Array.isArray(data.attachments)
    || data.attachments.length !== request.files.length) return false;
  const requestedPaths = request.files.map((file) => (
    isRecord(file) && isNonEmptyString(file.storagePath) ? file.storagePath : null
  ));
  if (requestedPaths.some((path) => path === null)) return false;
  const expectedPaths = new Set(requestedPaths as string[]);
  if (expectedPaths.size !== requestedPaths.length) return false;
  const receiptIds = new Set<string>();
  const receiptPaths = new Set<string>();
  for (const attachment of data.attachments) {
    if (!isRecord(attachment)
      || !isBoardUuid(attachment.id)
      || !isNonEmptyString(attachment.storagePath)
      || !expectedPaths.has(attachment.storagePath)) return false;
    receiptIds.add(attachment.id.toLowerCase());
    receiptPaths.add(attachment.storagePath);
  }
  return receiptIds.size === request.files.length
    && receiptPaths.size === expectedPaths.size;
}

function boardNotificationRetryReceipt(
  value: Record<string, unknown>,
  request: Record<string, unknown>,
): boolean {
  if (!isBoardUuid(request.postId)
    || !isNonEmptyString(request.eventKey)
    || !BOARD_NOTIFICATION_EVENT_PATTERN.test(request.eventKey)
    || !isRecord(value.delivery)
    || value.delivery.notificationStored !== true
    || value.delivery.retryable !== false
    || (value.delivery.pushStatus !== 'accepted'
      && value.delivery.pushStatus !== 'no_registered_device'
      && value.delivery.pushStatus !== 'provider_rejected')
    || !Array.isArray(value.delivery.notificationIds)
    || value.delivery.notificationIds.length === 0
    || !value.delivery.notificationIds.every(isBoardUuid)
    || new Set(value.delivery.notificationIds.map((id) => String(id).toLowerCase())).size
      !== value.delivery.notificationIds.length) return false;
  return value.notificationRetry === null && value.notificationWarning === null;
}

/** A successful transport is accepted only when its function-specific receipt is complete. */
export function isBoardSuccess(
  name: unknown,
  value: unknown,
  requestValue?: unknown,
): boolean {
  if (!isRecord(value) || value.ok !== true) return false;
  const data = value.data;
  const request = isRecord(requestValue) ? requestValue : null;
  switch (name) {
    case 'board-create':
      return value.saved === true && isRecord(data) && isNonEmptyString(data.id);
    case 'board-update':
      return value.saved === true && (data === undefined || data === null);
    case 'board-list':
      return hasValidBoardListAttachmentUrls(data);
    case 'board-detail':
      return request !== null
        && isNonEmptyString(request.postId)
        && hasValidBoardDetailAttachmentUrls(data, request.postId);
    case 'board-categories-list':
      return hasValidBoardCategories(data);
    case 'board-attachment-sign': {
      if (request === null || !Array.isArray(request.files) || request.files.length === 0) {
        return false;
      }
      const expectedPaths = request.files.map((file) => (
        isRecord(file) && typeof file.storagePath === 'string'
          ? file.storagePath
          : undefined
      ));
      return parseBoardAttachmentSignRows(data, expectedPaths) !== null;
    }
    case 'board-comment-create':
    case 'board-category-create':
      return isRecord(data) && isNonEmptyString(data.id);
    case 'board-reaction-toggle':
      return request !== null && boardReactionToggleReceipt(data, request);
    case 'board-comment-like-toggle':
      return request !== null && boardCommentLikeToggleReceipt(data, request);
    case 'board-notification-retry':
      return request !== null && boardNotificationRetryReceipt(value, request);
    case 'board-delete':
      return request !== null && boardDeleteReceipt(data, request);
    case 'board-comment-delete':
      return request !== null && boardCommentDeleteReceipt(data, request);
    case 'board-comment-update':
      return request !== null && boardCommentUpdateReceipt(data, request);
    case 'board-pin':
      return request !== null && boardPinReceipt(data, request);
    case 'board-attachment-delete':
      return request !== null && boardAttachmentDeleteReceipt(data, request);
    case 'board-attachment-finalize':
      return request !== null && boardAttachmentFinalizeReceipt(data, request);
    case 'board-category-update':
      return request !== null && boardCategoryUpdateReceipt(data, request);
    default:
      return false;
  }
}
