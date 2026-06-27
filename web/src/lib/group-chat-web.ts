export const GROUP_CHAT_UPLOAD_BUCKET = 'chat-uploads';
export const GROUP_CHAT_UPLOAD_PREFIX = 'group-chat/';
export const MAX_GROUP_CHAT_UPLOAD_BYTES = 20 * 1024 * 1024;

const ALLOWED_GROUP_CHAT_ACTIONS = new Set([
  'group_chat_bootstrap',
  'group_chat_send',
  'group_chat_mark_read',
  'group_chat_preferences',
  'group_chat_reaction_set',
  'group_chat_delete',
  'group_chat_member_send_permission',
  'group_chat_notice_set',
  'group_chat_notice_clear',
]);

export const ALLOWED_GROUP_CHAT_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
]);

export const ALLOWED_GROUP_CHAT_UPLOAD_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'pdf',
  'txt',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'zip',
]);

const GROUP_CHAT_REACTIONS = new Set(['👍', '❤️', '😂', '😮', '😢', '👏']);

type NormalizeGroupChatProxyOptions = {
  supabaseUrl?: string;
};

type NormalizedGroupChatPayload =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: number; message: string };

function cleanString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().slice(0, maxLength);
}

function cleanOptionalId(value: unknown) {
  const id = cleanString(value, 120);
  return id || null;
}

function cleanLimit(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.max(1, Math.min(150, Math.floor(numberValue)));
}

function cleanFileSize(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  return Math.min(MAX_GROUP_CHAT_UPLOAD_BYTES, Math.floor(numberValue));
}

export function getGroupChatFunctionUrl(supabaseUrl: string) {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/group-chat`;
}

export function getGroupChatPublicUploadPrefix(supabaseUrl: string) {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${GROUP_CHAT_UPLOAD_BUCKET}/${GROUP_CHAT_UPLOAD_PREFIX}`;
}

export function isAllowedGroupChatFileUrl(value: unknown, supabaseUrl?: string) {
  const fileUrl = cleanString(value, 2048);
  if (!fileUrl || !supabaseUrl) return false;
  try {
    const parsed = new URL(fileUrl);
    const allowedPrefix = getGroupChatPublicUploadPrefix(supabaseUrl);
    return parsed.href.startsWith(allowedPrefix);
  } catch {
    return false;
  }
}

export function normalizeGroupChatProxyPayload(
  input: unknown,
  options: NormalizeGroupChatProxyOptions = {},
): NormalizedGroupChatPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, message: 'Invalid group chat payload' };
  }

  const raw = input as Record<string, unknown>;
  const type = cleanString(raw.type, 80);
  if (!ALLOWED_GROUP_CHAT_ACTIONS.has(type)) {
    return { ok: false, status: 400, message: 'Unsupported group chat action' };
  }

  if (type === 'group_chat_bootstrap') {
    const limit = cleanLimit(raw.limit);
    return { ok: true, payload: limit ? { type, limit } : { type } };
  }

  if (type === 'group_chat_send') {
    const requestedMessageType = cleanString(raw.message_type, 20);
    const messageType =
      requestedMessageType === 'image' || requestedMessageType === 'file'
        ? requestedMessageType
        : 'text';
    const content = cleanString(raw.content, 2000);
    const replyToMessageId = cleanOptionalId(raw.reply_to_message_id);

    if (messageType === 'text') {
      if (!content) {
        return { ok: false, status: 400, message: 'Message content is required' };
      }
      return {
        ok: true,
        payload: {
          type,
          content,
          message_type: 'text',
          ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        },
      };
    }

    const fileUrl = cleanString(raw.file_url, 2048);
    if (!isAllowedGroupChatFileUrl(fileUrl, options.supabaseUrl)) {
      return { ok: false, status: 400, message: 'Invalid group chat attachment URL' };
    }

    return {
      ok: true,
      payload: {
        type,
        content,
        message_type: messageType,
        file_url: fileUrl,
        file_name: cleanGroupChatUploadFileName(cleanString(raw.file_name, 180)),
        file_size: cleanFileSize(raw.file_size),
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      },
    };
  }

  if (type === 'group_chat_mark_read') {
    const messageId = cleanOptionalId(raw.message_id);
    return { ok: true, payload: messageId ? { type, message_id: messageId } : { type } };
  }

  if (type === 'group_chat_preferences') {
    return { ok: true, payload: { type, muted: raw.muted === true } };
  }

  if (type === 'group_chat_reaction_set') {
    const messageId = cleanOptionalId(raw.message_id);
    if (!messageId) {
      return { ok: false, status: 400, message: 'Message id is required' };
    }
    const reaction = cleanString(raw.reaction, 16);
    if (reaction && !GROUP_CHAT_REACTIONS.has(reaction)) {
      return { ok: false, status: 400, message: 'Unsupported group chat reaction' };
    }
    return { ok: true, payload: { type, message_id: messageId, reaction: reaction || null } };
  }

  if (type === 'group_chat_delete') {
    const messageId = cleanOptionalId(raw.message_id);
    if (!messageId) {
      return { ok: false, status: 400, message: 'Message id is required' };
    }
    return { ok: true, payload: { type, message_id: messageId } };
  }

  if (type === 'group_chat_member_send_permission') {
    const targetActorId = cleanString(raw.target_actor_id, 80);
    if (!targetActorId.startsWith('fc:')) {
      return { ok: false, status: 400, message: 'FC actor id is required' };
    }
    return {
      ok: true,
      payload: {
        type,
        target_actor_id: targetActorId,
        can_send_messages: raw.can_send_messages === true,
      },
    };
  }

  if (type === 'group_chat_notice_set') {
    const messageId = cleanOptionalId(raw.message_id);
    if (!messageId) {
      return { ok: false, status: 400, message: 'Message id is required' };
    }
    return { ok: true, payload: { type, message_id: messageId } };
  }

  return { ok: true, payload: { type } };
}

export function buildGroupChatFunctionHeaders(serviceKey: string, appSessionToken: string) {
  return {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'x-app-session-token': appSessionToken,
  };
}

export function cleanGroupChatUploadFileName(value: string) {
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|#%{}\[\]^~`]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'file';
}

export function getGroupChatUploadExtension(fileName: string) {
  const extension = cleanGroupChatUploadFileName(fileName).split('.').pop()?.toLowerCase() ?? '';
  return extension;
}

export function isAllowedGroupChatUploadFile(input: { name: string; type?: string; size: number }) {
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_GROUP_CHAT_UPLOAD_BYTES) {
    return false;
  }
  const mimeType = String(input.type ?? '').trim().toLowerCase();
  const extension = getGroupChatUploadExtension(input.name);
  return ALLOWED_GROUP_CHAT_UPLOAD_MIME_TYPES.has(mimeType)
    || ALLOWED_GROUP_CHAT_UPLOAD_EXTENSIONS.has(extension);
}
