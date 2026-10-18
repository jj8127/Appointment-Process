import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import {
  getAppSessionTokenFromRequest,
  getEnv,
  parseAppSessionTokenDetailed,
  parseDesignerCompanyNameFromAffiliation,
} from '../_shared/request-board-auth.ts';
import {
  APP_PUSH_CATEGORIES,
  AppPreferenceActor,
  AppPushCategory,
  type AppPushCategoryPreferenceRow,
  type AppPushPreferenceRow,
  isAppPushCategory,
  isAppPushCategoryPreferenceRow,
  isAppPushPreferenceRow,
  isMessengerRoomPreferenceRow,
  matchesAppPreferenceActor,
  type MessengerRoomPreferenceRow,
  parseMessengerRoomKey,
} from '../_shared/notification-preferences.ts';
import { parseQueryRows } from '../_shared/query-result-contract.ts';
import { collectSupabaseRows } from '../../../lib/supabase-query-contract.ts';

type PreferenceAction =
  | { action: 'bootstrap' }
  | { action: 'set_global'; enabled: boolean }
  | { action: 'set_category'; category: AppPushCategory; enabled: boolean }
  | { action: 'set_room'; roomKey: string; muted: boolean }
  | { action: 'set_room_pinned'; roomKey: string; pinned: boolean }
  | { action: 'leave_room'; roomKey: string };

type ResolvedActor = AppPreferenceActor & {
  phone: string;
  sourceRole: 'fc' | 'manager' | 'admin';
  staffType: 'admin' | 'developer' | null;
  isDesigner: boolean;
};

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins[0] ?? 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl) throw new Error('Missing required environment variable: SUPABASE_URL');
if (!serviceKey) throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');

// Trust boundary: this service-role client is never exposed to the app. Every
// query below is scoped to the immutable actor tuple derived from a signed app session.
const supabase = createClient(supabaseUrl, serviceKey);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(code: string, status = 400) {
  return json({ ok: false, code }, status);
}

function cleanPhone(value: unknown) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => (
  typeof value === 'string' && UUID_PATTERN.test(value)
);

const isAdminActorRow = (value: unknown): value is {
  id: string;
  phone: string;
  active: boolean;
  staff_type: 'admin' | 'developer';
} => isRecord(value)
  && isUuid(value.id)
  && typeof value.phone === 'string'
  && typeof value.active === 'boolean'
  && (value.staff_type === 'admin' || value.staff_type === 'developer');

const isManagerActorRow = (value: unknown): value is {
  id: string;
  phone: string;
  active: boolean;
} => isRecord(value)
  && isUuid(value.id)
  && typeof value.phone === 'string'
  && typeof value.active === 'boolean';

const isFcActorRow = (value: unknown): value is {
  id: string;
  phone: string;
  signup_completed: boolean;
  affiliation: string;
  is_manager_referral_shadow: boolean;
} => isRecord(value)
  && isUuid(value.id)
  && typeof value.phone === 'string'
  && typeof value.signup_completed === 'boolean'
  && typeof value.affiliation === 'string'
  && typeof value.is_manager_referral_shadow === 'boolean';

const isTimestampOrNull = (value: unknown): value is string | null => (
  value === null
  || (typeof value === 'string' && Number.isFinite(new Date(value).getTime()))
);

type GlobalPreferenceRow = AppPushPreferenceRow & {
  updated_at: string;
};

const isGlobalPreferenceRow = (value: unknown): value is GlobalPreferenceRow =>
  isAppPushPreferenceRow(value)
  && isRecord(value)
  && typeof (value as Record<string, unknown>).updated_at === 'string'
  && Number.isFinite(
    new Date((value as Record<string, unknown>).updated_at as string).getTime(),
  );

type CategoryPreferenceRow = AppPushCategoryPreferenceRow & {
  updated_at: string;
};

const isCategoryPreferenceRow = (value: unknown): value is CategoryPreferenceRow =>
  isAppPushCategoryPreferenceRow(value)
  && isRecord(value)
  && typeof (value as Record<string, unknown>).updated_at === 'string'
  && Number.isFinite(
    new Date((value as Record<string, unknown>).updated_at as string).getTime(),
  );

type RoomPreferenceRow = MessengerRoomPreferenceRow & {
  pinned_at: string | null;
  left_at: string | null;
  updated_at: string;
};

const isRoomPreferenceRow = (value: unknown): value is RoomPreferenceRow =>
  isMessengerRoomPreferenceRow(value)
  && isRecord(value)
  && isTimestampOrNull((value as Record<string, unknown>).pinned_at)
  && isTimestampOrNull((value as Record<string, unknown>).left_at)
  && typeof (value as Record<string, unknown>).updated_at === 'string'
  && Number.isFinite(
    new Date((value as Record<string, unknown>).updated_at as string).getTime(),
  );

function sameTimestamp(actual: string | null, expected: string) {
  return actual !== null && new Date(actual).getTime() === new Date(expected).getTime();
}

async function resolveActor(req: Request): Promise<
  | { ok: true; actor: ResolvedActor }
  | { ok: false; status: number; code: string }
> {
  const token = getAppSessionTokenFromRequest(req);
  if (!token) return { ok: false, status: 401, code: 'missing_session_token' };
  const parsed = await parseAppSessionTokenDetailed(token);
  if (parsed.ok === false) return { ok: false, status: parsed.status ?? 401, code: parsed.code };
  const session = parsed.payload;
  const phone = cleanPhone(session.phone);
  if (phone.length !== 11) return { ok: false, status: 401, code: 'invalid_session_actor' };

  if (session.role === 'admin') {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id,phone,active,staff_type')
      .eq('phone', phone)
      .maybeSingle();
    if (error) return { ok: false, status: 500, code: 'actor_lookup_failed' };
    if (data === null) return { ok: false, status: 403, code: 'forbidden' };
    if (!isAdminActorRow(data) || data.phone !== phone) {
      return { ok: false, status: 500, code: 'actor_lookup_failed' };
    }
    if (!data.active) return { ok: false, status: 403, code: 'forbidden' };
    return {
      ok: true,
      actor: {
        id: data.id,
        role: 'admin',
        phone,
        sourceRole: 'admin',
        staffType: data.staff_type,
        isDesigner: false,
      },
    };
  }

  if (session.role === 'manager') {
    const { data, error } = await supabase
      .from('manager_accounts')
      .select('id,phone,active')
      .eq('phone', phone)
      .maybeSingle();
    if (error) return { ok: false, status: 500, code: 'actor_lookup_failed' };
    if (data === null) return { ok: false, status: 403, code: 'forbidden' };
    if (!isManagerActorRow(data) || data.phone !== phone) {
      return { ok: false, status: 500, code: 'actor_lookup_failed' };
    }
    if (!data.active) return { ok: false, status: 403, code: 'forbidden' };
    return {
      ok: true,
      actor: {
        id: data.id,
        role: 'manager',
        phone,
        sourceRole: 'manager',
        staffType: null,
        isDesigner: false,
      },
    };
  }

  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id,phone,signup_completed,affiliation,is_manager_referral_shadow')
    .eq('phone', phone)
    .maybeSingle();
  if (error) return { ok: false, status: 500, code: 'actor_lookup_failed' };
  if (data === null) {
    return { ok: false, status: 403, code: 'forbidden' };
  }
  if (!isFcActorRow(data) || data.phone !== phone) {
    return { ok: false, status: 500, code: 'actor_lookup_failed' };
  }
  if (!data.signup_completed || data.is_manager_referral_shadow === true) {
    return { ok: false, status: 403, code: 'forbidden' };
  }
  const isDesigner = Boolean(parseDesignerCompanyNameFromAffiliation(data.affiliation));
  return {
    ok: true,
    actor: {
      id: data.id,
      role: isDesigner ? 'manager' : 'fc',
      phone,
      sourceRole: 'fc',
      staffType: null,
      isDesigner,
    },
  };
}

function parseAction(value: unknown): PreferenceAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.action === 'bootstrap') return { action: 'bootstrap' };
  if (body.action === 'set_global' && typeof body.enabled === 'boolean') {
    return { action: 'set_global', enabled: body.enabled };
  }
  if (
    body.action === 'set_category'
    && isAppPushCategory(body.category)
    && typeof body.enabled === 'boolean'
  ) {
    return { action: 'set_category', category: body.category, enabled: body.enabled };
  }
  if (
    body.action === 'set_room'
    && typeof body.roomKey === 'string'
    && typeof body.muted === 'boolean'
  ) {
    return { action: 'set_room', roomKey: body.roomKey, muted: body.muted };
  }
  if (
    body.action === 'set_room_pinned'
    && typeof body.roomKey === 'string'
    && typeof body.pinned === 'boolean'
  ) {
    return { action: 'set_room_pinned', roomKey: body.roomKey, pinned: body.pinned };
  }
  if (body.action === 'leave_room' && typeof body.roomKey === 'string') {
    return { action: 'leave_room', roomKey: body.roomKey };
  }
  return null;
}

async function canAccessRoom(actor: ResolvedActor, rawRoomKey: string) {
  const room = parseMessengerRoomKey(rawRoomKey);
  if (!room) return { ok: false as const, status: 400, code: 'invalid_room_key' };

  if (room.kind === 'group') {
    if (actor.isDesigner) return { ok: false as const, status: 403, code: 'room_forbidden' };
    const { data, error } = await supabase
      .from('group_chat_rooms')
      .select('id,is_active')
      .eq('id', room.id)
      .maybeSingle();
    if (error) return { ok: false as const, status: 500, code: 'room_lookup_failed' };
    if (data === null) return { ok: false as const, status: 404, code: 'room_not_found' };
    if (!isRecord(data)
      || !isUuid(data.id)
      || data.id !== room.id
      || typeof data.is_active !== 'boolean') {
      return { ok: false as const, status: 500, code: 'room_lookup_failed' };
    }
    if (!data.is_active) return { ok: false as const, status: 404, code: 'room_not_found' };
    return { ok: true as const, roomKey: room.key };
  }

  if (actor.isDesigner) return { ok: false as const, status: 403, code: 'room_forbidden' };
  const { data: thread, error: threadError } = await supabase
    .from('garamin_direct_threads')
    .select('id,legacy_conversation_id,counterparty_role,counterparty_actor_id')
    .eq('id', room.id)
    .maybeSingle();
  if (threadError) return { ok: false as const, status: 500, code: 'room_lookup_failed' };
  if (thread === null) return { ok: false as const, status: 404, code: 'room_not_found' };
  if (!isRecord(thread)
    || !isUuid(thread.id)
    || thread.id !== room.id
    || !isUuid(thread.legacy_conversation_id)
    || (thread.counterparty_role !== 'admin'
      && thread.counterparty_role !== 'manager'
      && thread.counterparty_role !== 'developer')
    || (thread.counterparty_role === 'admin'
      ? thread.counterparty_actor_id !== null && !isUuid(thread.counterparty_actor_id)
      : !isUuid(thread.counterparty_actor_id))) {
    return { ok: false as const, status: 500, code: 'room_lookup_failed' };
  }
  const { data: conversation, error: conversationError } = await supabase
    .from('garamin_direct_conversations')
    .select('id,fc_id')
    .eq('id', thread.legacy_conversation_id)
    .maybeSingle();
  if (conversationError) return { ok: false as const, status: 500, code: 'room_lookup_failed' };
  if (conversation === null) return { ok: false as const, status: 404, code: 'room_not_found' };
  if (!isRecord(conversation)
    || !isUuid(conversation.id)
    || conversation.id !== thread.legacy_conversation_id
    || !isUuid(conversation.fc_id)) {
    return { ok: false as const, status: 500, code: 'room_lookup_failed' };
  }

  const permitted = actor.role === 'fc'
    ? conversation.fc_id === actor.id
    : actor.role === 'manager'
      ? thread.counterparty_role === 'manager' && thread.counterparty_actor_id === actor.id
      : actor.staffType === 'developer'
        ? thread.counterparty_role === 'developer' && thread.counterparty_actor_id === actor.id
        : thread.counterparty_role === 'admin'
          && (
            thread.counterparty_actor_id === null
            || thread.counterparty_actor_id === actor.id
          );
  return permitted
    ? { ok: true as const, roomKey: room.key }
    : { ok: false as const, status: 403, code: 'room_forbidden' };
}

async function bootstrap(actor: ResolvedActor, writeCommitted = false) {
  const tuple = { actor_id: actor.id, actor_role: actor.role };
  const roomResultPromise = collectSupabaseRows<RoomPreferenceRow>({
    queryName: 'notification_preferences_room_preferences',
    fetchPage: (from, to) => supabase
      .from('messenger_room_notification_preferences')
      .select('room_key,muted,pinned_at,left_at,updated_at,actor_id,actor_role')
      .match(tuple)
      .or('muted.eq.true,pinned_at.not.is.null,left_at.not.is.null')
      .order('updated_at', { ascending: false })
      .order('room_key', { ascending: true })
      .range(from, to),
    isRow: isRoomPreferenceRow,
    rowKey: (row) => row.room_key,
  }).then((data) => ({ data, error: null })).catch((error: unknown) => ({
    data: null,
    error,
  }));
  const [globalResult, categoryResult, roomResult] = await Promise.all([
    supabase.from('app_push_preferences').select('enabled,updated_at,actor_id,actor_role').match(tuple).maybeSingle(),
    supabase.from('app_push_category_preferences').select('category,enabled,updated_at,actor_id,actor_role').match(tuple),
    roomResultPromise,
  ]);
  if (globalResult.error || categoryResult.error || roomResult.error) {
    return writeCommitted ? json({ ok: false, saved: true, code: 'preference_read_failed_after_write' }, 200) : fail('preference_lookup_failed', 500);
  }

  const globalRow = globalResult.data;
  const categoryRows = parseQueryRows(categoryResult.data, isCategoryPreferenceRow);
  const roomRows = parseQueryRows(roomResult.data, isRoomPreferenceRow);
  if ((globalRow !== null && (
    !isGlobalPreferenceRow(globalRow) || !matchesAppPreferenceActor(globalRow, actor)
  ))
    || !categoryRows
    || !roomRows
    || categoryRows.some((row) => !matchesAppPreferenceActor(row, actor))
    || roomRows.some((row) => !matchesAppPreferenceActor(row, actor))
    || new Set(categoryRows.map((row) => row.category)).size !== categoryRows.length
    || new Set(roomRows.map((row) => row.room_key)).size !== roomRows.length) {
    return writeCommitted
      ? json({ ok: false, saved: true, code: 'preference_read_failed_after_write' }, 200)
      : fail('preference_lookup_failed', 500);
  }
  const storedCategories = new Map(
    categoryRows.map((row) => [row.category, row.enabled]),
  );
  const rooms = roomRows.map((row) => ({
    roomKey: row.room_key,
    muted: row.muted === true,
    pinnedAt: row.pinned_at ? new Date(row.pinned_at).toISOString() : null,
    leftAt: row.left_at ? new Date(row.left_at).toISOString() : null,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
  return json({
    ok: true,
    actor: { id: actor.id, role: actor.role },
    globalPushEnabled: globalRow?.enabled ?? true,
    categories: Object.fromEntries(
      APP_PUSH_CATEGORIES.map((category) => [category, storedCategories.get(category) !== false]),
    ),
    rooms,
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 405);

  const resolved = await resolveActor(req);
  if (resolved.ok === false) {
    return fail(resolved.code, resolved.status);
  }
  let action: PreferenceAction | null = null;
  try {
    action = parseAction(await req.json());
  } catch {
    return fail('invalid_json');
  }
  if (!action) return fail('invalid_action');
  if (action.action === 'bootstrap') return bootstrap(resolved.actor);

  const tuple = { actor_id: resolved.actor.id, actor_role: resolved.actor.role };
  const updatedAt = new Date().toISOString();
  if (action.action === 'set_global') {
    const { data, error } = await supabase
      .from('app_push_preferences')
      .upsert({
        ...tuple,
        enabled: action.enabled,
        updated_at: updatedAt,
      }, { onConflict: 'actor_id,actor_role' })
      .select('enabled,updated_at,actor_id,actor_role')
      .single();
    if (error
      || !isGlobalPreferenceRow(data)
      || !matchesAppPreferenceActor(data, resolved.actor)
      || data.enabled !== action.enabled
      || !sameTimestamp(data.updated_at, updatedAt)) {
      return fail('preference_write_failed', 500);
    }
    return bootstrap(resolved.actor, true);
  }
  if (action.action === 'set_category') {
    const { data, error } = await supabase
      .from('app_push_category_preferences')
      .upsert({
        ...tuple,
        category: action.category,
        enabled: action.enabled,
        updated_at: updatedAt,
      }, { onConflict: 'actor_id,actor_role,category' })
      .select('category,enabled,updated_at,actor_id,actor_role')
      .single();
    if (error
      || !isCategoryPreferenceRow(data)
      || !matchesAppPreferenceActor(data, resolved.actor)
      || data.category !== action.category
      || data.enabled !== action.enabled
      || !sameTimestamp(data.updated_at, updatedAt)) {
      return fail('preference_write_failed', 500);
    }
    return bootstrap(resolved.actor, true);
  }

  const access = await canAccessRoom(resolved.actor, action.roomKey);
  if (!access.ok) return fail(access.code, access.status);
  const { error } = await supabase.rpc('patch_messenger_room_preference_v1', {
    p_actor_id: tuple.actor_id,
    p_actor_role: tuple.actor_role,
    p_room_key: access.roomKey,
    p_action: action.action,
    p_value: action.action === 'set_room'
      ? action.muted
      : action.action === 'set_room_pinned'
        ? action.pinned
        : null,
    p_updated_at: updatedAt,
  });
  if (error) return fail('preference_write_failed', 500);

  const { data: receipt, error: receiptError } = await supabase
    .from('messenger_room_notification_preferences')
    .select('room_key,muted,pinned_at,left_at,updated_at,actor_id,actor_role')
    .match(tuple)
    .eq('room_key', access.roomKey)
    .maybeSingle();
  const receiptMatchesAction = isRoomPreferenceRow(receipt)
    && matchesAppPreferenceActor(receipt, resolved.actor)
    && receipt.room_key === access.roomKey
    && sameTimestamp(receipt.updated_at, updatedAt)
    && (action.action !== 'set_room' || receipt.muted === action.muted)
    && (action.action !== 'set_room_pinned'
      || (action.pinned
        ? sameTimestamp(receipt.pinned_at, updatedAt)
        : receipt.pinned_at === null))
    && (action.action !== 'leave_room'
      || (sameTimestamp(receipt.left_at, updatedAt) && receipt.pinned_at === null));
  return receiptError || !receiptMatchesAction
    ? fail('preference_write_failed', 500)
    : bootstrap(resolved.actor, true);
});
