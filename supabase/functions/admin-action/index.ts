import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  canSubmitInsuranceCommission,
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
import { fcRetirementBlockedResponse, retireFcBeforeAccountDeletion } from '../_shared/request-board-fc-retirement.ts';
import {
  buildFcDocWorkflowResetPayload,
  isFcStatus,
  parseFcStatusUpdateExtra,
} from '../../../lib/fc-status.ts';
import { buildSupabaseMutationReceiptSelect } from '../../../lib/supabase-query-contract.ts';
import {
  requireAccountDeletionReceipt,
  requireCreationReceipt,
  requireDocumentReceipt,
  requireExamDeletionReceipt,
  requireExamTransitionReceipt,
  requireMutationRowReceipt,
} from '../_shared/ux-mutation-contract.ts';

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
  if (!Array.isArray(data)) throw new Error('fc_profile_scope_query_contract_invalid');
  return Array.from(
    new Set(data.map((row: any) => String(row?.id ?? '').trim()).filter(Boolean)),
  );
}

function cleanPhone(input: string | null | undefined): string {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

const FC_BASIC_INFORMATION_FIELDS = new Set([
  'name',
  'affiliation',
  'email',
  'carrier',
]);

type FcBasicInformationPatchResult =
  | { ok: true; patch: Record<string, string> }
  | { ok: false; message: string };

function normalizeFcBasicInformationPatch(input: unknown): FcBasicInformationPatchResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '수정할 기본 정보가 올바르지 않습니다.' };
  }

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.some(([key]) => !FC_BASIC_INFORMATION_FIELDS.has(key))) {
    return { ok: false, message: '수정할 수 없는 기본 정보가 포함되어 있습니다.' };
  }

  const patch: Record<string, string> = {};
  for (const [key, rawValue] of entries) {
    if (typeof rawValue !== 'string') {
      return { ok: false, message: '기본 정보는 문자열로 입력해주세요.' };
    }

    const value = rawValue.trim();
    if (!value) {
      return { ok: false, message: '기본 정보의 필수 항목은 비워둘 수 없습니다.' };
    }
    if ((key === 'name' && value.length > 100) || value.length > 254) {
      return { ok: false, message: '기본 정보 입력값이 너무 깁니다.' };
    }
    if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { ok: false, message: '유효한 이메일을 입력해주세요.' };
    }

    patch[key] = value;
  }

  return { ok: true, patch };
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

function isCanonicalYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isCanonicalMonthStart(value: string): boolean {
  return /^\d{4}-\d{2}-01$/.test(value) && isCanonicalYmd(value);
}

function examMonthFromDate(value: string): string {
  return `${value.slice(0, 7)}-01`;
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

async function syncProfileAfterDocMutation(fcId: string) {
  const { data: allDocs, error: fetchError } = await supabase
    .from('fc_documents')
    .select('status,storage_path')
    .eq('fc_id', fcId);
  if (fetchError) throw fetchError;
  if (!Array.isArray(allDocs)) throw new Error('fc_document_query_contract_invalid');

  const docs = allDocs;
  const allApproved = docs.length > 0 && docs.every((doc) => doc.status === 'approved');

  const updatePayload = allApproved
    ? { status: 'docs-approved' }
    : {
      status: 'docs-pending',
      ...buildFcDocWorkflowResetPayload(),
    };
  const { data: updatedProfile, error: profileError } = await supabase
    .from('fc_profiles')
    .update(updatePayload)
    .eq('id', fcId)
    .select(buildSupabaseMutationReceiptSelect(updatePayload))
    .maybeSingle();
  if (profileError) throw profileError;
  requireMutationRowReceipt(updatedProfile, { ...updatePayload, id: fcId });

  return { allApproved };
}

async function areAllRequestedDocsApproved(fcId: string) {
  const { data: docs, error } = await supabase
    .from('fc_documents')
    .select('status')
    .eq('fc_id', fcId);
  if (error) throw error;

  if (!Array.isArray(docs)) throw new Error('fc_document_query_contract_invalid');
  const requestedDocs = docs;
  return requestedDocs.length > 0 && requestedDocs.every((doc) => doc.status === 'approved');
}

/** DB commit owns the outcome. Physical files are retryable, bounded post-commit cleanup. */
async function drainDocumentCleanup(fcId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('fc_document_cleanup_queue').select('storage_path').eq('fc_id', fcId).limit(20);
    if (error) return true;
    if (!Array.isArray(data)) return true;
    for (const row of data) {
      const result = await supabase.storage.from('fc-documents').remove([row.storage_path]);
      if (!result.error) await supabase.from('fc_document_cleanup_queue').delete().eq('fc_id', fcId).eq('storage_path', row.storage_path);
    }
    const { count, error: countError } = await supabase.from('fc_document_cleanup_queue').select('storage_path', { count: 'exact', head: true }).eq('fc_id', fcId);
    return !!countError || !Number.isSafeInteger(count) || count === null || count < 0 || count > 0;
  } catch { return true; }
}

async function assertDocumentCleanupScope(phone: string, role: 'admin' | 'fc', fcId: string) {
  const { error } = await supabase.rpc('assert_ux_mutation_actor_v1', {
    p_phone: phone, p_role: role, p_fc_id: fcId,
  });
  if (error) throw error;
}

async function getDocumentCleanupPending(fcId: string): Promise<boolean> {
  const { count, error } = await supabase.from('fc_document_cleanup_queue')
    .select('storage_path', { count: 'exact', head: true }).eq('fc_id', fcId);
  if (error || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw error ?? new Error('cleanup_state_unverified');
  return count > 0;
}

const FC_DOCUMENTS_BUCKET = 'fc-documents';
const FC_DOCUMENT_SIGNED_URL_SECONDS = 300;

/** Exact stored values only: callers echo storage_path and doc_type as read, and receipts compare them. */
function readFcDocumentField(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= maxLength ? value : null;
}

/** A path is signable only while an FC document row or that FC's Hanwha PDF field names it. */
async function findFcDocumentPathOwner(storagePath: string, fcId?: string): Promise<string | null> {
  let documentQuery = supabase.from('fc_documents').select('fc_id').eq('storage_path', storagePath);
  if (fcId) documentQuery = documentQuery.eq('fc_id', fcId);
  const { data: documents, error: documentError } = await documentQuery.limit(1);
  if (documentError) throw documentError;
  if (!Array.isArray(documents)) throw new Error('fc_document_query_contract_invalid');
  if (documents[0]?.fc_id) return String(documents[0].fc_id);

  let profileQuery = supabase.from('fc_profiles').select('id').eq('hanwha_commission_pdf_path', storagePath);
  if (fcId) profileQuery = profileQuery.eq('id', fcId);
  const { data: profiles, error: profileError } = await profileQuery.limit(1);
  if (profileError) throw profileError;
  if (!Array.isArray(profiles)) throw new Error('fc_profile_query_contract_invalid');
  return profiles[0]?.id ? String(profiles[0].id) : null;
}

async function signFcDocumentPath(storagePath: string, fcId?: string) {
  if (storagePath === 'deleted' || !(await findFcDocumentPathOwner(storagePath, fcId))) {
    return fail('Document not found', 404);
  }
  const { data, error } = await supabase.storage
    .from(FC_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, FC_DOCUMENT_SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) return fail('Signed URL creation failed', 500);
  return json({ ok: true, signedUrl: data.signedUrl, expiresInSeconds: FC_DOCUMENT_SIGNED_URL_SECONDS });
}

/** FC uploads target a document type staff requested and have not approved yet. */
async function rejectUnuploadableOwnDocument(fcId: string, docType: string) {
  const { data: doc, error } = await supabase
    .from('fc_documents')
    .select('status')
    .eq('fc_id', fcId)
    .eq('doc_type', docType)
    .maybeSingle();
  if (error) throw error;
  if (!doc) return fail('Document row not found', 404);
  if (doc.status === 'approved') return fail('이 서류는 승인되어 수정할 수 없습니다.', 409);
  return null;
}

async function fcDocumentObjectExists(storagePath: string): Promise<boolean> {
  const separator = storagePath.lastIndexOf('/');
  const folder = storagePath.slice(0, separator);
  const objectName = storagePath.slice(separator + 1);
  if (separator <= 0 || !objectName) return false;
  const { data, error } = await supabase.storage
    .from(FC_DOCUMENTS_BUCKET)
    .list(folder, { limit: 10, search: objectName });
  if (error) throw error;
  return Array.isArray(data) && data.some((object) => object?.name === objectName);
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
  const allowManagerRead = action === 'getResidentNumbers' || action === 'getInviteeReferralCode' || action === 'signFcDocument';
  const allowFcSelfProfile = action === 'getOwnProfile' || action === 'updateOwnProfile' || action === 'removeOwnDocument' || action === 'retryOwnDocumentCleanup' || action === 'getOwnDocumentCleanupStatus' || action === 'signOwnDocument' || action === 'prepareOwnDocumentUpload' || action === 'submitOwnDocument';
  const allowFcRead = action === 'getResidentNumbers' || allowFcSelfProfile;
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
          : parsedSession.code === 'session_verification_unavailable'
            ? 'Session verification temporarily unavailable'
            : 'Unauthorized: missing or invalid app session token',
        parsedSession.status ?? 401,
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
    || (allowFcSelfProfile && requesterFcIds.length > 0)
    || (action === 'getResidentNumbers' && requesterFcIds.length > 0);

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
    const ownFcId = requesterFcIds[0];

    if (action === 'getOwnProfile') {
      if (trustedRole !== 'fc' || !ownFcId) {
        return fail('Unauthorized: signed FC session is required', 403);
      }

      const { data: profile, error } = await supabase
        .from('fc_profiles')
        .select('id,affiliation,name,phone,recommender,email,temp_id,carrier,address,address_detail,resident_id_masked,signup_completed')
        .eq('id', ownFcId)
        .in('phone', buildResidentIds(trustedPhone))
        .maybeSingle();
      if (error) return fail('기본 정보를 불러오지 못했습니다.', 500);
      if (!profile?.id) return fail('기본 정보를 찾을 수 없습니다.', 404);

      return json({ ok: true, profile });
    }

    if (action === 'updateOwnProfile') {
      if (trustedRole !== 'fc' || !ownFcId) {
        return fail('Unauthorized: signed FC session is required', 403);
      }

      const normalized = normalizeFcBasicInformationPatch(payload.patch);
      if (normalized.ok === false) return fail(normalized.message);

      const phoneCandidates = buildResidentIds(trustedPhone);
      if (Object.keys(normalized.patch).length === 0) {
        const { data: currentProfile, error: readError } = await supabase
          .from('fc_profiles')
          .select('id')
          .eq('id', ownFcId)
          .in('phone', phoneCandidates)
          .maybeSingle();
        if (readError) return fail('기본 정보를 확인하지 못했습니다.', 500);
        if (!currentProfile?.id) return fail('기본 정보를 찾을 수 없습니다.', 404);
        return json({ ok: true, profile: currentProfile });
      }

      const { data: updatedProfile, error: updateError } = await supabase
        .from('fc_profiles')
        .update(normalized.patch)
        .eq('id', ownFcId)
        .in('phone', phoneCandidates)
        .select('id')
        .maybeSingle();
      if (updateError) return fail('기본 정보를 저장하지 못했습니다.', 500);
      if (!updatedProfile?.id) return fail('기본 정보를 찾을 수 없습니다.', 404);

      return json({ ok: true, profile: updatedProfile });
    }

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
      const residentNumberStatuses: Record<string, 'ready' | 'missing' | 'unavailable'> = {};
      const chunkSize = 100;
      for (let i = 0; i < uniqueFcIds.length; i += chunkSize) {
        const chunk = uniqueFcIds.slice(i, i + chunkSize);
        const { data: rows, error } = await supabase
          .from('fc_identity_secure')
          .select('fc_id,resident_number_encrypted')
          .in('fc_id', chunk);
        if (error) throw error;
        if (!Array.isArray(rows)) throw new Error('resident_number_query_contract_invalid');

        const requestedIds = new Set(chunk);
        const seenIds = new Set<string>();
        for (const rawRow of rows) {
          if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
            throw new Error('resident_number_row_contract_invalid');
          }
          const row = rawRow as Record<string, unknown>;
          const fcId = typeof row.fc_id === 'string' ? row.fc_id.trim() : '';
          const enc = row.resident_number_encrypted;
          if (!fcId || !requestedIds.has(fcId) || seenIds.has(fcId)
            || (enc !== null && typeof enc !== 'string')) {
            throw new Error('resident_number_row_contract_invalid');
          }
          seenIds.add(fcId);
          if (enc === null) {
            residentNumbers[fcId] = null;
            residentNumberStatuses[fcId] = 'missing';
            continue;
          }
          if (typeof enc !== 'string') throw new Error('resident_number_row_contract_invalid');
          if (!enc.trim()) throw new Error('resident_number_row_contract_invalid');

          try {
            const plain = await decrypt(enc, key);
            const digits = plain.replace(/[^0-9]/g, '');
            if (digits.length === 13) {
              residentNumbers[fcId] = `${digits.slice(0, 6)}-${digits.slice(6)}`;
              residentNumberStatuses[fcId] = 'ready';
            } else {
              residentNumbers[fcId] = null;
              residentNumberStatuses[fcId] = 'unavailable';
            }
          } catch {
            residentNumbers[fcId] = null;
            residentNumberStatuses[fcId] = 'unavailable';
          }
        }
      }

      // ensure every requested id exists in map
      for (const fcId of uniqueFcIds) {
        if (!(fcId in residentNumbers)) {
          residentNumbers[fcId] = null;
          residentNumberStatuses[fcId] = 'missing';
        }
      }

      return json({ ok: true, residentNumbers, residentNumberStatuses });
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
      const allowedFields = new Set(['career_type', 'temp_id', 'status']);
      const updateFields = data && typeof data === 'object' && !Array.isArray(data)
        ? Object.keys(data)
        : [];
      if (!fcId || updateFields.length === 0) return fail('fcId and profile fields are required');
      if (updateFields.some((field) => !allowedFields.has(field))) {
        return fail('unsupported profile field');
      }
      if (Object.prototype.hasOwnProperty.call(data, 'career_type')
        && data.career_type !== null
        && data.career_type !== '신입'
        && data.career_type !== '경력') {
        return fail('career_type must be 신입, 경력, or null');
      }
      if (Object.prototype.hasOwnProperty.call(data, 'temp_id')
        && data.temp_id !== null
        && typeof data.temp_id !== 'string') {
        return fail('temp_id must be a string or null');
      }
      if (Object.prototype.hasOwnProperty.call(data, 'status') && !isFcStatus(data.status)) {
        return fail('profile status is invalid');
      }
      const { data: updatedProfile, error } = await supabase
        .from('fc_profiles')
        .update(data)
        .eq('id', fcId)
        .select('id,career_type,temp_id,status')
        .maybeSingle();
      if (error) throw error;
      requireMutationRowReceipt(updatedProfile, { ...data, id: fcId });
      return json({ ok: true });
    }

    // ── updateStatus ──
    if (action === 'updateStatus') {
      const { fcId, status, extra } = payload as {
        fcId: string;
        status: string;
        extra?: Record<string, any>;
      };
      if (!fcId || !isFcStatus(status)) return fail('fcId and valid status are required');
      let nextExtra = parseFcStatusUpdateExtra(status, extra);
      if (!nextExtra) return fail('status extra fields are invalid');

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
          ...buildFcDocWorkflowResetPayload(),
        };
      }

      const updatePayload = { status, ...(nextExtra ?? {}) };
      const { data: updatedProfile, error } = await supabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId)
        .select(buildSupabaseMutationReceiptSelect(updatePayload))
        .maybeSingle();
      if (error) throw error;
      requireMutationRowReceipt(updatedProfile, { ...updatePayload, id: fcId });
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
      const updatePayload = {
        allowance_date: normalizedAllowanceDate,
        allowance_prescreen_requested_at: null,
        allowance_reject_reason: null,
        status: nextStatus,
      };
      const { data: updatedProfile, error: updateError } = await supabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId)
        .select('id,allowance_date,allowance_prescreen_requested_at,allowance_reject_reason,status')
        .maybeSingle();
      if (updateError) throw updateError;
      requireMutationRowReceipt(updatedProfile, { ...updatePayload, id: fcId });

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

      const updatePayload = {
        hanwha_commission_date_sub: normalizedSubmittedDate,
        hanwha_commission_reject_reason: null,
        status: nextStatus,
      };
      const { data: updatedProfile, error: updateError } = await supabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId)
        .select('id,hanwha_commission_date_sub,hanwha_commission_reject_reason,status')
        .maybeSingle();
      if (updateError) throw updateError;
      requireMutationRowReceipt(updatedProfile, { ...updatePayload, id: fcId });

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
      const updatePayload = {
        dawichok_url_sent_at: sentAt,
        dawichok_url_sent_by: sentBy,
      };
      const { data: updatedProfile, error: updateError } = await supabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId)
        .select('id,dawichok_url_sent_at,dawichok_url_sent_by')
        .maybeSingle();
      if (updateError) throw updateError;
      requireMutationRowReceipt(updatedProfile, { ...updatePayload, id: fcId });

      return json({
        ok: true,
        id: fcId,
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

        const { data: updatedProfile, error: updateError } = await supabase
          .from('fc_profiles')
          .update(updatePayload)
          .eq('id', fcId)
          .select(buildSupabaseMutationReceiptSelect(updatePayload))
          .maybeSingle();
        if (updateError) throw updateError;
        requireMutationRowReceipt(updatedProfile, { ...updatePayload, id: fcId });
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

      const { data: updatedProfile, error: updateError } = await supabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId)
        .select(buildSupabaseMutationReceiptSelect(updatePayload))
        .maybeSingle();
      if (updateError) throw updateError;
      requireMutationRowReceipt(updatedProfile, { ...updatePayload, id: fcId });
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
        .select(
          'status,hanwha_commission_pdf_path,hanwha_commission_pdf_name,appointment_date_life,appointment_date_nonlife,life_commission_completed,nonlife_commission_completed',
        )
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
      const confirmedDate = isReject ? null : date;

      const lifeDone = Boolean(
        (type === 'life' ? confirmedDate : profile.appointment_date_life)
        || profile.life_commission_completed,
      );
      const nonlifeDone = Boolean(
        (type === 'nonlife' ? confirmedDate : profile.appointment_date_nonlife)
        || profile.nonlife_commission_completed,
      );
      const currentStatus = String(profile.status ?? '');
      const preserveLegacyTerminal = isLegacyAppointmentTerminalStatus(currentStatus);
      const nextStatus =
        isReject || confirmedDate === null
          ? preserveLegacyTerminal
            ? currentStatus
            : 'hanwha-commission-approved'
          : currentStatus === 'final-link-sent'
            ? 'final-link-sent'
            : lifeDone && nonlifeDone
              ? 'final-link-sent'
              : 'appointment-completed';

      const updatePayload: Record<string, any> = {
        [field]: confirmedDate,
        [rejectField]: isReject ? rejectReason ?? null : null,
        status: nextStatus,
      };
      if (isReject) updatePayload[submittedField] = null;

      const { data: updated, error } = await supabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId)
        .select(
          'id,status,appointment_date_life,appointment_date_nonlife,appointment_date_life_sub,appointment_date_nonlife_sub,appointment_reject_reason_life,appointment_reject_reason_nonlife',
        )
        .single();
      if (error) throw error;
      requireMutationRowReceipt(updated, { ...updatePayload, id: fcId });

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
      if (Object.keys(updatePayload).length === 0) return fail('appointment schedule fields are required');
      const { data: updatedProfile, error } = await supabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId)
        .select('id,appointment_schedule_life,appointment_schedule_nonlife')
        .maybeSingle();
      if (error) throw error;
      requireMutationRowReceipt(updatedProfile, { ...updatePayload, id: fcId });
      return json({ ok: true });
    }

    // ── updateDocReqs: one transaction, no success before its committed result ──
    if (action === 'updateDocReqs') {
      const { fcId, types, deadline } = payload;
      if (typeof fcId !== 'string' || !Array.isArray(types) || types.some((type) => typeof type !== 'string')) return fail('invalid document request');
      if (deadline && (typeof deadline !== 'string' || !isCanonicalYmd(deadline))) return fail('invalid document deadline');
      const { data, error } = await supabase.rpc('update_fc_document_requests_atomic_v1', {
        p_actor_phone: trustedPhone, p_actor_role: 'admin', p_fc_id: fcId,
        p_types: types, p_deadline: deadline || null,
      });
      if (error) throw error;
      const receipt = requireDocumentReceipt(data, 'updated');
      const cleanupPending = await drainDocumentCleanup(fcId);
      return json({ ok: true, ...receipt, cleanupPending });
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
      const { data: updatedDoc, error } = await supabase
        .from('fc_documents')
        .update(updatePayload)
        .eq('fc_id', fcId)
        .eq('doc_type', docType)
        .select('id,fc_id,doc_type,status,reviewer_note')
        .maybeSingle();
      if (error) throw error;
      requireMutationRowReceipt(updatedDoc, {
        ...updatePayload,
        fc_id: fcId,
        doc_type: docType,
      });

      const { allApproved } = await syncProfileAfterDocMutation(fcId);
      return json({ ok: true, allApproved });
    }

    if (['retryDocumentCleanup', 'retryOwnDocumentCleanup', 'getDocumentCleanupStatus', 'getOwnDocumentCleanupStatus'].includes(action)) {
      const isOwn = action === 'retryOwnDocumentCleanup' || action === 'getOwnDocumentCleanupStatus';
      const fcId = isOwn ? ownFcId : payload.fcId;
      if (typeof fcId !== 'string' || !fcId) return fail('document target required');
      await assertDocumentCleanupScope(trustedPhone, isOwn ? 'fc' : 'admin', fcId);
      const cleanupPending = action.startsWith('get')
        ? await getDocumentCleanupPending(fcId) : await drainDocumentCleanup(fcId);
      return json({ ok: true, cleanupPending });
    }
    // Source path and approved-state checks are locked in the DB, not trusted from the UI.
    if (action === 'deleteDocFile' || action === 'removeOwnDocument') {
      const fcId = action === 'removeOwnDocument' ? ownFcId : payload.fcId;
      const { docType, storagePath } = payload;
      if (!fcId || typeof docType !== 'string') return fail('document target required');
      const { data, error } = await supabase.rpc('remove_fc_document_atomic_v1', {
        p_actor_phone: trustedPhone, p_actor_role: action === 'removeOwnDocument' ? 'fc' : 'admin',
        p_fc_id: fcId, p_doc_type: docType, p_expected_storage_path: storagePath ?? null,
      });
      if (error) throw error;
      const receipt = requireDocumentReceipt(data, 'deleted');
      const cleanupPending = await drainDocumentCleanup(fcId);
      return json({ ok: true, ...receipt, cleanupPending });
    }
    if (action === 'signFcDocument') {
      const storagePath = readFcDocumentField(payload.storagePath, 1024);
      if (!storagePath) return fail('storagePath is required');
      return await signFcDocumentPath(storagePath);
    }
    // The app client is anon, so FC document reads and uploads run on server-signed Storage URLs.
    if (action === 'signOwnDocument' || action === 'prepareOwnDocumentUpload' || action === 'submitOwnDocument') {
      if (trustedRole !== 'fc' || !ownFcId) {
        return fail('Unauthorized: signed FC session is required', 403);
      }
      if (action === 'signOwnDocument') {
        const storagePath = readFcDocumentField(payload.storagePath, 1024);
        if (!storagePath) return fail('storagePath is required');
        return await signFcDocumentPath(storagePath, ownFcId);
      }

      const docType = readFcDocumentField(payload.docType, 150);
      if (!docType) return fail('docType is required');
      const rejection = await rejectUnuploadableOwnDocument(ownFcId, docType);
      if (rejection) return rejection;

      if (action === 'prepareOwnDocumentUpload') {
        const storagePath = `${ownFcId}/${crypto.randomUUID()}.pdf`;
        const { data, error } = await supabase.storage
          .from(FC_DOCUMENTS_BUCKET)
          .createSignedUploadUrl(storagePath);
        if (error || !data?.signedUrl || !data.token) return fail('Signed upload URL creation failed', 500);
        return json({ ok: true, upload: { path: storagePath, token: data.token, signedUrl: data.signedUrl } });
      }

      const storagePath = readFcDocumentField(payload.storagePath, 1024);
      const fileName = readFcDocumentField(payload.fileName, 255);
      if (!storagePath || !fileName) return fail('storagePath and fileName are required');
      const objectName = storagePath.slice(ownFcId.length + 1);
      if (!storagePath.startsWith(`${ownFcId}/`) || !objectName || objectName.includes('/')) {
        return fail('Unauthorized: upload path does not belong to the signed FC', 403);
      }
      if (!(await fcDocumentObjectExists(storagePath))) return fail('Uploaded file not found', 409);

      // Same row and status the app wrote before; a retried submission rewrites identical values.
      const documentMutation = {
        fc_id: ownFcId,
        doc_type: docType,
        storage_path: storagePath,
        file_name: fileName,
        status: 'pending',
        reviewer_note: null,
      };
      const { data: documentReceipt, error: documentError } = await supabase
        .from('fc_documents')
        .upsert(documentMutation, { onConflict: 'fc_id,doc_type' })
        .select('fc_id,doc_type,storage_path,file_name,status,reviewer_note')
        .maybeSingle();
      if (documentError) throw documentError;
      requireMutationRowReceipt(documentReceipt, documentMutation);

      const { data: profileReceipt, error: profileError } = await supabase
        .from('fc_profiles')
        .update({ status: 'docs-pending' })
        .eq('id', ownFcId)
        .select('id,status')
        .maybeSingle();
      if (profileError) throw profileError;
      requireMutationRowReceipt(profileReceipt, { id: ownFcId, status: 'docs-pending' });

      return json({ ok: true, document: documentReceipt, profile: profileReceipt });
    }
    if (action === 'createNotice') {
      const { requestId, notice } = payload;
      if (typeof requestId !== 'string' || !notice || typeof notice !== 'object') return fail('notice request required');
      const { data, error } = await supabase.rpc('create_notice_idempotent_v1', {
        p_actor_phone: trustedPhone, p_actor_role: 'admin', p_request_id: requestId, p_notice: notice,
      });
      if (error) throw error;
      return json({ ok: true, notice: requireCreationReceipt(data) });
    }

    // ── upsertExamRound ──
    if (action === 'upsertExamRound') {
      const { roundId, data, locations } = payload as {
        roundId?: string | null;
        data: {
          exam_type: 'life' | 'nonlife';
          exam_date: string | null;
          exam_month?: string | null;
          registration_deadline: string;
          round_label?: string | null;
          notes?: string | null;
        };
        locations?: { location_name: string; sort_order?: number }[];
      };
      if (!data?.exam_type || !data?.registration_deadline) {
        return fail('exam_type and registration_deadline are required');
      }
      if (!['life', 'nonlife'].includes(data.exam_type)) {
        return fail('invalid exam type');
      }

      const examDate = trimOrNull(data.exam_date);
      const registrationDeadline = trimOrNull(data.registration_deadline);
      const hasExplicitExamMonth = Object.prototype.hasOwnProperty.call(data, 'exam_month');
      const explicitExamMonth = trimOrNull(data.exam_month);

      if (examDate && !isCanonicalYmd(examDate)) {
        return fail('invalid exam date');
      }
      if (!registrationDeadline || !isCanonicalYmd(registrationDeadline)) {
        return fail('invalid registration deadline');
      }
      if (hasExplicitExamMonth && (!explicitExamMonth || !isCanonicalMonthStart(explicitExamMonth))) {
        return fail('invalid exam month');
      }

      let examMonth: string;
      if (explicitExamMonth) {
        examMonth = explicitExamMonth;
      } else if (examDate) {
        if (roundId) {
          const { data: existingRound, error: existingRoundError } = await supabase
            .from('exam_rounds')
            .select('exam_date,exam_month')
            .eq('id', roundId)
            .maybeSingle();
          if (existingRoundError) throw existingRoundError;
          if (!existingRound) return fail('exam round not found', 404);
          if (existingRound.exam_date === null) {
            return fail('exam_month_required_for_tbd_round', 409);
          }
        }
        examMonth = examMonthFromDate(examDate);
      } else {
        return fail('exam_month_required_for_tbd_round');
      }

      if (examDate && examMonth !== examMonthFromDate(examDate)) {
        return fail('exam date and month mismatch');
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
        'save_exam_round_atomic_v2',
        {
          p_round_id: roundId ?? null,
          p_exam_date: examDate,
          p_exam_month: examMonth,
          p_registration_deadline: registrationDeadline,
          p_round_label: data.round_label ?? null,
          p_exam_type: data.exam_type,
          p_notes: data.notes ?? null,
          p_locations: safeLocations.map((location) => location.location_name),
        },
      );
      if (saveError) throw saveError;
      let savedRoundId: string;
      try {
        savedRoundId = requireCreationReceipt({ id: targetRoundId }).id;
      } catch {
        return fail('exam round save did not return an id', 500);
      }
      if (roundId && savedRoundId.toLowerCase() !== roundId.toLowerCase()) {
        return fail('exam round save receipt did not match the requested round', 500);
      }

      return json({ ok: true, roundId: savedRoundId });
    }

    // ── deleteExamRound: check, child delete and parent delete share the same transaction ──
    if (action === 'deleteExamRound') {
      const { roundId } = payload;
      if (typeof roundId !== 'string') return fail('roundId is required');
      const { data, error } = await supabase.rpc('delete_exam_round_atomic_v1', {
        p_actor_phone: trustedPhone, p_actor_role: 'admin', p_round_id: roundId,
      });
      if (error) throw error;
      return json({ ok: true, ...requireExamDeletionReceipt(data) });
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
        const knownTransitionFailures: Record<string, { message: string; status: number }> = {
          exam_registration_not_found: { message: '시험 신청 내역을 찾을 수 없습니다.', status: 404 },
          exam_transition_forbidden: { message: '시험 신청 상태를 변경할 권한이 없습니다.', status: 403 },
          terminal_exam_registration: { message: '완료되었거나 불참 처리된 시험 신청은 변경할 수 없습니다.', status: 409 },
          invalid_exam_transition: { message: '현재 상태에서는 요청한 시험 신청 상태로 변경할 수 없습니다.', status: 409 },
        };
        const knownFailure = knownTransitionFailures[error.message];
        return knownFailure
          ? fail(knownFailure.message, knownFailure.status)
          : fail('시험 신청 상태를 변경하지 못했습니다.', 500);
      }

      let result: ReturnType<typeof requireExamTransitionReceipt>;
      try {
        result = requireExamTransitionReceipt(
          data,
          normalizedRegistrationId,
          requestedTransition as 'confirm' | 'unconfirm' | 'reject' | 'cancel_by_admin',
        );
      } catch {
        return fail('Exam transition result could not be verified', 500);
      }
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

      const { data: fcProfile, error: fcProfileError } = await supabase
        .from('fc_profiles')
        .select('id,phone')
        .eq('id', fcId)
        .eq('is_manager_referral_shadow', false)
        .maybeSingle();
      if (fcProfileError) return fail('FC 계정을 삭제하지 못했습니다.', 500);
      if (!fcProfile?.id) return fail('삭제할 FC 계정을 찾을 수 없습니다.', 404);
      const retired = await retireFcBeforeAccountDeletion(fcProfile.id, fcProfile.phone);
      if (retired.ok === false) {
        const blocked = fcRetirementBlockedResponse(retired.reason);
        return json({ ok: false, code: blocked.code, message: blocked.message }, blocked.status);
      }

      const { data, error } = await supabase.rpc(
        'delete_account_core_transaction_v1',
        {
          p_target_role: 'fc',
          p_target_id: fcId,
        },
      );
      if (error) {
        return error.message === 'account_delete_target_not_found'
          ? fail('삭제할 FC 계정을 찾을 수 없습니다.', 404)
          : fail('FC 계정을 삭제하지 못했습니다.', 500);
      }

      let result: ReturnType<typeof requireAccountDeletionReceipt>;
      try {
        result = requireAccountDeletionReceipt(data);
      } catch {
        return fail('Account deletion result could not be verified', 500);
      }
      const proofPaths = readStringArray(result.proof_paths);
      const documentPaths = readStringArray(result.document_paths);
      const boardPaths = readStringArray(result.board_attachment_paths);
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
        deleted: result.deleted === true,
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
  } catch {
    return json({ ok: false, message: 'Request failed' }, 500);
  }
});
