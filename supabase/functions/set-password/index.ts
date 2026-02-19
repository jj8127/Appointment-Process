import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = {
  phone: string;
  password: string;
  confirm?: string;
  // Profile data from signup flow
  name?: string;
  affiliation?: string;
  recommender?: string;
  email?: string;
  carrier?: string;
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
  const password = (body.password ?? '').trim();
  const confirm = body.confirm?.trim();

  if (phone.length !== 11) {
    return fail('invalid_phone', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
  }
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  if (password.length < 8 || !hasLetter || !hasNumber || !hasSpecial) {
    return fail('weak_password', '비밀번호는 8자 이상이며 영문+숫자+특수문자를 포함해야 합니다.');
  }
  if (confirm !== undefined && password !== confirm) {
    return fail('password_mismatch', '비밀번호가 일치하지 않습니다.');
  }

  // 관리자(총무) 계정 중복 차단
  const { data: adminAccount, error: adminError } = await supabase
    .from('admin_accounts')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (adminError) {
    return json({ ok: false, code: 'db_error', message: adminError.message }, 500);
  }
  if (adminAccount) {
    return fail('already_exists', '해당 번호로 총무 계정이 이미 있습니다.');
  }

  // 본부장 계정 중복 차단
  const { data: managerAccount, error: managerError } = await supabase
    .from('manager_accounts')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (managerError) {
    return json({ ok: false, code: 'db_error', message: managerError.message }, 500);
  }
  if (managerAccount) {
    return fail('already_exists', '해당 번호로 본부장 계정이 이미 있습니다.');
  }

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id,name,phone,phone_verified')
    .eq('phone', phone)
    .maybeSingle();

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }

  // Profile data from signup form
  const profileName = (body.name ?? '').trim();
  const profileAffiliation = (body.affiliation ?? '').trim();
  const profileRecommender = (body.recommender ?? '').trim();
  const profileEmail = (body.email ?? '').trim();
  const profileCarrier = (body.carrier ?? '').trim();

  let fcId = profile?.id as string | undefined;
  let displayName = profile?.name ?? '';

  if (!fcId) {
    const { data: inserted, error: insertError } = await supabase
      .from('fc_profiles')
      .insert({
        phone,
        name: profileName,
        affiliation: profileAffiliation,
        recommender: profileRecommender,
        email: profileEmail,
        address: '',
        status: 'draft',
        identity_completed: false,
        carrier: profileCarrier,
      })
      .select('id,name')
      .maybeSingle();

    if (insertError || !inserted?.id) {
      return json(
        { ok: false, code: 'db_error', message: insertError?.message ?? 'Failed to create profile' },
        500,
      );
    }
    fcId = inserted.id as string;
    displayName = inserted.name ?? '';
  } else if (profileName) {
    // Update profile with signup form data (in case profile was created by OTP with empty fields)
    const updatePayload: Record<string, string> = {};
    if (profileName) updatePayload.name = profileName;
    if (profileAffiliation) updatePayload.affiliation = profileAffiliation;
    if (profileRecommender) updatePayload.recommender = profileRecommender;
    if (profileEmail) updatePayload.email = profileEmail;
    if (profileCarrier) updatePayload.carrier = profileCarrier;

    if (Object.keys(updatePayload).length > 0) {
      await supabase.from('fc_profiles').update(updatePayload).eq('id', fcId);
      displayName = profileName || displayName;
    }
  }
  if (profile?.phone_verified === false) {
    return fail('phone_not_verified', '휴대폰 인증이 필요합니다.');
  }

  const { data: existingCreds, error: credsError } = await supabase
    .from('fc_credentials')
    .select('password_set_at')
    .eq('fc_id', fcId)
    .maybeSingle();

  if (credsError) {
    return json({ ok: false, code: 'db_error', message: credsError.message }, 500);
  }

  if (existingCreds?.password_set_at) {
    return fail('already_set', '이미 비밀번호가 설정되어 있습니다.');
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await hashPassword(password, saltBytes);
  const passwordSalt = toBase64(saltBytes);

  const { error: upsertError } = await supabase
    .from('fc_credentials')
    .upsert(
      {
        fc_id: fcId,
        password_hash: passwordHash,
        password_salt: passwordSalt,
        password_set_at: new Date().toISOString(),
        failed_count: 0,
        locked_until: null,
        reset_token_hash: null,
        reset_token_expires_at: null,
      },
      { onConflict: 'fc_id' },
    );

  if (upsertError) {
    return json({ ok: false, code: 'db_error', message: upsertError.message }, 500);
  }

  // Mark signup as completed
  const { error: profileUpdateError } = await supabase
    .from('fc_profiles')
    .update({ signup_completed: true })
    .eq('id', fcId);

  if (profileUpdateError) {
    return json({ ok: false, code: 'db_error', message: profileUpdateError.message }, 500);
  }

  return json({ ok: true, residentId: phone, displayName });
});
