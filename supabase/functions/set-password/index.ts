import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { normalizeCommissionStatus, type CommissionCompletionStatus } from '../_shared/commission.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import { getEnv } from '../_shared/request-board-auth.ts';
import {
  buildFcPasswordSyncUpstream,
  syncRequestBoardPassword,
} from '../_shared/request-board-password-sync.ts';
import { SIGNUP_CLIENT_HEADERS } from '../_shared/signup-client-observation.ts';

type Payload = {
  phone?: string;
  password?: string;
  confirm?: string;
  completionToken?: string;
  name?: string;
  affiliation?: string;
  email?: string;
  carrier?: string;
  license_statuses?: unknown;
  commissionStatus?: CommissionCompletionStatus | string;
  referralCode?: string;
  referralInviterFcId?: string;
};

type LicenseStatus = 'third' | 'life' | 'nonlife' | 'none';

type ResolvedReferralDetails = {
  referralCodeId: string;
  referralCode: string;
  inviterFcId: string;
  inviterPhone: string;
  inviterName: string;
};

type ReferralResolutionResult = {
  resolvedReferral: ResolvedReferralDetails | null;
  rejectionReason: string | null;
};

type CompleteSignupResult = {
  ok?: boolean;
  code?: string;
  fcId?: string;
  residentId?: string;
  displayName?: string;
  affiliation?: string;
  sessionVersion?: number;
  alreadyApplied?: boolean;
};

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': `Content-Type, Authorization, x-client-info, apikey, ${Object.values(SIGNUP_CLIENT_HEADERS).join(', ')}`,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

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
const LICENSE_STATUS_NONE: LicenseStatus = 'none';
const LICENSE_STATUS_OPTIONS = ['third', 'life', 'nonlife', LICENSE_STATUS_NONE] as const;
const LICENSE_STATUS_LABEL_TO_VALUE: Record<string, LicenseStatus> = {
  '제3 보험': 'third',
  '생명 보험': 'life',
  '손해 보험': 'nonlife',
  없음: 'none',
};
const requestBoardPasswordSyncUrl = (getEnv('REQUEST_BOARD_PASSWORD_SYNC_URL') ?? '').trim();
const requestBoardPasswordSyncV2Url = (getEnv('REQUEST_BOARD_PASSWORD_SYNC_V2_URL') ?? '').trim();
const requestBoardPasswordSyncV2Required = (getEnv('REQUEST_BOARD_PASSWORD_SYNC_V2_REQUIRED') ?? '').trim().toLowerCase() === 'true';
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

function fail(code: string, message: string, status = 400) {
  return json({ ok: false, code, message }, status);
}

function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

function isNormalizedPhone(input: string): boolean {
  return /^01[0-9]{9}$/.test(input);
}

function isLicenseStatus(input: unknown): input is LicenseStatus {
  return LICENSE_STATUS_OPTIONS.includes(input as LicenseStatus);
}

function normalizeLicenseStatuses(input: unknown): LicenseStatus[] {
  const rawValues = Array.isArray(input) ? input : typeof input === 'string' ? [input] : [];
  const selected = new Set(
    rawValues
      .map((value) => {
        if (isLicenseStatus(value)) return value;
        if (typeof value === 'string') return LICENSE_STATUS_LABEL_TO_VALUE[value.trim()];
        return undefined;
      })
      .filter(isLicenseStatus),
  );
  const concreteStatuses = LICENSE_STATUS_OPTIONS.filter(
    (status) => status !== LICENSE_STATUS_NONE && selected.has(status),
  );
  return concreteStatuses.length > 0 ? concreteStatuses : [LICENSE_STATUS_NONE];
}

function mapLegacyCommissionStatusToLicenseStatuses(input?: string | null): LicenseStatus[] {
  switch (normalizeCommissionStatus(input ?? undefined)) {
    case 'life_only':
      return ['life'];
    case 'nonlife_only':
      return ['nonlife'];
    case 'both':
      return ['life', 'nonlife'];
    case 'none':
    default:
      return [LICENSE_STATUS_NONE];
  }
}

function resolveLicenseStatuses(input: unknown, legacyCommissionStatus?: string | null): LicenseStatus[] {
  if (input === undefined || input === null) {
    return mapLegacyCommissionStatusToLicenseStatuses(legacyCommissionStatus);
  }
  return normalizeLicenseStatuses(input);
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return bytesToHex(hash);
}

async function hmacSha256Hex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return bytesToHex(signature);
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

function parseDesignerCompanyNameFromAffiliation(affiliation?: string | null): string | null {
  if (!affiliation) return null;
  const normalized = affiliation.trim();
  if (!normalized) return null;
  const markerIndex = normalized.indexOf('설계매니저');
  if (markerIndex === -1) return null;
  const company = normalized.slice(0, markerIndex).trim();
  return company.length > 0 ? company : null;
}

function isRequestBoardDesignerAffiliation(affiliation?: string | null): boolean {
  return parseDesignerCompanyNameFromAffiliation(affiliation) !== null;
}

async function resolveReferralDetails(params: {
  referralCode: string;
  inviteePhone: string;
  validatedInviterFcId?: string | null;
  supabase: SupabaseClient;
}): Promise<ReferralResolutionResult> {
  try {
    const { data: referralCodeRow, error: codeError } = await params.supabase
      .from('referral_codes')
      .select('id, code, fc_id, is_active')
      .eq('code', params.referralCode)
      .eq('is_active', true)
      .maybeSingle();

    if (codeError || !referralCodeRow) {
      return { resolvedReferral: null, rejectionReason: codeError ? 'code_lookup_failed' : 'not_found_or_inactive' };
    }
    if (params.validatedInviterFcId && params.validatedInviterFcId !== referralCodeRow.fc_id) {
      return { resolvedReferral: null, rejectionReason: 'inviter_hint_mismatch' };
    }

    const { data: inviterProfile, error: inviterError } = await params.supabase
      .from('fc_profiles')
      .select('phone, name, signup_completed, is_manager_referral_shadow, affiliation')
      .eq('id', referralCodeRow.fc_id)
      .maybeSingle();

    if (inviterError || !inviterProfile?.phone) {
      return { resolvedReferral: null, rejectionReason: inviterError ? 'inviter_profile_lookup_failed' : 'inviter_profile_missing' };
    }
    if (inviterProfile.signup_completed !== true && inviterProfile.is_manager_referral_shadow !== true) {
      return { resolvedReferral: null, rejectionReason: 'inviter_not_completed' };
    }
    if (isRequestBoardDesignerAffiliation(inviterProfile.affiliation)) {
      return { resolvedReferral: null, rejectionReason: 'inviter_not_eligible' };
    }

    const inviterPhone = cleanPhone(String(inviterProfile.phone));
    if (!isNormalizedPhone(inviterPhone) || inviterPhone === params.inviteePhone) {
      return {
        resolvedReferral: null,
        rejectionReason: inviterPhone === params.inviteePhone ? 'self_referral' : 'inviter_phone_invalid',
      };
    }

    return {
      resolvedReferral: {
        referralCodeId: String(referralCodeRow.id),
        referralCode: String(referralCodeRow.code),
        inviterFcId: String(referralCodeRow.fc_id),
        inviterPhone,
        inviterName: String(inviterProfile.name ?? ''),
      },
      rejectionReason: null,
    };
  } catch {
    return { resolvedReferral: null, rejectionReason: 'unexpected_resolution_error' };
  }
}

async function insertSignupReferralEvent(params: {
  referral: ResolvedReferralDetails;
  inviteeFcId: string | null;
  inviteePhone: string;
}) {
  const { error } = await supabase.from('referral_events').insert({
    referral_code_id: params.referral.referralCodeId,
    referral_code: params.referral.referralCode,
    inviter_fc_id: params.referral.inviterFcId,
    inviter_phone: params.referral.inviterPhone,
    inviter_name: params.referral.inviterName,
    invitee_fc_id: params.inviteeFcId,
    invitee_phone: params.inviteePhone,
    event_type: 'signup_completed',
    source: 'manual_entry',
    metadata: {
      captureSource: 'set_password_signup',
      validationOutcome: 'resolved',
    },
  });

  if (error) {
    reportEdgeDiagnostic({
      event: 'set_password.referral_event',
      reason: 'insert_failed',
      errorClass: 'database',
    });
  }
}

function readRpcResult(value: unknown): CompleteSignupResult {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object' ? candidate as CompleteSignupResult : {};
}

function rpcFailure(code: string | undefined) {
  switch (code) {
    case 'not_found':
    case 'proof_required':
      return fail('verification_required', '휴대폰 인증을 다시 완료해주세요.', 401);
    case 'proof_invalid':
      return fail('verification_invalid', '휴대폰 인증 정보가 올바르지 않습니다. 다시 인증해주세요.', 401);
    case 'proof_expired':
      return fail('verification_expired', '휴대폰 인증이 만료되었습니다. 다시 인증해주세요.', 401);
    case 'request_conflict':
      return fail('request_conflict', '가입 정보가 변경되었습니다. 휴대폰 인증부터 다시 진행해주세요.', 409);
    case 'already_exists':
      return fail('already_set', '이미 가입된 계정입니다. 로그인해주세요.', 409);
    case 'referral_invalid':
      return fail('referral_invalid', '추천인 정보를 다시 확인해주세요.');
    case 'invalid_request':
      return fail('invalid_request', '가입 정보를 다시 확인해주세요.');
    default:
      return fail('db_error', '회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.', 500);
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405);
  }

  let body: Payload;
  try {
    const parsedBody: unknown = await req.json();
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return fail('invalid_json', '요청 형식이 올바르지 않습니다.');
    }
    body = parsedBody as Payload;
  } catch {
    return fail('invalid_json', '요청 형식이 올바르지 않습니다.');
  }

  // Compatibility window: legacy app builds never sent this field. Keep this
  // branch ahead of every validation, database call, and external side effect.
  if (!Object.prototype.hasOwnProperty.call(body, 'completionToken')) {
    return json({
      ok: false,
      code: 'upgrade_required',
      message: '안전한 회원가입을 위해 모두온 앱을 최신 버전으로 업데이트한 뒤 다시 시도해주세요.',
    }, 200);
  }

  const completionToken = typeof body.completionToken === 'string' ? body.completionToken.trim() : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(completionToken)) {
    return fail('verification_required', '휴대폰 인증을 다시 완료해주세요.', 401);
  }

  const phone = cleanPhone(body.phone ?? '');
  const password = (body.password ?? '').trim();
  const confirm = body.confirm?.trim();
  const profileName = (body.name ?? '').trim();
  const profileAffiliation = (body.affiliation ?? '').trim();
  const profileEmail = (body.email ?? '').trim().toLowerCase();
  const profileCarrier = (body.carrier ?? '').trim();
  const licenseStatuses = resolveLicenseStatuses(body.license_statuses, body.commissionStatus);
  const referralCode = (body.referralCode ?? '').trim().toUpperCase();
  const referralInviterFcId = (body.referralInviterFcId ?? '').trim() || null;

  if (!isNormalizedPhone(phone)) {
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
  if (!referralCode || !referralInviterFcId) {
    return fail('referral_invalid', '유효한 추천인을 선택해야 가입을 완료할 수 있습니다.');
  }

  const referralResolution = await resolveReferralDetails({
    referralCode,
    inviteePhone: phone,
    validatedInviterFcId: referralInviterFcId,
    supabase,
  });
  const resolvedReferral = referralResolution.resolvedReferral;
  if (!resolvedReferral) {
    return fail('referral_invalid', '유효한 추천인을 선택해야 가입을 완료할 수 있습니다.');
  }

  const canonicalRequest = JSON.stringify({
    version: 1,
    phone,
    completionToken,
    password,
    name: profileName,
    affiliation: profileAffiliation,
    email: profileEmail,
    carrier: profileCarrier,
    licenseStatuses,
    referralCode: resolvedReferral.referralCode,
    referralInviterFcId: resolvedReferral.inviterFcId,
  });
  const [completionTokenHash, requestFingerprint] = await Promise.all([
    sha256Hex(`fc-signup-completion-v1:${phone}:${completionToken}`),
    hmacSha256Hex(serviceKey, canonicalRequest),
  ]);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await hashPassword(password, saltBytes);
  const passwordSalt = toBase64(saltBytes);

  const { data, error } = await supabase.rpc('complete_fc_otp_signup_v1', {
    p_phone: phone,
    p_completion_token_hash: completionTokenHash,
    p_request_fingerprint: requestFingerprint,
    p_name: profileName,
    p_affiliation: profileAffiliation,
    p_email: profileEmail,
    p_carrier: profileCarrier,
    p_license_statuses: licenseStatuses,
    p_referral_code: resolvedReferral.referralCode,
    p_referral_inviter_fc_id: resolvedReferral.inviterFcId,
    p_password_hash: passwordHash,
    p_password_salt: passwordSalt,
  });

  if (error) {
    reportEdgeDiagnostic({
      event: 'set_password.complete_signup',
      reason: 'rpc_failed',
      errorClass: 'database',
    });
    return fail('db_error', '회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.', 500);
  }

  const result = readRpcResult(data);
  if (result.ok !== true) {
    return rpcFailure(result.code);
  }

  const residentId = typeof result.residentId === 'string' ? result.residentId : phone;
  const displayName = typeof result.displayName === 'string' ? result.displayName : profileName;
  const effectiveAffiliation = typeof result.affiliation === 'string' ? result.affiliation : profileAffiliation;
  const alreadyApplied = result.alreadyApplied === true;

  // A consumed capability can acknowledge a lost response, but must never
  // replay password sync or any other post-commit side effect.
  if (alreadyApplied) {
    return json({ ok: true, residentId, displayName, alreadyApplied: true });
  }

  const completedProfileId = typeof result.fcId === 'string' ? result.fcId : null;
  const completedSessionVersion = typeof result.sessionVersion === 'number'
    && Number.isSafeInteger(result.sessionVersion)
    && result.sessionVersion >= 0
    ? result.sessionVersion
    : null;
  await insertSignupReferralEvent({
    referral: resolvedReferral,
    inviteeFcId: completedProfileId,
    inviteePhone: phone,
  });

  const designerCompanyName = parseDesignerCompanyNameFromAffiliation(effectiveAffiliation);
  await syncRequestBoardPassword({
    syncUrl: requestBoardPasswordSyncUrl,
    syncV2Url: requestBoardPasswordSyncV2Url,
    requireV2: requestBoardPasswordSyncV2Required,
    syncToken: requestBoardPasswordSyncToken,
    timeoutMs: requestBoardPasswordSyncTimeoutMs,
    logPrefix: 'set-password',
    phone,
    password,
    upstream: buildFcPasswordSyncUpstream(
      completedProfileId,
      completedSessionVersion,
    ),
    options: {
      role: designerCompanyName ? 'designer' : 'fc',
      name: displayName,
      ...(designerCompanyName ? {} : { affiliation: effectiveAffiliation || null }),
      ...(designerCompanyName ? { companyName: designerCompanyName } : {}),
      initiatorRole: 'system',
      syncReason: 'bootstrap',
    },
  });

  return json({ ok: true, residentId, displayName, alreadyApplied });
});
