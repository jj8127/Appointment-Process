import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import {
  createAppSessionToken,
  getEnv,
  parseRequestBoardBridgeTokenDetailed,
} from '../_shared/request-board-auth.ts';

type RequestBody = {
  bridgeToken?: string;
};

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

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

function fail(code: string, message: string, status = 200) {
  return json({ ok: false, code, message }, status);
}

function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'Method not allowed', 405);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return fail('invalid_json', 'Invalid JSON');
  }

  const bridgeToken = String(body.bridgeToken ?? '').trim();
  if (!bridgeToken) {
    return fail('missing_bridge_token', '세션이 만료되었습니다. 다시 로그인해주세요.', 401);
  }

  const parsedBridgeToken = await parseRequestBoardBridgeTokenDetailed(bridgeToken);
  if (!parsedBridgeToken.ok) {
    return fail(parsedBridgeToken.code, parsedBridgeToken.message, 401);
  }

  const phone = cleanPhone(parsedBridgeToken.payload.phone ?? '');
  if (phone.length !== 11) {
    return fail('invalid_bridge_token', '브릿지 세션이 유효하지 않습니다. 다시 로그인해주세요.', 401);
  }

  const { data: adminAccount, error: adminError } = await supabase
    .from('admin_accounts')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  if (adminError) {
    return fail('db_error', adminError.message, 500);
  }

  if (adminAccount?.id) {
    return fail('forbidden', '추천인 세션을 발급할 수 없는 계정입니다.', 403);
  }

  if (parsedBridgeToken.payload.role === 'manager') {
    const { data: managerAccount, error: managerError } = await supabase
      .from('manager_accounts')
      .select('id, active')
      .eq('phone', phone)
      .maybeSingle();

    if (managerError) {
      return fail('db_error', managerError.message, 500);
    }

    if (!managerAccount?.id || managerAccount.active !== true) {
      return fail('forbidden', '추천인 세션을 발급할 수 없는 계정입니다.', 403);
    }

    const appSessionToken = await createAppSessionToken(phone, 'manager');
    if (!appSessionToken) {
      return fail('bridge_secret_missing', '앱 세션을 발급할 수 없습니다.', 500);
    }

    return json({
      ok: true,
      appSessionToken,
      role: 'manager',
    });
  }

  if (parsedBridgeToken.payload.role !== 'fc') {
    return fail('forbidden', '추천인 세션을 발급할 수 없는 계정입니다.', 403);
  }

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id, affiliation, signup_completed')
    .eq('phone', phone)
    .maybeSingle();

  if (profileError) {
    return fail('db_error', profileError.message, 500);
  }

  if (!profile?.id) {
    return fail('not_found', '계정을 찾을 수 없습니다.', 404);
  }

  if (!profile.signup_completed || String(profile.affiliation ?? '').includes('설계매니저')) {
    return fail('forbidden', '추천인 세션을 발급할 수 없는 계정입니다.', 403);
  }

  const appSessionToken = await createAppSessionToken(phone, 'fc', undefined, profile.id);
  if (!appSessionToken) {
    return fail('bridge_secret_missing', '앱 세션을 발급할 수 없습니다.', 500);
  }

  return json({
    ok: true,
    appSessionToken,
    role: 'fc',
  });
});
