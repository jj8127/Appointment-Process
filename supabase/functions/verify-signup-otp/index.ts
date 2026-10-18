import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { mutationRowReceiptMatches } from '../_shared/ux-mutation-contract.ts';

type Payload = {
  phone?: string;
  code?: string;
  challengeId?: string;
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

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
const textEncoder = new TextEncoder();

export function resolveSignupSmsBypassConfig(env: Record<string, string | undefined>) {
  const enabled = (env.SMS_BYPASS_ENABLED ?? '').trim().toLowerCase() === 'true';
  if (!enabled) {
    return { enabled: false, code: '' };
  }

  const isHostedDeployment = Boolean((env.DENO_DEPLOYMENT_ID ?? '').trim());
  const isProductionEnvironment = [
    env.NODE_ENV,
    env.DENO_ENV,
    env.APP_ENV,
    env.ENVIRONMENT,
    env.SUPABASE_ENV,
    env.VERCEL_ENV,
  ].some((value) => ['production', 'prod'].includes((value ?? '').trim().toLowerCase()));

  if (isHostedDeployment || isProductionEnvironment) {
    throw new Error('SMS bypass must not be enabled in production.');
  }

  const code = (env.SMS_BYPASS_CODE ?? env.TEST_SMS_CODE ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    throw new Error('A six-digit SMS bypass code is required when bypass is enabled.');
  }

  return { enabled: true, code };
}

const signupSmsBypassConfig = resolveSignupSmsBypassConfig({
  SMS_BYPASS_ENABLED: getEnv('SMS_BYPASS_ENABLED'),
  SMS_BYPASS_CODE: getEnv('SMS_BYPASS_CODE'),
  TEST_SMS_CODE: getEnv('TEST_SMS_CODE'),
  DENO_DEPLOYMENT_ID: getEnv('DENO_DEPLOYMENT_ID'),
  NODE_ENV: getEnv('NODE_ENV'),
  DENO_ENV: getEnv('DENO_ENV'),
  APP_ENV: getEnv('APP_ENV'),
  ENVIRONMENT: getEnv('ENVIRONMENT'),
  SUPABASE_ENV: getEnv('SUPABASE_ENV'),
  VERCEL_ENV: getEnv('VERCEL_ENV'),
});

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

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Base64(value: string) {
  const bytes = textEncoder.encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return toBase64(hash);
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

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return fail('invalid_json', 'Invalid JSON');
  }

  const phone = cleanPhone(body.phone ?? '');
  const code = (body.code ?? '').trim();
  const challengeId = (body.challengeId ?? '').trim();
  if (!phone) return fail('phone_required', '휴대폰 번호를 입력해주세요.');
  if (phone.length !== 11) return fail('invalid_phone', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
  if (!/^\d{6}$/.test(code)) return fail('invalid_code', '인증 코드는 6자리 숫자여야 합니다.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId)) {
    return fail('invalid_challenge', '인증 코드를 다시 요청해주세요.');
  }

  const submittedHash = await sha256Base64(`${code}:${phone}`);
  const verificationProof = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const verificationProofHash = await sha256Base64(verificationProof);
  const allowTestBypass = signupSmsBypassConfig.enabled && code === signupSmsBypassConfig.code;
  const { data: receipt, error } = await supabase.rpc('process_signup_otp_challenge_v1', {
    p_expected_phone: phone,
    p_challenge_id: challengeId,
    p_submitted_hash: submittedHash,
    p_verification_proof_hash: verificationProofHash,
    p_allow_test_bypass: allowTestBypass,
  });

  if (error || !receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return json({ ok: false, code: 'db_error', message: '휴대폰 인증 상태를 저장하지 못했습니다.' }, 500);
  }
  if (receipt.ok !== true) {
    const receiptCode = typeof receipt.code === 'string' ? receipt.code : 'db_error';
    const failures: Record<string, { message: string; status: number }> = {
      not_found: { message: '등록된 계정을 찾을 수 없습니다.', status: 400 },
      no_code: { message: '인증 코드가 없습니다.', status: 400 },
      stale_challenge: { message: '새로 발급된 인증 코드를 입력해주세요.', status: 400 },
      expired_code: { message: '인증 코드가 만료되었습니다.', status: 400 },
      invalid_code: { message: '인증 코드가 올바르지 않습니다.', status: 400 },
      locked: { message: '인증 시도가 너무 많아 잠시 후 다시 시도해주세요.', status: 429 },
      account_exists: { message: '이미 가입이 완료된 계정입니다.', status: 409 },
    };
    const failure = failures[receiptCode];
    if (!failure) {
      return json({ ok: false, code: 'db_error', message: '휴대폰 인증 상태를 확인하지 못했습니다.' }, 500);
    }
    return fail(receiptCode, failure.message, failure.status);
  }
  if (typeof receipt.profileId !== 'string' || !mutationRowReceiptMatches(receipt, {
    ok: true,
    code: 'verified',
    verified: true,
    residentId: phone,
    challengeId,
  })) {
    return json({ ok: false, code: 'otp_verification_unverified', message: '휴대폰 인증 결과를 확인하지 못했습니다.' }, 500);
  }

  return json({
    ok: true,
    verified: true,
    residentId: phone,
    profileId: receipt.profileId,
    verificationProof,
  });
});
