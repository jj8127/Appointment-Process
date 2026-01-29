import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = {
  phone: string;
  password: string;
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

const MAX_FAILS = 5;
const LOCK_MINUTES = 10;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(code: string, message: string, extra: Record<string, unknown> = {}) {
  return json({ ok: false, code, message, ...extra });
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

async function hashPassword(password: string, saltBase64: string) {
  const saltBytes = fromBase64(saltBase64);
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
  const password = (body.password ?? '').trim();

  if (phone.length !== 11) {
    return fail('invalid_phone', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
  }
  if (!password) {
    return fail('missing_password', '비밀번호를 입력해주세요.');
  }

  const { data: admin, error: adminError } = await supabase
    .from('admin_accounts')
    .select('id,name,phone,password_hash,password_salt,failed_count,locked_until,password_set_at,active')
    .eq('phone', phone)
    .maybeSingle();

  if (adminError) {
    return json({ ok: false, code: 'db_error', message: adminError.message }, 500);
  }

  if (admin?.id) {
    if (!admin.active) {
      return fail('inactive_admin', '관리자 계정이 비활성화되었습니다.', { role: 'admin' });
    }
    if (!admin.password_set_at) {
      return fail('needs_password_setup', '관리자 비밀번호가 아직 설정되지 않았습니다.', { role: 'admin' });
    }

    const now = new Date();
    if (admin.locked_until) {
      const lockedUntil = new Date(admin.locked_until);
      if (lockedUntil > now) {
        return fail('locked', '로그인 시도가 너무 많아 잠시 후 다시 시도해주세요.', {
          lockedUntil: lockedUntil.toISOString(),
          role: 'admin',
        });
      }
    }

    const hashed = await hashPassword(password, admin.password_salt);
    if (hashed !== admin.password_hash) {
      const nextCount = (admin.failed_count ?? 0) + 1;
      const remaining = Math.max(0, MAX_FAILS - nextCount);
      const shouldLock = nextCount >= MAX_FAILS;
      const lockedUntil = shouldLock ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000) : null;

      await supabase
        .from('admin_accounts')
        .update({
          failed_count: shouldLock ? 0 : nextCount,
          locked_until: lockedUntil ? lockedUntil.toISOString() : null,
        })
        .eq('id', admin.id);

      return fail(
        shouldLock ? 'locked' : 'invalid_password',
        shouldLock
          ? '로그인 시도가 너무 많아 잠시 후 다시 시도해주세요.'
          : '비밀번호가 올바르지 않습니다.',
        shouldLock ? { lockedUntil: lockedUntil?.toISOString(), role: 'admin' } : { remaining, role: 'admin' },
      );
    }

    await supabase
      .from('admin_accounts')
      .update({ failed_count: 0, locked_until: null })
      .eq('id', admin.id);

    return json({ ok: true, role: 'admin', residentId: admin.phone, displayName: admin.name ?? '' });
  }

  const { data: manager, error: managerError } = await supabase
    .from('manager_accounts')
    .select('id,name,phone,password_hash,password_salt,failed_count,locked_until,password_set_at,active')
    .eq('phone', phone)
    .maybeSingle();

  if (managerError) {
    return json({ ok: false, code: 'db_error', message: managerError.message }, 500);
  }

  if (manager?.id) {
    if (!manager.active) {
      return fail('inactive_manager', '본부장 계정이 비활성화되었습니다.', { role: 'manager' });
    }
    if (!manager.password_set_at) {
      return fail('needs_password_setup', '본부장 비밀번호가 아직 설정되지 않았습니다.', { role: 'manager' });
    }

    const now = new Date();
    if (manager.locked_until) {
      const lockedUntil = new Date(manager.locked_until);
      if (lockedUntil > now) {
        return fail('locked', '로그인 시도가 너무 많아 잠시 후 다시 시도해주세요.', {
          lockedUntil: lockedUntil.toISOString(),
          role: 'manager',
        });
      }
    }

    const hashed = await hashPassword(password, manager.password_salt);
    if (hashed !== manager.password_hash) {
      const nextCount = (manager.failed_count ?? 0) + 1;
      const remaining = Math.max(0, MAX_FAILS - nextCount);
      const shouldLock = nextCount >= MAX_FAILS;
      const lockedUntil = shouldLock ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000) : null;

      await supabase
        .from('manager_accounts')
        .update({
          failed_count: shouldLock ? 0 : nextCount,
          locked_until: lockedUntil ? lockedUntil.toISOString() : null,
        })
        .eq('id', manager.id);

      return fail(
        shouldLock ? 'locked' : 'invalid_password',
        shouldLock
          ? '로그인 시도가 너무 많아 잠시 후 다시 시도해주세요.'
          : '비밀번호가 올바르지 않습니다.',
        shouldLock ? { lockedUntil: lockedUntil?.toISOString(), role: 'manager' } : { remaining, role: 'manager' },
      );
    }

    await supabase
      .from('manager_accounts')
      .update({ failed_count: 0, locked_until: null })
      .eq('id', manager.id);

    return json({ ok: true, role: 'manager', residentId: manager.phone, displayName: manager.name ?? '' });
  }

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id,name,phone')
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
    .select('password_hash,password_salt,failed_count,locked_until,password_set_at')
    .eq('fc_id', profile.id)
    .maybeSingle();

  if (credsError) {
    return json({ ok: false, code: 'db_error', message: credsError.message }, 500);
  }
  if (!creds?.password_set_at) {
    return fail('needs_password_setup', '비밀번호가 아직 설정되지 않았습니다.');
  }

  const now = new Date();
  if (creds.locked_until) {
    const lockedUntil = new Date(creds.locked_until);
    if (lockedUntil > now) {
      return fail('locked', '로그인 시도가 너무 많아 잠시 후 다시 시도해주세요.', {
        lockedUntil: lockedUntil.toISOString(),
      });
    }
  }

  const hashed = await hashPassword(password, creds.password_salt);
  if (hashed !== creds.password_hash) {
    const nextCount = (creds.failed_count ?? 0) + 1;
    const remaining = Math.max(0, MAX_FAILS - nextCount);
    const shouldLock = nextCount >= MAX_FAILS;
    const lockedUntil = shouldLock ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000) : null;

    await supabase
      .from('fc_credentials')
      .update({
        failed_count: shouldLock ? 0 : nextCount,
        locked_until: lockedUntil ? lockedUntil.toISOString() : null,
      })
      .eq('fc_id', profile.id);

    return fail(
      shouldLock ? 'locked' : 'invalid_password',
      shouldLock
        ? '로그인 시도가 너무 많아 잠시 후 다시 시도해주세요.'
        : '비밀번호가 올바르지 않습니다.',
      shouldLock ? { lockedUntil: lockedUntil?.toISOString() } : { remaining },
    );
  }

  await supabase
    .from('fc_credentials')
    .update({ failed_count: 0, locked_until: null })
    .eq('fc_id', profile.id);

  return json({ ok: true, role: 'fc', residentId: profile.phone, displayName: profile.name ?? '' });
});
