import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getEnv,
  requireAppSessionFromRequest,
  type AppSessionTokenPayload,
} from '../_shared/request-board-auth.ts';
import {
  buildGroupChatActor,
  buildGroupChatAppointmentLabel,
  canGroupChatActorSendMessages,
  computeGroupChatMessageUnreadCounts,
  buildGroupChatPreview,
  GROUP_CHAT_NOTIFICATION_CATEGORY,
  GROUP_CHAT_ROOM_SLUG,
  GROUP_CHAT_ROOM_TITLE,
  GROUP_CHAT_TARGET_URL,
  isEligibleGroupChatMember,
  isRequestBoardDesignerAffiliation,
  normalizeFcGroupChatActorId,
  normalizeGroupChatMessageContent,
  normalizeGroupChatText,
  sanitizeGroupChatPhone,
  shouldFanoutGroupChatPush,
  summarizeGroupChatReactions,
  toNotificationRecipientRole,
  type GroupChatActor,
  type GroupChatMessageType,
  type GroupChatRole,
} from '../_shared/group-chat.ts';
import { validatePersistedNotificationForDelivery } from '../_shared/persisted-notification-delivery.ts';
import type { NotificationTargetV1 } from '../_shared/notification-target.ts';
import {
  deriveGroupChatNotificationEventKey,
  groupChatNotificationDeliveryKey,
  isGroupChatNotificationRetryToken,
  issueGroupChatNotificationRetryToken,
  verifyGroupChatNotificationRetryToken,
} from '../_shared/group-chat-notification-event.ts';
import {
  drainMessengerAttachmentCleanup,
  finalizeMessengerAttachmentBatch,
  listMessengerAttachmentsByBatchIds,
  mapMessengerAttachmentRpcError,
  MessengerAttachmentServiceError,
  type MessengerAttachmentMetadata,
} from '../_shared/messenger-attachment-service.ts';
import {
  compareGroupChatMessageTuple,
  escapeGroupChatIlikeLiteral,
  GROUP_CHAT_CONTEXT_SIDE_LIMIT,
  normalizeGroupChatSearchLimit,
  normalizeGroupChatSearchQuery,
  serializeGroupChatSearchResult,
  type GroupChatSearchMessageRow,
} from '../_shared/group-chat-search.ts';
import {
  chunkGroupChatDataApiValues,
  collectGroupChatDataApiBatches,
  collectGroupChatDataApiPages,
} from '../_shared/group-chat-data-api-batching.ts';
import {
  parseQueryCount,
  parseQueryRows,
} from '../_shared/query-result-contract.ts';
import {
  isAppPreferenceActorRow,
  isAppPushPreferenceRow,
  type AppPushPreferenceRow,
} from '../_shared/notification-preferences.ts';

type Payload =
  | { type: 'group_chat_bootstrap'; limit?: number }
  | { type: 'group_chat_search'; q?: unknown; limit?: unknown }
  | { type: 'group_chat_context'; room_id?: unknown; message_id?: unknown }
  | {
      type: 'group_chat_send';
      content?: string | null;
      message_type?: GroupChatMessageType | null;
      file_url?: string | null;
      file_name?: string | null;
      file_size?: number | null;
      reply_to_message_id?: string | null;
      client_message_id?: string | null;
      attachment_intent_ids?: string[] | null;
      delivery_key?: string | null;
      payload_fingerprint?: string | null;
    }
  | {
      type: 'group_chat_notification_retry';
      message_id?: string | null;
      retry_token?: string | null;
    }
  | { type: 'group_chat_mark_read'; message_id?: string | null }
  | { type: 'group_chat_preferences'; muted?: boolean | null }
  | { type: 'group_chat_reaction_set'; message_id?: string | null; reaction?: string | null }
  | { type: 'group_chat_delete'; message_id?: string | null }
  | { type: 'group_chat_member_send_permission'; target_actor_id?: string | null; can_send_messages?: boolean | null }
  | { type: 'group_chat_notice_set'; message_id?: string | null }
  | { type: 'group_chat_notice_clear' };

type RoomRow = {
  id: string;
  slug: string;
  title: string;
  is_active: boolean;
};

type MessageRow = {
  id: string;
  room_id: string;
  sender_actor_id: string;
  sender_role: GroupChatRole;
  sender_phone: string;
  sender_name: string | null;
  content: string;
  message_type: GroupChatMessageType;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  attachment_batch_id: string | null;
  created_at: string;
  reply_to_message_id: string | null;
  reply_to_sender_name: string | null;
  reply_to_content: string | null;
  deleted_at: string | null;
  deleted_by_actor_id: string | null;
};

type GroupChatMember = {
  immutable_actor_id: string;
  actor_id: string;
  role: GroupChatRole;
  phone: string;
  name: string | null;
  headquarters: string | null;
  appointment_label: string;
  can_send_messages: boolean;
};

type PreferenceRow = {
  actor_id: string;
  muted: boolean | null;
};

type RoomNotificationPreferenceRow = {
  actor_id: string;
  actor_role: string;
  muted: boolean;
};

type ReactionRow = {
  room_id: string;
  message_id: string;
  actor_id: string;
  reaction: string;
};

type ReadStateRow = {
  room_id: string;
  actor_id: string;
  last_read_at: string;
};

type ReadReceiptRow = {
  room_id: string;
  actor_id: string;
  last_read_at: string;
  last_read_message_id: string | null;
};

type ReadStateDetailRow = Pick<ReadReceiptRow, 'last_read_at' | 'last_read_message_id'>;

type SendPermissionRow = {
  room_id: string;
  actor_id: string;
  can_send_messages: boolean | null;
};

type NoticeRow = {
  room_id: string;
  message_id: string;
  created_by_actor_id: string;
  created_by_role: GroupChatRole;
  created_at: string;
  updated_at: string;
};

type DeviceTokenRow = {
  expo_push_token: string;
  resident_id: string | null;
  role?: string | null;
};

type GroupChatNotificationSummary = {
  ok: boolean;
  status: 'skipped' | 'inbox_only' | 'provider_accepted' | 'partial';
  stored: boolean;
  push_status: 'queued' | 'no_registered_device' | 'provider_failed';
  recipient_count: number;
  notification_count: number;
  push_token_count: number;
  push_accepted_count: number;
  push_rejected_count: number;
  delivery: {
    notificationStored: boolean;
    pushStatus: 'accepted' | 'no_registered_device' | 'provider_rejected' | 'not_attempted';
    retryable: boolean;
    notificationIds?: string[];
  };
};

type ExpoPushSummary = {
  requested_count: number;
  accepted_count: number;
  rejected_count: number;
};

type NotificationInsertSummary = {
  inserted_count: number;
  failed: boolean;
  ids_by_actor: Map<string, string>;
  failure_reason?: string;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_CHUNK_SIZE = 100;
const EXPO_PUSH_TIMEOUT_MS = 8_000;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const GROUP_CHAT_APP_PUSH_CATEGORY = 'messages';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isNonEmptyString = (value: unknown): value is string =>
  isString(value) && value.trim().length > 0;
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);
const isNullableBoolean = (value: unknown): value is boolean | null =>
  value === null || typeof value === 'boolean';
const isTimestamp = (value: unknown): value is string =>
  isNonEmptyString(value) && Number.isFinite(Date.parse(value));
const isNullableTimestamp = (value: unknown): value is string | null =>
  value === null || isTimestamp(value);
const isNonNegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const isGroupChatRole = (value: unknown): value is GroupChatRole =>
  value === 'fc' || value === 'manager' || value === 'admin';
const isGroupChatMessageType = (value: unknown): value is GroupChatMessageType =>
  value === 'text' || value === 'image' || value === 'file';

function isRoomRow(value: unknown): value is RoomRow {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.slug)
    && isNonEmptyString(value.title)
    && typeof value.is_active === 'boolean';
}

function isMessageRow(value: unknown): value is MessageRow {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.room_id)
    && isNonEmptyString(value.sender_actor_id)
    && isGroupChatRole(value.sender_role)
    && isString(value.sender_phone)
    && isNullableString(value.sender_name)
    && isString(value.content)
    && isGroupChatMessageType(value.message_type)
    && isNullableString(value.file_url)
    && isNullableString(value.file_name)
    && (value.file_size === null || isNonNegativeSafeInteger(value.file_size))
    && isNullableString(value.attachment_batch_id)
    && isTimestamp(value.created_at)
    && isNullableString(value.reply_to_message_id)
    && isNullableString(value.reply_to_sender_name)
    && isNullableString(value.reply_to_content)
    && isNullableTimestamp(value.deleted_at)
    && isNullableString(value.deleted_by_actor_id);
}

function isFcActorProfileListRow(value: unknown): value is FcActorProfileListRow {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNullableString(value.name)
    && isNullableString(value.phone)
    && isNullableString(value.affiliation)
    && value.signup_completed === true
    && isNullableBoolean(value.is_manager_referral_shadow)
    && isNullableBoolean(value.life_commission_completed)
    && isNullableBoolean(value.nonlife_commission_completed)
    && isNullableString(value.appointment_date_life)
    && isNullableString(value.appointment_date_nonlife);
}

function isFcActorProfileRow(value: unknown): value is FcActorProfileRow & {
  id: string;
  name: string | null;
  phone: string | null;
  affiliation: string | null;
  signup_completed: boolean;
  is_manager_referral_shadow: boolean | null;
} {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNullableString(value.name)
    && isNullableString(value.phone)
    && isNullableString(value.affiliation)
    && typeof value.signup_completed === 'boolean'
    && isNullableBoolean(value.is_manager_referral_shadow);
}

function isManagerActorRow(value: unknown): value is {
  name: string | null;
  phone: string | null;
  active: boolean;
} {
  return isRecord(value)
    && isNullableString(value.name)
    && isNullableString(value.phone)
    && typeof value.active === 'boolean';
}

function isAdminActorRow(value: unknown): value is {
  name: string | null;
  phone: string | null;
  active: boolean;
  staff_type: string;
} {
  return isRecord(value) && isNonEmptyString(value.staff_type) && isManagerActorRow(value);
}

function isManagerAccountListRow(value: unknown): value is Record<string, unknown> & {
  id: string;
  name: string | null;
  phone: string | null;
  active: boolean;
} {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNullableString(value.name)
    && isNullableString(value.phone)
    && value.active === true;
}

function isAdminAccountListRow(value: unknown): value is Record<string, unknown> & {
  id: string;
  name: string | null;
  phone: string | null;
  active: boolean;
  staff_type: string;
} {
  return isManagerAccountListRow(value) && isNonEmptyString(value.staff_type);
}

function isSendPermissionRow(value: unknown): value is SendPermissionRow {
  return isRecord(value)
    && isNonEmptyString(value.room_id)
    && isNonEmptyString(value.actor_id)
    && typeof value.can_send_messages === 'boolean';
}

function isGroupChatSearchMessageRow(value: unknown): value is GroupChatSearchMessageRow {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.room_id)
    && isNullableString(value.sender_name)
    && isGroupChatRole(value.sender_role)
    && isString(value.content)
    && isTimestamp(value.created_at)
    && isNullableTimestamp(value.deleted_at);
}

function isReactionRow(value: unknown): value is ReactionRow {
  return isRecord(value)
    && isNonEmptyString(value.room_id)
    && isNonEmptyString(value.message_id)
    && isNonEmptyString(value.actor_id)
    && isNonEmptyString(value.reaction);
}

function isReadStateRow(value: unknown): value is ReadStateRow {
  return isRecord(value)
    && isNonEmptyString(value.room_id)
    && isNonEmptyString(value.actor_id)
    && isTimestamp(value.last_read_at);
}

function isReadReceiptRow(value: unknown): value is ReadReceiptRow {
  return isRecord(value)
    && isNonEmptyString(value.room_id)
    && isNonEmptyString(value.actor_id)
    && isTimestamp(value.last_read_at)
    && isNullableString(value.last_read_message_id);
}

function isReadStateDetailRow(value: unknown): value is ReadStateDetailRow {
  return isRecord(value)
    && isTimestamp(value.last_read_at)
    && isNullableString(value.last_read_message_id);
}

function isPreferenceRow(value: unknown): value is PreferenceRow {
  return isRecord(value)
    && isNonEmptyString(value.actor_id)
    && isNullableBoolean(value.muted);
}

function isRoomNotificationPreferenceRow(value: unknown): value is RoomNotificationPreferenceRow {
  return isAppPreferenceActorRow(value)
    && typeof (value as Record<string, unknown>).muted === 'boolean';
}

function isDeviceTokenRow(value: unknown): value is DeviceTokenRow {
  return isRecord(value)
    && isNonEmptyString(value.expo_push_token)
    && isNullableString(value.resident_id)
    && (value.role === undefined || value.role === null || isString(value.role));
}

function isNoticeRow(value: unknown): value is NoticeRow {
  return isRecord(value)
    && isNonEmptyString(value.room_id)
    && isNonEmptyString(value.message_id)
    && isNonEmptyString(value.created_by_actor_id)
    && isGroupChatRole(value.created_by_role)
    && isTimestamp(value.created_at)
    && isTimestamp(value.updated_at);
}

function groupChatNotificationRetrySecrets() {
  return Array.from(new Set([
    getEnv('FC_APP_SESSION_TOKEN_SECRET')?.trim(),
    getEnv('FC_APP_SESSION_TOKEN_PREVIOUS_SECRET')?.trim(),
  ].filter((secret): secret is string => Boolean(secret))));
}

function groupChatNotificationRetrySigningSecret() {
  return groupChatNotificationRetrySecrets()[0] ?? null;
}

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const defaultOrigin = allowedOrigins[0] ?? 'https://yourdomain.com';

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}
if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceKey);
function resolveCorsOrigin(origin?: string | null) {
  if (origin && allowedOrigins.includes(origin)) return origin;
  if (origin?.includes('localhost') || origin?.includes('127.0.0.1')) return origin;
  return defaultOrigin;
}

function corsHeaders(origin?: string | null) {
  return {
    'Access-Control-Allow-Origin': resolveCorsOrigin(origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function json(body: Record<string, unknown>, status = 200, origin?: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function fail(code: string, message: string, status = 400, origin?: string | null) {
  return json({ ok: false, code, message }, status, origin);
}

function attachmentFailure(error: unknown, origin?: string | null) {
  const mapped = error instanceof MessengerAttachmentServiceError
    ? error
    : mapMessengerAttachmentRpcError(error);
  return fail(
    mapped.code,
    '첨부파일을 처리하지 못했습니다.',
    mapped.status,
    origin,
  );
}

async function parseJson(req: Request): Promise<Payload | null> {
  try {
    const parsed = await req.json();
    return typeof parsed === 'object' && parsed !== null ? parsed as Payload : null;
  } catch {
    return null;
  }
}

function dbError(_error: { message?: string }, origin?: string | null) {
  console.error('[group-chat] db error', { reason: 'database_operation_failed' });
  return fail('db_error', '단톡방 데이터를 처리하지 못했습니다.', 500, origin);
}

function serializeMessage(
  row: MessageRow,
  unreadCount = 0,
  reactions: ReturnType<typeof summarizeGroupChatReactions> = [],
  attachments: MessengerAttachmentMetadata[] = [],
) {
  return {
    id: row.id,
    room_id: row.room_id,
    sender_actor_id: row.sender_actor_id,
    sender_role: row.sender_role,
    sender_phone: row.sender_phone,
    sender_name: row.sender_name,
    content: row.content,
    message_type: row.message_type,
    file_url: row.file_url,
    file_name: row.file_name,
    file_size: row.file_size,
    attachments,
    created_at: row.created_at,
    unread_count: unreadCount,
    reply_to_message_id: row.reply_to_message_id,
    reply_to_sender_name: row.reply_to_sender_name,
    reply_to_content: row.reply_to_content,
    deleted_at: row.deleted_at,
    deleted_by_actor_id: row.deleted_by_actor_id,
    reactions,
  };
}

function serializeNotice(
  row: NoticeRow,
  message: MessageRow,
  reactions: ReturnType<typeof summarizeGroupChatReactions> = [],
  attachments: MessengerAttachmentMetadata[] = [],
) {
  return {
    room_id: row.room_id,
    message_id: row.message_id,
    created_by_actor_id: row.created_by_actor_id,
    created_by_role: row.created_by_role,
    created_at: row.created_at,
    updated_at: row.updated_at,
    message: serializeMessage(message, 0, reactions, attachments),
  };
}

async function ensureRoom(): Promise<RoomRow> {
  const existing = await supabase
    .from('group_chat_rooms')
    .select('id,slug,title,is_active')
    .eq('slug', GROUP_CHAT_ROOM_SLUG)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data !== null) {
    if (
      !isRoomRow(existing.data)
      || existing.data.slug !== GROUP_CHAT_ROOM_SLUG
      || existing.data.title !== GROUP_CHAT_ROOM_TITLE
    ) {
      throw new Error('group_chat_room_response_invalid');
    }
    return existing.data;
  }

  const inserted = await supabase
    .from('group_chat_rooms')
    .insert({
      slug: GROUP_CHAT_ROOM_SLUG,
      title: GROUP_CHAT_ROOM_TITLE,
      is_active: true,
    })
    .select('id,slug,title,is_active')
    .single();

  if (inserted.error) throw inserted.error;
  if (
    !isRoomRow(inserted.data)
    || inserted.data.slug !== GROUP_CHAT_ROOM_SLUG
    || inserted.data.title !== GROUP_CHAT_ROOM_TITLE
    || inserted.data.is_active !== true
  ) {
    throw new Error('group_chat_room_receipt_invalid');
  }
  return inserted.data;
}

type FcActorProfileRow = {
  id?: string | null;
  phone?: string | null;
  affiliation?: string | null;
  signup_completed?: boolean | null;
  is_manager_referral_shadow?: boolean | null;
};

type FcActorProfileListRow = {
  id: string;
  name: string | null;
  phone: string | null;
  affiliation: string | null;
  signup_completed: boolean;
  is_manager_referral_shadow: boolean | null;
  life_commission_completed: boolean | null;
  nonlife_commission_completed: boolean | null;
  appointment_date_life: string | null;
  appointment_date_nonlife: string | null;
};

type ActorBlockReason = {
  code: string;
  message: string;
  status: number;
};

function getFcActorBlockReason(profile: FcActorProfileRow | null, phone: string): ActorBlockReason | null {
  if (!profile?.id || sanitizeGroupChatPhone(profile.phone) !== phone) {
    return {
      code: 'group_chat_account_not_found',
      message: '단톡방에 연결할 계정을 찾을 수 없습니다. 다시 로그인해주세요.',
      status: 404,
    };
  }

  if (profile.signup_completed !== true) {
    return {
      code: 'not_completed',
      message: '본등록이 완료되지 않아 단톡방에 참여할 수 없습니다. 본등록 완료 후 다시 시도해주세요.',
      status: 403,
    };
  }

  if (profile.is_manager_referral_shadow === true || isRequestBoardDesignerAffiliation(profile.affiliation)) {
    return {
      code: 'request_board_designer_only',
      message: '설계요청 전용 계정은 가람PA 단톡방 참여 대상이 아닙니다.',
      status: 403,
    };
  }

  return null;
}

function getInactiveActorBlockReason(): ActorBlockReason {
  return {
    code: 'inactive_account',
    message: '비활성화된 계정이라 단톡방에 참여할 수 없습니다.',
    status: 403,
  };
}

async function resolveActor(session: AppSessionTokenPayload, origin?: string | null): Promise<
  | { ok: true; actor: GroupChatActor }
  | { ok: false; response: Response }
> {
  const phone = sanitizeGroupChatPhone(session.phone);
  if (phone.length !== 11) {
    return { ok: false, response: fail('invalid_app_session', '세션이 유효하지 않습니다. 다시 로그인해주세요.', 401, origin) };
  }

  if (session.role === 'fc') {
    const query = supabase
      .from('fc_profiles')
      .select('id,name,phone,affiliation,signup_completed,is_manager_referral_shadow');

    const result = session.fcId
      ? await query.eq('id', session.fcId).maybeSingle()
      : await query.eq('phone', phone).maybeSingle();

    if (result.error) return { ok: false, response: dbError(result.error, origin) };
    if (result.data !== null && !isFcActorProfileRow(result.data)) {
      return { ok: false, response: dbError({ message: 'group_chat_fc_actor_response_invalid' }, origin) };
    }
    const profile = result.data;
    const blockReason = getFcActorBlockReason(profile, phone);
    if (blockReason) {
      return {
        ok: false,
        response: fail(blockReason.code, blockReason.message, blockReason.status, origin),
      };
    }

    const actor = buildGroupChatActor({ role: 'fc', phone, name: profile?.name ?? null });
    if (!actor) return { ok: false, response: fail('invalid_actor', '단톡방 참여자 정보를 확인할 수 없습니다.', 403, origin) };
    return { ok: true, actor };
  }

  if (session.role === 'manager') {
    const { data, error } = await supabase
      .from('manager_accounts')
      .select('name,phone,active')
      .eq('phone', phone)
      .maybeSingle();
    if (error) return { ok: false, response: dbError(error, origin) };
    if (data !== null && (!isManagerActorRow(data) || sanitizeGroupChatPhone(data.phone) !== phone)) {
      return { ok: false, response: dbError({ message: 'group_chat_manager_actor_response_invalid' }, origin) };
    }
    if (!data?.active) {
      const blockReason = getInactiveActorBlockReason();
      return { ok: false, response: fail(blockReason.code, blockReason.message, blockReason.status, origin) };
    }

    const actor = buildGroupChatActor({ role: 'manager', phone, name: data.name });
    if (!actor) return { ok: false, response: fail('invalid_actor', '단톡방 참여자 정보를 확인할 수 없습니다.', 403, origin) };
    return { ok: true, actor };
  }

  const { data, error } = await supabase
    .from('admin_accounts')
    .select('name,phone,active,staff_type')
    .eq('phone', phone)
    .maybeSingle();
  if (error) return { ok: false, response: dbError(error, origin) };
  if (data !== null && (!isAdminActorRow(data) || sanitizeGroupChatPhone(data.phone) !== phone)) {
    return { ok: false, response: dbError({ message: 'group_chat_admin_actor_response_invalid' }, origin) };
  }
  if (!isEligibleGroupChatMember({ kind: 'admin', phone: data?.phone, active: data?.active, staff_type: data?.staff_type })) {
    const blockReason = data?.phone ? getInactiveActorBlockReason() : {
      code: 'group_chat_account_not_found',
      message: '단톡방에 연결할 계정을 찾을 수 없습니다. 다시 로그인해주세요.',
      status: 404,
    };
    return { ok: false, response: fail(blockReason.code, blockReason.message, blockReason.status, origin) };
  }

  const actor = buildGroupChatActor({ role: 'admin', phone, name: data?.name ?? null });
  if (!actor) return { ok: false, response: fail('invalid_actor', '단톡방 참여자 정보를 확인할 수 없습니다.', 403, origin) };
  return { ok: true, actor };
}

async function listEligibleMembers(): Promise<GroupChatMember[]> {
  const [fcResult, managerResult, adminResult] = await Promise.all([
    collectGroupChatDataApiPages(async (from, to) => {
      const result = await supabase
        .from('fc_profiles')
        .select('id,name,phone,affiliation,signup_completed,is_manager_referral_shadow,life_commission_completed,nonlife_commission_completed,appointment_date_life,appointment_date_nonlife')
        .eq('signup_completed', true)
        .order('id', { ascending: true })
        .range(from, to);
      const rows = parseQueryRows(result.data, isFcActorProfileListRow);
      return {
        data: rows,
        error: result.error ?? (rows ? null : new Error('group_chat_fc_member_response_invalid')),
      };
    }),
    collectGroupChatDataApiPages(async (from, to) => {
      const result = await supabase
        .from('manager_accounts')
        .select('id,name,phone,active')
        .eq('active', true)
        .order('id', { ascending: true })
        .range(from, to);
      const rows = parseQueryRows(result.data, isManagerAccountListRow);
      return {
        data: rows,
        error: result.error ?? (rows ? null : new Error('group_chat_manager_member_response_invalid')),
      };
    }),
    collectGroupChatDataApiPages(async (from, to) => {
      const result = await supabase
        .from('admin_accounts')
        .select('id,name,phone,active,staff_type')
        .eq('active', true)
        .order('id', { ascending: true })
        .range(from, to);
      const rows = parseQueryRows(result.data, isAdminAccountListRow);
      return {
        data: rows,
        error: result.error ?? (rows ? null : new Error('group_chat_admin_member_response_invalid')),
      };
    }),
  ]);

  if (!fcResult.ok || !managerResult.ok || !adminResult.ok) {
    throw new Error('group_chat_member_query_failed');
  }

  const members: GroupChatMember[] = [];

  fcResult.data.forEach((row) => {
    if (!isEligibleGroupChatMember({
      kind: 'fc',
        phone: row.phone,
        signup_completed: row.signup_completed,
        affiliation: row.affiliation,
        is_manager_referral_shadow: row.is_manager_referral_shadow,
    })) return;
    const actor = buildGroupChatActor({ role: 'fc', phone: row.phone, name: row.name });
    if (actor) {
      members.push({
        immutable_actor_id: row.id,
        actor_id: actor.id,
        role: actor.role,
        phone: actor.phone,
        name: actor.name,
        headquarters: normalizeGroupChatText(row.affiliation) || null,
        appointment_label: buildGroupChatAppointmentLabel({
          kind: 'fc',
          phone: row.phone,
          signup_completed: row.signup_completed,
          affiliation: row.affiliation,
          is_manager_referral_shadow: row.is_manager_referral_shadow,
          life_commission_completed: row.life_commission_completed,
          nonlife_commission_completed: row.nonlife_commission_completed,
          appointment_date_life: row.appointment_date_life,
          appointment_date_nonlife: row.appointment_date_nonlife,
        }),
        can_send_messages: false,
      });
    }
  });

  managerResult.data.forEach((row) => {
    if (!isEligibleGroupChatMember({ kind: 'manager', phone: row.phone, active: row.active })) return;
    const actor = buildGroupChatActor({ role: 'manager', phone: row.phone, name: row.name });
    if (actor) {
      members.push({
        immutable_actor_id: row.id,
        actor_id: actor.id,
        role: actor.role,
        phone: actor.phone,
        name: actor.name,
        headquarters: '본부장',
        appointment_label: '활성',
        can_send_messages: true,
      });
    }
  });

  adminResult.data.forEach((row) => {
    if (!isEligibleGroupChatMember({ kind: 'admin', phone: row.phone, active: row.active, staff_type: row.staff_type })) return;
    const actor = buildGroupChatActor({ role: 'admin', phone: row.phone, name: row.name });
    if (actor) {
      members.push({
        immutable_actor_id: row.id,
        actor_id: actor.id,
        role: actor.role,
        phone: actor.phone,
        name: actor.name,
        headquarters: '총무',
        appointment_label: '활성',
        can_send_messages: true,
      });
    }
  });

  const deduped = new Map<string, GroupChatMember>();
  members.forEach((member) => {
    if (!deduped.has(member.actor_id)) deduped.set(member.actor_id, member);
  });
  return Array.from(deduped.values());
}

async function getEligibleFcMemberByActorId(actorId: string): Promise<GroupChatMember | null> {
  const phone = sanitizeGroupChatPhone(actorId.replace(/^fc:/, ''));
  if (!phone) return null;

  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id,name,phone,affiliation,signup_completed,is_manager_referral_shadow,life_commission_completed,nonlife_commission_completed,appointment_date_life,appointment_date_nonlife')
    .eq('phone', phone)
    .maybeSingle();
  if (error) throw error;

  if (data !== null && !isFcActorProfileListRow(data)) {
    throw new Error('group_chat_fc_member_response_invalid');
  }

  if (!data || !isEligibleGroupChatMember({
    kind: 'fc',
    phone: data.phone,
    signup_completed: data.signup_completed,
    affiliation: data.affiliation,
    is_manager_referral_shadow: data.is_manager_referral_shadow,
  })) {
    return null;
  }

  const actor = buildGroupChatActor({ role: 'fc', phone: data.phone, name: data.name });
  if (!actor || actor.id !== actorId) return null;

  return {
    immutable_actor_id: data.id,
    actor_id: actor.id,
    role: actor.role,
    phone: actor.phone,
    name: actor.name,
    headquarters: normalizeGroupChatText(data.affiliation) || null,
    appointment_label: buildGroupChatAppointmentLabel({
      kind: 'fc',
      phone: data.phone,
      signup_completed: data.signup_completed,
      affiliation: data.affiliation,
      is_manager_referral_shadow: data.is_manager_referral_shadow,
      life_commission_completed: data.life_commission_completed,
      nonlife_commission_completed: data.nonlife_commission_completed,
      appointment_date_life: data.appointment_date_life,
      appointment_date_nonlife: data.appointment_date_nonlife,
    }),
    can_send_messages: false,
  };
}

async function listSendPermissions(roomId: string): Promise<SendPermissionRow[]> {
  const result = await collectGroupChatDataApiPages(async (from, to) => {
    const page = await supabase
      .from('group_chat_member_send_permissions')
      .select('room_id,actor_id,can_send_messages')
      .eq('room_id', roomId)
      .order('actor_id', { ascending: true })
      .range(from, to);
    const rows = parseQueryRows(page.data, isSendPermissionRow);
    return {
      data: rows,
      error: page.error ?? (rows ? null : new Error('group_chat_send_permission_response_invalid')),
    };
  });
  if (!result.ok
    || result.data.some((row) => row.room_id !== roomId)
    || new Set(result.data.map((row) => row.actor_id)).size !== result.data.length) {
    throw new Error('group_chat_send_permission_response_invalid');
  }
  return result.data;
}

function applySendPermissionsToMembers(
  members: GroupChatMember[],
  permissions: SendPermissionRow[],
): GroupChatMember[] {
  const canSendByActorId = new Map(
    permissions.map((row) => [
      normalizeFcGroupChatActorId(row.actor_id) || normalizeGroupChatText(row.actor_id),
      row.can_send_messages === true,
    ]),
  );

  return members.map((member) => {
    if (member.role !== 'fc') {
      return { ...member, can_send_messages: true };
    }
    return {
      ...member,
      can_send_messages: canSendByActorId.get(member.actor_id) === true,
    };
  });
}

async function listEligibleMembersWithSendPermissions(roomId: string) {
  const [members, permissions] = await Promise.all([
    listEligibleMembers(),
    listSendPermissions(roomId),
  ]);
  return applySendPermissionsToMembers(members, permissions);
}

async function canActorSendMessages(roomId: string, actor: GroupChatActor) {
  if (canGroupChatActorSendMessages({ actor, permissions: [] })) return true;

  const { data, error } = await supabase
    .from('group_chat_member_send_permissions')
    .select('room_id,actor_id,can_send_messages')
    .eq('room_id', roomId)
    .eq('actor_id', actor.id)
    .maybeSingle();
  if (error) throw error;
  if (
    data !== null
    && (
      !isSendPermissionRow(data)
      || data.room_id !== roomId
      || data.actor_id !== actor.id
    )
  ) {
    throw new Error('group_chat_send_permission_response_invalid');
  }
  return canGroupChatActorSendMessages({
    actor,
    permissions: data ? [data] : [],
  });
}

async function fetchMessages(roomId: string, limit = DEFAULT_MESSAGE_LIMIT): Promise<MessageRow[]> {
  const safeLimit = Math.min(MAX_MESSAGE_LIMIT, Math.max(1, Math.floor(limit)));
  const { data, error } = await supabase
    .from('group_chat_messages')
    .select('id,room_id,sender_actor_id,sender_role,sender_phone,sender_name,content,message_type,file_url,file_name,file_size,attachment_batch_id,created_at,reply_to_message_id,reply_to_sender_name,reply_to_content,deleted_at,deleted_by_actor_id')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  const rows = parseQueryRows(data, isMessageRow);
  if (!rows || rows.some((row) => row.room_id !== roomId)) {
    throw new Error('group_chat_message_response_invalid');
  }
  return rows;
}

async function findExistingActiveSearchRoom(
  requestedRoomId?: string | null,
): Promise<{ room: RoomRow | null; reason: 'not_found' | 'inactive' | null }> {
  const { data, error } = await supabase
    .from('group_chat_rooms')
    .select('id,slug,title,is_active')
    .eq('slug', GROUP_CHAT_ROOM_SLUG)
    .maybeSingle();
  if (error) throw error;

  if (data !== null && !isRoomRow(data)) {
    throw new Error('group_chat_room_response_invalid');
  }
  const room = data;
  if (!room?.id || (requestedRoomId && room.id !== requestedRoomId)) {
    return { room: null, reason: 'not_found' };
  }
  if (!room.is_active) return { room: null, reason: 'inactive' };
  return { room, reason: null };
}

function inaccessibleSearchRoomResponse(
  reason: 'not_found' | 'inactive' | null,
  origin?: string | null,
) {
  if (reason === 'inactive') {
    return fail('inactive_room', '비활성화된 단톡방입니다.', 403, origin);
  }
  return fail('room_not_found', '접근할 수 있는 단톡방을 찾지 못했습니다.', 404, origin);
}

async function handleSearch(
  _actor: GroupChatActor,
  payload: Extract<Payload, { type: 'group_chat_search' }>,
  origin?: string | null,
) {
  const query = normalizeGroupChatSearchQuery(payload.q);
  if (!query) {
    return fail('invalid_search_query', '검색어는 2자 이상 100자 이하로 입력해 주세요.', 400, origin);
  }
  const limit = normalizeGroupChatSearchLimit(payload.limit);
  if (!limit) {
    return fail('invalid_search_limit', '검색 결과 수는 1개 이상 50개 이하로 지정해 주세요.', 400, origin);
  }

  // This action is deliberately read-only: unlike bootstrap it never creates
  // the canonical room when missing, and it never touches read receipts.
  const authorized = await findExistingActiveSearchRoom();
  if (!authorized.room) {
    return inaccessibleSearchRoomResponse(authorized.reason, origin);
  }

  const literalPattern = `%${escapeGroupChatIlikeLiteral(query)}%`;
  const { data, error } = await supabase
    .from('group_chat_messages')
    .select('id,room_id,sender_name,sender_role,content,created_at,deleted_at')
    .eq('room_id', authorized.room.id)
    .is('deleted_at', null)
    .ilike('content', literalPattern)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) return dbError(error, origin);

  const rows = parseQueryRows(data, isGroupChatSearchMessageRow);
  if (!rows || rows.some((row) => row.room_id !== authorized.room!.id || row.deleted_at !== null)) {
    return fail('db_error', '검색 결과를 확인하지 못했습니다.', 500, origin);
  }
  return json({
    ok: true,
    results: rows.map((row) => serializeGroupChatSearchResult({
      row,
      query,
      roomLabel: authorized.room!.title,
    })),
    coverage: 'bounded_first_page',
    nextCursor: null,
  }, 200, origin);
}

async function handleContext(
  actor: GroupChatActor,
  payload: Extract<Payload, { type: 'group_chat_context' }>,
  origin?: string | null,
) {
  const roomId = typeof payload.room_id === 'string'
    ? payload.room_id.trim().toLowerCase()
    : '';
  const messageId = typeof payload.message_id === 'string'
    ? payload.message_id.trim().toLowerCase()
    : '';
  if (!UUID_PATTERN.test(roomId) || !UUID_PATTERN.test(messageId)) {
    return fail('invalid_context', '단톡방과 메시지 정보를 확인해 주세요.', 400, origin);
  }

  const authorized = await findExistingActiveSearchRoom(roomId);
  if (!authorized.room) {
    return inaccessibleSearchRoomResponse(authorized.reason, origin);
  }

  const select = 'id,room_id,sender_actor_id,sender_role,sender_phone,sender_name,content,message_type,file_url,file_name,file_size,attachment_batch_id,created_at,reply_to_message_id,reply_to_sender_name,reply_to_content,deleted_at,deleted_by_actor_id';
  const { data: anchorData, error: anchorError } = await supabase
    .from('group_chat_messages')
    .select(select)
    .eq('room_id', authorized.room.id)
    .eq('id', messageId)
    .maybeSingle();
  if (anchorError) return dbError(anchorError, origin);
  if (anchorData === null) {
    return fail('message_not_found', '메시지를 찾지 못했습니다.', 404, origin);
  }
  if (
    !isMessageRow(anchorData)
    || anchorData.id !== messageId
    || anchorData.room_id !== authorized.room.id
  ) {
    return fail('db_error', '기준 메시지를 확인하지 못했습니다.', 500, origin);
  }

  const anchor = anchorData;
  const tupleBefore = `created_at.lt.${anchor.created_at},and(created_at.eq.${anchor.created_at},id.lt.${anchor.id})`;
  const tupleAfter = `created_at.gt.${anchor.created_at},and(created_at.eq.${anchor.created_at},id.gt.${anchor.id})`;
  const sideFetchLimit = GROUP_CHAT_CONTEXT_SIDE_LIMIT + 1;
  const [beforeResult, afterResult] = await Promise.all([
    supabase
      .from('group_chat_messages')
      .select(select)
      .eq('room_id', authorized.room.id)
      .or(tupleBefore)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(sideFetchLimit),
    supabase
      .from('group_chat_messages')
      .select(select)
      .eq('room_id', authorized.room.id)
      .or(tupleAfter)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(sideFetchLimit),
  ]);
  if (beforeResult.error) return dbError(beforeResult.error, origin);
  if (afterResult.error) return dbError(afterResult.error, origin);

  const beforeRows = parseQueryRows(beforeResult.data, isMessageRow);
  const afterRows = parseQueryRows(afterResult.data, isMessageRow);
  if (
    !beforeRows
    || !afterRows
    || [...beforeRows, ...afterRows].some((row) =>
      row.room_id !== authorized.room!.id
    )
  ) {
    return fail('db_error', '메시지 문맥을 확인하지 못했습니다.', 500, origin);
  }
  const beforeCandidates = beforeRows
    .filter((row) => compareGroupChatMessageTuple(row, anchor) < 0);
  const afterCandidates = afterRows
    .filter((row) => compareGroupChatMessageTuple(row, anchor) > 0);
  const before = beforeCandidates.slice(0, GROUP_CHAT_CONTEXT_SIDE_LIMIT).reverse();
  const after = afterCandidates.slice(0, GROUP_CHAT_CONTEXT_SIDE_LIMIT);
  const contextRows = [...before, anchor, ...after];
  const [attachmentsByBatch, reactionRows] = await Promise.all([
    attachmentMapForMessages(contextRows),
    listReactions(authorized.room.id, contextRows.map((row) => row.id)),
  ]);
  const reactionsByMessage = groupReactionsByMessageId(reactionRows, actor.id);
  const messages = contextRows.map((row) => serializeMessage(
    row,
    0,
    reactionsByMessage.get(row.id) ?? [],
    row.attachment_batch_id
      ? attachmentsByBatch.get(row.attachment_batch_id) ?? []
      : [],
  ));

  return json({
    ok: true,
    roomRef: { version: 1, kind: 'group_chat', roomId: authorized.room.id },
    anchorMessageId: anchor.id,
    messages,
    hasBefore: beforeCandidates.length > GROUP_CHAT_CONTEXT_SIDE_LIMIT,
    hasAfter: afterCandidates.length > GROUP_CHAT_CONTEXT_SIDE_LIMIT,
    nextCursor: null,
  }, 200, origin);
}

async function attachmentMapForMessages(messages: MessageRow[]) {
  return await listMessengerAttachmentsByBatchIds({
    supabase,
    batchIds: messages.map((message) => message.attachment_batch_id),
  });
}

async function listReactions(roomId: string, messageIds: string[]): Promise<ReactionRow[]> {
  const ids = Array.from(new Set(messageIds.filter(Boolean)));
  if (ids.length === 0) return [];

  const idSet = new Set(ids);
  const batchResults = await Promise.all(
    chunkGroupChatDataApiValues(ids).map((messageIdBatch) =>
      collectGroupChatDataApiPages(async (from, to) => {
        const page = await supabase
          .from('group_chat_reactions')
          .select('room_id,message_id,actor_id,reaction')
          .eq('room_id', roomId)
          .in('message_id', messageIdBatch)
          .order('message_id', { ascending: true })
          .order('actor_id', { ascending: true })
          .range(from, to);
        const rows = parseQueryRows(page.data, isReactionRow);
        return {
          data: rows,
          error: page.error ?? (rows ? null : new Error('group_chat_reaction_response_invalid')),
        };
      })
    ),
  );
  if (batchResults.some((result) => !result.ok)) {
    throw new Error('group_chat_reaction_response_invalid');
  }
  const rows = batchResults.flatMap((result) => result.ok ? result.data : []);
  const rowKeys = rows.map((row) => `${row.message_id}:${row.actor_id}`);
  if (rows.some((row) => row.room_id !== roomId || !idSet.has(row.message_id))
    || new Set(rowKeys).size !== rowKeys.length) {
    throw new Error('group_chat_reaction_response_invalid');
  }
  return rows;
}

function groupReactionsByMessageId(
  reactions: ReactionRow[],
  viewerActorId: string,
) {
  const rowsByMessageId = new Map<string, ReactionRow[]>();
  reactions.forEach((row) => {
    const rows = rowsByMessageId.get(row.message_id) ?? [];
    rows.push(row);
    rowsByMessageId.set(row.message_id, rows);
  });

  const summariesByMessageId = new Map<string, ReturnType<typeof summarizeGroupChatReactions>>();
  rowsByMessageId.forEach((rows, messageId) => {
    summariesByMessageId.set(messageId, summarizeGroupChatReactions({
      viewerActorId,
      reactions: rows,
    }));
  });
  return summariesByMessageId;
}

async function getReadState(roomId: string, actorId: string) {
  const { data, error } = await supabase
    .from('group_chat_reads')
    .select('last_read_at,last_read_message_id')
    .eq('room_id', roomId)
    .eq('actor_id', actorId)
    .maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  if (!isReadStateDetailRow(data)) {
    throw new Error('group_chat_read_state_response_invalid');
  }
  return data;
}

async function listReadStates(roomId: string): Promise<ReadStateRow[]> {
  const result = await collectGroupChatDataApiPages(async (from, to) => {
    const page = await supabase
      .from('group_chat_reads')
      .select('room_id,actor_id,last_read_at')
      .eq('room_id', roomId)
      .order('actor_id', { ascending: true })
      .range(from, to);
    const rows = parseQueryRows(page.data, isReadStateRow);
    return {
      data: rows,
      error: page.error ?? (rows ? null : new Error('group_chat_read_states_response_invalid')),
    };
  });
  if (!result.ok
    || result.data.some((row) => row.room_id !== roomId)
    || new Set(result.data.map((row) => row.actor_id)).size !== result.data.length) {
    throw new Error('group_chat_read_states_response_invalid');
  }
  return result.data;
}

function buildReplyContent(row: Pick<MessageRow, 'content' | 'message_type' | 'file_name' | 'deleted_at'>) {
  if (row.deleted_at) return '삭제된 메시지';
  if (row.message_type === 'image') return '사진';
  if (row.message_type === 'file') return normalizeGroupChatText(row.file_name) || '파일';
  return normalizeGroupChatText(row.content).slice(0, 140);
}

async function getReplySnapshot(roomId: string, messageId?: string | null) {
  const safeMessageId = normalizeGroupChatText(messageId);
  if (!safeMessageId) return null;
  const row = await getMessageInRoom(roomId, safeMessageId);
  if (!row) return null;
  return {
    reply_to_message_id: row.id,
    reply_to_sender_name: row.sender_name,
    reply_to_content: buildReplyContent(row),
  };
}

async function getMuted(
  roomId: string,
  actorId: string,
  member?: Pick<GroupChatMember, 'immutable_actor_id' | 'role'> | null,
) {
  if (member) {
    const canonical = await supabase
      .from('messenger_room_notification_preferences')
      .select('muted')
      .eq('actor_id', member.immutable_actor_id)
      .eq('actor_role', member.role)
      .eq('room_key', groupChatRoomPreferenceKey(roomId))
      .maybeSingle();
    if (canonical.error) throw canonical.error;
    if (canonical.data !== null) {
      if (!isRecord(canonical.data) || typeof canonical.data.muted !== 'boolean') {
        throw new Error('group_chat_room_preference_response_invalid');
      }
      return canonical.data.muted;
    }
  }

  const { data, error } = await supabase
    .from('group_chat_preferences')
    .select('muted')
    .eq('room_id', roomId)
    .eq('actor_id', actorId)
    .maybeSingle();
  if (error) throw error;
  if (data === null) return false;
  if (!isRecord(data) || typeof data.muted !== 'boolean') {
    throw new Error('group_chat_preference_response_invalid');
  }
  return data.muted;
}

async function countUnread(roomId: string, actorId: string, lastReadAt?: string | null) {
  let query = supabase
    .from('group_chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', roomId)
    .neq('sender_actor_id', actorId);

  if (lastReadAt) {
    query = query.gt('created_at', lastReadAt);
  }

  const { count, error } = await query;
  if (error) throw error;
  const parsedCount = parseQueryCount(count);
  if (parsedCount === null) throw new Error('group_chat_unread_count_response_invalid');
  return parsedCount;
}

async function upsertRead(
  roomId: string,
  actorId: string,
  message?: Pick<MessageRow, 'id' | 'created_at'> | null,
): Promise<ReadReceiptRow> {
  const lastReadAt = message?.created_at ?? new Date().toISOString();
  const lastReadMessageId = message?.id ?? null;
  const { data, error } = await supabase
    .from('group_chat_reads')
    .upsert({
      room_id: roomId,
      actor_id: actorId,
      last_read_at: lastReadAt,
      last_read_message_id: lastReadMessageId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'room_id,actor_id' })
    .select('room_id,actor_id,last_read_at,last_read_message_id')
    .single();
  if (error) throw error;
  if (
    !isReadReceiptRow(data)
    || data.room_id !== roomId
    || data.actor_id !== actorId
    || data.last_read_message_id !== lastReadMessageId
    || Date.parse(data.last_read_at) !== Date.parse(lastReadAt)
  ) {
    throw new Error('group_chat_read_receipt_invalid');
  }
  return data;
}

function countAcceptedExpoTickets(value: unknown, expectedCount: number) {
  if (!value || typeof value !== 'object') return 0;
  const rawData = (value as { data?: unknown }).data;
  const tickets = Array.isArray(rawData) ? rawData : rawData ? [rawData] : [];
  const acceptedCount = tickets.filter((ticket) =>
    ticket && typeof ticket === 'object' && (ticket as { status?: unknown }).status === 'ok'
  ).length;
  return Math.min(expectedCount, acceptedCount);
}

async function sendExpoPushPayloads(pushPayload: Record<string, unknown>[]): Promise<ExpoPushSummary> {
  const summary: ExpoPushSummary = {
    requested_count: pushPayload.length,
    accepted_count: 0,
    rejected_count: 0,
  };

  for (let index = 0; index < pushPayload.length; index += EXPO_PUSH_CHUNK_SIZE) {
    const chunk = pushPayload.slice(index, index + EXPO_PUSH_CHUNK_SIZE);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS),
      });
      if (!response.ok) {
        summary.rejected_count += chunk.length;
        console.warn('[group-chat] expo push failed', {
          reason: 'provider_http_failed',
          status: response.status,
        });
        continue;
      }

      const providerPayload = await response.json().catch(() => null);
      const acceptedCount = countAcceptedExpoTickets(providerPayload, chunk.length);
      summary.accepted_count += acceptedCount;
      summary.rejected_count += chunk.length - acceptedCount;
      if (acceptedCount !== chunk.length) {
        console.warn('[group-chat] expo push ticket rejected', {
          reason: 'provider_ticket_rejected',
          rejected_count: chunk.length - acceptedCount,
        });
      }
    } catch {
      summary.rejected_count += chunk.length;
      console.warn('[group-chat] expo push request failed', {
        reason: 'provider_delivery_not_accepted',
      });
    }
  }

  return summary;
}

async function insertNotificationsWithFallback(rows: Record<string, unknown>[]): Promise<NotificationInsertSummary> {
  if (rows.length === 0) {
    return { inserted_count: 0, failed: false, ids_by_actor: new Map() };
  }
  const expectedByActor = new Map(
    rows.map((row) => [String(row.recipient_actor_id ?? ''), row]),
  );
  if (expectedByActor.size !== rows.length || expectedByActor.has('')) {
    return {
      inserted_count: 0,
      failed: true,
      ids_by_actor: new Map(),
      failure_reason: 'recipient_mismatch',
    };
  }

  const idsByActor = new Map<string, string>();
  let insertedCount = 0;
  for (const batch of chunkGroupChatDataApiValues(rows)) {
    const result = await supabase
      .from('notifications')
      .upsert(batch, { onConflict: 'delivery_key' })
      .select('id,resident_id,recipient_role,recipient_actor_id,target,delivery_key');
    const receipts = parseQueryRows(result.data, isRecord);
    if (result.error || !receipts) {
      console.warn('[group-chat] notification insert failed', { reason: 'notification_insert_failed' });
      return {
        inserted_count: insertedCount,
        failed: true,
        ids_by_actor: idsByActor,
        failure_reason: 'notification_insert_failed',
      };
    }

    const confirmedBeforeBatch = idsByActor.size;
    let failureReason: string | undefined;
    for (const row of receipts) {
      const recipientActorId = String(row.recipient_actor_id ?? '');
      const expected = expectedByActor.get(recipientActorId);
      const expectedTarget = expected?.target;
      if (!expected || !expectedTarget || typeof expectedTarget !== 'object') {
        failureReason = 'recipient_mismatch';
        continue;
      }
      if (row.delivery_key !== expected.delivery_key || idsByActor.has(recipientActorId)) {
        failureReason = 'delivery_key_mismatch';
        continue;
      }
      const residentId = String(expected.resident_id ?? '');
      const validation = validatePersistedNotificationForDelivery(row, {
        target: expectedTarget as NotificationTargetV1,
        recipientRole: expected.recipient_role === 'admin' ? 'admin' : 'fc',
        recipientActorId,
        residentId,
      });
      if (validation.ok === false) {
        failureReason = validation.reason;
        continue;
      }
      idsByActor.set(recipientActorId, validation.notificationId);
    }

    insertedCount += receipts.length;
    if (
      failureReason
      || receipts.length !== batch.length
      || idsByActor.size - confirmedBeforeBatch !== batch.length
    ) {
      return {
        inserted_count: insertedCount,
        failed: true,
        ids_by_actor: idsByActor,
        failure_reason: failureReason ?? 'notification_id_mapping_incomplete',
      };
    }
  }

  return {
    inserted_count: insertedCount,
    failed: false,
    ids_by_actor: idsByActor,
  };
}

function selectEligibleRecipientTokens(
  tokenRows: DeviceTokenRow[],
  recipients: GroupChatMember[],
): DeviceTokenRow[] {
  // Group-chat membership is already resolved from active account tables. Match both
  // phone and role so an eligible manager token is retained without admitting a
  // request-board-only manager token for a non-member phone.
  const recipientRolesByPhone = new Map<string, Set<GroupChatRole>>();
  recipients.forEach((member) => {
    const phone = sanitizeGroupChatPhone(member.phone);
    if (!phone) return;
    const roles = recipientRolesByPhone.get(phone) ?? new Set<GroupChatRole>();
    roles.add(member.role);
    recipientRolesByPhone.set(phone, roles);
  });

  const tokensByValue = new Map<string, DeviceTokenRow>();
  tokenRows.forEach((row) => {
    const token = normalizeGroupChatText(row.expo_push_token);
    const phone = sanitizeGroupChatPhone(row.resident_id);
    const role = normalizeGroupChatText(row.role).toLowerCase() as GroupChatRole;
    if (!token || !phone || !recipientRolesByPhone.get(phone)?.has(role)) return;
    if (!tokensByValue.has(token)) tokensByValue.set(token, row);
  });
  return Array.from(tokensByValue.values());
}

function appPushPreferenceKey(actorId: string, actorRole: GroupChatRole) {
  return `${actorRole}:${actorId.toLowerCase()}`;
}

function groupChatRoomPreferenceKey(roomId: string) {
  return `garamin:group:${roomId.toLowerCase()}`;
}

function resolveRecipientRoomMuted(input: {
  member: GroupChatMember;
  canonicalMutedByActor: Map<string, boolean>;
  legacyMutedByActor: Map<string, boolean>;
}) {
  const canonicalKey = appPushPreferenceKey(
    input.member.immutable_actor_id,
    input.member.role,
  );
  if (input.canonicalMutedByActor.has(canonicalKey)) {
    return input.canonicalMutedByActor.get(canonicalKey) === true;
  }
  return input.legacyMutedByActor.get(input.member.actor_id) === true;
}

function selectNativePushRecipients(
  recipients: GroupChatMember[],
  globalPreferences: AppPushPreferenceRow[],
  categoryPreferences: AppPushPreferenceRow[],
) {
  // Missing rows are intentionally ON. Only an exact immutable actor UUID and
  // effective role tuple with enabled=false suppresses native push delivery.
  const globallyDisabled = new Set(
    globalPreferences
      .filter((row) => row.enabled === false)
      .map((row) => `${normalizeGroupChatText(row.actor_role).toLowerCase()}:${normalizeGroupChatText(row.actor_id).toLowerCase()}`),
  );
  const categoryDisabled = new Set(
    categoryPreferences
      .filter((row) => row.enabled === false)
      .map((row) => `${normalizeGroupChatText(row.actor_role).toLowerCase()}:${normalizeGroupChatText(row.actor_id).toLowerCase()}`),
  );
  return recipients.filter((member) => {
    const key = appPushPreferenceKey(member.immutable_actor_id, member.role);
    return !globallyDisabled.has(key) && !categoryDisabled.has(key);
  });
}

async function resolveNativePushRecipients(recipients: GroupChatMember[]): Promise<
  | { ok: true; recipients: GroupChatMember[] }
  | { ok: false }
> {
  if (recipients.length === 0) return { ok: true, recipients: [] };

  const actorIds = Array.from(new Set(
    recipients.map((member) => member.immutable_actor_id),
  ));
  const actorRoles = Array.from(new Set(
    recipients.map((member) => member.role),
  ));
  // Trust boundary: these service-only preference tables are read through the
  // server-held service client. Actor UUIDs and roles come from eligible account
  // rows above, never from the request body or client metadata.
  const [globalResult, categoryResult] = await Promise.all([
    collectGroupChatDataApiBatches(actorIds, async (actorIdBatch) => {
      const result = await supabase
        .from('app_push_preferences')
        .select('actor_id,actor_role,enabled')
        .in('actor_id', actorIdBatch)
        .in('actor_role', actorRoles);
      const rows = parseQueryRows(result.data, isAppPushPreferenceRow);
      return {
        data: rows,
        error: result.error ?? (rows ? null : new Error('group_chat_app_push_preference_response_invalid')),
      };
    }),
    collectGroupChatDataApiBatches(actorIds, async (actorIdBatch) => {
      const result = await supabase
        .from('app_push_category_preferences')
        .select('actor_id,actor_role,enabled')
        .in('actor_id', actorIdBatch)
        .in('actor_role', actorRoles)
        .eq('category', GROUP_CHAT_APP_PUSH_CATEGORY);
      const rows = parseQueryRows(result.data, isAppPushPreferenceRow);
      return {
        data: rows,
        error: result.error ?? (rows ? null : new Error('group_chat_app_push_preference_response_invalid')),
      };
    }),
  ]);
  if (!globalResult.ok || !categoryResult.ok) {
    console.warn('[group-chat] app push preference query failed', {
      reason: 'app_push_preference_query_failed',
    });
    return { ok: false };
  }

  return {
    ok: true,
    recipients: selectNativePushRecipients(
      recipients,
      globalResult.data,
      categoryResult.data,
    ),
  };
}

async function notifyRecipients(input: {
  roomId: string;
  message: MessageRow;
  eventKey: string;
  members?: GroupChatMember[];
  skipNativePush?: boolean;
}): Promise<GroupChatNotificationSummary> {
  const members = input.members ?? await listEligibleMembers();
  const immutableActorIds = Array.from(new Set(
    members.map((member) => member.immutable_actor_id),
  ));
  const effectiveActorRoles = Array.from(new Set(
    members.map((member) => member.role),
  ));
  const legacyActorIds = Array.from(new Set(
    members.map((member) => member.actor_id),
  ));
  // Canonical room preferences use the immutable actor tuple. The legacy
  // phone-derived group actor key remains a per-row compatibility fallback.
  const [canonicalPreferenceResult, legacyPreferenceResult] = await Promise.all([
    collectGroupChatDataApiBatches(immutableActorIds, async (actorIdBatch) => {
      const result = await supabase
        .from('messenger_room_notification_preferences')
        .select('actor_id,actor_role,muted')
        .eq('room_key', groupChatRoomPreferenceKey(input.roomId))
        .in('actor_id', actorIdBatch)
        .in('actor_role', effectiveActorRoles);
      const rows = parseQueryRows(result.data, isRoomNotificationPreferenceRow);
      return {
        data: rows,
        error: result.error ?? (rows ? null : new Error('group_chat_room_preference_response_invalid')),
      };
    }),
    collectGroupChatDataApiBatches(legacyActorIds, async (actorIdBatch) => {
      const result = await supabase
        .from('group_chat_preferences')
        .select('actor_id,muted')
        .eq('room_id', input.roomId)
        .in('actor_id', actorIdBatch);
      const rows = parseQueryRows(result.data, isPreferenceRow);
      return {
        data: rows,
        error: result.error ?? (rows ? null : new Error('group_chat_room_preference_response_invalid')),
      };
    }),
  ]);
  if (!canonicalPreferenceResult.ok || !legacyPreferenceResult.ok) {
    throw new Error('group_chat_room_preference_query_failed');
  }

  const canonicalMutedByActor = new Map(
    canonicalPreferenceResult.data
      .map((row) => [
        `${normalizeGroupChatText(row.actor_role).toLowerCase()}:${normalizeGroupChatText(row.actor_id).toLowerCase()}`,
        row.muted === true,
      ]),
  );
  const legacyMutedByActor = new Map(
    legacyPreferenceResult.data
      .map((row) => [row.actor_id, row.muted === true]),
  );

  const recipients = members.filter((member) =>
    shouldFanoutGroupChatPush({
      senderActorId: input.message.sender_actor_id,
      recipientActorId: member.actor_id,
      recipientMuted: resolveRecipientRoomMuted({
        member,
        canonicalMutedByActor,
        legacyMutedByActor,
      }),
    }),
  );
  if (recipients.length === 0) {
    return {
      ok: true,
      status: 'skipped',
      stored: true,
      push_status: 'no_registered_device',
      recipient_count: 0,
      notification_count: 0,
      push_token_count: 0,
      push_accepted_count: 0,
      push_rejected_count: 0,
      delivery: {
        notificationStored: true,
        pushStatus: 'no_registered_device',
        retryable: false,
      },
    };
  }

  const notificationRows = recipients.map((member) => ({
    recipient_role: toNotificationRecipientRole(member.role),
    resident_id: member.phone,
    recipient_actor_id: member.immutable_actor_id,
    title: GROUP_CHAT_ROOM_TITLE,
    body: `${input.message.sender_name ?? '사용자'}: ${buildGroupChatPreview(input.message)}`,
    category: GROUP_CHAT_NOTIFICATION_CATEGORY,
    target: { version: 1, kind: 'group_chat', roomId: input.roomId },
    target_url: GROUP_CHAT_TARGET_URL,
    delivery_key: groupChatNotificationDeliveryKey(
      input.eventKey,
      member.immutable_actor_id,
    ),
  }));
  const notificationInsert = await insertNotificationsWithFallback(notificationRows);
  if (notificationInsert.failed) {
    return {
      ok: false,
      status: 'partial',
      stored: false,
      push_status: 'provider_failed',
      recipient_count: recipients.length,
      notification_count: notificationInsert.inserted_count,
      push_token_count: 0,
      push_accepted_count: 0,
      push_rejected_count: 0,
      delivery: {
        notificationStored: false,
        pushStatus: 'not_attempted',
        retryable: true,
      },
    };
  }

  if (input.skipNativePush) {
    return {
      ok: true,
      status: 'inbox_only',
      stored: true,
      push_status: 'no_registered_device',
      recipient_count: recipients.length,
      notification_count: notificationInsert.inserted_count,
      push_token_count: 0,
      push_accepted_count: 0,
      push_rejected_count: 0,
      delivery: {
        notificationStored: true,
        pushStatus: 'not_attempted',
        retryable: false,
        notificationIds: Array.from(notificationInsert.ids_by_actor.values()),
      },
    };
  }

  const nativePushResolution = await resolveNativePushRecipients(recipients);
  if (!nativePushResolution.ok) {
    return {
      ok: true,
      status: 'partial',
      stored: true,
      push_status: 'provider_failed',
      recipient_count: recipients.length,
      notification_count: notificationInsert.inserted_count,
      push_token_count: 0,
      push_accepted_count: 0,
      push_rejected_count: 0,
      delivery: {
        notificationStored: true,
        pushStatus: 'provider_rejected',
        retryable: false,
        notificationIds: Array.from(notificationInsert.ids_by_actor.values()),
      },
    };
  }
  const nativePushRecipients = nativePushResolution.recipients;
  if (nativePushRecipients.length === 0) {
    return {
      ok: true,
      status: 'inbox_only',
      stored: true,
      push_status: 'no_registered_device',
      recipient_count: recipients.length,
      notification_count: notificationInsert.inserted_count,
      push_token_count: 0,
      push_accepted_count: 0,
      push_rejected_count: 0,
      delivery: {
        notificationStored: true,
        pushStatus: 'no_registered_device',
        retryable: false,
        notificationIds: Array.from(notificationInsert.ids_by_actor.values()),
      },
    };
  }

  const recipientPhones = Array.from(new Set(nativePushRecipients.map((member) => member.phone)));
  const tokenResult = await collectGroupChatDataApiBatches(
    recipientPhones,
    async (phoneBatch) => {
      const result = await supabase
        .from('device_tokens')
        .select('expo_push_token,resident_id,role')
        .in('resident_id', phoneBatch);
      const rows = parseQueryRows(result.data, isDeviceTokenRow);
      return {
        data: rows,
        error: result.error ?? (rows ? null : new Error('group_chat_device_token_response_invalid')),
      };
    },
  );
  if (!tokenResult.ok) {
    console.warn('[group-chat] token query failed', { reason: 'token_query_failed' });
    return {
      ok: true,
      status: 'partial',
      stored: true,
      push_status: 'provider_failed',
      recipient_count: recipients.length,
      notification_count: notificationInsert.inserted_count,
      push_token_count: 0,
      push_accepted_count: 0,
      push_rejected_count: 0,
      delivery: {
        notificationStored: true,
        pushStatus: 'provider_rejected',
        retryable: false,
        notificationIds: Array.from(notificationInsert.ids_by_actor.values()),
      },
    };
  }

  const allowedTokenRows = selectEligibleRecipientTokens(
    tokenResult.data,
    nativePushRecipients,
  );
  if (allowedTokenRows.length === 0) {
    return {
      ok: true,
      status: 'inbox_only',
      stored: true,
      push_status: 'no_registered_device',
      recipient_count: recipients.length,
      notification_count: notificationInsert.inserted_count,
      push_token_count: 0,
      push_accepted_count: 0,
      push_rejected_count: 0,
      delivery: {
        notificationStored: true,
        pushStatus: 'no_registered_device',
        retryable: false,
        notificationIds: Array.from(notificationInsert.ids_by_actor.values()),
      },
    };
  }
  const recipientByRoleAndPhone = new Map(
    nativePushRecipients.map((member) => [
      `${member.role}:${sanitizeGroupChatPhone(member.phone)}`,
      member,
    ]),
  );
  const pushPayload = allowedTokenRows
    .map((row) => {
      const member = recipientByRoleAndPhone.get(
        `${normalizeGroupChatText(row.role).toLowerCase()}:${sanitizeGroupChatPhone(row.resident_id)}`,
      );
      if (!member) return null;
      const notificationId = notificationInsert.ids_by_actor.get(
        member.immutable_actor_id,
      );
      if (!notificationId) return null;
      return {
        to: row.expo_push_token,
        sound: 'default',
        priority: 'high',
        channelId: 'alerts',
        title: GROUP_CHAT_ROOM_TITLE,
        body: `${input.message.sender_name ?? '사용자'}: ${buildGroupChatPreview(input.message)}`,
        data: {
          url: GROUP_CHAT_TARGET_URL,
          category: GROUP_CHAT_NOTIFICATION_CATEGORY,
          notificationId,
          target: { version: 1, kind: 'group_chat', roomId: input.roomId },
          sentAt: new Date().toISOString(),
        },
      };
    })
    .filter((payload): payload is NonNullable<typeof payload> => payload !== null);

  const provider = await sendExpoPushPayloads(pushPayload);
  // A persisted inbox notification is useful, but it is not evidence that a
  // handset push was delivered. When recipients exist, require at least one
  // accepted Expo ticket before reporting notification delivery as successful.
  const hasAcceptedPush = provider.accepted_count > 0;
  const providerAccepted = hasAcceptedPush && provider.rejected_count === 0;
  return {
    ok: true,
    status: providerAccepted ? 'provider_accepted' : 'partial',
    stored: true,
    push_status: providerAccepted ? 'queued' : 'provider_failed',
    recipient_count: recipients.length,
    notification_count: notificationInsert.inserted_count,
    push_token_count: provider.requested_count,
    push_accepted_count: provider.accepted_count,
    push_rejected_count: provider.rejected_count,
    delivery: {
      notificationStored: true,
      pushStatus: providerAccepted ? 'accepted' : 'provider_rejected',
      retryable: false,
      notificationIds: Array.from(notificationInsert.ids_by_actor.values()),
    },
  };
}

function notificationFanoutFailureSummary(): GroupChatNotificationSummary {
  return {
    ok: false,
    status: 'partial',
    stored: false,
    push_status: 'provider_failed',
    recipient_count: 0,
    notification_count: 0,
    push_token_count: 0,
    push_accepted_count: 0,
    push_rejected_count: 0,
    delivery: {
      notificationStored: false,
      pushStatus: 'not_attempted',
      retryable: true,
    },
  };
}

function notificationWarning(summary: GroupChatNotificationSummary) {
  if (summary.delivery.notificationStored) return null;
  return {
    code: 'notification_delivery_partial',
    message: '메시지는 전송됐지만 새 메시지 알림함 등록이 완료되지 않았습니다.',
  } as const;
}

async function handleBootstrap(actor: GroupChatActor, payload: Extract<Payload, { type: 'group_chat_bootstrap' }>, origin?: string | null) {
  const room = await ensureRoom();
  const [members, messages, readState, readStates, notice] = await Promise.all([
    listEligibleMembersWithSendPermissions(room.id),
    fetchMessages(room.id, payload.limit ?? DEFAULT_MESSAGE_LIMIT),
    getReadState(room.id, actor.id),
    listReadStates(room.id),
    getCurrentNotice(room.id, actor.id),
  ]);

  const currentMember = members.find((member) => member.actor_id === actor.id) ?? null;
  const [unreadCount, muted] = await Promise.all([
    countUnread(room.id, actor.id, readState?.last_read_at ?? null),
    getMuted(room.id, actor.id, currentMember),
  ]);
  const attachmentsByBatch = await attachmentMapForMessages(messages);
  const reactions = await listReactions(room.id, messages.map((message) => message.id));
  const reactionsByMessageId = groupReactionsByMessageId(reactions, actor.id);
  const messageUnreadCounts = computeGroupChatMessageUnreadCounts({
    members,
    readStates,
    messages,
  });
  const lastMessage = messages[0] ?? null;
  const canSendMessages = actor.role !== 'fc'
    || members.find((member) => member.actor_id === actor.id)?.can_send_messages === true;

  return json({
    ok: true,
    room: {
      id: room.id,
      slug: room.slug,
      title: room.title,
    },
    actor,
    can_send_messages: canSendMessages,
    member_count: members.length,
    members,
    muted,
    unread_count: unreadCount,
    last_read_at: readState?.last_read_at ?? null,
    notice,
    last_message: lastMessage
      ? serializeMessage(
        lastMessage,
        messageUnreadCounts.get(lastMessage.id) ?? 0,
        reactionsByMessageId.get(lastMessage.id) ?? [],
        lastMessage.attachment_batch_id
          ? attachmentsByBatch.get(lastMessage.attachment_batch_id) ?? []
          : [],
      )
      : null,
    messages: messages.map((message) =>
      serializeMessage(
        message,
        messageUnreadCounts.get(message.id) ?? 0,
        reactionsByMessageId.get(message.id) ?? [],
        message.attachment_batch_id
          ? attachmentsByBatch.get(message.attachment_batch_id) ?? []
          : [],
      ),
    ),
  }, 200, origin);
}

async function handleSend(actor: GroupChatActor, payload: Extract<Payload, { type: 'group_chat_send' }>, origin?: string | null) {
  const room = await ensureRoom();
  const canSendMessages = await canActorSendMessages(room.id, actor);
  if (!canSendMessages) {
    return fail('send_forbidden', '채팅 권한이 꺼져 있어요. 총무 또는 본부장에게 문의해주세요.', 403, origin);
  }

  const content = normalizeGroupChatMessageContent(payload.content);
  const fileUrl = normalizeGroupChatText(payload.file_url);
  const fileName = normalizeGroupChatText(payload.file_name);
  const fileSize = Number(payload.file_size ?? 0);
  const attachmentIntentIds = Array.isArray(payload.attachment_intent_ids)
    ? payload.attachment_intent_ids.map((value) =>
      normalizeGroupChatText(value).toLowerCase()
    )
    : [];
  const hasAttachments = attachmentIntentIds.length > 0;
  const deliveryKey = normalizeGroupChatText(payload.delivery_key).toLowerCase();
  const payloadFingerprint = normalizeGroupChatText(payload.payload_fingerprint).toLowerCase();
  if (
    attachmentIntentIds.length > 10
    || new Set(attachmentIntentIds).size !== attachmentIntentIds.length
    || attachmentIntentIds.some((id) => !UUID_PATTERN.test(id))
    || (
      hasAttachments
      && (
        !UUID_PATTERN.test(deliveryKey)
        || !/^[0-9a-f]{64}$/.test(payloadFingerprint)
      )
    )
    || (
      !hasAttachments
      && (
        Boolean(deliveryKey)
        || Boolean(payloadFingerprint)
      )
    )
  ) {
    return fail('invalid_attachment_payload', '첨부파일 요청이 올바르지 않습니다.', 400, origin);
  }
  if (!hasAttachments && !content) {
    return fail('invalid_payload', '메시지를 입력해주세요.', 400, origin);
  }
  if (
    fileUrl
    || fileName
    || (Number.isFinite(fileSize) && fileSize > 0)
    || (!hasAttachments && (payload.message_type === 'image' || payload.message_type === 'file'))
  ) {
    return fail(
      'legacy_attachment_upload_disabled',
      '기존 공개 첨부 방식은 더 이상 사용할 수 없습니다.',
      400,
      origin,
    );
  }

  const replySnapshot = await getReplySnapshot(room.id, payload.reply_to_message_id);
  let message: MessageRow;
  let messageAttachments: MessengerAttachmentMetadata[] = [];
  let attachmentCommit: { batchId: string; replayed: boolean } | null = null;
  let membersForSend: GroupChatMember[] | null = null;
  if (hasAttachments) {
    const clientMessageId = normalizeGroupChatText(payload.client_message_id).toLowerCase();
    if (payload.client_message_id && !UUID_PATTERN.test(clientMessageId)) {
      return fail('invalid_message_id', '메시지 식별자가 올바르지 않습니다.', 400, origin);
    }
    membersForSend = await listEligibleMembers();
    const senderMember = membersForSend.find((member) => member.actor_id === actor.id);
    if (!senderMember) {
      return fail('forbidden', '단톡방 참여자 정보를 확인할 수 없습니다.', 403, origin);
    }
    let finalized: Awaited<ReturnType<typeof finalizeMessengerAttachmentBatch>>;
    try {
      finalized = await finalizeMessengerAttachmentBatch({
        supabase,
        actor: {
          id: senderMember.immutable_actor_id,
          role: actor.role,
        },
        deliveryKey,
        payloadFingerprint,
        intentIds: attachmentIntentIds,
      });
    } catch (error) {
      return attachmentFailure(error, origin);
    }
    const messageId = clientMessageId || crypto.randomUUID();
    const commit = await supabase.rpc(
      'commit_group_chat_message_with_attachments_v2',
      {
        p_message_id: messageId,
        p_room_id: room.id,
        p_sender_immutable_actor_id: senderMember.immutable_actor_id,
        p_sender_actor_id: actor.id,
        p_sender_role: actor.role,
        p_sender_phone: actor.phone,
        p_sender_name: actor.name ?? '',
        p_content: content,
        p_reply_to_message_id: replySnapshot?.reply_to_message_id ?? null,
        p_reply_to_sender_name: replySnapshot?.reply_to_sender_name ?? null,
        p_reply_to_content: replySnapshot?.reply_to_content ?? null,
        p_delivery_key: deliveryKey,
        p_payload_fingerprint: payloadFingerprint,
        p_attachment_intent_ids: attachmentIntentIds,
      },
    );
    if (commit.error || !commit.data || typeof commit.data !== 'object') {
      return attachmentFailure(commit.error, origin);
    }
    const committed = commit.data as Record<string, unknown>;
    const result = await supabase
      .from('group_chat_messages')
      .select('id,room_id,sender_actor_id,sender_role,sender_phone,sender_name,content,message_type,file_url,file_name,file_size,attachment_batch_id,created_at,reply_to_message_id,reply_to_sender_name,reply_to_content,deleted_at,deleted_by_actor_id')
      .eq('room_id', room.id)
      .eq('id', messageId)
      .maybeSingle();
    if (
      result.error
      || !isMessageRow(result.data)
      || result.data.id !== messageId
      || result.data.room_id !== room.id
      || result.data.sender_actor_id !== actor.id
      || result.data.attachment_batch_id !== finalized.batchId
    ) {
      return fail('db_error', '전송한 메시지를 확인하지 못했습니다.', 500, origin);
    }
    message = result.data;
    try {
      const attachmentMap = await listMessengerAttachmentsByBatchIds({
        supabase,
        batchIds: [finalized.batchId],
      });
      messageAttachments = attachmentMap.get(finalized.batchId) ?? [];
    } catch (error) {
      return attachmentFailure(error, origin);
    }
    attachmentCommit = {
      batchId: finalized.batchId,
      replayed: finalized.replayed || committed.replayed === true,
    };
  } else {
    const result = await supabase
      .from('group_chat_messages')
      .insert({
        room_id: room.id,
        sender_actor_id: actor.id,
        sender_role: actor.role,
        sender_phone: actor.phone,
        sender_name: actor.name,
        content,
        message_type: 'text',
        file_url: null,
        file_name: null,
        file_size: null,
        reply_to_message_id: replySnapshot?.reply_to_message_id ?? null,
        reply_to_sender_name: replySnapshot?.reply_to_sender_name ?? null,
        reply_to_content: replySnapshot?.reply_to_content ?? null,
      })
      .select('id,room_id,sender_actor_id,sender_role,sender_phone,sender_name,content,message_type,file_url,file_name,file_size,attachment_batch_id,created_at,reply_to_message_id,reply_to_sender_name,reply_to_content,deleted_at,deleted_by_actor_id')
      .single();
    if (result.error) return dbError(result.error, origin);
    if (
      !isMessageRow(result.data)
      || result.data.room_id !== room.id
      || result.data.sender_actor_id !== actor.id
      || result.data.content !== content
      || result.data.message_type !== 'text'
    ) {
      return fail('db_error', '전송한 메시지를 확인하지 못했습니다.', 500, origin);
    }
    message = result.data;
  }
  const eventKey = await deriveGroupChatNotificationEventKey({
    roomId: room.id,
    messageId: message.id,
    senderActorId: message.sender_actor_id,
    createdAt: message.created_at,
  });
  const retrySigningSecret = groupChatNotificationRetrySigningSecret();
  const retryToken = retrySigningSecret
    ? await issueGroupChatNotificationRetryToken(eventKey, retrySigningSecret)
    : null;
  let readStateUpdated = true;
  try {
    await upsertRead(room.id, actor.id, message);
  } catch {
    readStateUpdated = false;
    console.warn('[group-chat] post-send read state update failed', {
      reason: 'read_state_update_failed',
    });
  }
  let unreadCount = 0;
  let notification = notificationFanoutFailureSummary();
  try {
    const members = membersForSend ?? await listEligibleMembers();
    unreadCount = members.filter((member) => member.actor_id !== actor.id).length;
    notification = await notifyRecipients({
      roomId: room.id,
      message,
      eventKey,
      members,
      skipNativePush: attachmentCommit?.replayed === true,
    });
  } catch {
    console.warn('[group-chat] notification fanout failed', {
      reason: 'notification_fanout_failed',
    });
  }

  return json({
    ok: true,
    message: serializeMessage(message, unreadCount, [], messageAttachments),
    ...(attachmentCommit ? { attachmentCommit } : {}),
    read_state: { updated: readStateUpdated },
    notification,
    delivery: notification.delivery,
    notificationRetry: notification.delivery.notificationStored || !retryToken
      ? null
      : { messageId: message.id, retryToken },
    warning: notificationWarning(notification),
  }, 200, origin);
}

async function handleNotificationRetry(
  actor: GroupChatActor,
  payload: Extract<Payload, { type: 'group_chat_notification_retry' }>,
  origin?: string | null,
) {
  const messageId = normalizeGroupChatText(payload.message_id).toLowerCase();
  const retryToken = normalizeGroupChatText(payload.retry_token).toLowerCase();
  if (
    !UUID_PATTERN.test(messageId)
    || !isGroupChatNotificationRetryToken(retryToken)
  ) {
    return fail(
      'invalid_notification_retry',
      '알림 재시도 요청이 올바르지 않습니다.',
      400,
      origin,
    );
  }

  const room = await ensureRoom();
  if (!room.is_active) {
    return fail('inactive_room', '비활성화된 단톡방입니다.', 403, origin);
  }
  const message = await getMessageInRoom(room.id, messageId);
  if (!message?.id) {
    return fail('not_found', '메시지를 찾지 못했습니다.', 404, origin);
  }
  if (message.deleted_at) {
    return fail(
      'deleted_message',
      '삭제된 메시지의 알림은 다시 보낼 수 없습니다.',
      409,
      origin,
    );
  }
  if (message.sender_actor_id !== actor.id) {
    return fail(
      'forbidden',
      '내가 보낸 메시지의 알림만 다시 시도할 수 있습니다.',
      403,
      origin,
    );
  }

  const eventKey = await deriveGroupChatNotificationEventKey({
    roomId: room.id,
    messageId: message.id,
    senderActorId: message.sender_actor_id,
    createdAt: message.created_at,
  });
  const retrySecrets = groupChatNotificationRetrySecrets();
  if (retrySecrets.length === 0) {
    return fail(
      'notification_retry_unavailable',
      '알림 재시도를 사용할 수 없습니다.',
      503,
      origin,
    );
  }
  const tokenVerified = await verifyGroupChatNotificationRetryToken({
    eventKey,
    retryToken,
    secrets: retrySecrets,
  });
  if (!tokenVerified) {
    return fail(
      'stale_notification_retry',
      '알림 재시도 정보가 현재 메시지와 일치하지 않습니다.',
      409,
      origin,
    );
  }
  const currentRetryToken = await issueGroupChatNotificationRetryToken(
    eventKey,
    retrySecrets[0],
  );

  const members = await listEligibleMembers();
  if (!members.some((member) => member.actor_id === actor.id)) {
    return fail(
      'forbidden',
      '현재 단톡방 참여자만 알림을 다시 시도할 수 있습니다.',
      403,
      origin,
    );
  }

  let notification = notificationFanoutFailureSummary();
  try {
    notification = await notifyRecipients({
      roomId: room.id,
      message,
      eventKey,
      members,
    });
  } catch {
    console.warn('[group-chat] notification retry failed', {
      reason: 'notification_retry_failed',
    });
  }

  return json({
    ok: true,
    notification,
    delivery: notification.delivery,
    notificationRetry: notification.delivery.notificationStored
      ? null
      : { messageId: message.id, retryToken: currentRetryToken },
    warning: notificationWarning(notification),
  }, 200, origin);
}

async function handleMarkRead(actor: GroupChatActor, payload: Extract<Payload, { type: 'group_chat_mark_read' }>, origin?: string | null) {
  const room = await ensureRoom();
  const messageId = normalizeGroupChatText(payload.message_id).toLowerCase();
  if (payload.message_id !== undefined && payload.message_id !== null && !UUID_PATTERN.test(messageId)) {
    return fail('invalid_message_id', '메시지 식별자가 올바르지 않습니다.', 400, origin);
  }
  const message = messageId ? await getMessageInRoom(room.id, messageId) : null;
  if (messageId && !message) {
    return fail('not_found', '메시지를 찾지 못했습니다.', 404, origin);
  }
  const readState = await upsertRead(room.id, actor.id, message);
  return json({ ok: true, read_state: readState }, 200, origin);
}

async function handlePreferences(actor: GroupChatActor, payload: Extract<Payload, { type: 'group_chat_preferences' }>, origin?: string | null) {
  const room = await ensureRoom();
  const muted = payload.muted === true;
  const members = await listEligibleMembers();
  const member = members.find((candidate) => candidate.actor_id === actor.id);
  if (!member) {
    return fail('forbidden', '단톡방 알림 설정을 변경할 수 없습니다.', 403, origin);
  }

  const roomKey = groupChatRoomPreferenceKey(room.id);
  // One canonical upsert is the save boundary. A stored false row intentionally
  // overrides a legacy true row, while bootstrap still falls back to legacy
  // only for actors that do not have a canonical preference yet.
  const canonicalResult = await supabase
    .from('messenger_room_notification_preferences')
    .upsert({
      actor_id: member.immutable_actor_id,
      actor_role: member.role,
      room_key: roomKey,
      muted,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'actor_id,actor_role,room_key' })
    .select('actor_id,actor_role,room_key,muted')
    .single();
  const saved = canonicalResult.data as {
    actor_id?: unknown;
    actor_role?: unknown;
    room_key?: unknown;
    muted?: unknown;
  } | null;
  if (
    canonicalResult.error
    || saved?.actor_id !== member.immutable_actor_id
    || saved.actor_role !== member.role
    || saved.room_key !== roomKey
    || saved.muted !== muted
  ) {
    console.warn('[group-chat] canonical room preference write failed', {
      reason: 'canonical_room_preference_write_failed',
    });
    return fail(
      'preference_write_failed',
      '단톡방 알림 설정을 저장하지 못했습니다. 다시 시도해 주세요.',
      500,
      origin,
    );
  }
  return json({ ok: true, muted: saved.muted }, 200, origin);
}

async function handleMemberSendPermission(
  actor: GroupChatActor,
  payload: Extract<Payload, { type: 'group_chat_member_send_permission' }>,
  origin?: string | null,
) {
  if (actor.role === 'fc') {
    return fail('forbidden', '채팅 권한은 총무, 본부장, 개발자만 변경할 수 있습니다.', 403, origin);
  }

  const room = await ensureRoom();
  const targetActorId = normalizeFcGroupChatActorId(payload.target_actor_id);
  if (!targetActorId) {
    return fail('invalid_payload', 'FC 참여자를 선택해주세요.', 400, origin);
  }

  const targetMember = await getEligibleFcMemberByActorId(targetActorId);
  if (!targetMember) {
    return fail('not_found', 'FC 참여자를 찾지 못했습니다.', 404, origin);
  }

  const canSendMessages = payload.can_send_messages === true;
  const { data, error } = await supabase
    .from('group_chat_member_send_permissions')
    .upsert({
      room_id: room.id,
      actor_id: targetActorId,
      can_send_messages: canSendMessages,
      updated_by_actor_id: actor.id,
      updated_by_role: actor.role,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'room_id,actor_id' })
    .select('room_id,actor_id,can_send_messages')
    .single();
  if (error) return dbError(error, origin);
  if (
    !isSendPermissionRow(data)
    || data.room_id !== room.id
    || data.actor_id !== targetActorId
    || data.can_send_messages !== canSendMessages
  ) {
    return fail('db_error', '채팅 권한 저장 결과를 확인하지 못했습니다.', 500, origin);
  }

  return json({
    ok: true,
    member: {
      ...targetMember,
      can_send_messages: data.can_send_messages,
    },
  }, 200, origin);
}

async function getMessageInRoom(roomId: string, messageId?: string | null) {
  const safeMessageId = normalizeGroupChatText(messageId);
  if (!safeMessageId) return null;

  const { data, error } = await supabase
    .from('group_chat_messages')
    .select('id,room_id,sender_actor_id,sender_role,sender_phone,sender_name,content,message_type,file_url,file_name,file_size,attachment_batch_id,created_at,reply_to_message_id,reply_to_sender_name,reply_to_content,deleted_at,deleted_by_actor_id')
    .eq('room_id', roomId)
    .eq('id', safeMessageId)
    .maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  if (!isMessageRow(data) || data.id !== safeMessageId || data.room_id !== roomId) {
    throw new Error('group_chat_message_response_invalid');
  }
  return data;
}

async function getNoticeRow(roomId: string) {
  const { data, error } = await supabase
    .from('group_chat_notices')
    .select('room_id,message_id,created_by_actor_id,created_by_role,created_at,updated_at')
    .eq('room_id', roomId)
    .maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  if (!isNoticeRow(data) || data.room_id !== roomId) {
    throw new Error('group_chat_notice_response_invalid');
  }
  return data;
}

async function clearNoticeForMessage(roomId: string, messageId: string) {
  const { error } = await supabase
    .from('group_chat_notices')
    .delete()
    .eq('room_id', roomId)
    .eq('message_id', messageId);
  if (error) throw error;
  const remaining = await supabase
    .from('group_chat_notices')
    .select('room_id,message_id')
    .eq('room_id', roomId)
    .eq('message_id', messageId)
    .maybeSingle();
  if (remaining.error) throw remaining.error;
  if (remaining.data !== null) throw new Error('group_chat_notice_delete_receipt_invalid');
}

async function getCurrentNotice(roomId: string, viewerActorId: string) {
  const notice = await getNoticeRow(roomId);
  if (!notice?.message_id) return null;

  const message = await getMessageInRoom(roomId, notice.message_id);
  if (!message?.id || message.deleted_at) {
    await clearNoticeForMessage(roomId, notice.message_id);
    return null;
  }

  const [reactions, attachmentsByBatch] = await Promise.all([
    listReactions(roomId, [message.id]),
    attachmentMapForMessages([message]),
  ]);
  return serializeNotice(
    notice,
    message,
    summarizeGroupChatReactions({
      viewerActorId,
      reactions,
    }),
    message.attachment_batch_id
      ? attachmentsByBatch.get(message.attachment_batch_id) ?? []
      : [],
  );
}

async function handleNoticeSet(actor: GroupChatActor, payload: Extract<Payload, { type: 'group_chat_notice_set' }>, origin?: string | null) {
  if (actor.role === 'fc') {
    return fail('forbidden', '공지는 총무, 본부장, 개발자만 등록할 수 있습니다.', 403, origin);
  }

  const room = await ensureRoom();
  const message = await getMessageInRoom(room.id, payload.message_id);
  if (!message?.id) return fail('not_found', '메시지를 찾을 수 없습니다.', 404, origin);
  if (message.deleted_at) {
    return fail('invalid_payload', '삭제된 메시지는 공지로 등록할 수 없습니다.', 400, origin);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('group_chat_notices')
    .upsert({
      room_id: room.id,
      message_id: message.id,
      created_by_actor_id: actor.id,
      created_by_role: actor.role,
      created_at: now,
      updated_at: now,
    }, { onConflict: 'room_id' })
    .select('room_id,message_id,created_by_actor_id,created_by_role,created_at,updated_at')
    .single();
  if (error) return dbError(error, origin);
  if (
    !isNoticeRow(data)
    || data.room_id !== room.id
    || data.message_id !== message.id
    || data.created_by_actor_id !== actor.id
    || data.created_by_role !== actor.role
    || Date.parse(data.created_at) !== Date.parse(now)
    || Date.parse(data.updated_at) !== Date.parse(now)
  ) {
    return fail('db_error', '공지 저장 결과를 확인하지 못했습니다.', 500, origin);
  }

  const [reactions, attachmentsByBatch] = await Promise.all([
    listReactions(room.id, [message.id]),
    attachmentMapForMessages([message]),
  ]);
  return json({
    ok: true,
    notice: serializeNotice(
      data,
      message,
      summarizeGroupChatReactions({
        viewerActorId: actor.id,
        reactions,
      }),
      message.attachment_batch_id
        ? attachmentsByBatch.get(message.attachment_batch_id) ?? []
        : [],
    ),
  }, 200, origin);
}

async function handleNoticeClear(actor: GroupChatActor, origin?: string | null) {
  if (actor.role === 'fc') {
    return fail('forbidden', '공지는 총무, 본부장, 개발자만 해제할 수 있습니다.', 403, origin);
  }

  const room = await ensureRoom();
  const { error } = await supabase
    .from('group_chat_notices')
    .delete()
    .eq('room_id', room.id);
  if (error) return dbError(error, origin);
  if (await getNoticeRow(room.id)) {
    return fail('db_error', '공지 해제 결과를 확인하지 못했습니다.', 500, origin);
  }

  return json({ ok: true, notice: null }, 200, origin);
}

async function handleReactionSet(actor: GroupChatActor, payload: Extract<Payload, { type: 'group_chat_reaction_set' }>, origin?: string | null) {
  const room = await ensureRoom();
  const message = await getMessageInRoom(room.id, payload.message_id);
  if (!message?.id) return fail('not_found', '메시지를 찾지 못했습니다.', 404, origin);

  const reaction = normalizeGroupChatText(payload.reaction);
  const persistedReaction = reaction ? reaction.slice(0, 16) : null;
  if (!reaction) {
    const { error } = await supabase
      .from('group_chat_reactions')
      .delete()
      .eq('room_id', room.id)
      .eq('message_id', message.id)
      .eq('actor_id', actor.id);
    if (error) return dbError(error, origin);
  } else {
    const { error } = await supabase
      .from('group_chat_reactions')
      .upsert({
        room_id: room.id,
        message_id: message.id,
        actor_id: actor.id,
        actor_role: actor.role,
        reaction: persistedReaction,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'room_id,message_id,actor_id' });
    if (error) return dbError(error, origin);
  }

  const persisted = await supabase
    .from('group_chat_reactions')
    .select('room_id,message_id,actor_id,reaction')
    .eq('room_id', room.id)
    .eq('message_id', message.id)
    .eq('actor_id', actor.id)
    .maybeSingle();
  if (persisted.error) return dbError(persisted.error, origin);
  if (
    (persistedReaction === null && persisted.data !== null)
    || (
      persistedReaction !== null
      && (
        !isReactionRow(persisted.data)
        || persisted.data.room_id !== room.id
        || persisted.data.message_id !== message.id
        || persisted.data.actor_id !== actor.id
        || persisted.data.reaction !== persistedReaction
      )
    )
  ) {
    return fail('db_error', '반응 저장 결과를 확인하지 못했습니다.', 500, origin);
  }

  const reactions = await listReactions(room.id, [message.id]);
  return json({
    ok: true,
    reactions: summarizeGroupChatReactions({
      viewerActorId: actor.id,
      reactions,
    }),
  }, 200, origin);
}

async function handleDelete(actor: GroupChatActor, payload: Extract<Payload, { type: 'group_chat_delete' }>, origin?: string | null) {
  const room = await ensureRoom();
  const message = await getMessageInRoom(room.id, payload.message_id);
  if (!message?.id) return fail('not_found', '메시지를 찾지 못했습니다.', 404, origin);
  if (message.sender_actor_id !== actor.id) {
    return fail('forbidden', '내가 보낸 메시지만 삭제할 수 있습니다.', 403, origin);
  }

  if (message.attachment_batch_id) {
    const members = await listEligibleMembers();
    const senderMember = members.find((member) => member.actor_id === actor.id);
    if (!senderMember) {
      return fail('forbidden', '단톡방 참여자 정보를 확인할 수 없습니다.', 403, origin);
    }
    const deletion = await supabase.rpc(
      'delete_messenger_attachment_delivery_v2',
      {
        p_message_kind: 'group',
        p_message_id: message.id,
        p_actor_id: senderMember.immutable_actor_id,
        p_actor_role: actor.role,
        p_group_actor_id: actor.id,
      },
    );
    if (deletion.error) return attachmentFailure(deletion.error, origin);
    const result = isRecord(deletion.data) ? deletion.data : null;
    if (
      !result
      || result.deleted !== true
      || result.batchId !== message.attachment_batch_id
      || !isNonNegativeSafeInteger(result.scheduled)
      || (
        result.retainedForReferences !== undefined
        && !isNonNegativeSafeInteger(result.retainedForReferences)
      )
    ) {
      return fail('db_error', '첨부 메시지 삭제 결과를 확인하지 못했습니다.', 500, origin);
    }
    const batchId = result.batchId;
    const cleanup = await drainMessengerAttachmentCleanup({
      supabase,
      limit: 20,
      batchId,
    });
    const deletedMessage = await getMessageInRoom(room.id, message.id);
    if (
      !deletedMessage
      || deletedMessage.id !== message.id
      || deletedMessage.room_id !== room.id
      || deletedMessage.attachment_batch_id !== message.attachment_batch_id
      || deletedMessage.deleted_at === null
      || deletedMessage.deleted_by_actor_id !== actor.id
      || deletedMessage.content !== ''
    ) {
      return fail('db_error', '삭제한 메시지를 확인하지 못했습니다.', 500, origin);
    }
    const reactions = await listReactions(room.id, [message.id]);
    return json({
      ok: true,
      message: serializeMessage(
        deletedMessage,
        0,
        summarizeGroupChatReactions({
          viewerActorId: actor.id,
          reactions,
        }),
      ),
      cleanup: {
        scheduled: result.scheduled,
        removed: cleanup.removed,
        requeued: cleanup.requeued,
        exhausted: cleanup.exhausted,
      },
    }, 200, origin);
  }

  const { data, error } = await supabase
    .from('group_chat_messages')
    .update({
      content: '',
      deleted_at: new Date().toISOString(),
      deleted_by_actor_id: actor.id,
    })
    .eq('room_id', room.id)
    .eq('id', message.id)
    .select('id,room_id,sender_actor_id,sender_role,sender_phone,sender_name,content,message_type,file_url,file_name,file_size,attachment_batch_id,created_at,reply_to_message_id,reply_to_sender_name,reply_to_content,deleted_at,deleted_by_actor_id')
    .single();
  if (error) return dbError(error, origin);
  if (
    !isMessageRow(data)
    || data.id !== message.id
    || data.room_id !== room.id
    || data.deleted_at === null
    || data.deleted_by_actor_id !== actor.id
    || data.content !== ''
  ) {
    return fail('db_error', '삭제한 메시지를 확인하지 못했습니다.', 500, origin);
  }

  const reactions = await listReactions(room.id, [message.id]);
  await clearNoticeForMessage(room.id, message.id);
  return json({
    ok: true,
    message: serializeMessage(
      data,
      0,
      summarizeGroupChatReactions({
        viewerActorId: actor.id,
        reactions,
      }),
    ),
  }, 200, origin);
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'Method not allowed', 405, origin);
  }

  const sessionResult = await requireAppSessionFromRequest(req);
  if (sessionResult.ok === false) {
    return fail(sessionResult.code, sessionResult.message, sessionResult.status, origin);
  }

  const payload = await parseJson(req);
  if (!payload?.type) {
    return fail('invalid_json', 'Invalid payload', 400, origin);
  }

  const actorResult = await resolveActor(sessionResult.session, origin);
  if (actorResult.ok === false) return actorResult.response;

  try {
    if (payload.type === 'group_chat_bootstrap') {
      return await handleBootstrap(actorResult.actor, payload, origin);
    }
    if (payload.type === 'group_chat_search') {
      return await handleSearch(actorResult.actor, payload, origin);
    }
    if (payload.type === 'group_chat_context') {
      return await handleContext(actorResult.actor, payload, origin);
    }
    if (payload.type === 'group_chat_send') {
      return await handleSend(actorResult.actor, payload, origin);
    }
    if (payload.type === 'group_chat_notification_retry') {
      return await handleNotificationRetry(actorResult.actor, payload, origin);
    }
    if (payload.type === 'group_chat_mark_read') {
      return await handleMarkRead(actorResult.actor, payload, origin);
    }
    if (payload.type === 'group_chat_preferences') {
      return await handlePreferences(actorResult.actor, payload, origin);
    }
    if (payload.type === 'group_chat_reaction_set') {
      return await handleReactionSet(actorResult.actor, payload, origin);
    }
    if (payload.type === 'group_chat_delete') {
      return await handleDelete(actorResult.actor, payload, origin);
    }
    if (payload.type === 'group_chat_member_send_permission') {
      return await handleMemberSendPermission(actorResult.actor, payload, origin);
    }
    if (payload.type === 'group_chat_notice_set') {
      return await handleNoticeSet(actorResult.actor, payload, origin);
    }
    if (payload.type === 'group_chat_notice_clear') {
      return await handleNoticeClear(actorResult.actor, origin);
    }

    return fail('invalid_type', 'Unknown group chat action', 400, origin);
  } catch (error) {
    return dbError(error instanceof Error ? error : { message: String(error) }, origin);
  }
});
