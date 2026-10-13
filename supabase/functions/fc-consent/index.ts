import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
// eslint-disable-next-line import/no-unresolved
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getKoreanYmd,
  hasMismatchedClaimedPhone,
  isExactYmd,
  requireFcSelfServiceActor,
} from '../_shared/fc-self-service-auth.ts';
type Payload = {
  phone?: string;
  allowance_date?: string;
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405);
  }
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, code: 'server_misconfigured', message: '서비스 설정을 확인할 수 없습니다.' }, 500);
  }

  const auth = await requireFcSelfServiceActor(req);
  if (auth.ok === false) {
    return json({ ok: false, code: auth.code, message: auth.message }, auth.status);
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return json({ ok: false, code: 'invalid_json', message: '요청 형식이 올바르지 않습니다.' }, 400);
  }

  if (hasMismatchedClaimedPhone(auth.actor, body.phone)) {
    return json({ ok: false, code: 'actor_mismatch', message: '로그인 정보와 요청 정보가 일치하지 않습니다.' }, 403);
  }

  const allowanceDate = (body.allowance_date ?? '').trim();
  if (!allowanceDate || !isExactYmd(allowanceDate) || allowanceDate > getKoreanYmd()) {
    return json({ ok: false, code: 'invalid_allowance_date', message: '오늘 또는 그 이전의 유효한 동의일을 입력해주세요.' }, 400);
  }

  const { data: updated, error: updateError } = await supabase
    .from('fc_profiles')
    .update({
      allowance_date: allowanceDate,
      allowance_prescreen_requested_at: null,
      status: 'allowance-pending',
      allowance_reject_reason: null,
    })
    .eq('id', auth.actor.id)
    .eq('phone', auth.actor.phone)
    .not('temp_id', 'is', null)
    .neq('temp_id', '')
    .or('status.is.null,status.in.(draft,temp-id-issued,allowance-pending)')
    .select('id,name')
    .maybeSingle();

  if (updateError) {
    return json({ ok: false, code: 'write_failed', message: '보증보험 조회 동의일을 저장하지 못했습니다.' }, 503);
  }
  if (!updated?.id) {
    return json({
      ok: false,
      code: 'consent_locked_or_prerequisite_missing',
      message: '임시사번이 없거나 이미 확정된 동의 정보는 수정할 수 없습니다.',
    }, 409);
  }

  return json({
    ok: true,
    profile: { id: updated.id, name: updated.name ?? '' },
  });
});
