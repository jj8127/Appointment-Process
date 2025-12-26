import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = {
  phone?: string;
  code?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

const supabaseUrl = getEnv('SUPABASE_URL') ?? '';
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(supabaseUrl, serviceKey);
const textEncoder = new TextEncoder();
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 10;

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
  if (!phone) return fail('phone_required', '휴대폰 번호를 입력해주세요.');
  if (phone.length !== 11) return fail('invalid_phone', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
  if (!/^\d{6}$/.test(code)) return fail('invalid_code', '인증 코드는 6자리 숫자여야 합니다.');

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select(
      'id,phone_verification_hash,phone_verification_expires_at,phone_verification_attempts,phone_verification_locked_until',
    )
    .eq('phone', phone)
    .maybeSingle();

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }
  if (!profile?.id) {
    return fail('not_found', '등록된 계정을 찾을 수 없습니다.');
  }
  if (!profile.phone_verification_hash || !profile.phone_verification_expires_at) {
    return fail('no_code', '인증 코드가 없습니다.');
  }
  if (profile.phone_verification_locked_until) {
    const lockedUntil = new Date(profile.phone_verification_locked_until);
    if (lockedUntil > new Date()) {
      return fail('locked', '인증 시도가 너무 많아 잠시 후 다시 시도해주세요.', 429);
    }
  }
  const expiresAt = new Date(profile.phone_verification_expires_at);
  if (expiresAt < new Date()) {
    return fail('expired_code', '인증 코드가 만료되었습니다.');
  }

  const expected = await sha256Base64(`${code}:${phone}`);
  if (expected !== profile.phone_verification_hash) {
    const nextAttempts = (profile.phone_verification_attempts ?? 0) + 1;
    const shouldLock = nextAttempts >= MAX_ATTEMPTS;
    const lockedUntil = shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString() : null;

    await supabase
      .from('fc_profiles')
      .update({
        phone_verification_attempts: shouldLock ? 0 : nextAttempts,
        phone_verification_locked_until: lockedUntil,
      })
      .eq('id', profile.id);

    return fail(
      shouldLock ? 'locked' : 'invalid_code',
      shouldLock ? '인증 시도가 너무 많아 잠시 후 다시 시도해주세요.' : '인증 코드가 올바르지 않습니다.',
      shouldLock ? 429 : 400,
    );
  }

  const { error: updateError } = await supabase
    .from('fc_profiles')
    .update({
      phone_verified: true,
      phone_verified_at: new Date().toISOString(),
      phone_verification_hash: null,
      phone_verification_expires_at: null,
      phone_verification_sent_at: null,
      phone_verification_attempts: 0,
      phone_verification_locked_until: null,
    })
    .eq('id', profile.id);

  if (updateError) {
    return json({ ok: false, code: 'db_error', message: updateError.message }, 500);
  }

  return json({ ok: true });
});
