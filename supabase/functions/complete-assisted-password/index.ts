import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import {
  getEnv,
  hashAssistedPasswordChangeNonce,
  parseAssistedPasswordChangeTokenDetailed,
  parseDesignerCompanyNameFromAffiliation,
} from '../_shared/request-board-auth.ts';
import { syncRequestBoardPassword } from '../_shared/request-board-password-sync.ts';

type Payload = {
  token?: string;
  newPassword?: string;
  confirm?: string;
};

type CompletionResult = {
  ok?: boolean;
  fcId?: string;
  phone?: string;
  name?: string;
  affiliation?: string;
};

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const defaultOrigin = allowedOrigins[0] ?? 'https://yourdomain.com';

function resolveCorsOrigin(origin?: string) {
  if (origin && allowedOrigins.includes(origin)) return origin;
  if (origin?.includes('localhost') || origin?.includes('127.0.0.1')) return origin;
  if (origin && allowedOrigins.length === 0) return origin;
  return defaultOrigin;
}

function buildCorsHeaders(origin?: string) {
  return {
    'Access-Control-Allow-Origin': resolveCorsOrigin(origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl) throw new Error('Missing required environment variable: SUPABASE_URL');
if (!serviceKey) throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, serviceKey);
const encoder = new TextEncoder();
const requestBoardPasswordSyncUrl = (getEnv('REQUEST_BOARD_PASSWORD_SYNC_URL') ?? '').trim();
const requestBoardPasswordSyncToken = (getEnv('REQUEST_BOARD_PASSWORD_SYNC_TOKEN') ?? '').trim();
const requestBoardPasswordSyncTimeoutRaw = Number(
  (getEnv('REQUEST_BOARD_PASSWORD_SYNC_TIMEOUT_MS') ?? '5000').trim(),
);
const requestBoardPasswordSyncTimeoutMs =
  Number.isFinite(requestBoardPasswordSyncTimeoutRaw) && requestBoardPasswordSyncTimeoutRaw >= 1000
    ? Math.floor(requestBoardPasswordSyncTimeoutRaw)
    : 5000;

function json(body: Record<string, unknown>, status = 200, origin?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...buildCorsHeaders(origin) },
  });
}

function fail(code: string, message: string, status = 200, origin?: string) {
  return json({ ok: false, code, message }, status, origin);
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(input: string) {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function hashPassword(password: string, saltBytes: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? undefined;
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'Method not allowed', 405, origin);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return fail('invalid_json', 'Invalid JSON', 200, origin);
  }

  const token = String(body.token ?? '').trim();
  const newPassword = String(body.newPassword ?? '').trim();
  const confirm = body.confirm === undefined ? newPassword : String(body.confirm).trim();
  if (!token) {
    return fail('missing_password_change_token', '비밀번호 변경 요청이 없습니다. 다시 로그인해주세요.', 200, origin);
  }
  if (
    newPassword.length < 8
    || newPassword.length > 128
    || !/[A-Za-z]/.test(newPassword)
    || !/[0-9]/.test(newPassword)
    || !/[^A-Za-z0-9]/.test(newPassword)
  ) {
    return fail('weak_password', '새 비밀번호는 8자 이상이며 영문+숫자+특수문자를 포함해야 합니다.', 200, origin);
  }
  if (newPassword !== confirm) {
    return fail('password_mismatch', '새 비밀번호가 일치하지 않습니다.', 200, origin);
  }

  const parsedToken = await parseAssistedPasswordChangeTokenDetailed(token);
  if (parsedToken.ok === false) {
    return fail(parsedToken.code, parsedToken.message, 200, origin);
  }

  const { fcId, phone, nonce } = parsedToken.payload;
  const { data: existingCredential, error: credentialError } = await supabase
    .from('fc_credentials')
    .select('password_hash,password_salt,must_change_password')
    .eq('fc_id', fcId)
    .maybeSingle();

  if (credentialError) {
    reportEdgeDiagnostic({
      event: 'complete_assisted_password.credential_lookup',
      reason: 'lookup_failed',
      errorClass: 'database',
    });
    return fail('db_error', '비밀번호 변경 상태를 확인하지 못했습니다.', 500, origin);
  }
  if (!existingCredential?.must_change_password) {
    return fail('password_change_not_required', '이미 임시 비밀번호 변경을 완료했습니다.', 200, origin);
  }

  let candidateCurrentHash: string;
  try {
    if (
      typeof existingCredential.password_hash !== 'string'
      || typeof existingCredential.password_salt !== 'string'
    ) {
      throw new TypeError('Invalid credential material');
    }
    candidateCurrentHash = await hashPassword(
      newPassword,
      fromBase64(existingCredential.password_salt),
    );
  } catch {
    reportEdgeDiagnostic({
      event: 'complete_assisted_password.credential_lookup',
      reason: 'invalid_credential_material',
      errorClass: 'database',
    });
    return fail('db_error', '비밀번호 변경 상태를 확인하지 못했습니다.', 500, origin);
  }
  if (candidateCurrentHash === existingCredential.password_hash) {
    return fail('password_reuse', '임시 비밀번호와 다른 새 비밀번호를 입력해주세요.', 200, origin);
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await hashPassword(newPassword, saltBytes);
  const passwordSalt = toBase64(saltBytes);
  const nonceHash = await hashAssistedPasswordChangeNonce(nonce);

  const { data, error } = await supabase.rpc(
    'complete_admin_assisted_password_change_v1',
    {
      p_fc_id: fcId,
      p_phone: phone,
      p_nonce_hash: nonceHash,
      p_password_hash: passwordHash,
      p_password_salt: passwordSalt,
    },
  );

  if (error) {
    const isInvalidChallenge = error.message === 'assisted_password_change_invalid_challenge';
    reportEdgeDiagnostic({
      event: 'complete_assisted_password.rpc',
      reason: isInvalidChallenge ? 'challenge_rejected' : 'completion_failed',
      errorClass: 'database',
    });
    return fail(
      isInvalidChallenge ? 'invalid_password_change_token' : 'password_change_failed',
      isInvalidChallenge
        ? '비밀번호 변경 요청이 만료되었거나 이미 사용되었습니다. 다시 로그인해주세요.'
        : '비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.',
      isInvalidChallenge ? 200 : 500,
      origin,
    );
  }

  const result = (Array.isArray(data) ? data[0] : data) as CompletionResult | null;
  if (
    result?.ok !== true
    || result.fcId !== fcId
    || String(result.phone ?? '').replace(/\D/g, '') !== phone
  ) {
    return fail('password_change_failed', '비밀번호 변경 결과를 확인하지 못했습니다.', 500, origin);
  }

  const designerCompanyName = parseDesignerCompanyNameFromAffiliation(result.affiliation);
  await syncRequestBoardPassword({
    syncUrl: requestBoardPasswordSyncUrl,
    syncToken: requestBoardPasswordSyncToken,
    timeoutMs: requestBoardPasswordSyncTimeoutMs,
    logPrefix: 'complete-assisted-password',
    phone,
    password: newPassword,
    options: {
      role: designerCompanyName ? 'designer' : 'fc',
      name: result.name ?? '',
      ...(designerCompanyName ? {} : { affiliation: result.affiliation ?? null }),
      ...(designerCompanyName ? { companyName: designerCompanyName } : {}),
      initiatorRole: 'self',
      syncReason: 'self-reset',
    },
  });

  return json({ ok: true }, 200, origin);
});
