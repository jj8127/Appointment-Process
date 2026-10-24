import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  cleanPhone,
  ensureManagerReferralShadowProfile,
} from '../_shared/referral-code.ts';
import {
  getEnv,
  requireAppSessionFromRequest,
  type AppSessionTokenPayload,
} from '../_shared/request-board-auth.ts';
import { collectSupabaseRows } from '../../../lib/supabase-query-contract.ts';

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, serviceKey);
const DB_ERROR_MESSAGE = '초대 목록 조회 중 문제가 발생했습니다.';

type SessionPayload = AppSessionTokenPayload;

type InviteeQueryRow = {
  id: string;
  name: string;
  phone: string;
  recommender_linked_at: string | null;
  created_at: string;
  updated_at: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isInviteeQueryRow(value: unknown): value is InviteeQueryRow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string'
    && UUID_PATTERN.test(row.id)
    && typeof row.name === 'string'
    && typeof row.phone === 'string'
    && cleanPhone(row.phone).length === 11
    && (row.recommender_linked_at === null || isTimestamp(row.recommender_linked_at))
    && isTimestamp(row.created_at)
    && isTimestamp(row.updated_at);
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(code: string, message: string, status = 400) {
  return json({ ok: false, code, message }, status);
}

function maskPhone(phone: string): string {
  const normalized = cleanPhone(phone);
  if (normalized.length === 11) {
    return `${normalized.slice(0, 3)}-****-${normalized.slice(7)}`;
  }
  if (normalized.length >= 4) {
    return `${normalized.slice(0, 3)}-****`;
  }
  return '';
}

async function resolveSelfProfile(session: SessionPayload) {
  if (!session || (session.role !== 'fc' && session.role !== 'manager' && session.role !== 'admin')) {
    return { error: fail('forbidden', '초대 목록을 조회할 수 없는 계정입니다.') };
  }

  const sessionPhone = cleanPhone(session.phone ?? '');
  if (sessionPhone.length !== 11) {
    return { error: fail('invalid_app_session', '세션이 유효하지 않습니다. 다시 로그인해주세요.') };
  }

  const { data: adminRow, error: adminError } = await supabase
    .from('admin_accounts')
    .select('id')
    .eq('phone', sessionPhone)
    .maybeSingle();
  if (adminError) {
    return { error: fail('db_error', DB_ERROR_MESSAGE, 500) };
  }
  if (adminRow) {
    return { error: fail('forbidden', '초대 목록을 조회할 수 없는 계정입니다.') };
  }

  let managerAccount: { id: string; name: string | null } | null = null;
  if (session.role === 'manager' || session.role === 'admin') {
    const { data: managerRow, error: managerError } = await supabase
      .from('manager_accounts')
      .select('id, name')
      .eq('phone', sessionPhone)
      .eq('active', true)
      .maybeSingle();
    if (managerError) {
      return { error: fail('db_error', DB_ERROR_MESSAGE, 500) };
    }
    if (!managerRow?.id) {
      return { error: fail('forbidden', '초대 목록을 조회할 수 없는 계정입니다.') };
    }
    managerAccount = managerRow;
  }

  const sessionFcId = String(session.fcId ?? '').trim();
  const profileQuery = supabase
    .from('fc_profiles')
    .select('id, phone, affiliation, signup_completed, is_manager_referral_shadow')
    .limit(1);

  let profileResult = sessionFcId
    ? await profileQuery.eq('id', sessionFcId).maybeSingle()
    : await profileQuery.eq('phone', sessionPhone).maybeSingle();

  if (!profileResult.data?.id && managerAccount) {
    const ensureResult = await ensureManagerReferralShadowProfile(supabase, sessionPhone, managerAccount.name);
    if (ensureResult.ok === false) {
      return { error: fail('db_error', DB_ERROR_MESSAGE, 500) };
    }

    profileResult = await profileQuery.eq('phone', sessionPhone).maybeSingle();
  }

  const { data: profile, error: profileError } = profileResult;
  if (profileError) {
    return { error: fail('db_error', DB_ERROR_MESSAGE, 500) };
  }
  if (!profile?.id) {
    return { error: fail('not_found', '계정을 찾을 수 없습니다.') };
  }
  if (cleanPhone(String(profile.phone ?? '')) !== sessionPhone) {
    return { error: fail('invalid_app_session', '세션이 유효하지 않습니다. 다시 로그인해주세요.') };
  }

  const isManagerShadow = profile.is_manager_referral_shadow === true;
  if (profile.signup_completed !== true && !(managerAccount && isManagerShadow)) {
    return { error: fail('not_found', '계정을 찾을 수 없습니다.') };
  }
  if (String(profile.affiliation ?? '').includes('설계매니저')) {
    return { error: fail('forbidden', '초대 목록을 조회할 수 없는 계정입니다.') };
  }

  return { profile: { id: String(profile.id) } };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405);
  }

  const sessionResult = await requireAppSessionFromRequest(req);
  if (sessionResult.ok === false) {
    return fail(sessionResult.code, sessionResult.message, sessionResult.status);
  }

  const resolved = await resolveSelfProfile(sessionResult.session);
  if (resolved.error) {
    return resolved.error;
  }

  let inviteeRows: InviteeQueryRow[];
  try {
    inviteeRows = await collectSupabaseRows<InviteeQueryRow>({
      queryName: 'my_invitees',
      isRow: isInviteeQueryRow,
      maxRows: 10_000,
      rowKey: (row) => row.id,
      fetchPage: (from, to) => supabase
        .from('fc_profiles')
        .select('id, name, phone, recommender_linked_at, created_at, updated_at')
        .eq('recommender_fc_id', resolved.profile.id)
        .neq('id', resolved.profile.id)
        .order('recommender_linked_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    });
  } catch {
    return fail('db_error', '초대 목록 응답을 확인하지 못했습니다.', 500);
  }

  const invitees = inviteeRows.map((row) => {
    const referenceDate = row.recommender_linked_at ?? row.updated_at;
    return {
      id: row.id,
      inviteeName: row.name.trim() || null,
      inviteePhone: maskPhone(row.phone),
      status: 'confirmed' as const,
      capturedAt: referenceDate,
      confirmedAt: referenceDate,
    };
  });

  return json({ ok: true, invitees });
});
