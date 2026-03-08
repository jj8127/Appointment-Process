import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  createRequestBoardBridgeToken,
  getEnv,
  parseAppSessionToken,
  parseDesignerCompanyNameFromAffiliation,
} from '../_shared/request-board-auth.ts';

type RequestBody = {
  sessionToken?: string;
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

function fail(code: string, message: string, status = 400) {
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

  const sessionToken = String(body.sessionToken ?? '').trim();
  if (!sessionToken) {
    return fail('missing_session_token', '앱 세션 토큰이 없습니다.');
  }

  const session = await parseAppSessionToken(sessionToken);
  if (!session) {
    return fail('invalid_session_token', '앱 세션 토큰이 유효하지 않습니다.', 401);
  }

  const phone = cleanPhone(session.phone);
  if (phone.length !== 11) {
    return fail('invalid_phone', '유효한 전화번호가 아닙니다.', 401);
  }

  if (session.role === 'admin') {
    const { data: admin, error } = await supabase
      .from('admin_accounts')
      .select('phone,active,name')
      .eq('phone', phone)
      .maybeSingle();

    if (error) {
      return fail('db_error', error.message, 500);
    }

    if (!admin?.phone) {
      return fail('not_found', '계정을 찾을 수 없습니다.', 404);
    }

    if (!admin.active) {
      return fail('inactive_account', '비활성화된 계정입니다.', 403);
    }

    return fail('request_board_not_applicable', '총무 계정은 가람Link 요청 주체가 아닙니다.', 403);
  }

  if (session.role === 'manager') {
    const { data: manager, error } = await supabase
      .from('manager_accounts')
      .select('phone,active,name')
      .eq('phone', phone)
      .maybeSingle();

    if (error) {
      return fail('db_error', error.message, 500);
    }

    if (!manager?.phone) {
      return fail('not_found', '계정을 찾을 수 없습니다.', 404);
    }

    if (!manager.active) {
      return fail('inactive_account', '비활성화된 계정입니다.', 403);
    }

    const requestBoardBridgeToken = await createRequestBoardBridgeToken(manager.phone, 'manager');
    if (!requestBoardBridgeToken) {
      return fail('bridge_secret_missing', '브릿지 토큰을 발급할 수 없습니다.', 500);
    }

    return json({
      ok: true,
      requestBoardBridgeToken,
      requestBoardRole: 'fc',
      displayName: manager.name ?? '',
    });
  }

  const { data: profile, error } = await supabase
    .from('fc_profiles')
    .select('phone,name,signup_completed,affiliation')
    .eq('phone', phone)
    .maybeSingle();

  if (error) {
    return fail('db_error', error.message, 500);
  }

  if (!profile?.phone) {
    return fail('not_found', '계정을 찾을 수 없습니다.', 404);
  }

  if (!profile.signup_completed) {
    return fail('not_completed', '회원가입이 완료되지 않았습니다.', 403);
  }

  const designerCompanyName = parseDesignerCompanyNameFromAffiliation(profile.affiliation);
  const requestBoardRole = designerCompanyName ? 'designer' : 'fc';
  const requestBoardBridgeToken = await createRequestBoardBridgeToken(profile.phone, requestBoardRole);

  if (!requestBoardBridgeToken) {
    return fail('bridge_secret_missing', '브릿지 토큰을 발급할 수 없습니다.', 500);
  }

  return json({
    ok: true,
    requestBoardBridgeToken,
    requestBoardRole,
    displayName: profile.name ?? '',
  });
});
