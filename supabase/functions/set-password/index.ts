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
  commissionStatus?: 'none' | 'life_only' | 'nonlife_only' | 'both' | string;
};

type CommissionCompletionStatus = 'none' | 'life_only' | 'nonlife_only' | 'both';

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

function normalizeCommissionStatus(input?: string): CommissionCompletionStatus {
  if (input === 'life_only' || input === 'nonlife_only' || input === 'both') return input;
  return 'none';
}

function mapCommissionToProfileState(input: CommissionCompletionStatus): {
  status: 'draft' | 'appointment-completed' | 'final-link-sent';
  lifeCompleted: boolean;
  nonlifeCompleted: boolean;
} {
  if (input === 'both') {
    return { status: 'final-link-sent', lifeCompleted: true, nonlifeCompleted: true };
  }
  if (input === 'life_only') {
    return { status: 'appointment-completed', lifeCompleted: true, nonlifeCompleted: false };
  }
  if (input === 'nonlife_only') {
    return { status: 'appointment-completed', lifeCompleted: false, nonlifeCompleted: true };
  }
  return { status: 'draft', lifeCompleted: false, nonlifeCompleted: false };
}

function isMissingColumnError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase();
  return code === '42703' || message.includes('column') || message.includes('life_commission_completed') || message.includes('nonlife_commission_completed');
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

async function syncRequestBoardPassword(phone: string, password: string) {
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
      body: JSON.stringify({ phone, password }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[set-password] request_board sync failed: ${response.status} ${text.slice(0, 200)}`);
      return;
    }

    const json = await response.json().catch(() => ({}));
    if (!json?.success) {
      console.warn(`[set-password] request_board sync error: ${JSON.stringify(json).slice(0, 200)}`);
    }
  } catch (error) {
    console.warn('[set-password] request_board sync error:', error);
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
  const commissionStatus = normalizeCommissionStatus(body.commissionStatus);
  const commissionState = mapCommissionToProfileState(commissionStatus);

  let fcId = profile?.id as string | undefined;
  let displayName = profile?.name ?? '';

  if (!fcId) {
    const insertPayload: Record<string, unknown> = {
      phone,
      name: profileName,
      affiliation: profileAffiliation,
      recommender: profileRecommender,
      email: profileEmail,
      address: '',
      status: commissionState.status,
      identity_completed: false,
      carrier: profileCarrier,
      life_commission_completed: commissionState.lifeCompleted,
      nonlife_commission_completed: commissionState.nonlifeCompleted,
    };

    let insertResult = await supabase
      .from('fc_profiles')
      .insert(insertPayload)
      .select('id,name')
      .maybeSingle();

    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      const fallbackPayload = { ...insertPayload };
      delete fallbackPayload.life_commission_completed;
      delete fallbackPayload.nonlife_commission_completed;
      insertResult = await supabase
        .from('fc_profiles')
        .insert(fallbackPayload)
        .select('id,name')
        .maybeSingle();
    }

    const { data: inserted, error: insertError } = insertResult;

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
    const updatePayload: Record<string, string | boolean> = {
      status: commissionState.status,
      life_commission_completed: commissionState.lifeCompleted,
      nonlife_commission_completed: commissionState.nonlifeCompleted,
    };
    if (profileName) updatePayload.name = profileName;
    if (profileAffiliation) updatePayload.affiliation = profileAffiliation;
    if (profileRecommender) updatePayload.recommender = profileRecommender;
    if (profileEmail) updatePayload.email = profileEmail;
    if (profileCarrier) updatePayload.carrier = profileCarrier;

    if (Object.keys(updatePayload).length > 0) {
      let updateResult = await supabase.from('fc_profiles').update(updatePayload).eq('id', fcId);
      if (updateResult.error && isMissingColumnError(updateResult.error)) {
        const fallbackPayload = { ...updatePayload };
        delete fallbackPayload.life_commission_completed;
        delete fallbackPayload.nonlife_commission_completed;
        updateResult = await supabase.from('fc_profiles').update(fallbackPayload).eq('id', fcId);
      }
      if (updateResult.error) {
        return json({ ok: false, code: 'db_error', message: updateResult.error.message }, 500);
      }
      displayName = profileName || displayName;
    }
  } else {
    const statusOnlyPayload: Record<string, string | boolean> = {
      status: commissionState.status,
      life_commission_completed: commissionState.lifeCompleted,
      nonlife_commission_completed: commissionState.nonlifeCompleted,
    };
    let statusUpdateResult = await supabase.from('fc_profiles').update(statusOnlyPayload).eq('id', fcId);
    if (statusUpdateResult.error && isMissingColumnError(statusUpdateResult.error)) {
      const fallbackPayload = { ...statusOnlyPayload };
      delete fallbackPayload.life_commission_completed;
      delete fallbackPayload.nonlife_commission_completed;
      statusUpdateResult = await supabase.from('fc_profiles').update(fallbackPayload).eq('id', fcId);
    }
    if (statusUpdateResult.error) {
      return json({ ok: false, code: 'db_error', message: statusUpdateResult.error.message }, 500);
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

  await syncRequestBoardPassword(phone, password);

  return json({ ok: true, residentId: phone, displayName });
});
