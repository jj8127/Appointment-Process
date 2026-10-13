import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { mutationRowReceiptMatches } from '../_shared/ux-mutation-contract.ts';

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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
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

async function sha256Base64(value: string) {
  const bytes = textEncoder.encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return toBase64(hash);
}

async function hmacSignature(message: string, secretKey: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function sendOtpSms(to: string, code: string) {
  if (signupTestSmsConfig.enabled) {
    return { ok: true, status: 200 };
  }
  if (!ncpAccessKey || !ncpSecretKey || !ncpServiceId || !ncpSmsFrom) {
    return { ok: false, status: 500, message: 'SMS 설정이 필요합니다.' };
  }
  const timestamp = Date.now().toString();
  const path = `/sms/v2/services/${ncpServiceId}/messages`;
  const message = `POST ${path}\n${timestamp}\n${ncpAccessKey}`;
  const signature = await hmacSignature(message, ncpSecretKey);

  const payload = {
    type: 'SMS',
    contentType: 'COMM',
    countryCode: '82',
    from: ncpSmsFrom,
    content: `[FC 위촉] 회원가입 인증 코드: ${code} (5분 유효)`,
    messages: [{ to }],
  };

  const res = await fetch(`https://sens.apigw.ntruss.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ncp-apigw-timestamp': timestamp,
      'x-ncp-iam-access-key': ncpAccessKey,
      'x-ncp-apigw-signature-v2': signature,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, message: 'SMS 전송에 실패했습니다.' };
  }
  return { ok: true, status: 200 };
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
    return json({ ok: false, code: 'db_error', message: adminError.message }, 500);
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
    return json({ ok: false, code: 'db_error', message: managerError.message }, 500);
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
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }

  let hasPasswordSet = false;

  if (profile?.id) {
    const { data: credentials, error: credentialsError } = await supabase
      .from('fc_credentials')
      .select('fc_id,password_set_at')
      .eq('fc_id', profile.id)
      .maybeSingle();

    if (credentialsError) {
      return json({ ok: false, code: 'db_error', message: credentialsError.message }, 500);
    }

    hasPasswordSet = Boolean(credentials?.password_set_at);
  }

  const hasActiveFcAccount = Boolean(profile?.id) && profile?.signup_completed === true && hasPasswordSet;

  if (hasActiveFcAccount) {
    return json({ ok: false, code: 'already_exists', message: '해당 번호로 FC 계정이 이미 있습니다.' });
  }

  // checkOnly: 중복 없음 확인만 하고 OTP 발송 없이 반환
  if (checkOnly) {
    return json({ ok: true, available: true, residentId: phone });
  }

  const code = generateOtpCode();
  const hash = await sha256Base64(`${code}:${phone}`);
  let profileId = profile?.id ?? null;

  if (!profileId) {
    const insertPayload = {
      phone,
      name: '',
      affiliation: '',
      recommender: '',
      recommender_code_id: null,
      recommender_code: null,
      recommender_linked_at: null,
      recommender_link_source: null,
      email: '',
      address: '',
      status: 'draft',
      identity_completed: false,
      phone_verified: false,
    } as const;
    const { data: insertReceipt, error: insertError } = await supabase
      .from('fc_profiles')
      .insert(insertPayload)
      .select('id,phone,name,affiliation,recommender,recommender_code_id,recommender_code,recommender_linked_at,recommender_link_source,email,address,status,identity_completed,phone_verified')
      .maybeSingle();
    if (insertError) {
      return json({ ok: false, code: 'db_error', message: insertError.message }, 500);
    }
    if (!insertReceipt || !mutationRowReceiptMatches(insertReceipt, insertPayload)) {
      return json({ ok: false, code: 'otp_write_unverified', message: '인증 코드 저장 결과를 확인하지 못했습니다.' }, 500);
    }
    profileId = insertReceipt.id;
  }

  const challengeId = crypto.randomUUID();
  const { data: issueReceipt, error: issueError } = await supabase.rpc(
    'issue_signup_otp_challenge_v1',
    {
      p_fc_id: profileId,
      p_expected_phone: phone,
      p_challenge_id: challengeId,
      p_otp_hash: hash,
    },
  );
  if (issueError || !issueReceipt || typeof issueReceipt !== 'object' || Array.isArray(issueReceipt)) {
    return json({ ok: false, code: 'db_error', message: '인증 코드 발급 상태를 저장하지 못했습니다.' }, 500);
  }
  if (issueReceipt.ok !== true) {
    const issueCode = typeof issueReceipt.code === 'string' ? issueReceipt.code : 'db_error';
    if (issueCode === 'locked') {
      return json({ ok: false, code: 'locked', message: '인증 시도가 너무 많아 잠시 후 다시 시도해주세요.' }, 429);
    }
    if (issueCode === 'cooldown') {
      return json({ ok: false, code: 'cooldown', message: '잠시 후 다시 시도해주세요.' }, 429);
    }
    if (issueCode === 'account_exists') {
      return json({ ok: false, code: 'already_exists', message: '해당 번호로 FC 계정이 이미 있습니다.' });
    }
    return json({ ok: false, code: issueCode, message: '인증 코드 발급 상태를 저장하지 못했습니다.' }, 500);
  }
  if (!mutationRowReceiptMatches(issueReceipt, {
    ok: true,
    code: 'issued',
    profileId,
    residentId: phone,
    challengeId,
  })) {
    return json({ ok: false, code: 'otp_write_unverified', message: '인증 코드 저장 결과를 확인하지 못했습니다.' }, 500);
  }

  const smsResult = await sendOtpSms(phone, code);
  if (!smsResult.ok) {
    return json(
      { ok: false, code: 'sms_send_failed', message: smsResult.message ?? 'SMS 전송에 실패했습니다.' },
      smsResult.status ?? 500,
    );
  }

  if (signupTestSmsConfig.enabled) {
    // Security: Never expose OTP code in response, even in test mode
    // Keep diagnostics useful without disclosing the phone number or OTP.
    console.info('[request-signup-otp] test delivery simulated');
    return json({ ok: true, sent: true, residentId: phone, challengeId, test_mode: true });
  }
  return json({ ok: true, sent: true, residentId: phone, challengeId });
});
