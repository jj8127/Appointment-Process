import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import {
  buildRequestBoardPasswordSyncOptions,
  findPasswordResetAccount,
} from '../_shared/password-reset-account.ts';

type Payload = {
  phone?: string;
  email?: string;
  token: string;
  newPassword: string;
  confirm?: string;
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
const encoder = new TextEncoder();
const SMS_BYPASS_ENABLED = (getEnv('SMS_BYPASS_ENABLED') ?? 'true').toLowerCase() === 'true';
const SMS_BYPASS_CODE = (getEnv('SMS_BYPASS_CODE') ?? getEnv('TEST_SMS_CODE') ?? '123456').trim();
const requestBoardPasswordSyncUrl = (getEnv('REQUEST_BOARD_PASSWORD_SYNC_URL') ?? '').trim();
const requestBoardPasswordSyncToken = (getEnv('REQUEST_BOARD_PASSWORD_SYNC_TOKEN') ?? '').trim();
const requestBoardPasswordSyncTimeoutRaw = Number((getEnv('REQUEST_BOARD_PASSWORD_SYNC_TIMEOUT_MS') ?? '5000').trim());
const requestBoardPasswordSyncTimeoutMs =
  Number.isFinite(requestBoardPasswordSyncTimeoutRaw) && requestBoardPasswordSyncTimeoutRaw >= 1000
    ? Math.floor(requestBoardPasswordSyncTimeoutRaw)
    : 5000;

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

async function hashPassword(password: string, saltBytes: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes.buffer as ArrayBuffer, iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

async function syncRequestBoardPassword(
  phone: string,
  password: string,
  options?: {
    role?: 'fc' | 'designer' | 'admin' | 'manager';
    name?: string | null;
    companyName?: string | null;
    affiliation?: string | null;
  },
) {
  if (!requestBoardPasswordSyncUrl || !requestBoardPasswordSyncToken) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestBoardPasswordSyncTimeoutMs);
  try {
    const response = await fetch(requestBoardPasswordSyncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-bridge-token': requestBoardPasswordSyncToken,
      },
      body: JSON.stringify({
        phone,
        password,
        role: options?.role ?? 'fc',
        name: options?.name ?? undefined,
        companyName: options?.companyName ?? undefined,
        affiliation:
          options?.role === 'fc' || options?.role === 'manager'
            ? options?.affiliation ?? undefined
            : undefined,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[reset-password] request_board sync failed: ${response.status} ${text.slice(0, 200)}`);
      return;
    }

    const json = await response.json().catch(() => ({}));
    if (!json?.success) {
      console.warn(`[reset-password] request_board sync error: ${JSON.stringify(json).slice(0, 200)}`);
    }
  } catch (error) {
    console.warn('[reset-password] request_board sync error:', error);
  } finally {
    clearTimeout(timeout);
  }
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
  const token = (body.token ?? '').trim();
  const newPassword = (body.newPassword ?? '').trim();
  const confirm = body.confirm?.trim();

  if (!phone) {
    return fail('phone_required', '휴대폰 번호를 입력해주세요.');
  }
  if (phone.length !== 11) {
    return fail('invalid_phone', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
  }
  if (!token) {
    return fail('missing_token', '인증 코드를 입력해주세요.');
  }
  if (!/^\d{6}$/.test(token)) {
    return fail('invalid_token', '인증 코드는 6자리 숫자여야 합니다.');
  }
  const hasLetter = /[A-Za-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  if (newPassword.length < 8 || !hasLetter || !hasNumber || !hasSpecial) {
    return fail('weak_password', '비밀번호는 8자 이상이며 영문+숫자+특수문자를 포함해야 합니다.');
  }
  if (confirm !== undefined && newPassword !== confirm) {
    return fail('password_mismatch', '비밀번호가 일치하지 않습니다.');
  }

  const { account, error: accountError } = await findPasswordResetAccount(supabase, phone);
  if (accountError) {
    const message = accountError instanceof Error ? accountError.message : '계정 조회 중 오류가 발생했습니다.';
    return json({ ok: false, code: 'db_error', message }, 500);
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

  if (account.kind === 'fc' && !account.signupCompleted) {
    return fail('not_completed', '회원가입이 완료되지 않았습니다.');
  }
  const bypassToken = SMS_BYPASS_ENABLED && token === SMS_BYPASS_CODE;
  if (!account.resetTokenHash || !account.resetTokenExpiresAt) {
    if (!bypassToken) {
      return fail('invalid_token', '인증 코드가 유효하지 않습니다.');
    }
  }

  if (!bypassToken) {
    const expiresAt = new Date(account.resetTokenExpiresAt);
    if (expiresAt < new Date()) {
      return fail('expired_token', '인증 코드가 만료되었습니다.');
    }

    const tokenHash = await sha256Base64(token);
    if (tokenHash !== account.resetTokenHash) {
      return fail('invalid_token', '인증 코드가 유효하지 않습니다.');
    }
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await hashPassword(newPassword, saltBytes);
  const passwordSalt = toBase64(saltBytes);

  const passwordUpdatePayload = {
    password_hash: passwordHash,
    password_salt: passwordSalt,
    password_set_at: new Date().toISOString(),
    failed_count: 0,
    locked_until: null,
    reset_token_hash: null,
    reset_token_expires_at: null,
    reset_sent_at: null,
  };

  const updateResult =
    account.kind === 'admin'
      ? await supabase.from('admin_accounts').update(passwordUpdatePayload).eq('id', account.id)
      : account.kind === 'manager'
        ? await supabase.from('manager_accounts').update(passwordUpdatePayload).eq('id', account.id)
        : await supabase.from('fc_credentials').update(passwordUpdatePayload).eq('fc_id', account.id);

  const { error: updateError } = updateResult;

  if (updateError) {
    return json({ ok: false, code: 'db_error', message: updateError.message }, 500);
  }

  await syncRequestBoardPassword(phone, newPassword, buildRequestBoardPasswordSyncOptions(account));

  return json({ ok: true });
});
