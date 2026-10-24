import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { sendSignupSms } from '../_shared/signup-sms.ts';
import { finalizeFcSignupDeliveryAttempt } from '../_shared/sms-delivery-attempt.ts';
import {
  reportSignupClientObservation,
  SIGNUP_CLIENT_HEADERS,
} from '../_shared/signup-client-observation.ts';

type Payload = {
  phone?: string;
  checkOnly?: boolean;
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
  'Access-Control-Allow-Headers': `Content-Type, Authorization, x-client-info, apikey, ${Object.values(SIGNUP_CLIENT_HEADERS).join(', ')}`,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

// Security: Validate required environment variables
const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const ncpAccessKey = getEnv('NCP_SENS_ACCESS_KEY') ?? getEnv('NCP_ACCESS_KEY');
const ncpSecretKey = getEnv('NCP_SENS_SECRET_KEY') ?? getEnv('NCP_SECRET_KEY');
const ncpServiceId = getEnv('NCP_SENS_SERVICE_ID') ?? getEnv('NCP_SMS_SERVICE_ID');
const ncpSmsFrom = getEnv('NCP_SENS_SMS_FROM') ?? getEnv('NCP_SMS_SENDER');

export function resolveSignupTestSmsConfig(env: Record<string, string | undefined>) {
  const enabled = (env.TEST_SMS_MODE ?? '').trim().toLowerCase() === 'true';
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
    throw new Error('Test SMS mode must not be enabled in production.');
  }

  const code = (env.TEST_SMS_CODE ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    throw new Error('A six-digit test SMS code is required when test mode is enabled.');
  }

  return { enabled: true, code };
}

const signupTestSmsConfig = resolveSignupTestSmsConfig({
  TEST_SMS_MODE: getEnv('TEST_SMS_MODE'),
  TEST_SMS_CODE: getEnv('TEST_SMS_CODE'),
  DENO_DEPLOYMENT_ID: getEnv('DENO_DEPLOYMENT_ID'),
  NODE_ENV: getEnv('NODE_ENV'),
  DENO_ENV: getEnv('DENO_ENV'),
  APP_ENV: getEnv('APP_ENV'),
  ENVIRONMENT: getEnv('ENVIRONMENT'),
  SUPABASE_ENV: getEnv('SUPABASE_ENV'),
  VERCEL_ENV: getEnv('VERCEL_ENV'),
});

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}
if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}
if (!signupTestSmsConfig.enabled && (!ncpAccessKey || !ncpSecretKey || !ncpServiceId || !ncpSmsFrom)) {
  throw new Error('Missing required NCP SMS credentials (NCP_SENS_ACCESS_KEY, NCP_SENS_SECRET_KEY, NCP_SENS_SERVICE_ID, NCP_SENS_SMS_FROM)');
}

const supabase = createClient(supabaseUrl, serviceKey);
const textEncoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function cleanupLinkedAuthUsers(linkedProfileIds: string[]) {
  for (const profileId of linkedProfileIds) {
    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(profileId);
    if (authDeleteError) {
      console.warn('[request-signup-otp] auth cleanup failed', {
        reason: 'auth_cleanup_failed',
        status: authDeleteError.status ?? 'unknown',
      });
    }
  }
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

async function sha256Base64(value: string) {
  const bytes = textEncoder.encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return toBase64(hash);
}

async function sendOtpSms(to: string, code: string) {
  return sendSignupSms(to, code, `[FC 위촉] 회원가입 인증 코드: ${code} (5분 유효)`, signupTestSmsConfig.enabled);
}

function generateOtpCode() {
  if (signupTestSmsConfig.enabled) {
    return signupTestSmsConfig.code;
  }
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  const value = bytes[0] % 900000;
  return String(100000 + value);
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
  reportSignupClientObservation(req);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return fail('invalid_json', 'Invalid JSON');
  }

  const phone = cleanPhone(body.phone ?? '');
  const checkOnly = body.checkOnly === true;

  if (!phone) return fail('phone_required', '휴대폰 번호를 입력해주세요.');
  if (phone.length !== 11) return fail('invalid_phone', '휴대폰 번호는 숫자 11자리로 입력해주세요.');

  // 관리자(총무) 계정 중복 체크
  const { data: adminAccount, error: adminError } = await supabase
    .from('admin_accounts')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (adminError) {
    return json({ ok: false, code: 'db_error', message: '가입 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' }, 500);
  }
  if (adminAccount) {
    return json({ ok: false, code: 'already_exists', message: '해당 번호로 총무 계정이 이미 있습니다.' });
  }

  // 본부장 계정 중복 체크
  const { data: managerAccount, error: managerError } = await supabase
    .from('manager_accounts')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (managerError) {
    return json({ ok: false, code: 'db_error', message: '가입 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' }, 500);
  }
  if (managerAccount) {
    return json({ ok: false, code: 'already_exists', message: '해당 번호로 본부장 계정이 이미 있습니다.' });
  }

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id,signup_completed')
    .eq('phone', phone)
    .maybeSingle();

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: '가입 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' }, 500);
  }

  let hasPasswordSet = false;

  if (profile?.id) {
    const { data: credentials, error: credentialsError } = await supabase
      .from('fc_credentials')
      .select('fc_id,password_set_at')
      .eq('fc_id', profile.id)
      .maybeSingle();

    if (credentialsError) {
      return json({ ok: false, code: 'db_error', message: '가입 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' }, 500);
    }

    hasPasswordSet = Boolean(credentials?.password_set_at);
  }

  const hasActiveFcAccount = Boolean(profile?.id) && profile?.signup_completed === true && hasPasswordSet;

  if (hasActiveFcAccount) {
    return json({ ok: false, code: 'already_exists', message: '해당 번호로 FC 계정이 이미 있습니다.' });
  }

  // checkOnly: 중복 없음 확인만 하고 OTP 발송 없이 반환
  if (checkOnly) {
    return json({ ok: true, available: true });
  }

  const code = generateOtpCode();
  const hash = await sha256Base64(`${code}:${phone}`);
  const { data: issued, error: issueError } = await supabase.rpc('issue_fc_signup_otp_v1', {
    p_phone: phone,
    p_code_hash: hash,
  });
  if (issueError || !issued || typeof issued !== 'object' || Array.isArray(issued)) {
    return json({ ok: false, code: 'db_error', message: '인증 요청을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' }, 500);
  }
  if (issued.ok !== true) {
    if (issued.code === 'already_exists') {
      return json({ ok: false, code: 'already_exists', message: '해당 번호로 계정이 이미 있습니다.' });
    }
    if (issued.code === 'locked') {
      return json({ ok: false, code: 'locked', message: '인증 시도가 너무 많아 잠시 후 다시 시도해주세요.' }, 429);
    }
    if (issued.code === 'cooldown') {
      return json({ ok: false, code: 'cooldown', message: '잠시 후 다시 시도해주세요.' }, 429);
    }
    return json({ ok: false, code: 'db_error', message: '인증 요청을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' }, 500);
  }

  const deliveryId = typeof issued.deliveryId === 'string' && UUID.test(issued.deliveryId)
    ? issued.deliveryId
    : null;
  const authProfileIds = Array.isArray(issued.authProfileIds)
    && issued.authProfileIds.every((value: unknown) => typeof value === 'string' && UUID.test(value))
    ? issued.authProfileIds as string[]
    : null;
  if (!deliveryId || !authProfileIds) {
    return json({ ok: false, code: 'db_error', message: '인증 요청을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' }, 500);
  }

  await cleanupLinkedAuthUsers(authProfileIds);

  const smsResult = await sendOtpSms(phone, code);
  const finalized = await finalizeFcSignupDeliveryAttempt(supabase, phone, deliveryId, smsResult);
  if (!smsResult.ok) {
    if (!finalized) {
      return json({ ok: false, code: 'sms_delivery_unknown',
        message: '문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.' }, 503);
    }
    return json(
      { ok: false, code: smsResult.deliveryState === 'unknown' ? 'sms_delivery_unknown' : 'sms_send_failed',
        message: smsResult.deliveryState === 'unknown'
          ? '문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.'
          : 'SMS 전송에 실패했습니다. 바로 다시 요청해 주세요.' },
      smsResult.status,
    );
  }

  if (!finalized) {
    return json({ ok: false, code: 'sms_delivery_unknown',
      message: '문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.' }, 503);
  }

  if (signupTestSmsConfig.enabled) {
    // Security: Never expose OTP code in response, even in test mode
    // Keep diagnostics useful without disclosing the phone number or OTP.
    console.info('[request-signup-otp] test delivery simulated');
    return json({ ok: true, sent: true, test_mode: true });
  }
  return json({ ok: true, sent: true });
});
