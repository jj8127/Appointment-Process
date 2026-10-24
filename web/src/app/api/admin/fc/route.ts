import { isValidCareerType } from '@/lib/user-intent-policy';
import {
  buildFcDocWorkflowResetPayload,
  isFcStatus,
  parseFcStatusUpdateExtra,
} from '@shared/lib/fc-status';
import dayjs from 'dayjs';
import { after, NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { serverError } from '@/lib/api-error';
import { resolveAdminTempIdUpdate } from '@/lib/admin-temp-id-update';
import { isValidIsoDate } from '@/lib/calendar-date';
import {
  persistNotificationToResident,
  sendPushNotificationToResident,
  sendPushNotificationToResidentDevices,
  type NotificationPersistenceResult,
  type PushPayload,
  type PushNotificationResult,
} from '@/lib/push-notification-service';
import {
  hasAppointmentWorkflowEvidence,
  hasHanwhaApprovedPdf,
  resolveAppointmentCompletionStatus,
} from '@/lib/fc-workflow';
import { normalizeFcDocumentStoragePath } from '@/lib/admin-fc-doc-storage';
import { isPlainFcDocumentPath } from '@shared/supabase/functions/_shared/fc-document-path';
import { validateHanwhaPdfPayload } from '@/lib/admin-hanwha-pdf-payload';
import { logger } from '@/lib/logger';
import { parseNotificationTargetV1 } from '@/lib/notification-target';
import {
  hasRetiredLegacyRecommenderMutationFields,
  isRetiredLegacyRecommenderSearchAction,
  RECOMMENDER_RELATION_UNAVAILABLE_MESSAGE,
  RECOMMENDER_RPC_NOT_READY_MESSAGE,
} from '@/lib/recommender-relation-route-handler';
import { buildPhoneCandidates, getVerifiedServerSession } from '@/lib/server-session';
import { requireSupabaseRows } from '@/lib/supabase-query-contract';
import { readAdminDocumentWorkflowRows } from '@/lib/admin-document-workflow';
import { ADMIN_FC_DETAIL_SELECT } from '@/lib/admin-document-client';
import { summarizeFcActionPayload, toAuditAction } from '@/lib/admin-audit-event';
import { recordAdminAuditEvent } from '@/lib/admin-audit-server';

type AdminAction =
  | 'getProfile'
  | 'updateProfile'
  | 'updateStatus'
  | 'updateAllowanceDate'
  | 'updateHanwhaSubmissionDate'
  | 'markDawichokUrlSent'
  | 'updateAppointmentDate'
  | 'updateDocsRequest'
  | 'updateDocStatus'
  | 'deleteDocFile'
  | 'retryDocumentCleanup'
  | 'getDocumentCleanupStatus'
  | 'createHanwhaPdfUploadUrl'
  | 'deleteHanwhaPdf'
  | 'signDoc'
  | 'sendReminder'
  | 'getInviteeReferralCode'
  | 'getReferralCode';

type AdminSession = {
  role: 'admin';
  residentId: string;
  residentDigits: string;
  staffType: 'admin' | 'developer';
};

type ManagerSession = {
  role: 'manager';
  residentId: string;
  residentDigits: string;
  staffType: 'manager';
};

type CookieSession = {
  role: string | null;
  residentId: string;
  residentDigits: string;
};

type SessionErrorResult = {
  ok: false;
  status: number;
  error: string;
};

type SessionSuccessResult<T> = {
  ok: true;
  session: T;
};

type AffiliationScope = {
  restricted: boolean;
  prefixes: string[];
};

type AdminRequest = {
  action: AdminAction;
  payload: Record<string, unknown>;
};

// Actions that change FC data; reads, signed URLs and upload-URL issuance are not history.
const AUDITED_FC_ACTIONS = new Set<AdminAction>([
  'updateProfile',
  'updateStatus',
  'updateAllowanceDate',
  'updateHanwhaSubmissionDate',
  'markDawichokUrlSent',
  'updateAppointmentDate',
  'updateDocsRequest',
  'updateDocStatus',
  'deleteDocFile',
  'retryDocumentCleanup',
  'deleteHanwhaPdf',
  'sendReminder',
]);

const DAWICHOK_URL_SIGNAL_STATUSES = new Set([
  'docs-approved',
  'hanwha-commission-review',
  'hanwha-commission-rejected',
  'hanwha-commission-approved',
  'appointment-completed',
  'final-link-sent',
]);
const ADMIN_PROFILE_UPDATE_FIELD_NAMES = [
  'career_type',
  'temp_id',
  'status',
  'allowance_date',
  'allowance_prescreen_requested_at',
  'allowance_reject_reason',
  'life_commission_completed',
  'nonlife_commission_completed',
] as const;
const ADMIN_PROFILE_UPDATE_FIELDS = new Set<string>(ADMIN_PROFILE_UPDATE_FIELD_NAMES);
const ADMIN_PROFILE_UPDATE_RECEIPT_SELECT = [
  'id',
  'name',
  'recommender',
  'recommender_fc_id',
  ...ADMIN_PROFILE_UPDATE_FIELD_NAMES,
].join(',');
const ADMIN_FC_STATUS_UPDATE_RECEIPT_SELECT = 'id,status,allowance_date,allowance_prescreen_requested_at,allowance_reject_reason,hanwha_commission_date_sub,hanwha_commission_date,hanwha_commission_reject_reason,hanwha_commission_pdf_path,hanwha_commission_pdf_name,dawichok_url_sent_at,dawichok_url_sent_by,appointment_url,appointment_date,appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life_sub,appointment_date_nonlife_sub,appointment_reject_reason_life,appointment_reject_reason_nonlife,appointment_date_life,appointment_date_nonlife,life_commission_completed,nonlife_commission_completed';

function notificationResponse(result: {
  success: boolean;
  delivery: {
    notificationStored: boolean;
    pushStatus: 'accepted' | 'no_registered_device' | 'provider_rejected' | 'not_attempted';
    retryable: boolean;
    notificationId?: string;
  };
} | null) {
  if (!result) return {};
  return {
    notification: result,
    delivery: result.delivery,
    ...(result.delivery.notificationStored
      ? {}
      : { warning: 'notification_persistence_incomplete' }),
  };
}

function requireFcMutationReceipt(
  receipt: unknown,
  expected: Record<string, unknown>,
  mutationName: string,
): Record<string, unknown> {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error(`${mutationName}_mutation_receipt_invalid`);
  }

  const row = receipt as Record<string, unknown>;
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = row[field];
    if (Object.is(actualValue, expectedValue)) continue;
    if (
      field.endsWith('_at')
      && typeof actualValue === 'string'
      && typeof expectedValue === 'string'
      && Number.isFinite(Date.parse(actualValue))
      && Date.parse(actualValue) === Date.parse(expectedValue)
    ) continue;
    throw new Error(`${mutationName}_mutation_receipt_invalid`);
  }
  return row;
}

function requireSingleFcMutationReceipt(
  receipts: Record<string, unknown>[] | null | undefined,
  expected: Record<string, unknown>,
  mutationName: string,
): Record<string, unknown> {
  const rows = requireSupabaseRows(receipts, mutationName);
  if (rows.length !== 1) {
    throw new Error(`${mutationName}_mutation_receipt_invalid`);
  }
  return requireFcMutationReceipt(rows[0], expected, mutationName);
}

async function resolveCanonicalFcNotificationRecipient(fcId: string): Promise<string | null> {
  const { data: profile, error } = await adminSupabase
    .from('fc_profiles')
    .select('phone')
    .eq('id', fcId)
    .maybeSingle();

  const phone = typeof profile?.phone === 'string' ? profile.phone.trim() : '';
  const phoneDigits = phone.replace(/\D/g, '');
  if (error || !profile || !/^010\d{8}$/.test(phoneDigits)) {
    logger.warn('[api/admin/fc] canonical notification recipient unavailable', {
      category: 'admin_fc_notification',
      reason: error ? 'database_lookup_failed' : 'invalid_or_missing_recipient',
      status: 'incomplete',
    });
    return null;
  }

  return phoneDigits;
}

async function sendPushNotificationToCanonicalFc(
  fcId: string,
  payload: PushPayload,
): Promise<PushNotificationResult> {
  const phoneDigits = await resolveCanonicalFcNotificationRecipient(fcId);
  if (!phoneDigits) {
    return sendPushNotificationToResident('', payload, fcId);
  }

  return sendPushNotificationToResident(phoneDigits, payload, fcId);
}

async function queuePushNotificationToCanonicalFc(
  fcId: string,
  payload: PushPayload,
): Promise<NotificationPersistenceResult> {
  const phoneDigits = await resolveCanonicalFcNotificationRecipient(fcId);
  if (!phoneDigits) {
    return {
      success: false,
      notificationId: null,
      delivery: {
        notificationStored: false,
        pushStatus: 'not_attempted',
        retryable: false,
      },
      inbox: { attempted: false, logged: false },
    };
  }

  const persistence = await persistNotificationToResident(phoneDigits, payload, fcId);
  if (persistence.success) {
    after(async () => {
      await sendPushNotificationToResidentDevices(
        phoneDigits,
        payload,
        persistence.notificationId,
        fcId,
      );
    });
  }
  return persistence;
}

async function getValidatedCookieSession(): Promise<SessionErrorResult | SessionSuccessResult<CookieSession>> {
  const sessionCheck = await getVerifiedServerSession({ allowedRoles: ['admin', 'manager'] });
  if (!sessionCheck.ok) {
    return sessionCheck;
  }

  return {
    ok: true as const,
    session: {
      role: sessionCheck.session.role,
      residentId: sessionCheck.session.residentId,
      residentDigits: sessionCheck.session.residentDigits,
    },
  };
}

async function getAdminSession(): Promise<SessionErrorResult | SessionSuccessResult<AdminSession>> {
  const sessionCheck = await getValidatedCookieSession();
  if (!sessionCheck.ok) {
    return sessionCheck;
  }

  if (sessionCheck.session.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const phoneCandidates = buildPhoneCandidates(
    sessionCheck.session.residentId,
    sessionCheck.session.residentDigits,
  );

  const { data, error } = await adminSupabase
    .from('admin_accounts')
    .select('staff_type,active')
    .in('phone', phoneCandidates)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    logger.error('[api/admin/fc] session verification failed', error);
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  if (!data) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const verifiedSession: AdminSession = {
    role: 'admin',
    residentId: sessionCheck.session.residentId,
    residentDigits: sessionCheck.session.residentDigits,
    staffType: data.staff_type === 'developer' ? 'developer' : 'admin',
  };

  return { ok: true, session: verifiedSession };
}

async function getReadSession(): Promise<SessionErrorResult | SessionSuccessResult<AdminSession | ManagerSession>> {
  const sessionCheck = await getValidatedCookieSession();
  if (!sessionCheck.ok) {
    return sessionCheck;
  }

  if (sessionCheck.session.role === 'admin') {
    return getAdminSession();
  }

  if (sessionCheck.session.role !== 'manager') {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const phoneCandidates = buildPhoneCandidates(
    sessionCheck.session.residentId,
    sessionCheck.session.residentDigits,
  );

  const { data, error } = await adminSupabase
    .from('manager_accounts')
    .select('id,active')
    .in('phone', phoneCandidates)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    logger.error('[api/admin/fc] manager session verification failed', error);
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  if (!data) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const verifiedSession: ManagerSession = {
    role: 'manager',
    residentId: sessionCheck.session.residentId,
    residentDigits: sessionCheck.session.residentDigits,
    staffType: 'manager',
  };

  return { ok: true, session: verifiedSession };
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isRecommenderRpcNotReadyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message === RECOMMENDER_RPC_NOT_READY_MESSAGE;
}

function isAllowanceFlowMutation(status: string, extra?: Record<string, unknown>) {
  if (status === 'allowance-consented') {
    return true;
  }
  if (status !== 'allowance-pending' || !extra) return false;
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

const isAffiliationAllowed = (scope: AffiliationScope, affiliation?: string | null) => {
  if (!scope.restricted) return true;
  const candidate = String(affiliation ?? '').trim();
  if (!candidate) return false;
  return scope.prefixes.some((prefix) => candidate === prefix || candidate.startsWith(`${prefix} `));
};

async function loadAffiliationScope(session: AdminSession | ManagerSession): Promise<AffiliationScope> {
  void session;
  return { restricted: false, prefixes: [] };
}

async function requireFcProfileScope(session: AdminSession | ManagerSession, fcId: string) {
  const scope = await loadAffiliationScope(session);
  if (!scope.restricted) return null;

  const { data: profile, error } = await adminSupabase
    .from('fc_profiles')
    .select('affiliation')
    .eq('id', fcId)
    .maybeSingle();

  if (error) throw error;
  if (profile && isAffiliationAllowed(scope, profile.affiliation)) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

function resolveAllowanceStatus(currentStatus: string | null | undefined): string {
  if (!currentStatus || ['draft', 'temp-id-issued', 'allowance-pending', 'allowance-consented'].includes(currentStatus)) {
    return 'allowance-pending';
  }
  return currentStatus;
}

const NO_FILE_APPROVAL_NOTE = '총무 수동 승인: 파일 미제출';

const isNoFileDoc = (storagePath: string | null | undefined) => {
  const normalizedPath = String(storagePath ?? '').trim();
  return !normalizedPath || normalizedPath === 'deleted';
};

async function syncProfileAfterDocMutation(fcId: string) {
  const allDocs = await readAdminDocumentWorkflowRows(fcId, 'admin_fc_document_workflow');
  const allApproved = allDocs.length > 0 && allDocs.every((doc) => doc.status === 'approved');

  const updatePayload = allApproved
    ? { status: 'docs-approved' }
    : {
        status: 'docs-pending',
        ...buildFcDocWorkflowResetPayload(),
      };
  const { data: updatedProfiles, error: profileError } = await adminSupabase
    .from('fc_profiles')
    .update(updatePayload)
    .eq('id', fcId)
    .select(ADMIN_FC_STATUS_UPDATE_RECEIPT_SELECT);
  if (profileError) throw profileError;
  requireSingleFcMutationReceipt(
    updatedProfiles,
    { ...updatePayload, id: fcId },
    'admin_fc_document_workflow_profile',
  );

  return { allApproved };
}

async function areAllRequestedDocsApproved(fcId: string) {
  const requestedDocs = await readAdminDocumentWorkflowRows(fcId, 'admin_fc_requested_documents');
  return requestedDocs.length > 0 && requestedDocs.every((doc) => doc.status === 'approved');
}

/** Committed metadata stays successful when physical cleanup is delayed. */
async function drainDocumentCleanup(fcId: string): Promise<boolean> {
  try {
    const { data, error } = await adminSupabase.from('fc_document_cleanup_queue').select('storage_path').eq('fc_id', fcId).limit(20);
    if (error) return true;
    for (const row of requireSupabaseRows(data, 'admin_fc_document_cleanup_queue')) {
      const { error: removeError } = await adminSupabase.storage.from('fc-documents').remove([row.storage_path]);
      if (!removeError) {
        const { error: queueError } = await adminSupabase.from('fc_document_cleanup_queue').delete().eq('fc_id', fcId).eq('storage_path', row.storage_path);
        if (queueError) return true;
      }
    }
    const { count, error: countError } = await adminSupabase.from('fc_document_cleanup_queue').select('storage_path', { count: 'exact', head: true }).eq('fc_id', fcId);
    return !!countError || typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 0;
  } catch { return true; }
}

export async function POST(req: Request) {
  let body: AdminRequest;
  try {
    body = (await req.json()) as AdminRequest;
  } catch (err) {
    logger.error('[api/admin/fc] invalid json', err);
    return badRequest('Invalid JSON payload');
  }

  const { action, payload } = body ?? {};
  if (!action) return badRequest('action is required');

  const sessionCheck = action === 'getProfile' || action === 'getReferralCode' || action === 'getInviteeReferralCode' || action === 'signDoc'
    ? await getReadSession()
    : await getAdminSession();
  if (!sessionCheck.ok) {
    return NextResponse.json({ error: sessionCheck.error }, { status: sessionCheck.status });
  }

  const response = await runAdminFcAction(action, payload, sessionCheck);
  if (response.ok && AUDITED_FC_ACTIONS.has(action) && sessionCheck.session.role === 'admin') {
    // The change is committed; a failed history write is logged but does not undo it.
    const fcId = typeof payload?.fcId === 'string' ? payload.fcId : null;
    await recordAdminAuditEvent(
      { role: 'admin', staffType: sessionCheck.session.staffType, residentDigits: sessionCheck.session.residentDigits },
      { category: 'fc_action', action: toAuditAction(action), targetFcId: fcId, detail: summarizeFcActionPayload(payload) },
    );
  }
  return response;
}

async function runAdminFcAction(
  action: AdminAction,
  payload: AdminRequest['payload'],
  sessionCheck: SessionSuccessResult<AdminSession | ManagerSession>,
): Promise<Response> {
  try {
    if (isRetiredLegacyRecommenderSearchAction(action)) {
      return badRequest('추천인 검색은 추천인 관계 전용 경로에서만 사용할 수 있습니다.');
    }

    if (action === 'createHanwhaPdfUploadUrl' || action === 'deleteHanwhaPdf') {
      const validatedPayload = validateHanwhaPdfPayload(action, payload);
      if (!validatedPayload.ok) {
        return badRequest(validatedPayload.error);
      }
      const { fcId, fileName } = validatedPayload;

      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;

      if (action === 'createHanwhaPdfUploadUrl') {
        const resolvedFileName = String(fileName).trim() || 'dawichok-url.pdf';
        // The name becomes the last path segment; signers refuse '%', '#' and control characters.
        const safeFileName = resolvedFileName
          .replace(/[\\/:*?"<>|%#\u0000-\u001f\u007f]+/g, '_')
          .replace(/\s+/g, ' ')
          .trim();
        const normalizedFileName =
          safeFileName.toLowerCase().endsWith('.pdf') ? safeFileName : `${safeFileName}.pdf`;
        const storagePath = `hanwha-url-pdf/${fcId}/${dayjs().format('YYYYMMDD-HHmmss')}-${Math.floor(
          Math.random() * 1e9,
        )}-${normalizedFileName}`;

        const { data: uploadData, error: uploadError } = await adminSupabase.storage
          .from('fc-documents')
          .createSignedUploadUrl(storagePath, { upsert: true });
        if (uploadError) throw uploadError;
        if (!uploadData?.signedUrl) {
          return badRequest('서명 URL을 생성할 수 없습니다.');
        }

        return NextResponse.json({
          ok: true,
          uploadUrl: uploadData.signedUrl,
          storagePath: uploadData.path ?? storagePath,
          fileName: normalizedFileName,
        });
      }

      const { data: profile, error: profileError } = await adminSupabase
        .from('fc_profiles')
        .select('hanwha_commission_pdf_path,status')
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;
      const storedPath = normalizeFcDocumentStoragePath(profile?.hanwha_commission_pdf_path);
      if (!storedPath) {
        return badRequest('삭제할 다위촉 URL 파일이 없습니다.');
      }

      const { error: deleteError } = await adminSupabase.storage
        .from('fc-documents')
        .remove([storedPath]);
      if (deleteError) throw deleteError;

      const nextStatus = profile?.status === 'appointment-completed' || profile?.status === 'final-link-sent'
        ? profile.status
        : 'hanwha-commission-review';
      const expectedUpdate = {
        id: fcId,
        hanwha_commission_pdf_path: null,
        hanwha_commission_pdf_name: null,
        status: nextStatus,
      };
      const { data: updatedProfile, error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update({
          hanwha_commission_pdf_path: null,
          hanwha_commission_pdf_name: null,
          status: nextStatus,
        })
        .eq('id', fcId)
        .select('id,hanwha_commission_pdf_path,hanwha_commission_pdf_name,status')
        .maybeSingle();
      if (updateError) throw updateError;
      const receipt = requireFcMutationReceipt(
        updatedProfile,
        expectedUpdate,
        'admin_fc_delete_hanwha_pdf',
      );

      return NextResponse.json({ ok: true, profile: receipt });
    }

    if (action === 'getProfile') {
      const { fcId } = payload as { fcId?: string };
      if (!fcId) return badRequest('fcId is required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;

      const { data, error } = await adminSupabase
        .from('fc_profiles')
        .select(ADMIN_FC_DETAIL_SELECT)
        .eq('id', fcId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return NextResponse.json({ error: 'FC profile not found' }, { status: 404 });

      return NextResponse.json({ ok: true, profile: data });
    }

    if (action === 'updateProfile') {
      const adminSession = sessionCheck.session as AdminSession;
      const { fcId, data } = payload as {
        fcId?: string;
        data?: Record<string, unknown>;
      };
      if (!fcId || !data || typeof data !== 'object' || Array.isArray(data)) {
        return badRequest('fcId and data are required');
      }
      const scopeError = await requireFcProfileScope(adminSession, fcId);
      if (scopeError) return scopeError;
      if (hasRetiredLegacyRecommenderMutationFields(data)) {
        return badRequest('추천인 관계는 추천인 관계 전용 경로에서만 수정할 수 있습니다.');
      }

      if (Object.prototype.hasOwnProperty.call(data, 'career_type') && !isValidCareerType(data.career_type)) {
        return badRequest('경력 구분은 신입 또는 경력을 선택해주세요.');
      }
      if (Object.keys(data).some((field) => !ADMIN_PROFILE_UPDATE_FIELDS.has(field))) {
        return badRequest('profile update fields are invalid');
      }
      if (Object.prototype.hasOwnProperty.call(data, 'status') && !isFcStatus(data.status)) {
        return badRequest('profile status is invalid');
      }
      for (const field of ['life_commission_completed', 'nonlife_commission_completed']) {
        if (Object.prototype.hasOwnProperty.call(data, field) && typeof data[field] !== 'boolean') {
          return badRequest('commission completion fields must be boolean');
        }
      }
      for (const field of [
        'temp_id',
        'allowance_date',
        'allowance_prescreen_requested_at',
        'allowance_reject_reason',
      ]) {
        if (Object.prototype.hasOwnProperty.call(data, field)
          && data[field] !== null
          && typeof data[field] !== 'string'
        ) {
          return badRequest('profile text fields must be strings or null');
        }
      }
      const updateData = { ...data };

      const hasTempIdUpdate = Object.prototype.hasOwnProperty.call(updateData, 'temp_id');
      let tempIdChanged = false;
      let nextTempId: string | null = null;
      if (hasTempIdUpdate && updateData.temp_id != null && typeof updateData.temp_id !== 'string') {
        return badRequest('temp_id must be a string or null');
      }

      if (hasTempIdUpdate) {
        const { data: currentProfile, error: currentProfileError } = await adminSupabase
          .from('fc_profiles')
          .select('status,temp_id')
          .eq('id', fcId)
          .maybeSingle();
        if (currentProfileError) throw currentProfileError;

        const tempIdUpdate = resolveAdminTempIdUpdate(currentProfile?.temp_id, updateData.temp_id);
        tempIdChanged = tempIdUpdate.changed;
        nextTempId = tempIdUpdate.nextTempId;

        // The server owns the issuance transition. A stale client must not move a
        // draft profile when it resubmits the same temporary ID.
        if (updateData.status === 'temp-id-issued') {
          delete updateData.status;
        }

        if (!tempIdChanged) {
          delete updateData.temp_id;
        } else {
          updateData.temp_id = nextTempId;
        }

        if (
          tempIdChanged &&
          nextTempId &&
          !Object.prototype.hasOwnProperty.call(updateData, 'status') &&
          currentProfile?.status === 'draft'
        ) {
          updateData.status = 'temp-id-issued';
        }
      }

      let profileReceipt: Record<string, unknown>;
      if (Object.keys(updateData).length > 0) {
        const { data: updatedProfile, error: updateError } = await adminSupabase
          .from('fc_profiles')
          .update(updateData)
          .eq('id', fcId)
          .select(ADMIN_PROFILE_UPDATE_RECEIPT_SELECT)
          .maybeSingle();
        if (updateError) throw updateError;
        profileReceipt = requireFcMutationReceipt(
          updatedProfile,
          updateData,
          'admin_fc_update_profile',
        );
      } else {
        const { data: profile, error: profileError } = await adminSupabase
          .from('fc_profiles')
          .select('id,name,recommender,recommender_fc_id,career_type,temp_id,status')
          .eq('id', fcId)
          .maybeSingle();
        if (profileError) throw profileError;
        profileReceipt = requireFcMutationReceipt(
          profile,
          {},
          'admin_fc_reload_profile',
        );
      }

      const shouldNotifyTemp = tempIdChanged && Boolean(nextTempId);
      const updatedProfile = {
        ...Object.fromEntries(
          Object.keys(updateData).map((field) => [field, profileReceipt[field]]),
        ),
        id: profileReceipt.id,
        career_type: profileReceipt.career_type,
        name: profileReceipt.name,
        recommender: profileReceipt.recommender,
        recommender_fc_id: profileReceipt.recommender_fc_id,
        status: profileReceipt.status,
        temp_id: profileReceipt.temp_id,
      };

      let notificationResult: PushNotificationResult | null = null;
      if (shouldNotifyTemp && nextTempId) {
        const title = '임시번호 발급';
        const body = `임시사번: ${nextTempId} 이 발급되었습니다.`;
        notificationResult = await sendPushNotificationToCanonicalFc(fcId, {
          title,
          body,
          target: { version: 1, kind: 'onboarding_section', fcId, section: 'consent' },
          data: { url: '/consent' },
        });
      }

      return NextResponse.json({
        ok: true,
        profile: updatedProfile,
        ...notificationResponse(notificationResult),
      });
    }

    if (action === 'updateStatus') {
      const { fcId, status, title, msg, extra: rawExtra } = payload as {
        fcId?: string;
        status?: string;
        title?: string;
        msg?: string;
        extra?: Record<string, unknown>;
      };
      if (!fcId || !isFcStatus(status)) return badRequest('fcId and valid status are required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;
      let extra = parseFcStatusUpdateExtra(status, rawExtra);
      if (!extra) return badRequest('status extra fields are invalid');

      if (isAllowanceFlowMutation(status, extra)) {
        const { data: currentProfile, error: profileError } = await adminSupabase
          .from('fc_profiles')
          .select('allowance_date,temp_id')
          .eq('id', fcId)
          .maybeSingle();
        if (profileError) throw profileError;

        if (!String(currentProfile?.temp_id ?? '').trim() && requiresAllowanceDate(status, extra)) {
          return badRequest('임시사번 발급 후 보증 보험 동의를 진행할 수 있습니다.');
        }

        const normalizedAllowanceDate = String(extra?.allowance_date ?? currentProfile?.allowance_date ?? '').trim();
        if (!normalizedAllowanceDate && requiresAllowanceDate(status, extra)) {
          return badRequest('보증보험 조회 동의일을 먼저 입력해주세요.');
        }
        if (normalizedAllowanceDate && !isValidIsoDate(normalizedAllowanceDate)) {
          return badRequest('유효한 보증보험 조회 동의일을 입력해주세요.');
        }

        extra = {
          ...(extra ?? {}),
          allowance_date: normalizedAllowanceDate || null,
        };
      }

      if (status === 'hanwha-commission-approved') {
        const approvedDate = String(extra?.hanwha_commission_date ?? dayjs().format('YYYY-MM-DD')).trim();
        const submittedDate = String(extra?.hanwha_commission_date_sub ?? '').trim();

        if (!approvedDate || !isValidIsoDate(approvedDate)) {
          return badRequest('다위촉 URL 처리일이 필요합니다.');
        }
        extra = {
          ...(extra ?? {}),
          hanwha_commission_date: approvedDate,
        };

        const { data: currentProfile, error: profileError } = await adminSupabase
          .from('fc_profiles')
          .select('hanwha_commission_date_sub')
          .eq('id', fcId)
          .maybeSingle();
        if (profileError) throw profileError;
        const effectiveSubmittedDate = submittedDate || String(currentProfile?.hanwha_commission_date_sub ?? '').trim();
        if (!effectiveSubmittedDate || !isValidIsoDate(effectiveSubmittedDate)) {
          return badRequest('다위촉 URL 완료일을 입력해주세요.');
        }
        extra = {
          ...(extra ?? {}),
          hanwha_commission_date_sub: effectiveSubmittedDate,
        };
      }

      if (status === 'docs-approved' && !(await areAllRequestedDocsApproved(fcId))) {
        return badRequest('모든 요청 서류가 승인된 뒤에만 다위촉 URL 단계로 넘길 수 있습니다.');
      }

      if (status === 'docs-pending') {
        extra = {
          ...(extra ?? {}),
          ...buildFcDocWorkflowResetPayload(),
        };
      }

      const updatePayload = { ...(extra ?? {}), status };
      const { data: updatedData, error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId)
        .select(ADMIN_FC_STATUS_UPDATE_RECEIPT_SELECT);

      if (updateError) throw updateError;
      const updatedProfile = requireSingleFcMutationReceipt(
        updatedData,
        updatePayload,
        'admin_fc_update_status',
      );
      logger.debug('[api/admin/fc] updateStatus result', {
        category: 'admin_fc_update',
        resultStatus: 'completed',
        updatedCount: 1,
      });

      let notificationResult: PushNotificationResult | null = null;
      if (msg) {
        const finalTitle = title || '상태 업데이트';
        let url = '/notifications';
        if (status === 'allowance-consented') url = '/docs-upload';
        else if (status === 'docs-approved') url = '/hanwha-commission';
        else if (status === 'hanwha-commission-approved') url = '/hanwha-commission';
        else if (status === 'temp-id-issued') url = '/consent';

        notificationResult = await sendPushNotificationToCanonicalFc(fcId, {
          title: finalTitle,
          body: msg,
          target: {
            version: 1,
            kind: 'onboarding_section',
            fcId,
            section: status === 'allowance-consented'
              ? 'docs_upload'
              : status === 'docs-approved' || status === 'hanwha-commission-approved'
                ? 'hanwha_commission'
                : status === 'temp-id-issued'
                  ? 'consent'
                  : 'home',
          },
          data: { url },
        });
      }

      return NextResponse.json({
        ok: true,
        status: updatedProfile.status,
        profile: {
          id: updatedProfile.id,
          ...Object.fromEntries(
            Object.keys(updatePayload).map((field) => [field, updatedProfile[field]]),
          ),
        },
        ...notificationResponse(notificationResult),
      });
    }

    if (action === 'updateAllowanceDate') {
      const { fcId, allowanceDate } = payload as {
        fcId?: string;
        allowanceDate?: string | null;
      };
      const normalizedAllowanceDate = String(allowanceDate ?? '').trim();
      if (!fcId || !normalizedAllowanceDate) return badRequest('fcId and allowanceDate are required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;
      if (!isValidIsoDate(normalizedAllowanceDate)) return badRequest('유효한 보증보험 조회 동의일을 입력해주세요.');

      const { data: profile, error: profileError } = await adminSupabase
        .from('fc_profiles')
        .select('status,temp_id')
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return badRequest('FC profile not found');
      if (!String(profile.temp_id ?? '').trim()) {
        return badRequest('임시사번 발급 후 보증보험 조회 동의일을 저장할 수 있습니다.');
      }

      const nextStatus = resolveAllowanceStatus(profile.status);
      const expectedUpdate = {
        allowance_date: normalizedAllowanceDate,
        allowance_prescreen_requested_at: null,
        allowance_reject_reason: null,
        status: nextStatus,
      };
      const { data: updatedProfile, error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update(expectedUpdate)
        .eq('id', fcId)
        .select('allowance_date,allowance_prescreen_requested_at,allowance_reject_reason,status')
        .maybeSingle();
      if (updateError) throw updateError;
      const receipt = requireFcMutationReceipt(
        updatedProfile,
        expectedUpdate,
        'admin_fc_update_allowance_date',
      );

      return NextResponse.json({
        ok: true,
        allowance_date: receipt.allowance_date,
        status: receipt.status,
      });
    }

    if (action === 'updateHanwhaSubmissionDate') {
      const { fcId, submittedDate } = payload as {
        fcId?: string;
        submittedDate?: string | null;
      };
      const normalizedSubmittedDate = String(submittedDate ?? '').trim();
      if (!fcId || !normalizedSubmittedDate) return badRequest('fcId and submittedDate are required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;
      if (!isValidIsoDate(normalizedSubmittedDate)) return badRequest('유효한 다위촉 URL 완료일을 입력해주세요.');

      const { data: profile, error: profileError } = await adminSupabase
        .from('fc_profiles')
        .select('status')
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return NextResponse.json({ error: 'FC profile not found' }, { status: 404 });

      const nextStatus =
        profile?.status === 'hanwha-commission-approved' ||
        profile?.status === 'appointment-completed' ||
        profile?.status === 'final-link-sent'
          ? profile.status
          : 'hanwha-commission-review';

      const expectedUpdate = {
        hanwha_commission_date_sub: normalizedSubmittedDate,
        hanwha_commission_reject_reason: null,
        status: nextStatus,
      };
      const { data: updatedProfile, error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update(expectedUpdate)
        .eq('id', fcId)
        .select('hanwha_commission_date_sub,hanwha_commission_reject_reason,status')
        .maybeSingle();
      if (updateError) throw updateError;
      const receipt = requireFcMutationReceipt(
        updatedProfile,
        expectedUpdate,
        'admin_fc_update_hanwha_submission_date',
      );

      return NextResponse.json({
        ok: true,
        hanwha_commission_date_sub: receipt.hanwha_commission_date_sub,
        status: receipt.status,
      });
    }

    if (action === 'markDawichokUrlSent') {
      const { fcId } = payload as { fcId?: string };
      if (!fcId) return badRequest('fcId is required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;

      const { data: profile, error: profileError } = await adminSupabase
        .from('fc_profiles')
        .select('status')
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return NextResponse.json({ error: 'FC profile not found' }, { status: 404 });
      if (!DAWICHOK_URL_SIGNAL_STATUSES.has(String(profile.status ?? ''))) {
        return badRequest('서류 승인 후에만 다위촉 URL 발송 신호를 보낼 수 있습니다.');
      }

      const sentAt = new Date().toISOString();
      const sentBy = sessionCheck.session.residentDigits;
      const expectedUpdate = {
        dawichok_url_sent_at: sentAt,
        dawichok_url_sent_by: sentBy,
      };
      const { data: updatedProfile, error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update(expectedUpdate)
        .eq('id', fcId)
        .select('dawichok_url_sent_at,dawichok_url_sent_by')
        .maybeSingle();
      if (updateError) throw updateError;
      const receipt = requireFcMutationReceipt(
        updatedProfile,
        expectedUpdate,
        'admin_fc_mark_dawichok_url_sent',
      );

      const title = '다위촉 URL 안내';
      const msg = '카카오톡으로 전송된 다위촉 URL을 진행해 주세요.';
      const url = '/hanwha-commission';
      const notificationResult = await sendPushNotificationToCanonicalFc(fcId, {
        title,
        body: msg,
        target: {
          version: 1,
          kind: 'onboarding_section',
          fcId,
          section: 'hanwha_commission',
        },
        data: { url },
      });

      return NextResponse.json({
        ok: true,
        dawichok_url_sent_at: receipt.dawichok_url_sent_at,
        dawichok_url_sent_by: receipt.dawichok_url_sent_by,
        ...notificationResponse(notificationResult),
      });
    }

    if (action === 'updateAppointmentDate') {
      const { fcId, category, appointmentDate } = payload as {
        fcId?: string;
        category?: 'life' | 'nonlife';
        appointmentDate?: string | null;
      };
      const normalizedAppointmentDate = String(appointmentDate ?? '').trim();
      if (!fcId || !category || !normalizedAppointmentDate) {
        return badRequest('FC, 위촉 구분, 위촉 완료일이 모두 필요합니다.');
      }
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;
      if (!['life', 'nonlife'].includes(category)) {
        return badRequest('유효한 위촉 구분이 필요합니다.');
      }
      if (!isValidIsoDate(normalizedAppointmentDate)) {
        return badRequest('유효한 위촉 완료일을 입력해주세요.');
      }

      const { data: profile, error: profileError } = await adminSupabase
        .from('fc_profiles')
        .select([
          'status',
          'hanwha_commission_date',
          'hanwha_commission_pdf_path',
          'hanwha_commission_pdf_name',
          'appointment_schedule_life',
          'appointment_schedule_nonlife',
          'appointment_date_life_sub',
          'appointment_date_nonlife_sub',
          'appointment_reject_reason_life',
          'appointment_reject_reason_nonlife',
          'appointment_date_life',
          'appointment_date_nonlife',
          'life_commission_completed',
          'nonlife_commission_completed',
        ].join(','))
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return badRequest('FC profile not found');
      const appointmentProfile = profile as Parameters<typeof resolveAppointmentCompletionStatus>[0];
      if (!hasAppointmentWorkflowEvidence(appointmentProfile) && !hasHanwhaApprovedPdf(appointmentProfile)) {
        return badRequest('다위촉 URL 승인 후 PDF가 등록되어야 생명/손해 위촉 단계를 진행할 수 있습니다.');
      }

      const nextProfile =
        category === 'life'
          ? {
              ...appointmentProfile,
              appointment_date_life: normalizedAppointmentDate,
            }
          : {
              ...appointmentProfile,
              appointment_date_nonlife: normalizedAppointmentDate,
            };
      const nextStatus = resolveAppointmentCompletionStatus(nextProfile);

      const expectedUpdate = category === 'life'
        ? {
            appointment_date_life: normalizedAppointmentDate,
            appointment_reject_reason_life: null,
            status: nextStatus,
          }
        : {
            appointment_date_nonlife: normalizedAppointmentDate,
            appointment_reject_reason_nonlife: null,
            status: nextStatus,
          };
      const { data: updatedProfile, error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update(expectedUpdate)
        .eq('id', fcId)
        .select([
          'appointment_date_life',
          'appointment_reject_reason_life',
          'appointment_date_nonlife',
          'appointment_reject_reason_nonlife',
          'status',
        ].join(','))
        .maybeSingle();
      if (updateError) throw updateError;
      const receipt = requireFcMutationReceipt(
        updatedProfile,
        expectedUpdate,
        'admin_fc_update_appointment_date',
      );
      const appointmentDateField = category === 'life'
        ? 'appointment_date_life'
        : 'appointment_date_nonlife';

      return NextResponse.json({
        ok: true,
        appointmentDate: receipt[appointmentDateField],
        category,
        status: receipt.status,
      });
    }

    if (action === 'updateDocsRequest') {
      const { fcId, types, deadline } = payload as { fcId?: string; types?: string[]; deadline?: string | null };
      if (!fcId || !Array.isArray(types) || types.some((type) => typeof type !== 'string')) return badRequest('서류 종류를 확인해주세요.');
      if (deadline && !isValidIsoDate(deadline)) return badRequest('서류 마감일을 확인해주세요.');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;
      const { data, error } = await adminSupabase.rpc('update_fc_document_requests_atomic_v1', {
        p_actor_phone: sessionCheck.session.residentDigits, p_actor_role: sessionCheck.session.role,
        p_fc_id: fcId, p_types: types, p_deadline: deadline || null,
      });
      if (error) throw error;
      if (!data || data.updated !== true) return NextResponse.json({ error: '서류 요청 반영 결과를 확인하지 못했습니다.' }, { status: 502 });
      const cleanupPending = await drainDocumentCleanup(fcId);
      const notificationResult = types.length > 0 ? await sendPushNotificationToCanonicalFc(fcId, {
        title: '필수 서류 등록 알림', body: '관리자가 필수 서류 목록을 갱신하였습니다. 확인 후 제출해주세요.',
        target: { version: 1, kind: 'onboarding_section', fcId, section: 'docs_upload' }, data: { url: '/docs-upload' },
      }) : null;
      return NextResponse.json({ ok: true, updated: true, cleanupPending, ...notificationResponse(notificationResult) });
    }

    if (action === 'getDocumentCleanupStatus') {
      const { fcId } = payload as { fcId?: string };
      if (!fcId) return badRequest('fcId is required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;
      const { count, error } = await adminSupabase.from('fc_document_cleanup_queue')
        .select('storage_path', { count: 'exact', head: true }).eq('fc_id', fcId);
      if (error) throw error;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        return NextResponse.json({ ok: false, error: '파일 정리 상태를 확인할 수 없습니다.' }, { status: 502 });
      }
      return NextResponse.json({ ok: true, cleanupPending: count > 0 });
    }

    if (action === 'retryDocumentCleanup') {
      const { fcId } = payload as { fcId?: string };
      if (!fcId) return badRequest('fcId is required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;
      return NextResponse.json({ ok: true, cleanupPending: await drainDocumentCleanup(fcId) });
    }

    if (action === 'updateDocStatus') {
      const { fcId, docType, status, reviewerNote } = payload as {
        fcId?: string;
        docType?: string;
        status?: string;
        reviewerNote?: string | null;
      };
      if (!fcId || !docType || !status) return badRequest('fcId, docType, and status are required');
      const normalizedStatus = String(status).trim();
      if (!['pending', 'approved', 'rejected'].includes(normalizedStatus)) {
        return badRequest('status must be pending, approved, or rejected');
      }
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;

      const { data: doc, error: docError } = await adminSupabase
        .from('fc_documents')
        .select('storage_path')
        .eq('fc_id', fcId)
        .eq('doc_type', docType)
        .maybeSingle();
      if (docError) throw docError;
      if (!doc) return badRequest('Document row not found');

      const noteForNoFile =
        normalizedStatus === 'approved' && isNoFileDoc(doc.storage_path)
          ? NO_FILE_APPROVAL_NOTE
          : null;
      const trimmedReviewerNote = typeof reviewerNote === 'string' ? reviewerNote.trim() : '';

      if (normalizedStatus === 'rejected' && !trimmedReviewerNote) {
        return badRequest('반려 사유를 입력해주세요.');
      }

      const updatePayload: Record<string, unknown> = { status: normalizedStatus };
      if (trimmedReviewerNote) {
        updatePayload.reviewer_note = trimmedReviewerNote;
      } else if (normalizedStatus === 'approved' && noteForNoFile) {
        updatePayload.reviewer_note = noteForNoFile;
      } else if (normalizedStatus === 'rejected') {
        updatePayload.reviewer_note = null;
      } else if (normalizedStatus === 'pending') {
        updatePayload.reviewer_note = null;
      }

      const { data: updatedDoc, error: updateErr } = await adminSupabase
        .from('fc_documents')
        .update(updatePayload)
        .eq('fc_id', fcId)
        .eq('doc_type', docType)
        .select('status,reviewer_note')
        .maybeSingle();
      if (updateErr) throw updateErr;
      const documentReceipt = requireFcMutationReceipt(
        updatedDoc,
        updatePayload,
        'admin_fc_update_document_status',
      );

      let allApproved: boolean;
      try {
        ({ allApproved } = await syncProfileAfterDocMutation(fcId));
      } catch {
        logger.warn('[api/admin/fc] saved document workflow incomplete');
        return NextResponse.json({
          ok: true,
          warning: 'workflow_update_incomplete',
          allApproved: null,
          reviewerNote: documentReceipt.reviewer_note ?? null,
          status: documentReceipt.status,
        });
      }

      let notificationResult: NotificationPersistenceResult | null = null;
      if (normalizedStatus === 'rejected') {
        const title = '서류 반려 안내';
        const reasonText = trimmedReviewerNote || '사유 없음';
        const body = `제출하신 [${docType}] 서류가 반려되었습니다.\n사유: ${reasonText}`;
        notificationResult = await queuePushNotificationToCanonicalFc(fcId, {
          title,
          body,
          target: { version: 1, kind: 'onboarding_section', fcId, section: 'docs_upload' },
          data: { url: '/docs-upload' },
          category: '서류',
        });
      } else if (normalizedStatus === 'approved' && allApproved) {
        const title = '서류 검토 완료';
        const body = '모든 서류가 승인되었습니다. 다위촉 단계로 진행해주세요.';
        notificationResult = await queuePushNotificationToCanonicalFc(fcId, {
          title,
          body,
          target: {
            version: 1,
            kind: 'onboarding_section',
            fcId,
            section: 'hanwha_commission',
          },
          data: { url: '/hanwha-commission' },
          category: '서류',
        });
      } else if (normalizedStatus === 'approved') {
        const title = '서류 승인 안내';
        const body = `제출하신 [${docType}] 서류가 승인되었습니다.`;
        notificationResult = await queuePushNotificationToCanonicalFc(fcId, {
          title,
          body,
          target: { version: 1, kind: 'onboarding_section', fcId, section: 'docs_upload' },
          data: { url: '/docs-upload' },
          category: '서류',
        });
      }

      return NextResponse.json({
        ok: true,
        allApproved,
        reviewerNote: documentReceipt.reviewer_note ?? null,
        status: documentReceipt.status,
        ...notificationResponse(notificationResult),
      });
    }

    if (action === 'deleteDocFile') {
      const { fcId, docType, storagePath } = payload as { fcId?: string; docType?: string; storagePath?: string };
      if (!fcId || !docType || !storagePath) return badRequest('fcId, docType, storagePath are required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;
      const { data, error } = await adminSupabase.rpc('remove_fc_document_atomic_v1', {
        p_actor_phone: sessionCheck.session.residentDigits, p_actor_role: sessionCheck.session.role,
        p_fc_id: fcId, p_doc_type: docType, p_expected_storage_path: storagePath,
      });
      if (error) throw error;
      if (!data || data.deleted !== true) return NextResponse.json({ error: '서류 삭제 결과를 확인하지 못했습니다.' }, { status: 502 });
      return NextResponse.json({ ok: true, deleted: true, cleanupPending: await drainDocumentCleanup(fcId) });
    }

    if (action === 'signDoc') {
      const { path, fcId: requestedFcId } = payload as { path?: string; fcId?: string };
      const normalizedPath = normalizeFcDocumentStoragePath(path);
      if (!normalizedPath) return badRequest('path is required');
      // The path is decoded here, and Storage collapses dot segments, so an owned row value
      // such as "<fc>/../<other fc>/x.pdf" would sign another member's file.
      if (!isPlainFcDocumentPath(normalizedPath)) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      let fcId = requestedFcId;
      if (!fcId) {
        const { data: doc, error: docError } = await adminSupabase.from('fc_documents')
          .select('fc_id').eq('storage_path', normalizedPath).maybeSingle();
        if (docError) throw docError;
        fcId = doc?.fc_id;
        if (!fcId) {
          const { data: profile, error: profileError } = await adminSupabase.from('fc_profiles')
            .select('id').eq('hanwha_commission_pdf_path', normalizedPath).maybeSingle();
          if (profileError) throw profileError;
          fcId = profile?.id;
        }
      }
      if (!fcId) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;
      const { data: owner, error: ownerError } = await adminSupabase.from('fc_profiles')
        .select('hanwha_commission_pdf_path,fc_documents(storage_path)').eq('id', fcId).maybeSingle();
      if (ownerError) throw ownerError;
      if (!owner) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      const documents = requireSupabaseRows(owner.fc_documents, 'admin_fc_document_owner');
      const paths = [owner.hanwha_commission_pdf_path, ...documents.map((doc) => doc.storage_path)];
      if (!paths.some((storedPath) => normalizeFcDocumentStoragePath(storedPath) === normalizedPath)) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      const { data, error } = await adminSupabase.storage
        .from('fc-documents')
        .createSignedUrl(normalizedPath, 60);
      if (error || !data?.signedUrl) {
        throw error ?? new Error('Signed URL creation failed');
      }
      return NextResponse.json({ ok: true, signedUrl: data.signedUrl });
    }

    if (action === 'sendReminder') {
      const { fcId, title, body, url, target: rawTarget } = payload as {
        fcId?: string;
        title?: string;
        body?: string;
        url?: string;
        target?: unknown;
      };
      if (!fcId || !title || !body) return badRequest('fcId, title, body are required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;

      const target = parseNotificationTargetV1(rawTarget);
      if (!target) return badRequest('A valid notification target is required');
      if (
        ('fcId' in target && target.fcId !== fcId)
        || target.kind === 'request'
        || target.kind === 'request_chat'
        || target.kind === 'request_direct_chat'
      ) {
        return badRequest('Notification target does not match the FC');
      }
      const notificationResult = await sendPushNotificationToCanonicalFc(fcId, {
        title,
        body,
        target,
        data: { url: url ?? '/notifications' },
      });

      return NextResponse.json({ ok: true, ...notificationResponse(notificationResult) });
    }

    if (action === 'getReferralCode' || action === 'getInviteeReferralCode') {
      const { fcId } = payload as { fcId?: string };
      if (!fcId) return badRequest('fcId is required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;

      const { data, error } = await adminSupabase.rpc('get_invitee_referral_code', {
        p_fc_id: fcId,
      });

      if (error) throw error;
      const signupReferralCode = (data as string | null) ?? null;
      return NextResponse.json({
        ok: true,
        signupReferralCode,
        inviteeReferralCode: signupReferralCode,
        referralCode: signupReferralCode,
      });
    }

    return badRequest('Unknown action');
  } catch (err: unknown) {
    const error = err as Error;
    if ((err as { code?: string })?.code === 'PGRST202') return NextResponse.json({ error: '서류 변경 기능이 아직 준비되지 않았습니다. 운영 담당자에게 문의해주세요.' }, { status: 503 });
    if (isRecommenderRpcNotReadyError(error)) {
      logger.error('[api/admin/fc] recommender RPC unavailable', error);
      return NextResponse.json({ error: RECOMMENDER_RELATION_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    if (error?.message && [
      '추천인은 목록에서 선택해주세요.',
      '추천인 대상 FC를 찾을 수 없습니다.',
      '추천인 후보 FC를 찾을 수 없습니다.',
      '추천인 변경 사유를 입력해주세요.',
      '활성 추천코드가 있는 FC만 추천인으로 선택할 수 있습니다.',
      '자기 자신을 추천인으로 지정할 수 없습니다.',
      '추천 관계 대상 FC 전화번호가 올바르지 않습니다.',
      '추천인 후보 FC 전화번호가 올바르지 않습니다.',
    ].includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (
      typeof (err as { code?: unknown })?.code === 'string' &&
      (err as { code?: string }).code === '42703' &&
      typeof (err as { message?: unknown })?.message === 'string' &&
      (err as { message?: string }).message?.includes('fc_profiles.admin_memo')
    ) {
      logger.error('[api/admin/fc] admin memo column unavailable', {
        code: (err as { code?: string })?.code ?? 'unknown',
      });
      return NextResponse.json(
        { error: '관리자 메모를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' },
        { status: 500 }
      );
    }
    return serverError(err, 'api/admin/fc');
  }
}
