import dayjs from 'dayjs';
import { NextResponse } from 'next/server';

import {
  applyRecommenderSelection,
  searchRecommenderCandidates,
} from '@/lib/admin-referrals';
import { adminSupabase } from '@/lib/admin-supabase';
import { resolveAdminTempIdUpdate } from '@/lib/admin-temp-id-update';
import {
  sendPushNotificationToResident,
  type PushPayload,
  type PushNotificationResult,
} from '@/lib/push-notification-service';
import {
  hasAppointmentWorkflowEvidence,
  hasHanwhaApprovedPdf,
  resolveAppointmentCompletionStatus,
} from '@/lib/fc-workflow';
import { normalizeFcDocumentStoragePath } from '@/lib/admin-fc-doc-storage';
import { validateHanwhaPdfPayload } from '@/lib/admin-hanwha-pdf-payload';
import { logger } from '@/lib/logger';
import { buildPhoneCandidates, getVerifiedServerSession } from '@/lib/server-session';

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
  | 'createHanwhaPdfUploadUrl'
  | 'deleteHanwhaPdf'
  | 'signDoc'
  | 'sendReminder'
  | 'getInviteeReferralCode'
  | 'getReferralCode'
  | 'searchRecommenders';

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

const RECOMMENDER_RPC_NOT_READY_MESSAGE =
  '운영 DB에 추천인 상태 단일화 함수가 아직 적용되지 않았습니다. migration 20260423000001을 먼저 반영해주세요.';
const DAWICHOK_URL_SIGNAL_STATUSES = new Set([
  'docs-approved',
  'hanwha-commission-review',
  'hanwha-commission-rejected',
  'hanwha-commission-approved',
  'appointment-completed',
  'final-link-sent',
]);

function notificationResponse(result: PushNotificationResult | null) {
  if (!result) return {};
  return {
    notification: result,
    ...(result.success ? {} : { warning: 'notification_delivery_incomplete' }),
  };
}

async function sendPushNotificationToCanonicalFc(
  fcId: string,
  payload: PushPayload,
): Promise<PushNotificationResult> {
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
    return sendPushNotificationToResident('', payload);
  }

  return sendPushNotificationToResident(phone, payload);
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

function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
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

function buildDocWorkflowResetPayload() {
  return {
    hanwha_commission_date_sub: null,
    hanwha_commission_date: null,
    hanwha_commission_reject_reason: null,
    hanwha_commission_pdf_path: null,
    hanwha_commission_pdf_name: null,
    dawichok_url_sent_at: null,
    dawichok_url_sent_by: null,
    appointment_url: null,
    appointment_date: null,
    appointment_schedule_life: null,
    appointment_schedule_nonlife: null,
    appointment_date_life_sub: null,
    appointment_date_nonlife_sub: null,
    appointment_reject_reason_life: null,
    appointment_reject_reason_nonlife: null,
    appointment_date_life: null,
    appointment_date_nonlife: null,
    life_commission_completed: false,
    nonlife_commission_completed: false,
  };
}

const NO_FILE_APPROVAL_NOTE = '총무 수동 승인: 파일 미제출';

const isNoFileDoc = (storagePath: string | null | undefined) => {
  const normalizedPath = String(storagePath ?? '').trim();
  return !normalizedPath || normalizedPath === 'deleted';
};

async function syncProfileAfterDocMutation(fcId: string) {
  const { data: docs, error: docsError } = await adminSupabase
    .from('fc_documents')
    .select('status,storage_path')
    .eq('fc_id', fcId);
  if (docsError) throw docsError;

  const allDocs = docs ?? [];
  const allApproved = allDocs.length > 0 && allDocs.every((doc) => doc.status === 'approved');

  const { error: profileError } = await adminSupabase
    .from('fc_profiles')
    .update(
      allApproved
        ? { status: 'docs-approved' }
        : {
            status: 'docs-pending',
            ...buildDocWorkflowResetPayload(),
          },
    )
    .eq('id', fcId);
  if (profileError) throw profileError;

  return { allApproved };
}

async function areAllRequestedDocsApproved(fcId: string) {
  const { data: docs, error } = await adminSupabase
    .from('fc_documents')
    .select('status')
    .eq('fc_id', fcId);
  if (error) throw error;

  const requestedDocs = docs ?? [];
  return requestedDocs.length > 0 && requestedDocs.every((doc) => doc.status === 'approved');
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

  const sessionCheck = action === 'getProfile' || action === 'getReferralCode' || action === 'getInviteeReferralCode'
    ? await getReadSession()
    : await getAdminSession();
  if (!sessionCheck.ok) {
    return NextResponse.json({ error: sessionCheck.error }, { status: sessionCheck.status });
  }

  try {
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
        const safeFileName = resolvedFileName
          .replace(/[\\/:*?"<>|\r\n]+/g, '_')
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
        .select('hanwha_commission_pdf_path')
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

      const { error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update({
          hanwha_commission_pdf_path: null,
          hanwha_commission_pdf_name: null,
        })
        .eq('id', fcId);
      if (updateError) throw updateError;

      return NextResponse.json({ ok: true });
    }

    if (action === 'getProfile') {
      const { fcId } = payload as { fcId?: string };
      if (!fcId) return badRequest('fcId is required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;

      const { data, error } = await adminSupabase
        .from('fc_profiles')
        .select('*, fc_documents(*)')
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
      if (!fcId || !data) return badRequest('fcId and data are required');
      const scopeError = await requireFcProfileScope(adminSession, fcId);
      if (scopeError) return scopeError;

      const updateData = { ...data };
      const hasStructuredRecommender = Object.prototype.hasOwnProperty.call(updateData, 'recommenderFcId');
      const nextRecommenderFcId = hasStructuredRecommender
        ? (String(updateData.recommenderFcId ?? '').trim() || null)
        : null;
      const recommenderOverrideReason = String(updateData.recommenderOverrideReason ?? '').trim();

      delete updateData.recommenderFcId;
      delete updateData.recommenderOverrideReason;

      const hasTempIdUpdate = Object.prototype.hasOwnProperty.call(updateData, 'temp_id');
      let tempIdChanged = false;
      let nextTempId: string | null = null;
      if (hasTempIdUpdate && updateData.temp_id != null && typeof updateData.temp_id !== 'string') {
        return badRequest('temp_id must be a string or null');
      }

      if (Object.prototype.hasOwnProperty.call(updateData, 'recommender')) {
        return badRequest('추천인은 목록에서 선택해주세요.');
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

      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await adminSupabase
          .from('fc_profiles')
          .update(updateData)
          .eq('id', fcId);
        if (updateError) throw updateError;
      }

      if (hasStructuredRecommender) {
        await applyRecommenderSelection({
          actor: {
            actorPhone: adminSession.residentDigits,
            actorRole: 'admin',
            actorStaffType: adminSession.staffType,
          },
          inviteeFcId: fcId,
          inviterFcId: nextRecommenderFcId,
          reason: recommenderOverrideReason,
        });
      }

      const shouldNotifyTemp = tempIdChanged && Boolean(nextTempId);
      let updatedProfile: Record<string, unknown> | null = null;
      const { data: profile, error: profileError } = await adminSupabase
        .from('fc_profiles')
        .select('name,recommender,recommender_fc_id,career_type,temp_id,status')
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) {
        logger.warn('[api/admin/fc] profile reload failed after updateProfile', profileError);
      } else {
        updatedProfile = profile as Record<string, unknown> | null;
      }

      let notificationResult: PushNotificationResult | null = null;
      if (shouldNotifyTemp && nextTempId) {
        const title = '임시번호 발급';
        const body = `임시사번: ${nextTempId} 이 발급되었습니다.`;
        notificationResult = await sendPushNotificationToCanonicalFc(fcId, {
          title,
          body,
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
      if (!fcId || !status) return badRequest('fcId and status are required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;
      let extra = rawExtra;

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
        if (normalizedAllowanceDate && !isValidYmd(normalizedAllowanceDate)) {
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

        if (!approvedDate || !isValidYmd(approvedDate)) {
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
        if (!effectiveSubmittedDate || !isValidYmd(effectiveSubmittedDate)) {
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
          ...buildDocWorkflowResetPayload(),
        };
      }

      const { data: updatedData, error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update({ status, ...(extra ?? {}) })
        .eq('id', fcId)
        .select();

      logger.debug('[api/admin/fc] updateStatus result', {
        category: 'admin_fc_update',
        resultStatus: updateError ? 'failed' : 'completed',
        updatedCount: updatedData?.length,
      });

      if (updateError) throw updateError;

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
          data: { url },
        });
      }

      return NextResponse.json({ ok: true, ...notificationResponse(notificationResult) });
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
      if (!isValidYmd(normalizedAllowanceDate)) return badRequest('유효한 보증보험 조회 동의일을 입력해주세요.');

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
      const { error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update({
          allowance_date: normalizedAllowanceDate,
          allowance_prescreen_requested_at: null,
          allowance_reject_reason: null,
          status: nextStatus,
        })
        .eq('id', fcId);
      if (updateError) throw updateError;

      return NextResponse.json({
        ok: true,
        allowance_date: normalizedAllowanceDate,
        status: nextStatus,
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
      if (!isValidYmd(normalizedSubmittedDate)) return badRequest('유효한 다위촉 URL 완료일을 입력해주세요.');

      const { data: profile, error: profileError } = await adminSupabase
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

      const { error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update({
          hanwha_commission_date_sub: normalizedSubmittedDate,
          hanwha_commission_reject_reason: null,
          status: nextStatus,
        })
        .eq('id', fcId);
      if (updateError) throw updateError;

      return NextResponse.json({
        ok: true,
        hanwha_commission_date_sub: normalizedSubmittedDate,
        status: nextStatus,
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
      const { error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update({
          dawichok_url_sent_at: sentAt,
          dawichok_url_sent_by: sentBy,
        })
        .eq('id', fcId);
      if (updateError) throw updateError;

      const title = '다위촉 URL 안내';
      const msg = '카카오톡으로 전송된 다위촉 URL을 진행해 주세요.';
      const url = '/hanwha-commission';
      const notificationResult = await sendPushNotificationToCanonicalFc(fcId, {
        title,
        body: msg,
        data: { url },
      });

      return NextResponse.json({
        ok: true,
        dawichok_url_sent_at: sentAt,
        dawichok_url_sent_by: sentBy,
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
      if (!isValidYmd(normalizedAppointmentDate)) {
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

      const { error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update(
          category === 'life'
            ? {
                appointment_date_life: normalizedAppointmentDate,
                appointment_reject_reason_life: null,
                status: nextStatus,
              }
            : {
                appointment_date_nonlife: normalizedAppointmentDate,
                appointment_reject_reason_nonlife: null,
                status: nextStatus,
              },
        )
        .eq('id', fcId);
      if (updateError) throw updateError;

      return NextResponse.json({
        ok: true,
        appointmentDate: normalizedAppointmentDate,
        category,
        status: nextStatus,
      });
    }

    if (action === 'updateDocsRequest') {
      const { fcId, types, deadline, currentDeadline } = payload as {
        fcId?: string;
        types?: string[];
        deadline?: string | null;
        currentDeadline?: string | null;
      };
      if (!fcId || !Array.isArray(types)) return badRequest('fcId and types are required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;

      const nextTypes = types ?? [];
      const normalizedDeadline = deadline ? dayjs(deadline).format('YYYY-MM-DD') : null;
      const shouldResetNotify = normalizedDeadline !== (currentDeadline ?? null);

      const { data: currentDocsRaw, error: fetchErr } = await adminSupabase
        .from('fc_documents')
        .select('doc_type, storage_path')
        .eq('fc_id', fcId);
      if (fetchErr) throw fetchErr;

      const currentDocs = currentDocsRaw || [];
      const currentTypes = currentDocs.map((d) => d.doc_type);

      if (nextTypes.length === 0) {
        logger.info('[api/admin/fc] Deleting all documents', { fcId });
        const { error: deleteAllError, count: deleteAllCount } = await adminSupabase
          .from('fc_documents')
          .delete({ count: 'exact' })
          .eq('fc_id', fcId);
        if (deleteAllError) throw deleteAllError;
        logger.info('[api/admin/fc] Deleted all documents', { fcId, count: deleteAllCount });

        const { error: profileUpdateError } = await adminSupabase
          .from('fc_profiles')
          .update({
            status: 'allowance-consented',
            docs_deadline_at: null,
            docs_deadline_last_notified_at: null,
          })
          .eq('id', fcId);
        if (profileUpdateError) throw profileUpdateError;

        return NextResponse.json({ ok: true });
      }

      const toAdd = nextTypes.filter((type) => !currentTypes.includes(type));
      const toDelete = currentDocs
        .filter((d) => !nextTypes.includes(d.doc_type) && (!d.storage_path || d.storage_path === 'deleted'))
        .map((d) => d.doc_type);

      if (toDelete.length) {
        logger.info('[api/admin/fc] Deleting documents', { fcId, types: toDelete });
        const { error: deleteError, count: deleteCount } = await adminSupabase
          .from('fc_documents')
          .delete({ count: 'exact' })
          .eq('fc_id', fcId)
          .in('doc_type', toDelete);
        if (deleteError) throw deleteError;
        logger.info('[api/admin/fc] Deleted documents', { fcId, count: deleteCount, expected: toDelete.length });
      }
      if (toAdd.length) {
        const rows = toAdd.map((type) => ({
          fc_id: fcId,
          doc_type: type,
          status: 'pending' as const,
          file_name: '',
          storage_path: '',
        }));
        const { data: insertedDocs, error: insertError } = await adminSupabase
          .from('fc_documents')
          .insert(rows)
          .select();

        logger.debug('[api/admin/fc] updateDocsRequest insert result', {
          fcId,
          insertedCount: insertedDocs?.length,
          rowsToInsert: rows.length,
          error: insertError
        });

        if (insertError) throw insertError;
      }

      const profileUpdate: Record<string, string | null> = {
        docs_deadline_at: normalizedDeadline,
      };
      if (shouldResetNotify) {
        profileUpdate.docs_deadline_last_notified_at = null;
      }

      const { error: profileUpdateError } = await adminSupabase
        .from('fc_profiles')
        .update({ status: 'docs-requested', ...profileUpdate })
        .eq('id', fcId);
      if (profileUpdateError) throw profileUpdateError;

      const title = '필수 서류 등록 알림';
      const body = '관리자가 필수 서류 목록을 갱신하였습니다. 확인 후 제출해주세요.';
      const notificationResult = await sendPushNotificationToCanonicalFc(fcId, {
        title,
        body,
        data: { url: '/docs-upload' },
      });

      return NextResponse.json({ ok: true, ...notificationResponse(notificationResult) });
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

      const { error: updateErr } = await adminSupabase
        .from('fc_documents')
        .update(updatePayload)
        .eq('fc_id', fcId)
        .eq('doc_type', docType);
      if (updateErr) throw updateErr;

      const { allApproved } = await syncProfileAfterDocMutation(fcId);

      let notificationResult: PushNotificationResult | null = null;
      if (normalizedStatus === 'rejected') {
        const title = '서류 반려 안내';
        const reasonText = trimmedReviewerNote || '사유 없음';
        const body = `제출하신 [${docType}] 서류가 반려되었습니다.\n사유: ${reasonText}`;
        notificationResult = await sendPushNotificationToCanonicalFc(fcId, {
          title,
          body,
          data: { url: '/docs-upload' },
          category: '서류',
        });
      }

      if (allApproved) {
        const title = '서류 검토 완료';
        const body = '모든 서류가 승인되었습니다. 다위촉 단계로 진행해주세요.';
        notificationResult = await sendPushNotificationToCanonicalFc(fcId, {
          title,
          body,
          data: { url: '/hanwha-commission' },
        });
      }

      return NextResponse.json({
        ok: true,
        allApproved,
        ...notificationResponse(notificationResult),
      });
    }

    if (action === 'deleteDocFile') {
      const { fcId, docType, storagePath } = payload as {
        fcId?: string;
        docType?: string;
        storagePath?: string;
      };
      if (!fcId || !docType || !storagePath) return badRequest('fcId, docType, storagePath are required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;

      const { error: storageErr } = await adminSupabase.storage
        .from('fc-documents')
        .remove([storagePath]);
      if (storageErr) throw storageErr;

      const { error: updateErr } = await adminSupabase
        .from('fc_documents')
        .update({ storage_path: 'deleted', file_name: 'deleted.pdf', status: 'pending', reviewer_note: null })
        .eq('fc_id', fcId)
        .eq('doc_type', docType);
      if (updateErr) throw updateErr;

      await syncProfileAfterDocMutation(fcId);

      return NextResponse.json({ ok: true });
    }

    if (action === 'signDoc') {
      const { path } = payload as { path?: string };
      const normalizedPath = normalizeFcDocumentStoragePath(path);
      if (!normalizedPath) return badRequest('path is required');
      const { data, error } = await adminSupabase.storage
        .from('fc-documents')
        .createSignedUrl(normalizedPath, 60);
      if (error || !data?.signedUrl) {
        throw error ?? new Error('Signed URL creation failed');
      }
      return NextResponse.json({ ok: true, signedUrl: data.signedUrl });
    }

    if (action === 'sendReminder') {
      const { fcId, title, body, url } = payload as {
        fcId?: string;
        title?: string;
        body?: string;
        url?: string;
      };
      if (!fcId || !title || !body) return badRequest('fcId, title, body are required');
      const scopeError = await requireFcProfileScope(sessionCheck.session, fcId);
      if (scopeError) return scopeError;

      const notificationResult = await sendPushNotificationToCanonicalFc(fcId, {
        title,
        body,
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

    if (action === 'searchRecommenders') {
      const { query, excludeFcId, selectedFcId } = payload as {
        query?: string;
        excludeFcId?: string | null;
        selectedFcId?: string | null;
      };

      const result = await searchRecommenderCandidates({
        query,
        excludeFcId,
        selectedFcId,
      });

      return NextResponse.json({ ok: true, ...result });
    }

    return badRequest('Unknown action');
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[api/admin/fc] failed', error);
    if (isRecommenderRpcNotReadyError(error)) {
      return NextResponse.json({ error: RECOMMENDER_RPC_NOT_READY_MESSAGE }, { status: 503 });
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
      RECOMMENDER_RPC_NOT_READY_MESSAGE,
    ].includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (
      typeof (err as { code?: unknown })?.code === 'string' &&
      (err as { code?: string }).code === '42703' &&
      typeof (err as { message?: unknown })?.message === 'string' &&
      (err as { message?: string }).message?.includes('fc_profiles.admin_memo')
    ) {
      return NextResponse.json(
        { error: '관리자 메모 컬럼이 없어 저장할 수 없습니다. Supabase 마이그레이션을 먼저 적용해주세요.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: '요청 처리에 실패했습니다.' }, { status: 500 });
  }
}
