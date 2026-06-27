import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getEnv,
  requireAppSessionFromRequest,
  type AppSessionTokenPayload,
} from '../_shared/request-board-auth.ts';
import { filterManagerTokensForNotification } from '../_shared/notification-delivery-policy.ts';
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

type Payload =
  | { type: 'group_chat_bootstrap'; limit?: number }
  | {
      type: 'group_chat_send';
      content?: string | null;
      message_type?: GroupChatMessageType | null;
      file_url?: string | null;
      file_name?: string | null;
      file_size?: number | null;
      reply_to_message_id?: string | null;
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
  created_at: string;
  reply_to_message_id: string | null;
  reply_to_sender_name: string | null;
  reply_to_content: string | null;
  deleted_at: string | null;
  deleted_by_actor_id: string | null;
};

type GroupChatMember = {
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

type ReactionRow = {
  message_id: string;
  actor_id: string;
  reaction: string;
};

type ReadStateRow = {
  actor_id: string;
  last_read_at: string | null;
};

type SendPermissionRow = {
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

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_CHUNK_SIZE = 100;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const CHAT_UPLOAD_BUCKET = 'chat-uploads';
const CHAT_UPLOAD_PREFIX = 'group-chat/';

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
const chatUploadPublicPrefix = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${CHAT_UPLOAD_BUCKET}/${CHAT_UPLOAD_PREFIX}`;

function isAllowedGroupChatUploadUrl(value: string | null) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.href.startsWith(chatUploadPublicPrefix);
  } catch {
    return false;
  }
}

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

async function parseJson(req: Request): Promise<Payload | null> {
  try {
    const parsed = await req.json();
    return typeof parsed === 'object' && parsed !== null ? parsed as Payload : null;
  } catch {
    return null;
  }
}

function dbError(error: { message?: string }, origin?: string | null) {
  console.error('[group-chat] db error', error?.message);
  return fail('db_error', '단톡방 데이터를 처리하지 못했습니다.', 500, origin);
}

function serializeMessage(
  row: MessageRow,
  unreadCount = 0,
  reactions: ReturnType<typeof summarizeGroupChatReactions> = [],
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
) {
  return {
    room_id: row.room_id,
    message_id: row.message_id,
    created_by_actor_id: row.created_by_actor_id,
    created_by_role: row.created_by_role,
    created_at: row.created_at,
    updated_at: row.updated_at,
    message: serializeMessage(message, 0, reactions),
  };
}

async function ensureRoom(): Promise<RoomRow> {
  const existing = await supabase
    .from('group_chat_rooms')
    .select('id,slug,title,is_active')
    .eq('slug', GROUP_CHAT_ROOM_SLUG)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data?.id) return existing.data as RoomRow;

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
  return inserted.data as RoomRow;
}

type FcActorProfileRow = {
  id?: string | null;
  phone?: string | null;
  affiliation?: string | null;
  signup_completed?: boolean | null;
  is_manager_referral_shadow?: boolean | null;
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
    supabase
      .from('fc_profiles')
      .select('name,phone,affiliation,signup_completed,is_manager_referral_shadow,life_commission_completed,nonlife_commission_completed,appointment_date_life,appointment_date_nonlife')
      .eq('signup_completed', true),
    supabase
      .from('manager_accounts')
      .select('name,phone,active')
      .eq('active', true),
    supabase
      .from('admin_accounts')
      .select('name,phone,active,staff_type')
      .eq('active', true),
  ]);

  if (fcResult.error) throw fcResult.error;
  if (managerResult.error) throw managerResult.error;
  if (adminResult.error) throw adminResult.error;

  const members: GroupChatMember[] = [];

  (fcResult.data ?? []).forEach((row) => {
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

  (managerResult.data ?? []).forEach((row) => {
    if (!isEligibleGroupChatMember({ kind: 'manager', phone: row.phone, active: row.active })) return;
    const actor = buildGroupChatActor({ role: 'manager', phone: row.phone, name: row.name });
    if (actor) {
      members.push({
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

  (adminResult.data ?? []).forEach((row) => {
    if (!isEligibleGroupChatMember({ kind: 'admin', phone: row.phone, active: row.active, staff_type: row.staff_type })) return;
    const actor = buildGroupChatActor({ role: 'admin', phone: row.phone, name: row.name });
    if (actor) {
      members.push({
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
    .select('name,phone,affiliation,signup_completed,is_manager_referral_shadow,life_commission_completed,nonlife_commission_completed,appointment_date_life,appointment_date_nonlife')
    .eq('phone', phone)
    .maybeSingle();
  if (error) throw error;

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
  const { data, error } = await supabase
    .from('group_chat_member_send_permissions')
    .select('actor_id,can_send_messages')
    .eq('room_id', roomId);
  if (error) throw error;
  return (data ?? []) as SendPermissionRow[];
}

function applySendPermissionsToMembers(
  members: GroupChatMember[],
  permissions: SendPermissionRow[],
): GroupChatMember[] {
  const canSendByActorId = new Map(
    permissions.map((row) => [normalizeGroupChatText(row.actor_id), row.can_send_messages === true]),
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
    .select('can_send_messages')
    .eq('room_id', roomId)
    .eq('actor_id', actor.id)
    .maybeSingle();
  if (error) throw error;
  return canGroupChatActorSendMessages({
    actor,
    permissions: data ? [{ actor_id: actor.id, can_send_messages: data.can_send_messages }] : [],
  });
}

async function fetchMessages(roomId: string, limit = DEFAULT_MESSAGE_LIMIT): Promise<MessageRow[]> {
  const safeLimit = Math.min(MAX_MESSAGE_LIMIT, Math.max(1, Math.floor(limit)));
  const { data, error } = await supabase
    .from('group_chat_messages')
    .select('id,room_id,sender_actor_id,sender_role,sender_phone,sender_name,content,message_type,file_url,file_name,file_size,created_at,reply_to_message_id,reply_to_sender_name,reply_to_content,deleted_at,deleted_by_actor_id')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return (data ?? []) as MessageRow[];
}

async function listReactions(roomId: string, messageIds: string[]): Promise<ReactionRow[]> {
  const ids = Array.from(new Set(messageIds.filter(Boolean)));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('group_chat_reactions')
    .select('message_id,actor_id,reaction')
    .eq('room_id', roomId)
    .in('message_id', ids);
  if (error) throw error;
  return (data ?? []) as ReactionRow[];
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
  return data as { last_read_at?: string | null; last_read_message_id?: string | null } | null;
}

async function listReadStates(roomId: string): Promise<ReadStateRow[]> {
  const { data, error } = await supabase
    .from('group_chat_reads')
    .select('actor_id,last_read_at')
    .eq('room_id', roomId);
  if (error) throw error;
  return (data ?? []) as ReadStateRow[];
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

  const { data, error } = await supabase
    .from('group_chat_messages')
    .select('id,room_id,sender_name,content,message_type,file_name,deleted_at')
    .eq('room_id', roomId)
    .eq('id', safeMessageId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return null;

  const row = data as Pick<MessageRow, 'id' | 'room_id' | 'sender_name' | 'content' | 'message_type' | 'file_name' | 'deleted_at'>;
  return {
    reply_to_message_id: row.id,
    reply_to_sender_name: row.sender_name,
    reply_to_content: buildReplyContent(row),
  };
}

async function getMuted(roomId: string, actorId: string) {
  const { data, error } = await supabase
    .from('group_chat_preferences')
    .select('muted')
    .eq('room_id', roomId)
    .eq('actor_id', actorId)
    .maybeSingle();
  if (error) throw error;
  return data?.muted === true;
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
  return count ?? 0;
}

async function upsertRead(roomId: string, actorId: string, messageId?: string | null) {
  let lastReadAt = new Date().toISOString();
  let lastReadMessageId: string | null = null;

  if (messageId) {
    const { data, error } = await supabase
      .from('group_chat_messages')
      .select('id,created_at')
      .eq('room_id', roomId)
      .eq('id', messageId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) {
      lastReadAt = data.created_at;
      lastReadMessageId = data.id;
    }
  }

  const { error } = await supabase
    .from('group_chat_reads')
    .upsert({
      room_id: roomId,
      actor_id: actorId,
      last_read_at: lastReadAt,
      last_read_message_id: lastReadMessageId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'room_id,actor_id' });
  if (error) throw error;
}

async function sendExpoPushPayloads(pushPayload: Record<string, unknown>[]) {
  for (let index = 0; index < pushPayload.length; index += EXPO_PUSH_CHUNK_SIZE) {
    const chunk = pushPayload.slice(index, index + EXPO_PUSH_CHUNK_SIZE);
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      console.warn('[group-chat] expo push failed', { status: response.status, body: raw.slice(0, 300) });
    }
  }
}

async function insertNotificationsWithFallback(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const firstTry = await supabase.from('notifications').insert(rows);
  if (!firstTry.error) return;

  const missingTargetColumn =
    firstTry.error.code === '42703' || String(firstTry.error.message ?? '').includes('target_url');
  if (!missingTargetColumn) {
    console.warn('[group-chat] notification insert failed', firstTry.error.message);
    return;
  }

  const fallbackRows = rows.map(({ target_url: _targetUrl, ...row }) => row);
  const secondTry = await supabase.from('notifications').insert(fallbackRows);
  if (secondTry.error) {
    console.warn('[group-chat] notification fallback insert failed', secondTry.error.message);
  }
}

async function notifyRecipients(input: {
  roomId: string;
  sender: GroupChatActor;
  message: MessageRow;
  members?: GroupChatMember[];
}) {
  const members = input.members ?? await listEligibleMembers();
  const { data: preferenceRows, error: preferenceError } = await supabase
    .from('group_chat_preferences')
    .select('actor_id,muted')
    .eq('room_id', input.roomId);
  if (preferenceError) throw preferenceError;

  const mutedByActor = new Map(
    ((preferenceRows ?? []) as PreferenceRow[]).map((row) => [row.actor_id, row.muted === true]),
  );

  const recipients = members.filter((member) =>
    shouldFanoutGroupChatPush({
      senderActorId: input.sender.id,
      recipientActorId: member.actor_id,
      recipientMuted: mutedByActor.get(member.actor_id) === true,
    }),
  );
  if (recipients.length === 0) return;

  const notificationRows = recipients.map((member) => ({
    recipient_role: toNotificationRecipientRole(member.role),
    resident_id: member.phone,
    title: GROUP_CHAT_ROOM_TITLE,
    body: `${input.sender.name ?? '사용자'}: ${buildGroupChatPreview(input.message)}`,
    category: GROUP_CHAT_NOTIFICATION_CATEGORY,
    target_url: GROUP_CHAT_TARGET_URL,
  }));
  await insertNotificationsWithFallback(notificationRows);

  const recipientPhones = Array.from(new Set(recipients.map((member) => member.phone)));
  const { data: tokenRows, error: tokenError } = await supabase
    .from('device_tokens')
    .select('expo_push_token,resident_id,role')
    .in('resident_id', recipientPhones);
  if (tokenError) {
    console.warn('[group-chat] token query failed', tokenError.message);
    return;
  }

  const allowedPhones = new Set(recipientPhones);
  const allowedTokenRows = filterManagerTokensForNotification(
    ((tokenRows ?? []) as DeviceTokenRow[])
      .filter((row) => row.expo_push_token && allowedPhones.has(sanitizeGroupChatPhone(row.resident_id))),
    { category: GROUP_CHAT_NOTIFICATION_CATEGORY, targetId: null },
  );
  const pushPayload = allowedTokenRows
    .map((row) => ({
      to: row.expo_push_token,
      sound: 'default',
      priority: 'high',
      channelId: 'alerts',
      title: GROUP_CHAT_ROOM_TITLE,
      body: `${input.sender.name ?? '사용자'}: ${buildGroupChatPreview(input.message)}`,
      data: {
        url: GROUP_CHAT_TARGET_URL,
        category: GROUP_CHAT_NOTIFICATION_CATEGORY,
      },
    }));

  await sendExpoPushPayloads(pushPayload);
}

async function handleBootstrap(actor: GroupChatActor, payload: Extract<Payload, { type: 'group_chat_bootstrap' }>, origin?: string | null) {
  const room = await ensureRoom();
  const [members, messages, readState, readStates, muted, notice] = await Promise.all([
    listEligibleMembersWithSendPermissions(room.id),
    fetchMessages(room.id, payload.limit ?? DEFAULT_MESSAGE_LIMIT),
    getReadState(room.id, actor.id),
    listReadStates(room.id),
    getMuted(room.id, actor.id),
    getCurrentNotice(room.id, actor.id),
  ]);

  const unreadCount = await countUnread(room.id, actor.id, readState?.last_read_at ?? null);
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
      )
      : null,
    messages: messages.map((message) =>
      serializeMessage(
        message,
        messageUnreadCounts.get(message.id) ?? 0,
        reactionsByMessageId.get(message.id) ?? [],
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

  const messageType = payload.message_type === 'image' || payload.message_type === 'file' ? payload.message_type : 'text';
  const content = normalizeGroupChatMessageContent(payload.content);
  const fileUrl = normalizeGroupChatText(payload.file_url);
  const fileName = normalizeGroupChatText(payload.file_name);
  const fileSize = Number(payload.file_size ?? 0);

  if (messageType === 'text' && !content) {
    return fail('invalid_payload', '메시지를 입력해주세요.', 400, origin);
  }
  if ((messageType === 'image' || messageType === 'file') && !fileUrl) {
    return fail('invalid_payload', '첨부 파일 정보가 필요합니다.', 400, origin);
  }
  if ((messageType === 'image' || messageType === 'file') && !isAllowedGroupChatUploadUrl(fileUrl)) {
    return fail('invalid_payload', '허용되지 않는 첨부 파일 주소입니다.', 400, origin);
  }

  const replySnapshot = await getReplySnapshot(room.id, payload.reply_to_message_id);

  const { data, error } = await supabase
    .from('group_chat_messages')
    .insert({
      room_id: room.id,
      sender_actor_id: actor.id,
      sender_role: actor.role,
      sender_phone: actor.phone,
      sender_name: actor.name,
      content: content || (messageType === 'image' ? '사진을 보냈습니다.' : fileName || '파일을 보냈습니다.'),
      message_type: messageType,
      file_url: fileUrl || null,
      file_name: fileName || null,
      file_size: Number.isFinite(fileSize) && fileSize > 0 ? Math.floor(fileSize) : null,
      reply_to_message_id: replySnapshot?.reply_to_message_id ?? null,
      reply_to_sender_name: replySnapshot?.reply_to_sender_name ?? null,
      reply_to_content: replySnapshot?.reply_to_content ?? null,
    })
    .select('id,room_id,sender_actor_id,sender_role,sender_phone,sender_name,content,message_type,file_url,file_name,file_size,created_at,reply_to_message_id,reply_to_sender_name,reply_to_content,deleted_at,deleted_by_actor_id')
    .single();

  if (error) return dbError(error, origin);

  const message = data as MessageRow;
  await upsertRead(room.id, actor.id, message.id);
  const members = await listEligibleMembers();
  const unreadCount = members.filter((member) => member.actor_id !== actor.id).length;
  await notifyRecipients({ roomId: room.id, sender: actor, message, members });

  return json({ ok: true, message: serializeMessage(message, unreadCount) }, 200, origin);
}

async function handleMarkRead(actor: GroupChatActor, payload: Extract<Payload, { type: 'group_chat_mark_read' }>, origin?: string | null) {
  const room = await ensureRoom();
  await upsertRead(room.id, actor.id, payload.message_id ?? null);
  return json({ ok: true }, 200, origin);
}

async function handlePreferences(actor: GroupChatActor, payload: Extract<Payload, { type: 'group_chat_preferences' }>, origin?: string | null) {
  const room = await ensureRoom();
  const muted = payload.muted === true;
  const { error } = await supabase
    .from('group_chat_preferences')
    .upsert({
      room_id: room.id,
      actor_id: actor.id,
      muted,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'room_id,actor_id' });
  if (error) return dbError(error, origin);
  return json({ ok: true, muted }, 200, origin);
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
  const targetActorId = normalizeGroupChatText(payload.target_actor_id);
  if (!targetActorId || !targetActorId.startsWith('fc:')) {
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
    .select('actor_id,can_send_messages')
    .single();
  if (error) return dbError(error, origin);

  return json({
    ok: true,
    member: {
      ...targetMember,
      can_send_messages: data?.can_send_messages === true,
    },
  }, 200, origin);
}

async function getMessageInRoom(roomId: string, messageId?: string | null) {
  const safeMessageId = normalizeGroupChatText(messageId);
  if (!safeMessageId) return null;

  const { data, error } = await supabase
    .from('group_chat_messages')
    .select('id,room_id,sender_actor_id,sender_role,sender_phone,sender_name,content,message_type,file_url,file_name,file_size,created_at,reply_to_message_id,reply_to_sender_name,reply_to_content,deleted_at,deleted_by_actor_id')
    .eq('room_id', roomId)
    .eq('id', safeMessageId)
    .maybeSingle();
  if (error) throw error;
  return data as MessageRow | null;
}

async function getNoticeRow(roomId: string) {
  const { data, error } = await supabase
    .from('group_chat_notices')
    .select('room_id,message_id,created_by_actor_id,created_by_role,created_at,updated_at')
    .eq('room_id', roomId)
    .maybeSingle();
  if (error) throw error;
  return data as NoticeRow | null;
}

async function clearNoticeForMessage(roomId: string, messageId: string) {
  const { error } = await supabase
    .from('group_chat_notices')
    .delete()
    .eq('room_id', roomId)
    .eq('message_id', messageId);
  if (error) throw error;
}

async function getCurrentNotice(roomId: string, viewerActorId: string) {
  const notice = await getNoticeRow(roomId);
  if (!notice?.message_id) return null;

  const message = await getMessageInRoom(roomId, notice.message_id);
  if (!message?.id || message.deleted_at) {
    await clearNoticeForMessage(roomId, notice.message_id);
    return null;
  }

  const reactions = await listReactions(roomId, [message.id]);
  return serializeNotice(
    notice,
    message,
    summarizeGroupChatReactions({
      viewerActorId,
      reactions,
    }),
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

  const reactions = await listReactions(room.id, [message.id]);
  return json({
    ok: true,
    notice: serializeNotice(
      data as NoticeRow,
      message,
      summarizeGroupChatReactions({
        viewerActorId: actor.id,
        reactions,
      }),
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

  return json({ ok: true, notice: null }, 200, origin);
}

async function handleReactionSet(actor: GroupChatActor, payload: Extract<Payload, { type: 'group_chat_reaction_set' }>, origin?: string | null) {
  const room = await ensureRoom();
  const message = await getMessageInRoom(room.id, payload.message_id);
  if (!message?.id) return fail('not_found', '메시지를 찾지 못했습니다.', 404, origin);

  const reaction = normalizeGroupChatText(payload.reaction);
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
        reaction: reaction.slice(0, 16),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'room_id,message_id,actor_id' });
    if (error) return dbError(error, origin);
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

  const { data, error } = await supabase
    .from('group_chat_messages')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_actor_id: actor.id,
    })
    .eq('room_id', room.id)
    .eq('id', message.id)
    .select('id,room_id,sender_actor_id,sender_role,sender_phone,sender_name,content,message_type,file_url,file_name,file_size,created_at,reply_to_message_id,reply_to_sender_name,reply_to_content,deleted_at,deleted_by_actor_id')
    .single();
  if (error) return dbError(error, origin);

  const reactions = await listReactions(room.id, [message.id]);
  await clearNoticeForMessage(room.id, message.id);
  return json({
    ok: true,
    message: serializeMessage(
      data as MessageRow,
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
    if (payload.type === 'group_chat_send') {
      return await handleSend(actorResult.actor, payload, origin);
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
