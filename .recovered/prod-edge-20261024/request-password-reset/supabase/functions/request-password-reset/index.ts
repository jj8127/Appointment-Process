import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { canInitializeFcPassword, findPasswordResetAccount } from '../_shared/password-reset-account.ts';
import { processPasswordResetChallenge } from '../_shared/password-reset-challenge.ts';
import { sendSignupSms } from '../_shared/signup-sms.ts';
import {
  beginSmsDeliveryAttempt,
  finalizeSmsDeliveryAttempt,
} from '../_shared/sms-delivery-attempt.ts';

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

export function resolvePasswordResetTestSmsConfig(env: Record<string, string | undefined>) {
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

const passwordResetTestSmsConfig = resolvePasswordResetTestSmsConfig({
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
const supabase = createClient(supabaseUrl, serviceKey);
const encoder = new TextEncoder();

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

async function sendResetSms(to: string, code: string) {
  return sendSignupSms(to, code, `[가람in] 비밀번호 변경 코드: ${code} (15분 유효)`,
    passwordResetTestSmsConfig.enabled);
}

function generateResetCode() {
  if (passwordResetTestSmsConfig.enabled) {
    return passwordResetTestSmsConfig.code;
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

  const { account, error: accountError } = await findPasswordResetAccount(supabase, phone);
  if (accountError) {
    return json({ ok: false, code: 'db_error', message: '계정 조회 중 오류가 발생했습니다.' }, 500);
  }

  if (!account) {
    return fail('not_found', '등록된 계정을 찾을 수 없습니다.');
  }

  if (account.kind === 'admin' && !account.active) {
    return fail('inactive_account', '총무 계정이 비활성화되었습니다.');
  }

  if (account.kind === 'manager' && !account.active) {
    return fail('inactive_account', '본부장 계정이 비활성화되었습니다.');
  }

  if (account.kind === 'fc' && (account.signupCompleted !== true || account.isManagerReferralShadow === true)) {
    return fail('not_completed', '회원가입이 완료되지 않았습니다.');
  }

  if (!account.passwordSetAt && !canInitializeFcPassword(account)) {
    return fail('not_set', '비밀번호가 아직 설정되지 않았습니다.');
  }

  const code = generateResetCode();
  const tokenHash = await sha256Base64(code);
  const challengeResult = await processPasswordResetChallenge(supabase, account, { action: 'issue', tokenHash });
  if (challengeResult.ok === false) {
    const { status, ...failure } = challengeResult;
    return json(failure, status);
  }

  const tracking = await beginSmsDeliveryAttempt(supabase, 'password_reset');
  if (!tracking.ok) {
    const compensation = await processPasswordResetChallenge(supabase, account, { action: 'cancel', tokenHash });
    return compensation.ok
      ? json({ ok: false, code: 'sms_send_failed', message: 'SMS 전송에 실패했습니다. 바로 다시 요청해 주세요.' }, 503)
      : json({ ok: false, code: 'sms_delivery_unknown', message: '문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.' }, 503);
  }

  const smsResult = await sendResetSms(phone, code);
  const finalized = await finalizeSmsDeliveryAttempt(supabase, 'password_reset', tracking.deliveryId, smsResult);
  if (!smsResult.ok) {
    if (smsResult.deliveryState === 'rejected') {
      const compensation = await processPasswordResetChallenge(supabase, account, { action: 'cancel', tokenHash });
      if (compensation.ok === false) {
        return json({ ok: false, code: 'sms_delivery_unknown', message: '문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.' }, 503);
      }
    }
    if (!finalized) {
      return json({ ok: false, code: 'sms_delivery_unknown', message: '문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.' }, 503);
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
    return json({ ok: false, code: 'sms_delivery_unknown', message: '문자 접수 상태를 확인하지 못했습니다. 문자가 오면 인증번호를 입력해 주세요.' }, 503);
  }

  return json({ ok: true, sent: true });
});
