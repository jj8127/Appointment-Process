import {
  parseMessengerAttachmentMetadataList,
  type MessengerAttachmentMetadata,
} from '../../../lib/messenger-attachment-contract.ts';
import { isHttpsResponseUrl } from './user-intent-policy.ts';

export type DirectMessengerMessageContract = {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
  message_type: 'text' | 'image' | 'file';
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  attachments: MessengerAttachmentMetadata[];
};

export type GroupMessengerReactionContract = {
  reaction: string;
  count: number;
  reacted_by_me: boolean;
};

export type GroupMessengerMessageContract = {
  id: string;
  room_id: string;
  sender_actor_id: string;
  sender_role: 'fc' | 'manager' | 'admin';
  sender_phone: string;
  sender_name: string | null;
  content: string;
  message_type: 'text' | 'image' | 'file';
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  attachments: MessengerAttachmentMetadata[];
  created_at: string;
  unread_count: number;
  reply_to_message_id: string | null;
  reply_to_sender_name: string | null;
  reply_to_content: string | null;
  deleted_at: string | null;
  deleted_by_actor_id: string | null;
  reactions: GroupMessengerReactionContract[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

const isNullableString = (value: unknown): value is string | null => (
  value === null || typeof value === 'string'
);

const isValidDateString = (value: unknown): value is string => (
  typeof value === 'string' && Number.isFinite(Date.parse(value))
);

const isMessageType = (value: unknown): value is 'text' | 'image' | 'file' => (
  value === 'text' || value === 'image' || value === 'file'
);

function parseAttachments(value: unknown): MessengerAttachmentMetadata[] | null {
  if (!Array.isArray(value)) return null;
  try {
    return parseMessengerAttachmentMetadataList(value);
  } catch {
    return null;
  }
}

function parseFileFields(value: Record<string, unknown>) {
  const fileUrl = value.file_url === null
    ? null
    : isHttpsResponseUrl(value.file_url)
      ? value.file_url.trim()
      : undefined;
  if (fileUrl === undefined
    || !isNullableString(value.file_name)
    || !(value.file_size === null
      || (Number.isSafeInteger(value.file_size) && Number(value.file_size) >= 0))) return null;
  return {
    fileUrl,
    fileName: value.file_name,
    fileSize: value.file_size as number | null,
  };
}

export function parseDirectMessengerMessage(
  value: unknown,
  expectedConversationId?: string,
): DirectMessengerMessageContract | null {
  if (!isRecord(value)) return null;
  const attachments = parseAttachments(value.attachments);
  const file = parseFileFields(value);
  if (!attachments
    || !file
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.conversation_id)
    || (expectedConversationId !== undefined
      && value.conversation_id.trim() !== expectedConversationId.trim())
    || !isNonEmptyString(value.sender_id)
    || !isNonEmptyString(value.receiver_id)
    || typeof value.content !== 'string'
    || value.content.length > 4_000
    || !isValidDateString(value.created_at)
    || typeof value.is_read !== 'boolean'
    || !isMessageType(value.message_type)
    || (!value.content && attachments.length === 0 && file.fileUrl === null)
    || (attachments.length > 0
      && (file.fileUrl !== null || file.fileName !== null || file.fileSize !== null))) return null;
  return {
    id: value.id.trim(),
    conversation_id: value.conversation_id.trim(),
    sender_id: value.sender_id.trim(),
    receiver_id: value.receiver_id.trim(),
    content: value.content,
    created_at: value.created_at,
    is_read: value.is_read,
    message_type: value.message_type,
    file_url: file.fileUrl,
    file_name: file.fileName,
    file_size: file.fileSize,
    attachments,
  };
}

export function parseDirectMessengerMessageList(
  value: unknown,
  expectedConversationId?: string,
): DirectMessengerMessageContract[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map((row) => parseDirectMessengerMessage(row, expectedConversationId));
  if (rows.some((row) => row === null)) return null;
  const messages = rows as DirectMessengerMessageContract[];
  return new Set(messages.map((row) => row.id)).size === messages.length ? messages : null;
}

export function parseGroupMessengerReactionList(
  value: unknown,
): GroupMessengerReactionContract[] | null {
  if (!Array.isArray(value)) return null;
  const rows: GroupMessengerReactionContract[] = [];
  for (const raw of value) {
    if (!isRecord(raw)
      || !isNonEmptyString(raw.reaction)
      || !Number.isSafeInteger(raw.count)
      || Number(raw.count) < 0
      || typeof raw.reacted_by_me !== 'boolean') return null;
    rows.push({
      reaction: raw.reaction,
      count: Number(raw.count),
      reacted_by_me: raw.reacted_by_me,
    });
  }
  return new Set(rows.map((row) => row.reaction)).size === rows.length ? rows : null;
}

export function parseGroupMessengerMessage(
  value: unknown,
): GroupMessengerMessageContract | null {
  if (!isRecord(value)) return null;
  const attachments = parseAttachments(value.attachments);
  const reactions = parseGroupMessengerReactionList(value.reactions);
  const file = parseFileFields(value);
  if (!attachments
    || !reactions
    || !file
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.room_id)
    || !isNonEmptyString(value.sender_actor_id)
    || (value.sender_role !== 'admin' && value.sender_role !== 'manager' && value.sender_role !== 'fc')
    || typeof value.sender_phone !== 'string'
    || !isNullableString(value.sender_name)
    || typeof value.content !== 'string'
    || !isMessageType(value.message_type)
    || !isValidDateString(value.created_at)
    || !Number.isSafeInteger(value.unread_count)
    || Number(value.unread_count) < 0
    || !isNullableString(value.reply_to_message_id)
    || !isNullableString(value.reply_to_sender_name)
    || !isNullableString(value.reply_to_content)
    || !(value.deleted_at === null || isValidDateString(value.deleted_at))
    || !isNullableString(value.deleted_by_actor_id)
    || (attachments.length > 0
      && (file.fileUrl !== null || file.fileName !== null || file.fileSize !== null))) return null;
  return {
    id: value.id.trim(),
    room_id: value.room_id.trim(),
    sender_actor_id: value.sender_actor_id.trim(),
    sender_role: value.sender_role,
    sender_phone: value.sender_phone,
    sender_name: value.sender_name,
    content: value.content,
    message_type: value.message_type,
    file_url: file.fileUrl,
    file_name: file.fileName,
    file_size: file.fileSize,
    attachments,
    created_at: value.created_at,
    unread_count: Number(value.unread_count),
    reply_to_message_id: value.reply_to_message_id,
    reply_to_sender_name: value.reply_to_sender_name,
    reply_to_content: value.reply_to_content,
    deleted_at: value.deleted_at,
    deleted_by_actor_id: value.deleted_by_actor_id,
    reactions,
  };
}

export function parseGroupMessengerMessageList(
  value: unknown,
): GroupMessengerMessageContract[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map(parseGroupMessengerMessage);
  if (rows.some((row) => row === null)) return null;
  const messages = rows as GroupMessengerMessageContract[];
  return new Set(messages.map((row) => row.id)).size === messages.length ? messages : null;
}
