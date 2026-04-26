import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getEnv,
  requireAppSessionFromRequest,
  type AppSessionTokenPayload,
} from '../_shared/request-board-auth.ts';
import {
  cleanPhone,
  ensureActiveReferralCode,
  ensureManagerReferralShadowProfile,
} from '../_shared/referral-code.ts';

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

// Security: Validate required environment variables
const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}
if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceKey);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(code: string, message: string) {
  return json({ ok: false, code, message });
}

type SessionPayload = AppSessionTokenPayload;

async function readOptionalJsonBody(req: Request) {
  const raw = await req.text();
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return null;
  }
}

async function resolveSelfReferralCode(params: { session: SessionPayload }) {
  const session = params.session;
  if (!session || (session.role !== 'fc' && session.role !== 'manager' && session.role !== 'admin')) {
    return fail('forbidden', '추천 코드를 조회할 수 없는 계정입니다.');
  }

  const sessionPhone = cleanPhone(session.phone ?? '');
  if (sessionPhone.length !== 11) {
    return fail('invalid_app_session', '세션이 유효하지 않습니다. 다시 로그인해주세요.');
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
      return json({ ok: false, code: 'db_error', message: managerError.message }, 500);
    }
    if (!managerRow?.id) {
      return fail('forbidden', '추천 코드를 조회할 수 없는 계정입니다.');
    }
    managerAccount = managerRow;
  }

  // Check if phone belongs to admin_accounts
  const { data: adminAccount, error: adminError } = await supabase
    .from('admin_accounts')
    .select('id')
    .eq('phone', sessionPhone)
    .maybeSingle();
  if (adminError) {
    return json({ ok: false, code: 'db_error', message: adminError.message }, 500);
  }
  if (adminAccount) {
    return fail('forbidden', '추천 코드를 조회할 수 없는 계정입니다.');
  }

  const sessionFcId = String(session.fcId ?? '').trim();
  const profileQuery = supabase
    .from('fc_profiles')
    .select('id, phone, affiliation, signup_completed, recommender, recommender_fc_id, recommender_code, recommender_linked_at, recommender_link_source, is_manager_referral_shadow');

  let profileResult = sessionFcId
    ? await profileQuery.eq('id', sessionFcId).maybeSingle()
    : await profileQuery.eq('phone', sessionPhone).maybeSingle();
  if (!profileResult.data?.id && managerAccount) {
    const ensureResult = await ensureManagerReferralShadowProfile(supabase, sessionPhone, managerAccount.name);
    if (!ensureResult.ok) {
      return json({ ok: false, code: 'db_error', message: ensureResult.message }, 500);
    }

    profileResult = await profileQuery.eq('phone', sessionPhone).maybeSingle();
  }
  const { data: profile, error: profileError } = profileResult;

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }
  if (!profile?.id) {
    return fail('not_found', '계정을 찾을 수 없습니다.');
  }

  if (cleanPhone(String(profile.phone ?? '')) !== sessionPhone) {
    return fail('invalid_app_session', '세션이 유효하지 않습니다. 다시 로그인해주세요.');
  }
  const isManagerShadow = profile.is_manager_referral_shadow === true;
  if (profile.signup_completed !== true && !(managerAccount && isManagerShadow)) {
    return fail('not_found', '계정을 찾을 수 없습니다.');
  }

  const affiliation = String(profile.affiliation ?? '');
  if (affiliation.includes('설계매니저')) {
    return fail('forbidden', '추천 코드를 조회할 수 없는 계정입니다.');
  }

  const fetchActiveReferralCode = () => supabase
    .from('referral_codes')
    .select('id, code, created_at')
    .eq('fc_id', profile.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let { data: referralCode, error: codeError } = await fetchActiveReferralCode();
  if (codeError) {
    return json({ ok: false, code: 'db_error', message: codeError.message }, 500);
  }

  if (!referralCode) {
    const ensureResult = await ensureActiveReferralCode({
      supabase,
      fcId: profile.id,
      actorPhone: sessionPhone,
      actorRole: managerAccount ? 'manager' : 'fc',
      reason: 'auto_issue_on_self_service_lookup',
    });

    if (!ensureResult.ok) {
      return json({ ok: false, code: 'db_error', message: ensureResult.message }, 500);
    }

    const ensuredCodeResult = await fetchActiveReferralCode();
    referralCode = ensuredCodeResult.data;
    codeError = ensuredCodeResult.error;
    if (codeError) {
      return json({ ok: false, code: 'db_error', message: codeError.message }, 500);
    }
    if (!referralCode) {
      return json(
        {
          ok: false,
          code: 'db_error',
          message: '추천 코드를 자동으로 준비하지 못했습니다. 잠시 후 다시 시도해주세요.',
        },
        500,
      );
    }
  }

  const recommenderName = typeof profile.recommender === 'string' && profile.recommender.trim()
    ? profile.recommender.trim()
    : null;

  let recommenderAffiliation: string | null = null;
  let recommenderCode: string | null =
    typeof profile.recommender_code === 'string' && profile.recommender_code.trim()
      ? profile.recommender_code.trim()
      : null;
  const recommenderFcId = String(profile.recommender_fc_id ?? '').trim();
  if (recommenderFcId) {
    const profileRes = await supabase
      .from('fc_profiles')
      .select('affiliation')
      .eq('id', recommenderFcId)
      .maybeSingle();
    const aff = String(profileRes.data?.affiliation ?? '').trim();
    if (aff) recommenderAffiliation = aff;
  }

  return json({
    ok: true,
    code: referralCode.code,
    codeId: referralCode.id,
    createdAt: referralCode.created_at,
    recommender: recommenderName,
    recommenderAffiliation,
    recommenderCode,
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405);
  }
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, code: 'server_misconfigured', message: 'Missing Supabase credentials' }, 500);
  }

  // Verify session token from Authorization header
  const sessionResult = await requireAppSessionFromRequest(req);
  if (!sessionResult.ok) {
    return fail(sessionResult.code, sessionResult.message);
  }

  const body = await readOptionalJsonBody(req);
  if (body === null) {
    return fail('invalid_json', 'Invalid JSON');
  }

  return resolveSelfReferralCode({ session: sessionResult.session });
});
