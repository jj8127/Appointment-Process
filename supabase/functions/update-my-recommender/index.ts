import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { applyReferralLinkState } from '../_shared/referral-link.ts';
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

function fail(code: string, message: string, status = 200) {
  return json({ ok: false, code, message }, status);
}

async function resolveSession(session: SessionPayload) {
  if (!session || (session.role !== 'fc' && session.role !== 'manager' && session.role !== 'admin')) {
    return { error: fail('forbidden', '추천인을 변경할 수 없는 계정입니다.') };
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
    return { error: fail('forbidden', '추천인을 변경할 수 없는 계정입니다.') };
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
      return { error: fail('forbidden', '추천인을 변경할 수 없는 계정입니다.') };
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
    return { error: fail('forbidden', '추천인을 변경할 수 없는 계정입니다.') };
  }

  return {
    profile: { id: String(profile.id), phone: sessionPhone },
    actorRole: managerAccount ? 'manager' : 'fc',
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 'Method not allowed', 405);

  const sessionResult = await requireAppSessionFromRequest(req);
  if (!sessionResult.ok) return fail(sessionResult.code, sessionResult.message);

  let code = '';
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const parsed = JSON.parse(raw);
      code = typeof parsed?.code === 'string' ? parsed.code.trim().toUpperCase() : '';
    }
  } catch {
    return fail('invalid_json', 'Invalid JSON');
  }

  if (!code || code.length !== 8) {
    return fail('invalid_code', '추천 코드는 8자리입니다.');
  }

  const resolvedSession = await resolveSession(sessionResult.session);
  if ('error' in resolvedSession) {
    return resolvedSession.error;
  }

  const { data: referralRow, error: referralError } = await supabase
    .from('referral_codes')
    .select('id, fc_id, code, is_active')
    .eq('code', code)
    .eq('is_active', true)
    .maybeSingle();

  if (referralError) {
    return json({ ok: false, code: 'db_error', message: referralError.message }, 500);
  }
  if (!referralRow) {
    return fail('invalid_code', '유효하지 않은 추천 코드입니다.');
  }

  const { data: inviter, error: inviterError } = await supabase
    .from('fc_profiles')
    .select('id, name, phone, affiliation, signup_completed, is_manager_referral_shadow')
    .eq('id', referralRow.fc_id)
    .maybeSingle();

  if (inviterError) {
    return json({ ok: false, code: 'db_error', message: inviterError.message }, 500);
  }
  if (!inviter) {
    return fail('invalid_code', '유효하지 않은 추천 코드입니다.');
  }
  if (inviter.signup_completed !== true && inviter.is_manager_referral_shadow !== true) {
    return fail('invalid_code', '유효하지 않은 추천 코드입니다.');
  }
  if (String(inviter.affiliation ?? '').includes('설계매니저')) {
    return fail('invalid_code', '유효하지 않은 추천 코드입니다.');
  }

  const inviterPhone = cleanPhone(String(inviter.phone ?? ''));
  if (inviterPhone.length !== 11) {
    return fail('invalid_code', '유효하지 않은 추천 코드입니다.');
  }
  if (inviterPhone === resolvedSession.profile.phone) {
    return fail('self_referral', '본인의 추천 코드는 사용할 수 없습니다.');
  }

  const applyResult = await applyReferralLinkState({
    supabase,
    inviteeFcId: resolvedSession.profile.id,
    inviterFcId: String(inviter.id),
    referralCodeId: String(referralRow.id),
    referralCode: referralRow.code,
    source: 'self_service',
    actorPhone: resolvedSession.profile.phone,
    actorRole: resolvedSession.actorRole,
    reason: 'referral_self_service',
  });

  if (!applyResult.ok) {
    return json({ ok: false, code: 'db_error', message: applyResult.message }, 500);
  }

  return json({
    ok: true,
    inviterName: String(inviter.name ?? '').trim() || null,
    inviterFcId: String(inviter.id),
    changed: applyResult.changed,
  });
});
