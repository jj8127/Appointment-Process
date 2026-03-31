import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getEnv,
  parseAppSessionToken,
} from '../_shared/request-board-auth.ts';

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
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
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) {
    return fail('unauthorized', '인증이 필요합니다.');
  }

  const token = bearerMatch[1];
  const session = await parseAppSessionToken(token);
  if (!session) {
    return fail('unauthorized', '인증이 필요합니다.');
  }

  let body: { phone?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('invalid_json', 'Invalid JSON');
  }

  const phone = cleanPhone(String(body.phone ?? ''));
  if (phone.length !== 11) {
    return fail('invalid_phone', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
  }

  // Verify that the session phone matches the requested phone
  const sessionPhone = cleanPhone(session.phone ?? '');
  if (sessionPhone !== phone) {
    return fail('unauthorized', '인증이 필요합니다.');
  }

  // Check if phone belongs to admin_accounts
  const { data: adminAccount, error: adminError } = await supabase
    .from('admin_accounts')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (adminError) {
    return json({ ok: false, code: 'db_error', message: adminError.message }, 500);
  }
  if (adminAccount) {
    return fail('forbidden', '추천 코드를 조회할 수 없는 계정입니다.');
  }

  // Check if phone belongs to manager_accounts
  const { data: managerAccount, error: managerError } = await supabase
    .from('manager_accounts')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (managerError) {
    return json({ ok: false, code: 'db_error', message: managerError.message }, 500);
  }
  if (managerAccount) {
    return fail('forbidden', '추천 코드를 조회할 수 없는 계정입니다.');
  }

  // Fetch fc_profiles to get fc_id and check affiliation
  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id, affiliation')
    .eq('phone', phone)
    .maybeSingle();
  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }
  if (!profile?.id) {
    return fail('not_found', '계정을 찾을 수 없습니다.');
  }

  // 설계매니저 판별
  const affiliation = String(profile.affiliation ?? '');
  if (affiliation.includes('설계매니저')) {
    return fail('forbidden', '추천 코드를 조회할 수 없는 계정입니다.');
  }

  const fcId = profile.id as string;

  // Fetch active referral code
  const { data: referralCode, error: codeError } = await supabase
    .from('referral_codes')
    .select('id, code, created_at')
    .eq('fc_id', fcId)
    .eq('is_active', true)
    .maybeSingle();
  if (codeError) {
    return json({ ok: false, code: 'db_error', message: codeError.message }, 500);
  }

  if (!referralCode) {
    return json({ ok: true, code: null, codeId: null, createdAt: null });
  }

  return json({
    ok: true,
    code: referralCode.code,
    codeId: referralCode.id,
    createdAt: referralCode.created_at,
  });
});
