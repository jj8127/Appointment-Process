import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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

function fromBase64(input: string) {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id,phone')
    .eq('phone', phone)
    .maybeSingle();

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }
  if (!profile?.id) {
    return fail('not_found', '등록된 계정을 찾을 수 없습니다.');
  }

  const { data: creds, error: credsError } = await supabase
    .from('fc_credentials')
    .select('reset_token_hash,reset_token_expires_at')
    .eq('fc_id', profile.id)
    .maybeSingle();

  if (credsError) {
    return json({ ok: false, code: 'db_error', message: credsError.message }, 500);
  }
  if (!creds?.reset_token_hash || !creds.reset_token_expires_at) {
    return fail('invalid_token', '인증 코드가 유효하지 않습니다.');
  }

  const expiresAt = new Date(creds.reset_token_expires_at);
  if (expiresAt < new Date()) {
    return fail('expired_token', '인증 코드가 만료되었습니다.');
  }

  const tokenHash = await sha256Base64(token);
  if (tokenHash !== creds.reset_token_hash) {
    return fail('invalid_token', '인증 코드가 유효하지 않습니다.');
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await hashPassword(newPassword, saltBytes);
  const passwordSalt = toBase64(saltBytes);

  const { error: updateError } = await supabase
    .from('fc_credentials')
    .update({
      password_hash: passwordHash,
      password_salt: passwordSalt,
      password_set_at: new Date().toISOString(),
      failed_count: 0,
      locked_until: null,
      reset_token_hash: null,
      reset_token_expires_at: null,
    })
    .eq('fc_id', profile.id);

  if (updateError) {
    return json({ ok: false, code: 'db_error', message: updateError.message }, 500);
  }

  return json({ ok: true });
});
