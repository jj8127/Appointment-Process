import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  createRequestBoardBridgeToken,
  getEnv,
  parseAppSessionTokenDetailed,
  parseDesignerCompanyNameFromAffiliation,
} from '../_shared/request-board-auth.ts';
import { resolveManagerAffiliation } from '../_shared/manager-affiliation.ts';

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

  const parsed = await parseAppSessionTokenDetailed(sessionToken);
  if (parsed.ok === false) return fail(parsed.code, parsed.message, parsed.status ?? 401);
  const session = parsed.payload;

  const phone = cleanPhone(session.phone);
  if (phone.length !== 11) {
    return fail('invalid_phone', '유효한 전화번호가 아닙니다.', 401);
  }

  const account = session.role === 'admin'
    ? { role: 'admin' as const, ...await supabase.from('admin_accounts')
      .select('phone,active,name,staff_type').eq('phone', phone).maybeSingle() }
    : session.role === 'manager'
      ? { role: 'manager' as const, ...await supabase.from('manager_accounts')
        .select('phone,active,name').eq('phone', phone).maybeSingle() }
      : { role: 'fc' as const, ...await supabase.from('fc_profiles')
        .select('phone,name,signup_completed,affiliation').eq('phone', phone).maybeSingle() };

  if (account.error) {
    return fail('db_error', account.error.message, 500);
  }

  if (!account.data?.phone) {
    return fail('not_found', '계정을 찾을 수 없습니다.', 404);
  }

  if (account.role !== 'fc' && !account.data.active) {
    return fail('inactive_account', '비활성화된 계정입니다.', 403);
  }
  if (account.role === 'admin' && account.data.staff_type !== 'developer') {
    return fail('request_board_not_applicable', '총무 계정은 가람Link 요청 주체가 아닙니다.', 403);
  }
  if (account.role === 'fc' && !account.data.signup_completed) {
    return fail('not_completed', '회원가입이 완료되지 않았습니다.', 403);
  }

  const bridgeRole = account.role === 'manager' ? 'manager'
    : account.role === 'fc' && parseDesignerCompanyNameFromAffiliation(account.data.affiliation) ? 'designer' : 'fc';
  const affiliation = account.role === 'manager' ? resolveManagerAffiliation(account.data.name)
    : account.role === 'fc' && bridgeRole === 'fc' ? account.data.affiliation ?? null : undefined;
  const requestBoardBridgeToken = await createRequestBoardBridgeToken(
    account.data.phone,
    bridgeRole,
    affiliation,
    session,
  );

  if (!requestBoardBridgeToken) {
    return fail('bridge_secret_missing', '브릿지 토큰을 발급할 수 없습니다.', 500);
  }

  return json({
    ok: true,
    requestBoardBridgeToken,
    requestBoardRole: bridgeRole === 'manager' ? 'fc' : bridgeRole,
    displayName: account.data.name ?? '',
  });
});
