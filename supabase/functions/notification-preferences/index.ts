import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import {
  getAppSessionTokenFromRequest,
  getEnv,
  parseAppSessionToken,
  parseDesignerCompanyNameFromAffiliation,
} from '../_shared/request-board-auth.ts';
import {
  APP_PUSH_CATEGORIES,
  AppPreferenceActor,
  AppPushCategory,
  isAppPushCategory,
  parseMessengerRoomKey,
} from '../_shared/notification-preferences.ts';

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

async function resolveActor(req: Request): Promise<
  | { ok: true; actor: ResolvedActor }
  | { ok: false; status: number; code: string }
> {
  const token = getAppSessionTokenFromRequest(req);
  if (!token) return { ok: false, status: 401, code: 'missing_session_token' };
  const session = await parseAppSessionToken(token);
  if (!session) return { ok: false, status: 401, code: 'invalid_session_token' };
  const phone = cleanPhone(session.phone);
  if (phone.length !== 11) return { ok: false, status: 401, code: 'invalid_session_actor' };

  if (session.role === 'admin') {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id,phone,active,staff_type')
      .eq('phone', phone)
      .maybeSingle();
    if (error) return { ok: false, status: 500, code: 'actor_lookup_failed' };
    if (!data?.id || !data.active) return { ok: false, status: 403, code: 'forbidden' };
    return {
      ok: true,
      actor: {
        id: data.id,
        role: 'admin',
        phone,
        sourceRole: 'admin',
        staffType: data.staff_type === 'developer' ? 'developer' : 'admin',
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
    if (!data?.id || !data.active) return { ok: false, status: 403, code: 'forbidden' };
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
  if (!data?.id || !data.signup_completed || data.is_manager_referral_shadow === true) {
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
    if (!data?.id || !data.is_active) return { ok: false as const, status: 404, code: 'room_not_found' };
    return { ok: true as const, roomKey: room.key };
  }

  if (actor.isDesigner) return { ok: false as const, status: 403, code: 'room_forbidden' };
  const { data: thread, error: threadError } = await supabase
    .from('garamin_direct_threads')
    .select('id,legacy_conversation_id,counterparty_role,counterparty_actor_id')
    .eq('id', room.id)
    .maybeSingle();
  if (threadError) return { ok: false as const, status: 500, code: 'room_lookup_failed' };
  if (!thread?.id) return { ok: false as const, status: 404, code: 'room_not_found' };
  const { data: conversation, error: conversationError } = await supabase
    .from('garamin_direct_conversations')
    .select('fc_id')
    .eq('id', thread.legacy_conversation_id)
    .maybeSingle();
  if (conversationError) return { ok: false as const, status: 500, code: 'room_lookup_failed' };

  const permitted = actor.role === 'fc'
    ? conversation?.fc_id === actor.id
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

async function bootstrap(actor: ResolvedActor) {
  const tuple = { actor_id: actor.id, actor_role: actor.role };
  const [globalResult, categoryResult, roomResult] = await Promise.all([
    supabase.from('app_push_preferences').select('enabled').match(tuple).maybeSingle(),
    supabase.from('app_push_category_preferences').select('category,enabled').match(tuple),
    supabase
      .from('messenger_room_notification_preferences')
      .select('room_key,muted,pinned_at,left_at,updated_at')
      .match(tuple)
      .or('muted.eq.true,pinned_at.not.is.null,left_at.not.is.null')
      .order('updated_at', { ascending: false }),
  ]);
  if (globalResult.error || categoryResult.error || roomResult.error) {
    return fail('preference_lookup_failed', 500);
  }
  const storedCategories = new Map(
    (categoryResult.data ?? []).map((row) => [row.category, row.enabled !== false]),
  );
  const rooms = (roomResult.data ?? []).map((row) => ({
    roomKey: row.room_key,
    muted: row.muted === true,
    pinnedAt: row.pinned_at ? new Date(row.pinned_at).toISOString() : null,
    leftAt: row.left_at ? new Date(row.left_at).toISOString() : null,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
  return json({
    ok: true,
    actor: { id: actor.id, role: actor.role },
    globalPushEnabled: globalResult.data?.enabled !== false,
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
    const { error } = await supabase.from('app_push_preferences').upsert({
      ...tuple,
      enabled: action.enabled,
      updated_at: updatedAt,
    }, { onConflict: 'actor_id,actor_role' });
    return error ? fail('preference_write_failed', 500) : bootstrap(resolved.actor);
  }
  if (action.action === 'set_category') {
    const { error } = await supabase.from('app_push_category_preferences').upsert({
      ...tuple,
      category: action.category,
      enabled: action.enabled,
      updated_at: updatedAt,
    }, { onConflict: 'actor_id,actor_role,category' });
    return error ? fail('preference_write_failed', 500) : bootstrap(resolved.actor);
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
  return error ? fail('preference_write_failed', 500) : bootstrap(resolved.actor);
});
