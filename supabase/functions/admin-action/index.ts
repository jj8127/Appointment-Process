import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  canSubmitInsuranceCommission,
  buildWorkflowResetPayload,
  isLegacyAppointmentTerminalStatus,
  hasHanwhaPdfMetadata,
} from '../_shared/commission.ts';
import {
  parseAppSessionTokenDetailed,
  type AppSessionStaffType,
} from '../_shared/request-board-auth.ts';
import type { NotificationTargetV1 } from '../_shared/notification-target.ts';
import { validatePersistedNotificationForDelivery } from '../_shared/persisted-notification-delivery.ts';
import { drainMessengerAttachmentCleanup } from '../_shared/messenger-attachment-service.ts';

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, serviceKey);

const textDecoder = new TextDecoder();
const DAWICHOK_URL_SIGNAL_STATUSES = new Set([
  'docs-approved',
  'hanwha-commission-review',
  'hanwha-commission-rejected',
  'hanwha-commission-approved',
  'appointment-completed',
  'final-link-sent',
]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(message: string, status = 400) {
  return json({ ok: false, message }, status);
}

function hasExistingInsuranceStageActivity(profile: {
  appointment_schedule_life?: string | null;
  appointment_schedule_nonlife?: string | null;
  appointment_date_life_sub?: string | null;
  appointment_date_nonlife_sub?: string | null;
  appointment_reject_reason_life?: string | null;
  appointment_reject_reason_nonlife?: string | null;
  appointment_date_life?: string | null;
  appointment_date_nonlife?: string | null;
  life_commission_completed?: boolean | null;
  nonlife_commission_completed?: boolean | null;
}) {
  return Boolean(
    profile.appointment_schedule_life ||
    profile.appointment_schedule_nonlife ||
    profile.appointment_date_life_sub ||
    profile.appointment_date_nonlife_sub ||
    profile.appointment_reject_reason_life ||
    profile.appointment_reject_reason_nonlife ||
    profile.appointment_date_life ||
    profile.appointment_date_nonlife ||
    profile.life_commission_completed ||
    profile.nonlife_commission_completed,
  );
}

type ActionRequest = {
  adminPhone?: string | null;
  appSessionToken?: string | null;
  action: string;
  payload: Record<string, any>;
};

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

async function importAesKeyForDecrypt(base64Key: string) {
  const raw = fromBase64(base64Key);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
}

async function decrypt(value: string, key: CryptoKey) {
  const parts = value.split('.');
  if (parts.length !== 2) throw new Error('Invalid encrypted value');
  const iv = fromBase64(parts[0]);
  const cipher = fromBase64(parts[1]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
  return textDecoder.decode(plain);
}

async function verifyAdmin(
  phone: string,
  expectedStaffType: AppSessionStaffType,
): Promise<boolean> {
  const phoneCandidates = buildResidentIds(phone);
  const { data, error } = await supabase
    .from('admin_accounts')
    .select('id,active,staff_type')
    .in('phone', phoneCandidates)
    .eq('active', true)
    .maybeSingle();
  if (error || !data?.id) return false;
  const canonicalStaffType: AppSessionStaffType =
    data.staff_type === 'developer' ? 'developer' : 'admin';
  return canonicalStaffType === expectedStaffType;
}

async function resolveActiveAdminActor(
  phone: string,
  expectedStaffType: AppSessionStaffType,
): Promise<{ id: string; staffType: AppSessionStaffType } | null> {
  const phoneCandidates = buildResidentIds(phone);
  const { data, error } = await supabase
    .from('admin_accounts')
    .select('id,active,staff_type')
    .in('phone', phoneCandidates)
    .eq('active', true)
    .maybeSingle();
  if (error || !data?.id) return null;
  const staffType: AppSessionStaffType =
    data.staff_type === 'developer' ? 'developer' : 'admin';
  if (staffType !== expectedStaffType) return null;
  return { id: String(data.id), staffType };
}

async function verifyManager(phone: string): Promise<boolean> {
  const phoneCandidates = buildResidentIds(phone);
  const { data } = await supabase
    .from('manager_accounts')
    .select('id,active')
    .in('phone', phoneCandidates)
    .eq('active', true)
    .maybeSingle();
  return !!data?.id;
}

async function getFcIdsForPhone(phone: string): Promise<string[]> {
  const phoneCandidates = buildResidentIds(phone);
  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id')
    .in('phone', phoneCandidates);
  if (error) throw error;
  return Array.from(
    new Set((data ?? []).map((row: any) => String(row?.id ?? '').trim()).filter(Boolean)),
  );
}

function cleanPhone(input: string | null | undefined): string {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

const NOTIFICATION_DELIVERY_WARNING = 'notification_delivery_incomplete';

type CanonicalFcNotificationTarget =
  | { ok: true; phone: string; actorId: string }
  | { ok: false; reason: 'target_lookup_failed' | 'target_not_found' | 'target_phone_invalid' };

type CanonicalFcPushResult =
  | {
      confirmed: true;
      sent: number;
      pushStatus: 'accepted' | 'no_registered_device';
    }
  | {
      confirmed: false;
      pushStatus: 'provider_failed';
      reason:
        | 'transport_error'
        | 'invalid_response'
        | 'downstream_error'
        | 'not_logged'
        | 'no_device_target';
    };

async function resolveCanonicalFcNotificationTarget(
  fcId: string,
): Promise<CanonicalFcNotificationTarget> {
  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id,phone,signup_completed')
    .eq('id', fcId)
    .maybeSingle();

  if (error) return { ok: false, reason: 'target_lookup_failed' };
  if (!data?.id || data.signup_completed !== true) {
    return { ok: false, reason: 'target_not_found' };
  }

  const phone = cleanPhone(data.phone);
  if (!/^010\d{8}$/.test(phone)) {
    return { ok: false, reason: 'target_phone_invalid' };
  }

  return { ok: true, phone, actorId: String(data.id) };
}

function classifyCanonicalFcPushResponse(
  responseOk: boolean,
  value: unknown,
): CanonicalFcPushResult {
  if (!responseOk || !value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      confirmed: false,
      pushStatus: 'provider_failed',
      reason: responseOk ? 'invalid_response' : 'transport_error',
    };
  }

  const result = value as Record<string, unknown>;
  if (result.logged !== true) {
    return { confirmed: false, pushStatus: 'provider_failed', reason: 'not_logged' };
  }
  const delivery = result.delivery && typeof result.delivery === 'object'
    ? result.delivery as Record<string, unknown>
    : null;
  const pushStatus = delivery?.pushStatus;
  if (
    pushStatus !== 'accepted'
    && pushStatus !== 'no_registered_device'
    && pushStatus !== 'provider_rejected'
  ) {
    return { confirmed: false, pushStatus: 'provider_failed', reason: 'invalid_response' };
  }

  const sent = typeof result.sent === 'number' && Number.isFinite(result.sent)
    ? Math.max(0, Math.trunc(result.sent))
    : 0;
  if (pushStatus === 'provider_rejected') {
    return { confirmed: false, pushStatus: 'provider_failed', reason: 'downstream_error' };
  }
  if (pushStatus !== 'no_registered_device' && sent < 1) {
    return { confirmed: false, pushStatus: 'provider_failed', reason: 'invalid_response' };
  }

  return { confirmed: true, sent, pushStatus };
}

async function sendCanonicalFcPush(input: {
  phone: string;
  title: string;
  body: string;
  url: string | null;
  notificationId: string;
  recipientActorId: string;
  target: NotificationTargetV1;
  category?: string;
}): Promise<CanonicalFcPushResult> {
  const trustedSupabaseUrl = supabaseUrl;
  const trustedServiceKey = serviceKey;
  if (!trustedSupabaseUrl || !trustedServiceKey) {
    return { confirmed: false, pushStatus: 'provider_failed', reason: 'transport_error' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${trustedSupabaseUrl}/functions/v1/fc-notify`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${trustedServiceKey}`,
        'apikey': trustedServiceKey,
      },
      body: JSON.stringify({
        type: 'notify',
        target_role: 'fc',
        target_id: input.phone,
        title: input.title,
        body: input.body,
        category: input.category ?? 'app_event',
        url: input.url ?? undefined,
        notification_id: input.notificationId,
        recipient_actor_id: input.recipientActorId,
        target: input.target,
        skip_notification_insert: true,
      }),
    });
    const data: unknown = await response.json().catch(() => null);
    return classifyCanonicalFcPushResponse(response.ok, data);
  } catch {
    return { confirmed: false, pushStatus: 'provider_failed', reason: 'transport_error' };
  } finally {
    clearTimeout(timeoutId);
  }
}

function trimOrNull(input: string | null | undefined): string | null {
  const trimmed = String(input ?? '').trim();
  return trimmed || null;
}

function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function getKstYmd(reference = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference);
}

function resolveAllowanceStatus(currentStatus: string | null | undefined): string {
  if (!currentStatus || ['draft', 'temp-id-issued', 'allowance-pending', 'allowance-consented'].includes(currentStatus)) {
    return 'allowance-pending';
  }
  return currentStatus;
}

function isAllowanceFlowMutation(status: string, extra?: Record<string, unknown>) {
  if (status === 'allowance-consented') {
    return true;
  }
  if (status !== 'allowance-pending' || !extra) {
    return false;
  }
  return ['allowance_date', 'allowance_prescreen_requested_at', 'allowance_reject_reason'].some((key) =>
    Object.prototype.hasOwnProperty.call(extra, key),
  );
}

function requiresAllowanceDate(status: string, extra?: Record<string, unknown>) {
  if (status === 'allowance-consented') {
    return true;
  }
  if (status !== 'allowance-pending' || !extra) {
    return false;
  }
  const hasRejectReason = String(extra.allowance_reject_reason ?? '').trim().length > 0;
  const hasDateField = Object.prototype.hasOwnProperty.call(extra, 'allowance_date');
  const hasPrescreenRequest = Object.prototype.hasOwnProperty.call(extra, 'allowance_prescreen_requested_at')
    && Boolean(extra.allowance_prescreen_requested_at);
  return !hasRejectReason && (hasDateField || hasPrescreenRequest);
}

function formatPhone(digits: string): string {
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function buildResidentIds(phone: string | null | undefined): string[] {
  const raw = String(phone ?? '').trim();
  const digits = cleanPhone(raw);
  const values = new Set<string>();
  if (digits) values.add(digits);
  if (raw) values.add(raw);
  if (digits) {
    const masked = formatPhone(digits);
    if (masked) values.add(masked);
  }
  return Array.from(values).filter(Boolean);
}

function extractChatUploadPath(fileUrl: string | null | undefined): string | null {
  const raw = String(fileUrl ?? '').trim();
  if (!raw) return null;
  const marker = '/chat-uploads/';
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;
  const withBucket = raw.slice(idx + marker.length);
  const pathOnly = withBucket.split('?')[0] ?? '';
  const normalized = pathOnly.replace(/^\/+/, '');
  return normalized || null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? '').trim())
        .filter(Boolean),
    ),
  );
}

function buildDocWorkflowResetPayload() {
  const resetPayload = buildWorkflowResetPayload();
  delete resetPayload.docs_deadline_at;
  delete resetPayload.docs_deadline_last_notified_at;
  return resetPayload;
}

async function syncProfileAfterDocMutation(fcId: string) {
  const { data: allDocs, error: fetchError } = await supabase
    .from('fc_documents')
    .select('status,storage_path')
    .eq('fc_id', fcId);
  if (fetchError) throw fetchError;

  const docs = allDocs ?? [];
  const allApproved = docs.length > 0 && docs.every((doc) => doc.status === 'approved');

  if (allApproved) {
    const { error: profileError } = await supabase
      .from('fc_profiles')
      .update({ status: 'docs-approved' })
      .eq('id', fcId);
    if (profileError) throw profileError;
    return { allApproved: true };
  }

  const { error: profileError } = await supabase
    .from('fc_profiles')
    .update({
      status: 'docs-pending',
      ...buildDocWorkflowResetPayload(),
    })
    .eq('id', fcId);
  if (profileError) throw profileError;

  return { allApproved: false };
}

async function areAllRequestedDocsApproved(fcId: string) {
  const { data: docs, error } = await supabase
    .from('fc_documents')
    .select('status')
    .eq('fc_id', fcId);
  if (error) throw error;

  const requestedDocs = docs ?? [];
  return requestedDocs.length > 0 && requestedDocs.every((doc) => doc.status === 'approved');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return fail('Method not allowed', 405);
  }

  let body: ActionRequest;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON');
  }

  const { adminPhone, appSessionToken, action, payload } = body;
  if (!action || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('action and payload are required');
  }

  const normalizedBodyPhone = cleanPhone(adminPhone);
  const allowManagerRead = action === 'getResidentNumbers' || action === 'getInviteeReferralCode';
  const allowFcRead = action === 'getResidentNumbers';
  const authHeader = req.headers.get('Authorization') ?? '';
  const isServiceCaller = authHeader === `Bearer ${serviceKey}`;

  let trustedPhone = normalizedBodyPhone;
  let trustedRole: 'admin' | 'manager' | 'fc' | null = null;
  let trustedStaffType: AppSessionStaffType | null = null;
  let trustedFcId: string | null = null;

  if (!isServiceCaller) {
    if (typeof appSessionToken !== 'string' || !appSessionToken.trim()) {
      return fail('Unauthorized: missing or invalid app session token', 401);
    }

    const parsedSession = await parseAppSessionTokenDetailed(appSessionToken.trim());
    if (parsedSession.ok === false) {
      return fail(
        parsedSession.code === 'expired_app_session'
          ? 'Unauthorized: expired app session token'
          : 'Unauthorized: missing or invalid app session token',
        401,
      );
    }

    trustedPhone = cleanPhone(parsedSession.payload.phone);
    trustedRole = parsedSession.payload.role;
    trustedStaffType = parsedSession.payload.role === 'admin'
      ? parsedSession.payload.staffType ?? null
      : null;
    trustedFcId = parsedSession.payload.role === 'fc'
      ? String(parsedSession.payload.fcId ?? '').trim() || null
      : null;

    if (!trustedPhone || !normalizedBodyPhone || trustedPhone !== normalizedBodyPhone) {
      return fail('Unauthorized: actor does not match app session', 403);
    }
    if (trustedRole === 'admin' && !trustedStaffType) {
      return fail('Unauthorized: admin session scope is invalid', 403);
    }
  }

  const isAdmin = isServiceCaller || (
    trustedRole === 'admin'
    && trustedStaffType !== null
    && await verifyAdmin(trustedPhone, trustedStaffType)
  );
  const isManager =
    !isAdmin &&
    allowManagerRead &&
    trustedRole === 'manager' &&
    await verifyManager(trustedPhone);
  const requesterFcIds = !isAdmin && !isManager && allowFcRead
    ? trustedRole === 'fc'
      ? trustedFcId
        ? [trustedFcId]
        : await getFcIdsForPhone(trustedPhone)
      : []
    : [];

  if (!isAdmin && !isManager && allowFcRead && trustedRole === 'fc' && !trustedFcId && requesterFcIds.length !== 1) {
    return fail('Unauthorized: FC session scope is ambiguous. Please sign in again.', 403);
  }
  const isAuthorized =
    isAdmin
    || (allowManagerRead && isManager)
    || (allowFcRead && requesterFcIds.length > 0);

  if (!isAuthorized) {
    return fail(
      allowManagerRead
        ? allowFcRead
          ? 'Unauthorized: not an admin, manager, or FC self'
          : 'Unauthorized: not an admin or manager'
        : 'Unauthorized: not an admin',
      403,
    );
  }

  try {
    // ── getResidentNumbers ──
    if (action === 'getResidentNumbers') {
      const identityKey = getEnv('FC_IDENTITY_KEY');
      if (!identityKey) {
        return fail('Missing FC_IDENTITY_KEY', 500);
      }

      const { fcIds } = payload as { fcIds?: string[] };
      if (!Array.isArray(fcIds) || fcIds.length === 0) return fail('fcIds are required');

      const uniqueFcIds = Array.from(
        new Set(
          fcIds.map((v) => String(v ?? '').trim()).filter(Boolean),
        ),
      );

      if (!isAdmin && !isManager) {
        const allowedIds = new Set(requesterFcIds);
        const outOfScopeId = uniqueFcIds.find((fcId) => !allowedIds.has(fcId));
        if (outOfScopeId) {
          return fail('Unauthorized: FC can only read own resident number', 403);
        }
      }

      const key = await importAesKeyForDecrypt(identityKey);

      const residentNumbers: Record<string, string | null> = {};
      const chunkSize = 100;
      for (let i = 0; i < uniqueFcIds.length; i += chunkSize) {
        const chunk = uniqueFcIds.slice(i, i + chunkSize);
        const { data: rows, error } = await supabase
          .from('fc_identity_secure')
          .select('fc_id,resident_number_encrypted')
          .in('fc_id', chunk);
        if (error) throw error;

        for (const row of rows ?? []) {
          const fcId = (row as any).fc_id as string;
          const enc = (row as any).resident_number_encrypted as string | null;
          if (!fcId || !enc) {
            if (fcId) residentNumbers[fcId] = null;
            continue;
          }

          try {
            const plain = await decrypt(enc, key);
            const digits = plain.replace(/[^0-9]/g, '');
            if (digits.length === 13) {
              residentNumbers[fcId] = `${digits.slice(0, 6)}-${digits.slice(6)}`;
            } else {
              residentNumbers[fcId] = null;
            }
          } catch {
            residentNumbers[fcId] = null;
          }
        }
      }

      // ensure every requested id exists in map
      for (const fcId of uniqueFcIds) {
        if (!(fcId in residentNumbers)) residentNumbers[fcId] = null;
      }

      return json({ ok: true, residentNumbers });
    }

    if (action === 'getInviteeReferralCode') {
      const { fcId } = payload as { fcId?: string };
      if (!fcId) return fail('fcId is required');
      const { data, error } = await supabase
        .rpc('get_invitee_referral_code', { p_fc_id: fcId });
      if (error) throw error;
      return json({ ok: true, referralCode: (data as string | null) ?? null });
    }

    // ── updateProfile ──
    if (action === 'updateProfile') {
      const { fcId, data } = payload as { fcId: string; data: Record<string, any> };
      if (!fcId || !data) return fail('fcId and data are required');
      const { error } = await supabase.from('fc_profiles').update(data).eq('id', fcId);
      if (error) throw error;
      return json({ ok: true });
    }

    // ── updateStatus ──
    if (action === 'updateStatus') {
      const { fcId, status, extra } = payload as {
        fcId: string;
        status: string;
        extra?: Record<string, any>;
      };
      if (!fcId || !status) return fail('fcId and status are required');
      let nextExtra = extra;

      if (isAllowanceFlowMutation(status, nextExtra)) {
        const { data: currentProfile, error: profileError } = await supabase
          .from('fc_profiles')
          .select('allowance_date,temp_id')
          .eq('id', fcId)
          .maybeSingle();
        if (profileError) throw profileError;

        if (!String(currentProfile?.temp_id ?? '').trim() && requiresAllowanceDate(status, nextExtra)) {
          return fail('임시사번 발급 후 보증 보험 동의를 진행할 수 있습니다.');
        }

        const normalizedAllowanceDate = String(nextExtra?.allowance_date ?? currentProfile?.allowance_date ?? '').trim();
        if (!normalizedAllowanceDate && requiresAllowanceDate(status, nextExtra)) {
          return fail('보증보험 조회 동의일을 먼저 입력해주세요.');
        }
        if (normalizedAllowanceDate && !isValidYmd(normalizedAllowanceDate)) {
          return fail('유효한 보증보험 조회 동의일을 입력해주세요.');
        }

        nextExtra = {
          ...(nextExtra ?? {}),
          allowance_date: normalizedAllowanceDate || null,
        };
      }

      if (status === 'docs-approved' && !(await areAllRequestedDocsApproved(fcId))) {
        return fail('모든 요청 서류가 승인된 뒤에만 다위촉 URL 단계로 넘길 수 있습니다.');
      }

      if (status === 'docs-pending') {
        nextExtra = {
          ...(nextExtra ?? {}),
          ...buildDocWorkflowResetPayload(),
        };
      }

      const { error } = await supabase
        .from('fc_profiles')
        .update({ status, ...(nextExtra ?? {}) })
        .eq('id', fcId);
      if (error) throw error;
      return json({ ok: true });
    }

    // ── updateAllowanceDate ──
    if (action === 'updateAllowanceDate') {
      const { fcId, allowanceDate } = payload as {
        fcId?: string;
        allowanceDate?: string | null;
      };
      const normalizedAllowanceDate = String(allowanceDate ?? '').trim();
      if (!fcId || !normalizedAllowanceDate) {
        return fail('fcId and allowanceDate are required');
      }
      if (!isValidYmd(normalizedAllowanceDate)) {
        return fail('유효한 보증보험 조회 동의일을 입력해주세요.');
      }

      const { data: profile, error: profileError } = await supabase
        .from('fc_profiles')
        .select('status,temp_id')
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return fail('Profile not found.', 404);
      if (!String(profile.temp_id ?? '').trim()) {
        return fail('임시사번 발급 후 보증보험 조회 동의일을 저장할 수 있습니다.');
      }

      const nextStatus = resolveAllowanceStatus(profile.status);
      const { error: updateError } = await supabase
        .from('fc_profiles')
        .update({
          allowance_date: normalizedAllowanceDate,
          allowance_prescreen_requested_at: null,
          allowance_reject_reason: null,
          status: nextStatus,
        })
        .eq('id', fcId);
      if (updateError) throw updateError;

      return json({ ok: true, allowance_date: normalizedAllowanceDate, status: nextStatus });
    }

    // ── updateHanwhaSubmissionDate ──
    if (action === 'updateHanwhaSubmissionDate') {
      const { fcId, submittedDate } = payload as {
        fcId?: string;
        submittedDate?: string | null;
      };
      const normalizedSubmittedDate = String(submittedDate ?? '').trim();
      if (!fcId || !normalizedSubmittedDate) {
        return fail('fcId and submittedDate are required');
      }
      if (!isValidYmd(normalizedSubmittedDate)) {
        return fail('Invalid Hanwha submission date.');
      }

      const { data: profile, error: profileError } = await supabase
        .from('fc_profiles')
        .select('status')
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;

      const nextStatus =
        profile?.status === 'hanwha-commission-approved' ||
        profile?.status === 'appointment-completed' ||
        profile?.status === 'final-link-sent'
          ? profile.status
          : 'hanwha-commission-review';

      const { error: updateError } = await supabase
        .from('fc_profiles')
        .update({
          hanwha_commission_date_sub: normalizedSubmittedDate,
          hanwha_commission_reject_reason: null,
          status: nextStatus,
        })
        .eq('id', fcId);
      if (updateError) throw updateError;

      return json({ ok: true, hanwha_commission_date_sub: normalizedSubmittedDate, status: nextStatus });
    }

    // ── markDawichokUrlSent ──
    if (action === 'markDawichokUrlSent') {
      const { fcId } = payload as { fcId?: string };
      if (!fcId) return fail('fcId is required');

      const { data: profile, error: profileError } = await supabase
        .from('fc_profiles')
        .select('status')
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return fail('Profile not found.', 404);
      if (!DAWICHOK_URL_SIGNAL_STATUSES.has(String(profile.status ?? ''))) {
        return fail('서류 승인 후에만 다위촉 URL 발송 신호를 보낼 수 있습니다.');
      }

      const sentAt = new Date().toISOString();
      const sentBy = trustedPhone;
      const { error: updateError } = await supabase
        .from('fc_profiles')
        .update({
          dawichok_url_sent_at: sentAt,
          dawichok_url_sent_by: sentBy,
        })
        .eq('id', fcId);
      if (updateError) throw updateError;

      return json({
        ok: true,
        dawichok_url_sent_at: sentAt,
        dawichok_url_sent_by: sentBy,
      });
    }

    // ── updateHanwhaCommission ──
    if (action === 'updateHanwhaCommission') {
      const { fcId, decision, rejectReason, pdfPath, pdfName, submittedDate } = payload as {
        fcId?: string;
        decision?: 'approve' | 'reject';
        rejectReason?: string | null;
        pdfPath?: string | null;
        pdfName?: string | null;
        submittedDate?: string | null;
      };
      if (!fcId || !decision) return fail('fcId and decision are required');
      if (decision !== 'approve' && decision !== 'reject') {
        return fail('decision must be approve or reject');
      }

      const { data: profile, error: profileError } = await supabase
        .from('fc_profiles')
        .select('status,hanwha_commission_date_sub,hanwha_commission_pdf_path,hanwha_commission_pdf_name')
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) {
        return fail('Profile not found.', 404);
      }
      if (isLegacyAppointmentTerminalStatus(profile.status)) {
        return fail('Legacy appointment-completed rows cannot re-enter Hanwha review.', 409);
      }
      if (!['docs-approved', 'hanwha-commission-review', 'hanwha-commission-rejected', 'hanwha-commission-approved'].includes(String(profile.status ?? ''))) {
        return fail('Hanwha commission can only be processed after docs approval.', 409);
      }
      const normalizedSubmittedDate = trimOrNull(submittedDate);
      if (normalizedSubmittedDate && !isValidYmd(normalizedSubmittedDate)) {
        return fail('Invalid Hanwha submission date.');
      }
      const nextSubmittedDate = normalizedSubmittedDate ?? trimOrNull(profile.hanwha_commission_date_sub);
      if (!nextSubmittedDate) {
        return fail('FC submission date is required before Hanwha review can be processed.', 409);
      }

      if (decision === 'approve') {
        const nextPdfPath = trimOrNull(pdfPath) ?? trimOrNull(profile.hanwha_commission_pdf_path);
        const nextPdfName = trimOrNull(pdfName) ?? trimOrNull(profile.hanwha_commission_pdf_name);
        if (!hasHanwhaPdfMetadata({ hanwha_commission_pdf_path: nextPdfPath, hanwha_commission_pdf_name: nextPdfName })) {
          return fail('Dawichok URL PDF path and name are required for approval.', 409);
        }

        const updatePayload: Record<string, unknown> = {
          hanwha_commission_date: getKstYmd(),
          hanwha_commission_reject_reason: null,
          status: 'hanwha-commission-approved',
          hanwha_commission_pdf_path: nextPdfPath,
          hanwha_commission_pdf_name: nextPdfName,
          hanwha_commission_date_sub: nextSubmittedDate,
        };

        const { error: updateError } = await supabase.from('fc_profiles').update(updatePayload).eq('id', fcId);
        if (updateError) throw updateError;
        return json({ ok: true, status: 'hanwha-commission-approved' });
      }

      const normalizedRejectReason = String(rejectReason ?? '').trim();
      if (!normalizedRejectReason) {
        return fail('rejectReason is required when rejecting Hanwha commission.');
      }

      const updatePayload: Record<string, unknown> = {
        hanwha_commission_date: null,
        hanwha_commission_reject_reason: normalizedRejectReason,
        status: 'hanwha-commission-rejected',
        hanwha_commission_pdf_path: null,
        hanwha_commission_pdf_name: null,
        hanwha_commission_date_sub: nextSubmittedDate,
      };

      const { error: updateError } = await supabase.from('fc_profiles').update(updatePayload).eq('id', fcId);
      if (updateError) throw updateError;
      return json({ ok: true, status: 'hanwha-commission-rejected' });
    }

    // ── updateAppointmentDate ──
    if (action === 'updateAppointmentDate') {
      const { fcId, type, date, isReject, rejectReason } = payload as {
        fcId: string;
        type: 'life' | 'nonlife';
        date: string | null;
        isReject?: boolean;
        rejectReason?: string | null;
      };
      if (!fcId || !type) return fail('fcId and type are required');

      const { data: profile, error: profileError } = await supabase
        .from('fc_profiles')
        .select('status,hanwha_commission_pdf_path,hanwha_commission_pdf_name')
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return fail('Profile not found.', 404);
      if (!canSubmitInsuranceCommission(profile)) {
        return fail(
          'Dawichok URL approval and PDF file are required before updating insurance commission dates.',
          409,
        );
      }

      const field = type === 'life' ? 'appointment_date_life' : 'appointment_date_nonlife';
      const submittedField = type === 'life' ? 'appointment_date_life_sub' : 'appointment_date_nonlife_sub';
      const rejectField = type === 'life' ? 'appointment_reject_reason_life' : 'appointment_reject_reason_nonlife';

      const updatePayload: Record<string, any> = {
        [field]: date,
        [rejectField]: isReject ? rejectReason ?? null : null,
      };
      if (isReject) updatePayload[submittedField] = null;

      const { data: updated, error } = await supabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId)
        .select(
          'appointment_date_life, appointment_date_nonlife, life_commission_completed, nonlife_commission_completed',
        )
        .single();
      if (error) throw error;

      const lifeDone = Boolean(updated?.appointment_date_life || updated?.life_commission_completed);
      const nonlifeDone = Boolean(updated?.appointment_date_nonlife || updated?.nonlife_commission_completed);
      const bothDone = lifeDone && nonlifeDone;
      const currentStatus = String(profile?.status ?? '');
      const preserveLegacyTerminal = isLegacyAppointmentTerminalStatus(currentStatus);
      const nextStatus =
        isReject || date === null
          ? preserveLegacyTerminal
            ? currentStatus
            : 'hanwha-commission-approved'
          : currentStatus === 'final-link-sent'
            ? 'final-link-sent'
            : bothDone
              ? 'final-link-sent'
              : 'appointment-completed';
      const { error: statusErr } = await supabase.from('fc_profiles').update({ status: nextStatus }).eq('id', fcId);
      if (statusErr) throw statusErr;

      return json({ ok: true, status: nextStatus });
    }

    // ── updateAppointmentSchedule ──
    if (action === 'updateAppointmentSchedule') {
      const { fcId, life, nonlife } = payload as {
        fcId: string;
        life?: string | null;
        nonlife?: string | null;
      };
      if (!fcId) return fail('fcId is required');
      const { data: profile, error: profileError } = await supabase
        .from('fc_profiles')
        .select(
          'status,hanwha_commission_pdf_path,hanwha_commission_pdf_name,appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life_sub,appointment_date_nonlife_sub,appointment_reject_reason_life,appointment_reject_reason_nonlife,appointment_date_life,appointment_date_nonlife,life_commission_completed,nonlife_commission_completed',
        )
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return fail('Profile not found.', 404);
      if (!hasExistingInsuranceStageActivity(profile) && !canSubmitInsuranceCommission(profile)) {
        return fail(
          'Dawichok URL approval and PDF file are required before updating insurance schedule.',
          409,
        );
      }
      const updatePayload: Record<string, any> = {};
      if (life !== undefined) updatePayload.appointment_schedule_life = life || null;
      if (nonlife !== undefined) updatePayload.appointment_schedule_nonlife = nonlife || null;
      const { error } = await supabase.from('fc_profiles').update(updatePayload).eq('id', fcId);
      if (error) throw error;
      return json({ ok: true });
    }

    // ── updateDocReqs ──
    if (action === 'updateDocReqs') {
      const { fcId, types, deadline, currentDeadline } = payload as {
        fcId: string;
        types: string[];
        deadline?: string | null;
        currentDeadline?: string | null;
      };
      if (!fcId || !Array.isArray(types)) return fail('fcId and types are required');

      const normalizedDeadline = deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null;
      const shouldResetNotify = normalizedDeadline !== (currentDeadline ?? null);

      const { data: currentDocs, error: fetchErr } = await supabase
        .from('fc_documents')
        .select('doc_type,storage_path')
        .eq('fc_id', fcId);
      if (fetchErr) throw fetchErr;

      if (types.length === 0) {
        await supabase.from('fc_documents').delete().eq('fc_id', fcId);
        await supabase.from('fc_profiles').update({
          status: 'allowance-consented',
          docs_deadline_at: null,
          docs_deadline_last_notified_at: null,
        }).eq('id', fcId);
        return json({ ok: true });
      }

      const currentTypes = (currentDocs ?? []).map((d) => d.doc_type);
      const toDelete = (currentDocs ?? [])
        .filter((d) => !types.includes(d.doc_type) && (!d.storage_path || d.storage_path === 'deleted'))
        .map((d) => d.doc_type);
      const toAdd = types.filter((t) => !currentTypes.includes(t));

      if (toDelete.length) {
        await supabase.from('fc_documents').delete().eq('fc_id', fcId).in('doc_type', toDelete);
      }
      if (toAdd.length) {
        const rows = toAdd.map((t) => ({
          fc_id: fcId,
          doc_type: t,
          status: 'pending',
          file_name: '',
          storage_path: '',
        }));
        const { error: insertErr } = await supabase.from('fc_documents').insert(rows);
        if (insertErr) throw insertErr;
      }

      const profileUpdate: Record<string, string | null> = {
        docs_deadline_at: normalizedDeadline,
      };
      if (shouldResetNotify) profileUpdate.docs_deadline_last_notified_at = null;
      const { error: profileError } = await supabase
        .from('fc_profiles')
        .update({ status: 'docs-requested', ...profileUpdate })
        .eq('id', fcId);
      if (profileError) throw profileError;

      return json({ ok: true });
    }

    // ── updateDocStatus ──
    if (action === 'updateDocStatus') {
      const { fcId, docType, status, reviewerNote } = payload as {
        fcId: string;
        docType: string;
        status: string;
        reviewerNote?: string | null;
      };
      if (!fcId || !docType || !status) return fail('fcId, docType, and status are required');
      if (!['pending', 'approved', 'rejected'].includes(status)) return fail('status must be pending, approved, or rejected');
      if (status === 'rejected' && !String(reviewerNote ?? '').trim()) {
        return fail('Reject reason is required.');
      }

      const { data: doc, error: docError } = await supabase
        .from('fc_documents')
        .select('storage_path')
        .eq('fc_id', fcId)
        .eq('doc_type', docType)
        .maybeSingle();
      if (docError) throw docError;
      if (!doc) return fail('Document row not found');

      const isNoFileDoc = !doc.storage_path || doc.storage_path === 'deleted';
      const normalizedReviewerNote = String(reviewerNote ?? '').trim();
      const updatePayload: Record<string, any> = { status };
      if (normalizedReviewerNote) {
        updatePayload.reviewer_note = normalizedReviewerNote;
      } else if (status === 'approved' && isNoFileDoc) {
        updatePayload.reviewer_note = '총무 수동 승인: 파일 미제출';
      } else if (status === 'pending') {
        updatePayload.reviewer_note = null;
      }
      const { error } = await supabase
        .from('fc_documents')
        .update(updatePayload)
        .eq('fc_id', fcId)
        .eq('doc_type', docType);
      if (error) throw error;

      const { allApproved } = await syncProfileAfterDocMutation(fcId);
      return json({ ok: true, allApproved });
    }

    // ── deleteDocFile ──
    if (action === 'deleteDocFile') {
      const { fcId, docType, storagePath } = payload as {
        fcId: string;
        docType: string;
        storagePath?: string | null;
      };
      if (!fcId || !docType) return fail('fcId and docType are required');

      if (storagePath) {
        const { error: storageErr } = await supabase.storage.from('fc-documents').remove([storagePath]);
        if (storageErr) throw storageErr;
      }
      const { error } = await supabase
        .from('fc_documents')
        .update({ storage_path: 'deleted', file_name: 'deleted.pdf', status: 'pending', reviewer_note: null })
        .eq('fc_id', fcId)
        .eq('doc_type', docType);
      if (error) throw error;
      await syncProfileAfterDocMutation(fcId);
      return json({ ok: true });
    }

    // ── upsertExamRound ──
    if (action === 'upsertExamRound') {
      const { roundId, data, locations } = payload as {
        roundId?: string | null;
        data: {
          exam_type: 'life' | 'nonlife';
          exam_date: string | null;
          registration_deadline: string;
          round_label?: string | null;
          notes?: string | null;
        };
        locations?: { location_name: string; sort_order?: number }[];
      };
      if (!data?.exam_type || !data?.registration_deadline) {
        return fail('exam_type and registration_deadline are required');
      }

      const safeLocations = (locations ?? [])
        .map((loc) => ({
          location_name: (loc.location_name ?? '').trim(),
          sort_order: Number.isFinite(loc.sort_order as number) ? Number(loc.sort_order) : 0,
        }))
        .filter((loc) => Boolean(loc.location_name))
        .sort((left, right) =>
          left.sort_order - right.sort_order
          || left.location_name.localeCompare(right.location_name)
        );

      const { data: targetRoundId, error: saveError } = await supabase.rpc(
        'save_exam_round_atomic',
        {
          p_round_id: roundId ?? null,
          p_exam_date: data.exam_date ?? null,
          p_registration_deadline: data.registration_deadline,
          p_round_label: data.round_label ?? null,
          p_exam_type: data.exam_type,
          p_notes: data.notes ?? null,
          p_locations: safeLocations.map((location) => location.location_name),
        },
      );
      if (saveError) throw saveError;
      if (typeof targetRoundId !== 'string' || !targetRoundId) {
        return fail('exam round save did not return an id', 500);
      }

      return json({ ok: true, roundId: targetRoundId });
    }

    // ── deleteExamRound ──
    if (action === 'deleteExamRound') {
      const { roundId } = payload as { roundId: string };
      if (!roundId) return fail('roundId is required');

      const { count: registrationCount, error: registrationCountError } = await supabase
        .from('exam_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('round_id', roundId);
      if (registrationCountError) throw registrationCountError;
      if ((registrationCount ?? 0) > 0) {
        return fail('Registration-bearing exam rounds cannot be deleted.', 409);
      }
      await supabase.from('exam_locations').delete().eq('round_id', roundId);

      const { error: deleteRoundErr } = await supabase
        .from('exam_rounds')
        .delete()
        .eq('id', roundId);
      if (deleteRoundErr) throw deleteRoundErr;

      return json({ ok: true });
    }

    // ── transitionExamRegistration / legacy deleteExamRegistration ──
    if (action === 'transitionExamRegistration' || action === 'deleteExamRegistration') {
      const {
        registrationId,
        transition,
        reason,
      } = payload as {
        registrationId?: string;
        transition?: 'confirm' | 'unconfirm' | 'reject' | 'cancel_by_admin';
        reason?: string | null;
      };
      const normalizedRegistrationId = String(registrationId ?? '').trim();
      if (!normalizedRegistrationId) return fail('registrationId is required');

      if (trustedRole !== 'admin' || trustedStaffType === null) {
        return fail('Unauthorized: an active admin session is required', 403);
      }
      const actor = await resolveActiveAdminActor(trustedPhone, trustedStaffType);
      if (!actor) return fail('Unauthorized: inactive admin actor', 403);

      const requestedTransition =
        action === 'deleteExamRegistration' ? 'cancel_by_admin' : transition;
      if (!['confirm', 'unconfirm', 'reject', 'cancel_by_admin'].includes(String(requestedTransition ?? ''))) {
        return fail('invalid exam transition');
      }
      const normalizedReason = String(reason ?? '').trim();
      if (
        requestedTransition === 'reject'
        && (normalizedReason.length < 1 || normalizedReason.length > 1000)
      ) {
        return fail('reject reason must be between 1 and 1000 characters');
      }

      const { data, error } = await supabase.rpc('transition_exam_registration', {
        p_registration_id: normalizedRegistrationId,
        p_action: requestedTransition,
        p_actor_type: actor.staffType,
        p_actor_admin_id: actor.id,
        p_actor_fc_id: null,
        p_reason: requestedTransition === 'reject' ? normalizedReason : null,
      });
      if (error) {
        const status = error.message === 'exam_registration_not_found' ? 404 : 409;
        return fail(error.message || 'exam transition failed', status);
      }

      const result = Array.isArray(data) ? data[0] : data;
      const proofPath = String(result?.proof_path ?? '').trim();
      let cleanupWarning = false;
      if (proofPath) {
        const { error: cleanupError } = await supabase.storage
          .from('exam-payment-proofs')
          .remove([proofPath]);
        cleanupWarning = Boolean(cleanupError);
      }

      const targetPhone = cleanPhone(String(result?.target_resident_id ?? ''));
      let notificationDelivery: {
        notificationStored: boolean;
        pushStatus: 'accepted' | 'no_registered_device' | 'provider_rejected' | 'not_attempted';
        retryable: boolean;
        notificationId?: string;
      } = {
        notificationStored: false,
        pushStatus: 'not_attempted',
        retryable: true,
      };
      if (targetPhone) {
        const targetUrl = result?.exam_type === 'nonlife' ? '/exam-apply2' : '/exam-apply';
        const examTarget: NotificationTargetV1 = {
          version: 1,
          kind: 'exam',
          examType: result?.exam_type === 'nonlife' ? 'nonlife' : 'life',
          examRegistrationId: normalizedRegistrationId,
        };
        const title = requestedTransition === 'reject'
          ? '시험 접수가 반려되었습니다.'
          : requestedTransition === 'confirm'
            ? '시험 접수가 승인되었습니다.'
            : requestedTransition === 'unconfirm'
              ? '시험 접수 승인이 취소되었습니다.'
              : '시험 접수가 취소되었습니다.';
        const notificationBody = requestedTransition === 'reject'
          ? `${title} 사유: ${normalizedReason}`
          : title;
        const notificationId = String(result?.notification_id ?? '').trim();
        const recipientActorId = String(result?.recipient_actor_id ?? '').trim();
        if (notificationId && recipientActorId) {
          const { data: persistedNotification, error: persistedLookupError } = await supabase
            .from('notifications')
            .select('id,target,recipient_role,recipient_actor_id,resident_id')
            .eq('id', notificationId)
            .maybeSingle();
          const persisted = persistedLookupError
            ? { ok: false as const, reason: 'notification_lookup_failed' as const }
            : validatePersistedNotificationForDelivery(persistedNotification, {
                target: examTarget,
                recipientRole: 'fc',
                recipientActorId,
                residentId: targetPhone,
              });
          if (persisted.ok) {
            const push = await sendCanonicalFcPush({
              phone: targetPhone,
              title,
              body: notificationBody,
              url: targetUrl,
              notificationId: persisted.notificationId,
              recipientActorId,
              target: examTarget,
              category: 'exam_apply',
            });
            notificationDelivery = {
              notificationStored: true,
              pushStatus: push.confirmed ? push.pushStatus : 'provider_rejected',
              retryable: !push.confirmed,
              notificationId: persisted.notificationId,
            };
          }
        }
      }

      return json({
        ok: true,
        status: String(result?.status ?? ''),
        cleanupWarning,
        delivery: notificationDelivery,
        warning: notificationDelivery.notificationStored
          ? null
          : NOTIFICATION_DELIVERY_WARNING,
      });
    }

    // ── deleteFc ──
    if (action === 'deleteFc') {
      const { fcId } = payload as { fcId: string };
      if (!fcId) return fail('fcId is required');

      const { data, error } = await supabase.rpc(
        'delete_account_core_transaction_v1',
        {
          p_target_role: 'fc',
          p_target_id: fcId,
        },
      );
      if (error) return fail(error.message || 'account deletion failed', 409);

      const result = (data ?? {}) as Record<string, unknown>;
      const proofPaths = readStringArray(result.proof_paths);
      const documentPaths = readStringArray(result.document_paths);
      const boardPaths = readStringArray(result.board_attachment_paths);
      const chatPaths = readStringArray(result.chat_file_urls)
        .map(extractChatUploadPath)
        .filter((path): path is string => Boolean(path));
      const authUserIds = readStringArray(result.auth_user_ids);
      const cleanupOutboxId = String(result.cleanup_outbox_id ?? '').trim();

      const cleanupResults = await Promise.all([
        proofPaths.length > 0
          ? supabase.storage.from('exam-payment-proofs').remove(proofPaths)
          : Promise.resolve({ error: null }),
        documentPaths.length > 0
          ? supabase.storage.from('fc-documents').remove(documentPaths)
          : Promise.resolve({ error: null }),
        boardPaths.length > 0
          ? supabase.storage.from('board-attachments').remove(boardPaths)
          : Promise.resolve({ error: null }),
        chatPaths.length > 0
          ? supabase.storage.from('chat-uploads').remove(chatPaths)
          : Promise.resolve({ error: null }),
      ]);

      let authCleanupWarning = false;
      for (const authUserId of authUserIds) {
        const { error: authError } = await supabase.auth.admin.deleteUser(authUserId);
        if (authError) authCleanupWarning = true;
      }

      const postCommitCleanupFailed =
        cleanupResults.some((cleanup) => Boolean(cleanup.error))
        || authCleanupWarning;
      // Attachment rows enqueue their own durable two-phase cleanup from the
      // account-delete trigger. Draining is best-effort and never becomes a
      // user-facing warning because the account transaction already committed.
      await drainMessengerAttachmentCleanup({
        supabase,
        limit: 100,
      });
      const { error: outboxError } = cleanupOutboxId
        ? await supabase.rpc('record_account_deletion_cleanup_attempt_v1', {
          p_outbox_id: cleanupOutboxId,
          p_succeeded: !postCommitCleanupFailed,
          p_error_code: postCommitCleanupFailed
            ? 'post_commit_cleanup_partial_failure'
            : null,
        })
        : { error: new Error('cleanup_outbox_id_missing') };

      return json({
        ok: true,
        cleanupWarning:
          postCommitCleanupFailed
          || Boolean(outboxError),
      });
    }

    // ── sendNotification ──
    if (action === 'sendNotification') {
      const { fcId, title, body: notifBody, url } = payload as {
        fcId?: string;
        title: string;
        body: string;
        url?: string;
      };
      if (!fcId || !title || !notifBody) return fail('fcId, title, and body are required');

      const target = await resolveCanonicalFcNotificationTarget(fcId);
      if (target.ok === false) {
        return json({
          ok: false,
          confirmed: false,
          inboxRecorded: false,
          push: {
            confirmed: false,
            pushStatus: 'provider_failed',
            reason: 'invalid_response',
          },
          delivery: {
            notificationStored: false,
            pushStatus: 'not_attempted',
            retryable: false,
          },
          warning: null,
          reason: target.reason,
          message: 'Notification recipient is invalid',
        }, target.reason === 'target_lookup_failed' ? 500 : 404);
      }

      const insertPayload = {
        title,
        body: notifBody,
        category: 'app_event',
        recipient_role: 'fc',
        resident_id: target.phone,
        recipient_actor_id: fcId,
        target: {
          version: 1,
          kind: 'fc_profile',
          fcId,
        } satisfies NotificationTargetV1,
      } as const;

      const { data: insertedNotification, error: insertError } = await supabase
        .from('notifications')
        .insert({
          ...insertPayload,
          target_url: url ?? null,
        })
        .select('id,target,recipient_role,recipient_actor_id,resident_id')
        .single();

      const persisted = insertError
        ? { ok: false as const, reason: 'notification_insert_failed' as const }
        : validatePersistedNotificationForDelivery(insertedNotification, {
            target: insertPayload.target,
            recipientRole: 'fc',
            recipientActorId: target.actorId,
            residentId: target.phone,
          });
      const inboxRecorded = persisted.ok;
      const push = persisted.ok
        ? await sendCanonicalFcPush({
            phone: target.phone,
            title,
            body: notifBody,
            url: trimOrNull(url),
            notificationId: persisted.notificationId,
            recipientActorId: target.actorId,
            target: insertPayload.target,
          })
        : {
            confirmed: false,
            pushStatus: 'provider_failed',
            reason: 'not_logged',
          } as CanonicalFcPushResult;

      return json({
        ok: inboxRecorded,
        confirmed: inboxRecorded,
        inboxRecorded,
        push,
        delivery: {
          notificationStored: inboxRecorded,
          pushStatus: !inboxRecorded
            ? 'not_attempted'
            : push.confirmed
              ? push.pushStatus
              : 'provider_rejected',
          retryable: !inboxRecorded || !push.confirmed,
          ...(persisted.ok ? { notificationId: persisted.notificationId } : {}),
        },
        warning: inboxRecorded ? null : NOTIFICATION_DELIVERY_WARNING,
        ...(!inboxRecorded
          ? { message: 'Notification inbox persistence was not confirmed' }
          : {}),
      }, inboxRecorded ? 200 : 500);
    }

    return fail('Unknown action');
  } catch (err: any) {
    return json({ ok: false, message: err?.message ?? 'Request failed' }, 500);
  }
});
