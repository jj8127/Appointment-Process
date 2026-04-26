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

type SessionPayload = AppSessionTokenPayload;

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
    return { error: json({ ok: false, code: 'db_error', message: adminError.message }, 500) };
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
      return { error: json({ ok: false, code: 'db_error', message: managerError.message }, 500) };
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
    if (!ensureResult.ok) {
      return { error: json({ ok: false, code: 'db_error', message: ensureResult.message }, 500) };
    }

    profileResult = await profileQuery.eq('phone', sessionPhone).maybeSingle();
  }

  const { data: profile, error: profileError } = profileResult;
  if (profileError) {
    return { error: json({ ok: false, code: 'db_error', message: profileError.message }, 500) };
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
  if (!sessionResult.ok) {
    return fail(sessionResult.code, sessionResult.message, sessionResult.status);
  }

  const resolved = await resolveSelfProfile(sessionResult.session);
  if ('error' in resolved) {
    return resolved.error;
  }

  const { data: inviteeRows, error: inviteeError } = await supabase
    .from('fc_profiles')
    .select('id, name, phone, recommender_linked_at, created_at, updated_at')
    .eq('recommender_fc_id', resolved.profile.id)
    .neq('id', resolved.profile.id)
    .order('recommender_linked_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (inviteeError) {
    return json({ ok: false, code: 'db_error', message: inviteeError.message }, 500);
  }

  const invitees = (inviteeRows ?? []).map((row) => {
    const referenceDate = row.recommender_linked_at ?? row.updated_at ?? row.created_at ?? new Date(0).toISOString();
    return {
      id: row.id,
      inviteeName: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : null,
      inviteePhone: maskPhone(String(row.phone ?? '')),
      status: 'confirmed' as const,
      capturedAt: referenceDate,
      confirmedAt: referenceDate,
    };
  });

  return json({ ok: true, invitees });
});
