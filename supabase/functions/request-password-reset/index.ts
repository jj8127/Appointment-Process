import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = {
  phone?: string;
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
const testSmsMode = (getEnv('TEST_SMS_MODE') ?? '').toLowerCase() === 'true';
const testSmsCode = getEnv('TEST_SMS_CODE') ?? '123456';

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}
if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}
if (!testSmsMode && (!ncpAccessKey || !ncpSecretKey || !ncpServiceId || !ncpSmsFrom)) {
  throw new Error('Missing required NCP SMS credentials (NCP_SENS_ACCESS_KEY, NCP_SENS_SECRET_KEY, NCP_SENS_SERVICE_ID, NCP_SENS_SMS_FROM)');
}

const supabase = createClient(supabaseUrl, serviceKey);
const encoder = new TextEncoder();
const RESET_COOLDOWN_SECONDS = 60;

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


function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

async function sha256Base64(value: string) {
  const bytes = encoder.encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return toBase64(hash);
}

async function hmacSignature(message: string, secretKey: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function sendResetSms(to: string, code: string) {
  if (testSmsMode) {
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
    content: `[FC 위촉] 비밀번호 재설정 코드: ${code} (15분 유효)`,
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
    const text = await res.text();
    return { ok: false, status: res.status, message: text || 'SMS 전송 실패' };
  }
  return { ok: true, status: 200 };
}

function generateResetCode() {
  if (testSmsMode && /^\d{6}$/.test(testSmsCode)) {
    return testSmsCode;
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
  if (!phone) {
    return fail('phone_required', '휴대폰 번호를 입력해주세요.');
  }
  if (phone.length !== 11) {
    return fail('invalid_phone', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
  }

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id,phone')
    .eq('phone', phone)
    .maybeSingle();

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }

  if (!profile?.id) {
    return fail('not_found', '회원가입된 계정을 찾을 수 없습니다.');
  }

  const { data: creds, error: credsError } = await supabase
    .from('fc_credentials')
    .select('password_set_at,reset_sent_at')
    .eq('fc_id', profile.id)
    .maybeSingle();

  if (credsError) {
    return json({ ok: false, code: 'db_error', message: credsError.message }, 500);
  }
  if (!creds?.password_set_at) {
    return fail('not_set', '비밀번호가 아직 설정되지 않았습니다.');
  }

  if (creds.reset_sent_at) {
    const sentAt = new Date(creds.reset_sent_at);
    const elapsed = (Date.now() - sentAt.getTime()) / 1000;
    if (elapsed < RESET_COOLDOWN_SECONDS) {
      return json({ ok: false, code: 'cooldown', message: '잠시 후 다시 시도해주세요.' }, 429);
    }
  }

  const code = generateResetCode();
  const tokenHash = await sha256Base64(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { error: updateError } = await supabase
    .from('fc_credentials')
    .update({ reset_token_hash: tokenHash, reset_token_expires_at: expiresAt, reset_sent_at: new Date().toISOString() })
    .eq('fc_id', profile.id);

  if (updateError) {
    return json({ ok: false, code: 'db_error', message: updateError.message }, 500);
  }

  const smsResult = await sendResetSms(phone, code);
  if (!smsResult.ok) {
    return json(
      { ok: false, code: 'sms_send_failed', message: smsResult.message ?? 'SMS 전송에 실패했습니다.' },
      smsResult.status ?? 500,
    );
  }

  return json({ ok: true, sent: true });
});
