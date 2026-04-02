import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  buildWorkflowResetPayload,
  mapCommissionToProfileState,
  normalizeCommissionStatus,
  type CommissionCompletionStatus,
} from '../_shared/commission.ts';

type Payload = {
  phone: string;
  password: string;
  confirm?: string;
  // Profile data from signup flow
  name?: string;
  affiliation?: string;
  email?: string;
  carrier?: string;
  commissionStatus?: CommissionCompletionStatus | string;
  referralCode?: string;
  referralInviterFcId?: string;
};

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

type ReferralCaptureResult = {
  ok: boolean;
  rejectionReason: string | null;
  attributionId: string | null;
  reusedHistoricalConfirmedRow: boolean;
  warningReasons: string[];
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

function isNormalizedPhone(input: string): boolean {
  return /^[0-9]{11}$/.test(input);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

function isMissingColumnError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase();
  return (
    code === '42703' ||
    message.includes('column') ||
    message.includes('life_commission_completed') ||
    message.includes('nonlife_commission_completed') ||
    message.includes('hanwha_commission')
  );
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function parseDesignerCompanyNameFromAffiliation(affiliation?: string | null): string | null {
  if (!affiliation) return null;
  const normalized = affiliation.trim();
  if (!normalized) return null;
  const marker = '설계매니저';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return null;

  // e.g. "농협생명 설계매니저" -> "농협생명"
  const company = normalized.slice(0, markerIndex).trim();
  return company.length > 0 ? company : null;
}

function isRequestBoardDesignerAffiliation(affiliation?: string | null): boolean {
  return parseDesignerCompanyNameFromAffiliation(affiliation) !== null;
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
    role?: 'fc' | 'designer';
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
        affiliation: options?.role === 'fc' ? options?.affiliation ?? undefined : undefined,
      }),
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

    if (codeError) {
      console.warn('[set-password] resolveReferralDetails: referral code lookup error', codeError.message);
      return { resolvedReferral: null, rejectionReason: 'code_lookup_failed' };
    }
    if (!referralCodeRow) {
      console.warn('[set-password] resolveReferralDetails: referral code not found or inactive', params.referralCode);
      return { resolvedReferral: null, rejectionReason: 'not_found_or_inactive' };
    }
    if (params.validatedInviterFcId && params.validatedInviterFcId !== referralCodeRow.fc_id) {
      console.warn(
        '[set-password] resolveReferralDetails: inviter hint mismatch, using referral code source of truth',
        JSON.stringify({
          referralCode: params.referralCode,
          validatedInviterFcId: params.validatedInviterFcId,
          resolvedInviterFcId: referralCodeRow.fc_id,
        }),
      );
    }

    const { data: inviterProfile, error: inviterError } = await params.supabase
      .from('fc_profiles')
      .select('phone, name, signup_completed, affiliation')
      .eq('id', referralCodeRow.fc_id)
      .maybeSingle();

    if (inviterError) {
      console.warn('[set-password] resolveReferralDetails: inviter profile lookup error', inviterError.message);
      return { resolvedReferral: null, rejectionReason: 'inviter_profile_lookup_failed' };
    }
    if (!inviterProfile?.phone) {
      console.warn('[set-password] resolveReferralDetails: inviter profile not found or missing phone');
      return { resolvedReferral: null, rejectionReason: 'inviter_profile_missing' };
    }

    if (inviterProfile.signup_completed !== true) {
      console.warn('[set-password] resolveReferralDetails: inviter profile is not signup completed');
      return { resolvedReferral: null, rejectionReason: 'inviter_not_completed' };
    }

    if (isRequestBoardDesignerAffiliation(inviterProfile.affiliation)) {
      console.warn('[set-password] resolveReferralDetails: inviter profile is request-board designer');
      return { resolvedReferral: null, rejectionReason: 'inviter_not_eligible' };
    }

    const inviterPhone = cleanPhone(String(inviterProfile.phone));
    const inviterName = String(inviterProfile?.name ?? '');

    if (!isNormalizedPhone(inviterPhone)) {
      console.warn('[set-password] resolveReferralDetails: inviter phone is not normalized');
      return { resolvedReferral: null, rejectionReason: 'inviter_phone_invalid' };
    }

    if (inviterPhone === params.inviteePhone) {
      console.warn('[set-password] resolveReferralDetails: self-referral detected, skipping');
      return { resolvedReferral: null, rejectionReason: 'self_referral' };
    }

    return {
      resolvedReferral: {
        referralCodeId: referralCodeRow.id,
        referralCode: referralCodeRow.code,
        inviterFcId: referralCodeRow.fc_id,
        inviterPhone,
        inviterName,
      },
      rejectionReason: null,
    };
  } catch (err) {
    console.warn('[set-password] resolveReferralDetails: unexpected error', err instanceof Error ? err.message : String(err));
    return { resolvedReferral: null, rejectionReason: 'unexpected_resolution_error' };
  }
}

async function insertReferralEvent(params: {
  supabase: SupabaseClient;
  eventType: 'signup_completed' | 'referral_confirmed' | 'referral_rejected';
  source: 'manual_entry';
  attributionId?: string | null;
  referralCodeId?: string | null;
  referralCode?: string | null;
  inviterFcId?: string | null;
  inviterPhone?: string | null;
  inviterName?: string | null;
  inviteeFcId?: string | null;
  inviteePhone?: string | null;
  metadata?: Record<string, unknown>;
  logLabel: string;
}): Promise<void> {
  const { error } = await params.supabase
    .from('referral_events')
    .insert({
      attribution_id: params.attributionId ?? null,
      referral_code_id: params.referralCodeId ?? null,
      referral_code: params.referralCode ?? null,
      inviter_fc_id: params.inviterFcId ?? null,
      inviter_phone: params.inviterPhone ?? null,
      inviter_name: params.inviterName ?? null,
      invitee_fc_id: params.inviteeFcId ?? null,
      invitee_phone: params.inviteePhone ?? null,
      event_type: params.eventType,
      source: params.source,
      metadata: params.metadata ?? {},
    });

  if (error) {
    console.warn(`[set-password] ${params.logLabel}: event insert error`, error.message);
  }
}

async function persistRejectedReferralAttribution(params: {
  resolvedReferral: ResolvedReferralDetails;
  inviteePhone: string;
  inviteeFcId: string;
  rejectionReason: string;
  supabase: SupabaseClient;
}): Promise<string | null> {
  const now = new Date().toISOString();
  const rejectedPayload = {
    inviter_fc_id: params.resolvedReferral.inviterFcId,
    inviter_phone: params.resolvedReferral.inviterPhone,
    inviter_name: params.resolvedReferral.inviterName,
    invitee_fc_id: params.inviteeFcId,
    invitee_phone: params.inviteePhone,
    referral_code_id: params.resolvedReferral.referralCodeId,
    referral_code: params.resolvedReferral.referralCode,
    source: 'manual_entry',
    capture_source: 'manual_entry',
    selection_source: 'manual_entry_only',
    status: 'rejected',
    rejection_reason: params.rejectionReason,
    cancelled_at: null,
    confirmed_at: null,
  };

  try {
    const { data: existingRejected, error: existingRejectedError } = await params.supabase
      .from('referral_attributions')
      .select('id')
      .eq('invitee_fc_id', params.inviteeFcId)
      .eq('invitee_phone', params.inviteePhone)
      .eq('referral_code', params.resolvedReferral.referralCode)
      .eq('status', 'rejected')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRejectedError) {
      console.warn(
        '[set-password] persistRejectedReferralAttribution: rejected lookup error',
        existingRejectedError.message,
      );
      return null;
    }

    if (existingRejected?.id) {
      const { error: updateError } = await params.supabase
        .from('referral_attributions')
        .update({
          ...rejectedPayload,
          captured_at: now,
        })
        .eq('id', existingRejected.id);

      if (updateError) {
        console.warn(
          '[set-password] persistRejectedReferralAttribution: rejected update error',
          updateError.message,
        );
        return null;
      }

      return existingRejected.id;
    }

    const { data: insertedRejected, error: insertError } = await params.supabase
      .from('referral_attributions')
      .insert({
        ...rejectedPayload,
        captured_at: now,
      })
      .select('id')
      .maybeSingle();

    if (insertError) {
      console.warn(
        '[set-password] persistRejectedReferralAttribution: rejected insert error',
        insertError.message,
      );
      return null;
    }

    return insertedRejected?.id ?? null;
  } catch (error) {
    console.warn(
      '[set-password] persistRejectedReferralAttribution: unexpected error',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

async function captureReferralAttribution(params: {
  resolvedReferral: ResolvedReferralDetails;
  inviteePhone: string;
  inviteeFcId: string;
  supabase: SupabaseClient;
}): Promise<ReferralCaptureResult> {
  try {
    const {
      referralCodeId,
      referralCode,
      inviterFcId,
      inviterPhone,
      inviterName,
    } = params.resolvedReferral;

    const now = new Date().toISOString();
    const confirmedSelect = 'id, invitee_fc_id, confirmed_at, created_at';
    const { data: confirmedRowsByFc, error: confirmedByFcError } = await params.supabase
      .from('referral_attributions')
      .select(confirmedSelect)
      .eq('status', 'confirmed')
      .eq('invitee_fc_id', params.inviteeFcId)
      .order('confirmed_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (confirmedByFcError) {
      console.warn(
        '[set-password] captureReferralAttribution: confirmed-by-fc lookup error',
        confirmedByFcError.message,
      );
      return {
        ok: false,
        rejectionReason: 'confirmed_lookup_failed',
        attributionId: null,
        reusedHistoricalConfirmedRow: false,
        warningReasons: [],
      };
    }

    const confirmedRows = (confirmedRowsByFc ?? []) as Array<{ id: string; invitee_fc_id: string | null }>;
    const primaryConfirmed = confirmedRows[0] ?? null;
    const otherConfirmedIds = primaryConfirmed ? confirmedRows.slice(1).map((row) => row.id) : [];
    const reusedHistoricalConfirmedRow = confirmedRows.length > 0;
    const warningReasons: string[] = [];
    let attributionId = primaryConfirmed?.id ?? null;

    const confirmedPayload = {
      inviter_fc_id: inviterFcId,
      inviter_phone: inviterPhone,
      inviter_name: inviterName,
      invitee_fc_id: params.inviteeFcId,
      invitee_phone: params.inviteePhone,
      referral_code_id: referralCodeId,
      referral_code: referralCode,
      source: 'manual_entry',
      capture_source: 'manual_entry',
      selection_source: 'manual_entry_only',
      status: 'confirmed',
      cancelled_at: null,
      confirmed_at: now,
    };

    const overrideDuplicateConfirmed = async (duplicateIds: string[]) => {
      if (duplicateIds.length === 0) return null;
      const { error } = await params.supabase
        .from('referral_attributions')
        .update({
          status: 'overridden',
          source: 'manual_entry',
          selection_source: 'manual_entry_only',
          cancelled_at: now,
        })
        .in('id', duplicateIds);
      return error;
    };

    const updateConfirmedRow = async (attributionRowId: string) => {
      const { error } = await params.supabase
        .from('referral_attributions')
        .update(confirmedPayload)
        .eq('id', attributionRowId);
      return error;
    };

    if (primaryConfirmed) {
      const attributionError = await updateConfirmedRow(primaryConfirmed.id);
      if (attributionError) {
        console.warn('[set-password] captureReferralAttribution: attribution update error', attributionError.message);
        return {
          ok: false,
          rejectionReason: 'attribution_update_failed',
          attributionId: null,
          reusedHistoricalConfirmedRow,
          warningReasons: [],
        };
      }
    } else {
      const insertPayload = {
        ...confirmedPayload,
        captured_at: now,
      };
      const { data: attribution, error: attributionError } = await params.supabase
        .from('referral_attributions')
        .insert(insertPayload)
        .select('id')
        .maybeSingle();

      if (attributionError && !isUniqueViolation(attributionError)) {
        console.warn('[set-password] captureReferralAttribution: attribution insert error', attributionError.message);
        return {
          ok: false,
          rejectionReason: 'attribution_insert_failed',
          attributionId: null,
          reusedHistoricalConfirmedRow: false,
          warningReasons: [],
        };
      }

      if (isUniqueViolation(attributionError)) {
        const { data: retriedRows, error: retryLookupError } = await params.supabase
          .from('referral_attributions')
          .select(confirmedSelect)
          .eq('status', 'confirmed')
          .eq('invitee_fc_id', params.inviteeFcId)
          .order('confirmed_at', { ascending: false })
          .order('created_at', { ascending: false });

        if (retryLookupError) {
          console.warn(
            '[set-password] captureReferralAttribution: retry lookup after unique violation failed',
            retryLookupError.message,
          );
          return {
            ok: false,
            rejectionReason: 'confirmed_lookup_failed',
            attributionId: null,
            reusedHistoricalConfirmedRow: false,
            warningReasons: [],
          };
        }

        const retryPrimary = ((retriedRows ?? []) as Array<{ id: string }>)[0];
        if (!retryPrimary?.id) {
          console.warn(
            '[set-password] captureReferralAttribution: unique violation without fc-owned confirmed row; check DB uniqueness rollout or concurrent writes',
          );
          return {
            ok: false,
            rejectionReason: 'attribution_insert_conflict',
            attributionId: null,
            reusedHistoricalConfirmedRow: false,
            warningReasons: ['attribution_insert_conflict'],
          };
        }

        const retryError = await updateConfirmedRow(retryPrimary.id);
        if (retryError) {
          console.warn(
            '[set-password] captureReferralAttribution: retry update after unique violation failed',
            retryError.message,
          );
          return {
            ok: false,
            rejectionReason: 'attribution_update_failed',
            attributionId: null,
            reusedHistoricalConfirmedRow: true,
            warningReasons: [],
          };
        }

        attributionId = retryPrimary.id;
      } else if (!attribution?.id) {
        console.warn('[set-password] captureReferralAttribution: attribution insert returned no id');
        return {
          ok: false,
          rejectionReason: 'attribution_insert_missing_id',
          attributionId: null,
          reusedHistoricalConfirmedRow: false,
          warningReasons: [],
        };
      } else {
        attributionId = attribution.id;
      }
    }

    const overrideError = await overrideDuplicateConfirmed(otherConfirmedIds);
    if (overrideError) {
      console.warn('[set-password] captureReferralAttribution: duplicate override error', overrideError.message);
      warningReasons.push('duplicate_override_failed');
    }

    const { error: recommenderError } = await params.supabase
      .from('fc_profiles')
      .update({ recommender: inviterName, recommender_fc_id: inviterFcId })
      .eq('id', params.inviteeFcId);

    if (recommenderError) {
      console.warn('[set-password] captureReferralAttribution: recommender update error', recommenderError.message);
      warningReasons.push('recommender_update_failed');
    }

    await insertReferralEvent({
      supabase: params.supabase,
      eventType: 'referral_confirmed',
      source: 'manual_entry',
      attributionId,
      referralCodeId,
      referralCode,
      inviterFcId,
      inviterPhone,
      inviterName,
      inviteeFcId: params.inviteeFcId,
      inviteePhone: params.inviteePhone,
      metadata: {
        captureSource: 'set_password_signup',
        selectionSource: 'manual_entry_only',
        reusedHistoricalConfirmedRow,
        warningReasons: warningReasons.length > 0 ? warningReasons : undefined,
      },
      logLabel: 'captureReferralAttribution',
    });

    return {
      ok: true,
      rejectionReason: null,
      attributionId,
      reusedHistoricalConfirmedRow,
      warningReasons,
    };
  } catch (err) {
    console.warn('[set-password] captureReferralAttribution: unexpected error', err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      rejectionReason: 'unexpected_capture_error',
      attributionId: null,
      reusedHistoricalConfirmedRow: false,
      warningReasons: [],
    };
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
    .select('id,name,phone,phone_verified,affiliation,signup_completed,status,identity_completed')
    .eq('phone', phone)
    .maybeSingle();

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }

  // Profile data from signup form
  const profileName = (body.name ?? '').trim();
  const profileAffiliation = (body.affiliation ?? '').trim();
  const profileEmail = (body.email ?? '').trim();
  const profileCarrier = (body.carrier ?? '').trim();
  const commissionStatus = normalizeCommissionStatus(body.commissionStatus);
  const commissionState = mapCommissionToProfileState(commissionStatus);
  const referralCode = (body.referralCode ?? '').trim().toUpperCase();
  const referralInviterFcId = (body.referralInviterFcId ?? '').trim() || null;
  const referralResolution = referralCode
    ? await resolveReferralDetails({
        referralCode,
        inviteePhone: phone,
        validatedInviterFcId: referralInviterFcId,
        supabase,
      })
    : { resolvedReferral: null, rejectionReason: null };
  const resolvedReferral = referralResolution.resolvedReferral;

  if (!profile?.id || profile.phone_verified !== true) {
    return fail('phone_not_verified', '휴대폰 인증이 필요합니다.');
  }

  const fcId = profile.id as string;
  let displayName = profile?.name ?? '';
  let effectiveAffiliation = profile?.affiliation ?? profileAffiliation;

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

  if (profileName) {
    // Update profile with signup form data (in case profile was created by OTP with empty fields)
    // Also reset any stale PII fields that may have been left over from a previously completed profile
    const updatePayload: Record<string, unknown> = {
      status: commissionState.status,
      life_commission_completed: commissionState.lifeCompleted,
      nonlife_commission_completed: commissionState.nonlifeCompleted,
      // 이전 위촉 완료 후 재가입 시 identity 잔여 데이터 초기화
      address: '',
      address_detail: null,
      recommender: null,
      recommender_fc_id: null,
      resident_id_masked: null,
      resident_id_hash: null,
      identity_completed: false,
      temp_id: null,
      allowance_date: null,
      appointment_url: null,
      appointment_date: null,
      ...buildWorkflowResetPayload(),
    };
    if (profileName) updatePayload.name = profileName;
    if (profileAffiliation) updatePayload.affiliation = profileAffiliation;
    if (profileEmail) updatePayload.email = profileEmail;
    if (profileCarrier) updatePayload.carrier = profileCarrier;

    if (Object.keys(updatePayload).length > 0) {
      let updateResult = await supabase.from('fc_profiles').update(updatePayload).eq('id', fcId);
      if (updateResult.error && isMissingColumnError(updateResult.error)) {
        const fallbackPayload = { ...updatePayload };
        delete fallbackPayload.life_commission_completed;
        delete fallbackPayload.nonlife_commission_completed;
        delete fallbackPayload.appointment_schedule_life;
        delete fallbackPayload.appointment_schedule_nonlife;
        delete fallbackPayload.appointment_date_life;
        delete fallbackPayload.appointment_date_nonlife;
        delete fallbackPayload.appointment_date_life_sub;
        delete fallbackPayload.appointment_date_nonlife_sub;
        delete fallbackPayload.appointment_reject_reason_life;
        delete fallbackPayload.appointment_reject_reason_nonlife;
        delete fallbackPayload.docs_deadline_at;
        delete fallbackPayload.docs_deadline_last_notified_at;
        delete fallbackPayload.hanwha_commission_date_sub;
        delete fallbackPayload.hanwha_commission_date;
        delete fallbackPayload.hanwha_commission_reject_reason;
        delete fallbackPayload.hanwha_commission_pdf_path;
        delete fallbackPayload.hanwha_commission_pdf_name;
        updateResult = await supabase.from('fc_profiles').update(fallbackPayload).eq('id', fcId);
      }
      if (updateResult.error) {
        return json({ ok: false, code: 'db_error', message: updateResult.error.message }, 500);
      }
      displayName = profileName || displayName;
      if (profileAffiliation) {
        effectiveAffiliation = profileAffiliation;
      }
    }
  } else {
    const statusOnlyPayload: Record<string, unknown> = {
      status: commissionState.status,
      recommender: null,
      recommender_fc_id: null,
      life_commission_completed: commissionState.lifeCompleted,
      nonlife_commission_completed: commissionState.nonlifeCompleted,
      ...buildWorkflowResetPayload(),
    };
    let statusUpdateResult = await supabase.from('fc_profiles').update(statusOnlyPayload).eq('id', fcId);
    if (statusUpdateResult.error && isMissingColumnError(statusUpdateResult.error)) {
      const fallbackPayload = { ...statusOnlyPayload };
      delete fallbackPayload.life_commission_completed;
      delete fallbackPayload.nonlife_commission_completed;
      delete fallbackPayload.appointment_schedule_life;
      delete fallbackPayload.appointment_schedule_nonlife;
      delete fallbackPayload.appointment_date_life;
      delete fallbackPayload.appointment_date_nonlife;
      delete fallbackPayload.appointment_date_life_sub;
      delete fallbackPayload.appointment_date_nonlife_sub;
      delete fallbackPayload.appointment_reject_reason_life;
      delete fallbackPayload.appointment_reject_reason_nonlife;
      delete fallbackPayload.docs_deadline_at;
      delete fallbackPayload.docs_deadline_last_notified_at;
      delete fallbackPayload.hanwha_commission_date_sub;
      delete fallbackPayload.hanwha_commission_date;
      delete fallbackPayload.hanwha_commission_reject_reason;
      delete fallbackPayload.hanwha_commission_pdf_path;
      delete fallbackPayload.hanwha_commission_pdf_name;
      statusUpdateResult = await supabase.from('fc_profiles').update(fallbackPayload).eq('id', fcId);
    }
    if (statusUpdateResult.error) {
      return json({ ok: false, code: 'db_error', message: statusUpdateResult.error.message }, 500);
    }
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

  if (referralCode) {
    await insertReferralEvent({
      supabase,
      eventType: 'signup_completed',
      source: 'manual_entry',
      referralCode: referralCode || null,
      referralCodeId: resolvedReferral?.referralCodeId ?? null,
      inviterFcId: resolvedReferral?.inviterFcId ?? null,
      inviterPhone: resolvedReferral?.inviterPhone ?? null,
      inviterName: resolvedReferral?.inviterName ?? null,
      inviteeFcId: fcId,
      inviteePhone: phone,
      metadata: {
        captureSource: 'set_password_signup',
        validationOutcome: resolvedReferral ? 'resolved' : 'rejected',
        rejectionReason: resolvedReferral ? null : referralResolution.rejectionReason,
      },
      logLabel: 'set-password',
    });
  }

  const designerCompanyName = parseDesignerCompanyNameFromAffiliation(effectiveAffiliation);
  await syncRequestBoardPassword(phone, password, {
    role: designerCompanyName ? 'designer' : 'fc',
    name: displayName,
    ...(designerCompanyName ? {} : { affiliation: effectiveAffiliation ?? null }),
    ...(designerCompanyName ? { companyName: designerCompanyName } : {}),
  });

  if (resolvedReferral && fcId) {
    const captureResult = await captureReferralAttribution({
      resolvedReferral,
      inviteePhone: phone,
      inviteeFcId: fcId,
      supabase,
    });
    if (!captureResult.ok) {
      const rejectedAttributionId = captureResult.attributionId
        ? null
        : await persistRejectedReferralAttribution({
            resolvedReferral,
            inviteePhone: phone,
            inviteeFcId: fcId,
            rejectionReason: captureResult.rejectionReason ?? 'capture_failed',
            supabase,
          });

      await insertReferralEvent({
        supabase,
        eventType: 'referral_rejected',
        source: 'manual_entry',
        attributionId: captureResult.attributionId ?? rejectedAttributionId,
        referralCodeId: resolvedReferral.referralCodeId,
        referralCode: resolvedReferral.referralCode,
        inviterFcId: resolvedReferral.inviterFcId,
        inviterPhone: resolvedReferral.inviterPhone,
        inviterName: resolvedReferral.inviterName,
        inviteeFcId: fcId,
        inviteePhone: phone,
        metadata: {
          captureSource: 'set_password_signup',
          rejectionReason: captureResult.rejectionReason,
          rejectedAttributionPersisted: Boolean(rejectedAttributionId),
          warningReasons: captureResult.warningReasons.length > 0 ? captureResult.warningReasons : undefined,
        },
        logLabel: 'set-password',
      });
    }
  } else if (referralCode && fcId) {
    await insertReferralEvent({
      supabase,
      eventType: 'referral_rejected',
      source: 'manual_entry',
      referralCode: referralCode || null,
      inviteeFcId: fcId,
      inviteePhone: phone,
      metadata: {
        captureSource: 'set_password_signup',
        rejectionReason: referralResolution.rejectionReason ?? 'unresolved_referral',
      },
      logLabel: 'set-password',
    });
  }

  return json({ ok: true, residentId: phone, displayName });
});
