import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getEnv,
  getAppSessionTokenFromRequest,
  parseAppSessionToken,
} from '../_shared/request-board-auth.ts';

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

function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

async function ensureManagerReferralShadowProfile(managerPhone: string, managerName?: string | null) {
  const { error } = await supabase.rpc('ensure_manager_referral_shadow_profile', {
    p_manager_phone: managerPhone,
    p_manager_name: typeof managerName === 'string' && managerName.trim() ? managerName.trim() : null,
  });

  return error;
}

type SessionPayload = Awaited<ReturnType<typeof parseAppSessionToken>>;

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
    return fail('unauthorized', '인증이 필요합니다.');
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
    .select('id, phone, affiliation, signup_completed, recommender, recommender_fc_id, is_manager_referral_shadow');

  let profileResult = sessionFcId
    ? await profileQuery.eq('id', sessionFcId).maybeSingle()
    : await profileQuery.eq('phone', sessionPhone).maybeSingle();
  if (!profileResult.data?.id && managerAccount) {
    const ensureError = await ensureManagerReferralShadowProfile(sessionPhone, managerAccount.name);
    if (ensureError) {
      return json({ ok: false, code: 'db_error', message: ensureError.message }, 500);
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
    return fail('unauthorized', '인증이 필요합니다.');
  }
  const isManagerShadow = profile.is_manager_referral_shadow === true;
  if (profile.signup_completed !== true && !(managerAccount && isManagerShadow)) {
    return fail('not_found', '계정을 찾을 수 없습니다.');
  }

  const affiliation = String(profile.affiliation ?? '');
  if (affiliation.includes('설계매니저')) {
    return fail('forbidden', '추천 코드를 조회할 수 없는 계정입니다.');
  }

  const { data: referralCode, error: codeError } = await supabase
    .from('referral_codes')
    .select('id, code, created_at')
    .eq('fc_id', profile.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (codeError) {
    return json({ ok: false, code: 'db_error', message: codeError.message }, 500);
  }

  const recommenderName = typeof profile.recommender === 'string' && profile.recommender.trim()
    ? profile.recommender.trim()
    : null;

  let recommenderAffiliation: string | null = null;
  let recommenderCode: string | null = null;
  const recommenderFcId = String(profile.recommender_fc_id ?? '').trim();
  if (recommenderFcId) {
    const [profileRes, codeRes] = await Promise.all([
      supabase
        .from('fc_profiles')
        .select('affiliation')
        .eq('id', recommenderFcId)
        .maybeSingle(),
      supabase
        .from('referral_codes')
        .select('code')
        .eq('fc_id', recommenderFcId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const aff = String(profileRes.data?.affiliation ?? '').trim();
    if (aff) recommenderAffiliation = aff;
    const rc = String(codeRes.data?.code ?? '').trim();
    if (rc) recommenderCode = rc;
  }

  if (!referralCode) {
    return json({
      ok: true,
      code: null,
      codeId: null,
      createdAt: null,
      recommender: recommenderName,
      recommenderAffiliation,
      recommenderCode,
    });
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
  const token = getAppSessionTokenFromRequest(req);
  if (!token) {
    return fail('unauthorized', '인증이 필요합니다.');
  }
  const session = await parseAppSessionToken(token);
  if (!session) {
    return fail('unauthorized', '인증이 필요합니다.');
  }

  const body = await readOptionalJsonBody(req);
  if (body === null) {
    return fail('invalid_json', 'Invalid JSON');
  }

  return resolveSelfReferralCode({ session });
});
