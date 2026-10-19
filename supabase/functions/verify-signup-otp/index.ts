import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SIGNUP_CLIENT_HEADERS } from '../_shared/signup-client-observation.ts';

type Payload = {
  phone?: string;
  code?: string;
};

type VerifyResult = {
  ok?: boolean;
  code?: string;
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': `Content-Type, Authorization, x-client-info, apikey, ${Object.values(SIGNUP_CLIENT_HEADERS).join(', ')}`,
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Base64(value: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)));
  return toBase64(hash);
}

async function sha256Hex(value: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)));
  return bytesToHex(hash);
}

function readRpcResult(value: unknown): VerifyResult {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object' ? candidate as VerifyResult : {};
}

function rpcFailure(code: string | undefined) {
  switch (code) {
    case 'not_found':
      return fail('not_found', '등록된 계정을 찾을 수 없습니다.', 404);
    case 'no_code':
      return fail('no_code', '먼저 인증 코드를 요청해주세요.');
    case 'expired_code':
      return fail('expired_code', '인증 코드가 만료되었습니다. 다시 요청해주세요.');
    case 'locked':
      return fail('locked', '인증 시도가 너무 많아 잠시 후 다시 시도해주세요.', 429);
    case 'invalid_code':
      return fail('invalid_code', '인증 코드가 올바르지 않습니다.');
    case 'already_completed':
    case 'already_set':
    case 'already_exists':
      return fail('already_completed', '이미 가입이 완료된 계정입니다.', 409);
    case 'invalid_request':
      return fail('invalid_code', '인증 정보를 다시 확인해주세요.');
    default:
      return fail('db_error', '인증을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.', 500);
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return fail('invalid_json', '요청 형식이 올바르지 않습니다.');
  }

  const phone = cleanPhone(body.phone ?? '');
  const code = (body.code ?? '').trim();
  if (!phone) return fail('phone_required', '휴대폰 번호를 입력해주세요.');
  if (phone.length !== 11) return fail('invalid_phone', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
  if (!/^\d{6}$/.test(code)) return fail('invalid_code', '인증 코드는 6자리 숫자여야 합니다.');

  const completionToken = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const [codeHash, completionTokenHash] = await Promise.all([
    sha256Base64(`${code}:${phone}`),
    sha256Hex(`fc-signup-completion-v1:${phone}:${completionToken}`),
  ]);
  const isTestBypass = signupSmsBypassConfig.enabled && code === signupSmsBypassConfig.code;

  const { data, error } = await supabase.rpc('verify_fc_signup_otp_v1', {
    p_phone: phone,
    p_code_hash: codeHash,
    p_completion_token_hash: completionTokenHash,
    p_test_bypass: isTestBypass,
  });

  if (error) {
    return fail('db_error', '인증을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.', 500);
  }

  const result = readRpcResult(data);
  if (result.ok !== true) {
    return rpcFailure(result.code);
  }

  return json({ ok: true, completionToken });
});
