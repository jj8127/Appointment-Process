const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === "object" && !Array.isArray(value)
);
const isString = (value: unknown): value is string => typeof value === "string";
const isNonEmptyString = (value: unknown): value is string =>
  isString(value) && value.length > 0;
export const isBoardUuid = (value: unknown): value is string =>
  isString(value) && UUID_PATTERN.test(value);
const isUuid = isBoardUuid;
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);
const isSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value);
const isNonNegativeInteger = (value: unknown): value is number =>
  isSafeInteger(value) && Number(value) >= 0;
export type BoardActorRole = "admin" | "manager" | "fc";
export const isBoardActorRole = (value: unknown): value is BoardActorRole => (
  value === "admin" || value === "manager" || value === "fc"
);
const isAuthorRole = isBoardActorRole;
export const BOARD_REACTION_TYPES = [
  "like",
  "heart",
  "check",
  "smile",
] as const;
export type BoardReactionType = typeof BOARD_REACTION_TYPES[number];
export const isBoardReactionType = (
  value: unknown,
): value is BoardReactionType => (
  BOARD_REACTION_TYPES.some((type) => type === value)
);

export type BoardCategoryQueryRow = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
};

export type BoardListQueryRow = {
  id: string;
  category_id: string;
  title: string;
  content: string;
  author_name: string;
  author_role: "admin" | "manager" | "fc";
  author_resident_id: string;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  is_pinned: boolean;
  pinned_at: string | null;
  comment_count: number;
  reaction_count: number;
  attachment_count: number;
  view_count: number;
};

export type BoardAttachmentQueryRow = {
  id: string;
  post_id: string;
  file_type: "image" | "file";
  file_name: string;
  file_size: number;
  mime_type?: string | null;
  storage_path: string;
  sort_order: number;
  created_at?: string;
  created_by_resident_id?: string;
};

export type BoardPostReactionQueryRow = {
  post_id: string;
  resident_id?: string;
  reaction_type: BoardReactionType;
};

export type BoardDetailPostQueryRow = {
  id: string;
  category_id: string;
  title: string;
  content: string;
  author_name: string;
  author_role: "admin" | "manager" | "fc";
  author_resident_id: string;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  is_pinned: boolean;
  comment_count: number;
  reaction_count: number;
  attachment_count: number;
  view_count: number;
};

export type BoardCommentQueryRow = {
  id: string;
  post_id: string;
  parent_id: string | null;
  content: string;
  author_name: string;
  author_role: "admin" | "manager" | "fc";
  author_resident_id: string;
  created_at: string;
  edited_at: string | null;
  like_count: number;
  reply_count: number;
};

export type BoardCommentLikeQueryRow = {
  comment_id: string;
  resident_id: string;
};

export type BoardAuthoredEntityQueryRow = {
  id: string;
  author_role: BoardActorRole;
  author_resident_id: string;
};

export function isBoardAuthoredEntityQueryRow(
  value: unknown,
): value is BoardAuthoredEntityQueryRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    isAuthorRole(value.author_role) &&
    isNonEmptyString(value.author_resident_id);
}

export function isBoardCategoryQueryRow(
  value: unknown,
): value is BoardCategoryQueryRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.slug) &&
    isSafeInteger(value.sort_order) &&
    typeof value.is_active === "boolean";
}

export function isBoardListQueryRow(
  value: unknown,
): value is BoardListQueryRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.category_id) &&
    isString(value.title) &&
    isString(value.content) &&
    isString(value.author_name) &&
    isAuthorRole(value.author_role) &&
    isNonEmptyString(value.author_resident_id) &&
    isNonEmptyString(value.created_at) &&
    isNonEmptyString(value.updated_at) &&
    isNullableString(value.edited_at) &&
    typeof value.is_pinned === "boolean" &&
    isNullableString(value.pinned_at) &&
    isNonNegativeInteger(value.comment_count) &&
    isNonNegativeInteger(value.reaction_count) &&
    isNonNegativeInteger(value.attachment_count) &&
    isNonNegativeInteger(value.view_count);
}

export function isBoardAutomationListQueryRow(
  value: unknown,
): value is Pick<BoardListQueryRow, "id" | "title" | "created_at"> {
  return isRecord(value) &&
    isUuid(value.id) &&
    isString(value.title) &&
    isNonEmptyString(value.created_at);
}

export function isBoardAttachmentQueryRow(
  value: unknown,
): value is BoardAttachmentQueryRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.post_id) &&
    (value.file_type === "image" || value.file_type === "file") &&
    isString(value.file_name) &&
    isNonNegativeInteger(value.file_size) &&
    (value.mime_type === undefined || isNullableString(value.mime_type)) &&
    isNonEmptyString(value.storage_path) &&
    isSafeInteger(value.sort_order) &&
    (value.created_at === undefined || isNonEmptyString(value.created_at)) &&
    (value.created_by_resident_id === undefined || isNonEmptyString(value.created_by_resident_id));
}

export function isBoardPostReactionQueryRow(
  value: unknown,
): value is BoardPostReactionQueryRow {
  return isRecord(value) &&
    isUuid(value.post_id) &&
    (value.resident_id === undefined || isNonEmptyString(value.resident_id)) &&
    isBoardReactionType(value.reaction_type);
}

export function isBoardDetailPostQueryRow(
  value: unknown,
): value is BoardDetailPostQueryRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.category_id) &&
    isString(value.title) &&
    isString(value.content) &&
    isString(value.author_name) &&
    isAuthorRole(value.author_role) &&
    isNonEmptyString(value.author_resident_id) &&
    isNonEmptyString(value.created_at) &&
    isNonEmptyString(value.updated_at) &&
    isNullableString(value.edited_at) &&
    typeof value.is_pinned === "boolean" &&
    isNonNegativeInteger(value.comment_count) &&
    isNonNegativeInteger(value.reaction_count) &&
    isNonNegativeInteger(value.attachment_count) &&
    isNonNegativeInteger(value.view_count);
}

export function isBoardCommentQueryRow(
  value: unknown,
): value is BoardCommentQueryRow {
  return isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.post_id) &&
    (value.parent_id === null || isUuid(value.parent_id)) &&
    isString(value.content) &&
    isString(value.author_name) &&
    isAuthorRole(value.author_role) &&
    isNonEmptyString(value.author_resident_id) &&
    isNonEmptyString(value.created_at) &&
    isNullableString(value.edited_at) &&
    isNonNegativeInteger(value.like_count) &&
    isNonNegativeInteger(value.reply_count);
}

export function isBoardCommentLikeQueryRow(
  value: unknown,
): value is BoardCommentLikeQueryRow {
  return isRecord(value) &&
    isUuid(value.comment_id) &&
    isNonEmptyString(value.resident_id);
}

export function hasUniqueStringField<Row extends object>(
  rows: readonly Row[],
  field: keyof Row,
): boolean {
  const values = rows.map((row) => row[field]);
  return values.every((value) => typeof value === "string") &&
    new Set(values).size === values.length;
}
