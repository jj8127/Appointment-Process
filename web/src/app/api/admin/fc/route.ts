import dayjs from 'dayjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { sendPushNotification } from '@/app/actions';
import {
  applyRecommenderSelection,
  searchRecommenderCandidates,
} from '@/lib/admin-referrals';
import { adminSupabase } from '@/lib/admin-supabase';
import {
  hasAppointmentWorkflowEvidence,
  hasHanwhaApprovedPdf,
  resolveAppointmentCompletionStatus,
} from '@/lib/fc-workflow';
import { validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { buildPhoneCandidates } from '@/lib/server-session';

type AdminAction =
  | 'getProfile'
  | 'updateProfile'
  | 'updateStatus'
  | 'updateAllowanceDate'
  | 'updateHanwhaSubmissionDate'
  | 'updateAppointmentDate'
  | 'updateDocsRequest'
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

type AdminRequest = {
  action: AdminAction;
  payload: Record<string, unknown>;
};

const RECOMMENDER_RPC_NOT_READY_MESSAGE =
  '운영 DB에 추천인 override 함수가 아직 적용되지 않았습니다. migration 20260331000005를 먼저 반영해주세요.';

async function getValidatedCookieSession(): Promise<SessionErrorResult | SessionSuccessResult<CookieSession>> {
  const cookieStore = await cookies();
  const session = {
    role: cookieStore.get('session_role')?.value ?? null,
    residentId: cookieStore.get('session_resident')?.value ?? '',
  };
  const sessionCheck = validateSession(session);
  if (!sessionCheck.valid) {
    return { ok: false, status: 401, error: sessionCheck.error ?? 'Unauthorized' };
  }
  const residentDigits = session.residentId.replace(/[^0-9]/g, '');
  if (residentDigits.length !== 11) {
    return { ok: false, status: 401, error: 'Invalid resident phone' };
  }

  return {
    ok: true as const,
    session: {
      role: session.role,
      residentId: session.residentId,
      residentDigits,
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

function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function resolveAllowanceStatus(currentStatus: string | null | undefined): string {
  if (!currentStatus || ['draft', 'temp-id-issued', 'allowance-pending', 'allowance-consented'].includes(currentStatus)) {
    return 'allowance-pending';
  }
  return currentStatus;
}

function sanitizeFileName(fileName: string): string {
  const normalized = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  const collapsed = normalized.replace(/-+/g, '-').replace(/^-|-$/g, '');
  const ensuredPdf = collapsed.toLowerCase().endsWith('.pdf') ? collapsed : `${collapsed || 'hanwha-commission'}.pdf`;
  return ensuredPdf;
}

function buildDocWorkflowResetPayload() {
  return {
    hanwha_commission_date_sub: null,
    hanwha_commission_date: null,
    hanwha_commission_reject_reason: null,
    hanwha_commission_pdf_path: null,
    hanwha_commission_pdf_name: null,
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

async function syncProfileAfterDocMutation(fcId: string) {
  const { data: docs, error: docsError } = await adminSupabase
    .from('fc_documents')
    .select('status,storage_path')
    .eq('fc_id', fcId);
  if (docsError) throw docsError;

  const allDocs = docs ?? [];
  const allSubmitted =
    allDocs.length > 0 && allDocs.every((doc) => doc.storage_path && doc.storage_path !== 'deleted');
  const allApproved = allSubmitted && allDocs.every((doc) => doc.status === 'approved');

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
    if (action === 'getProfile') {
      const { fcId } = payload as { fcId?: string };
      if (!fcId) return badRequest('fcId is required');

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
      const { fcId, data, phone } = payload as {
        fcId?: string;
        data?: Record<string, unknown>;
        phone?: string;
      };
      if (!fcId || !data) return badRequest('fcId and data are required');

      const updateData = { ...data };
      const hasStructuredRecommender = Object.prototype.hasOwnProperty.call(updateData, 'recommenderFcId');
      const nextRecommenderFcId = hasStructuredRecommender
        ? (String(updateData.recommenderFcId ?? '').trim() || null)
        : null;
      const recommenderOverrideReason = String(updateData.recommenderOverrideReason ?? '').trim();

      delete updateData.recommenderFcId;
      delete updateData.recommenderOverrideReason;

      const hasTempIdUpdate = Object.prototype.hasOwnProperty.call(updateData, 'temp_id');
      if (hasTempIdUpdate) {
        if (typeof updateData.temp_id === 'string') {
          updateData.temp_id = updateData.temp_id.trim() || null;
        } else if (updateData.temp_id == null) {
          updateData.temp_id = null;
        }
      }

      if (Object.prototype.hasOwnProperty.call(updateData, 'recommender')) {
        return badRequest('추천인은 목록에서 선택해주세요.');
      }

      if (
        hasTempIdUpdate &&
        updateData.temp_id &&
        !Object.prototype.hasOwnProperty.call(updateData, 'status')
      ) {
        const { data: currentProfile, error: currentProfileError } = await adminSupabase
          .from('fc_profiles')
          .select('status')
          .eq('id', fcId)
          .maybeSingle();
        if (currentProfileError) throw currentProfileError;
        if (currentProfile?.status === 'draft') {
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

      const tempId = typeof updateData['temp_id'] === 'string' ? updateData['temp_id'] : null;
      const shouldNotifyTemp = Boolean(tempId);
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

      if (shouldNotifyTemp && phone) {
        const title = '임시번호 발급';
        const body = `임시사번: ${tempId} 이 발급되었습니다.`;
        try {
          await adminSupabase.from('notifications').insert({
            title,
            body,
            target_url: '/consent',
            recipient_role: 'fc',
            resident_id: phone,
          });
          await sendPushNotification(phone, { title, body, data: { url: '/consent' }, skipNotificationInsert: true });
          logger.debug('[api/admin/fc] temp-id notified', { fcId, name: profile?.name });
        } catch (notifyError) {
          logger.warn('[api/admin/fc] temp-id notification failed', {
            fcId,
            phone,
            error: notifyError instanceof Error ? notifyError.message : String(notifyError),
          });
        }
      }

      return NextResponse.json({ ok: true, profile: updatedProfile });
    }

    if (action === 'updateStatus') {
      const { fcId, status, title, msg, extra: rawExtra, phone } = payload as {
        fcId?: string;
        status?: string;
        title?: string;
        msg?: string;
        extra?: Record<string, unknown>;
        phone?: string;
      };
      if (!fcId || !status) return badRequest('fcId and status are required');
      let extra = rawExtra;

      if (isAllowanceFlowMutation(status, extra)) {
        const { data: currentProfile, error: profileError } = await adminSupabase
          .from('fc_profiles')
          .select('allowance_date')
          .eq('id', fcId)
          .maybeSingle();
        if (profileError) throw profileError;

        const normalizedAllowanceDate = String(extra?.allowance_date ?? currentProfile?.allowance_date ?? '').trim();
        if (normalizedAllowanceDate && !isValidYmd(normalizedAllowanceDate)) {
          return badRequest('유효한 수당 동의일을 입력해주세요.');
        }

        extra = {
          ...(extra ?? {}),
          allowance_date: normalizedAllowanceDate || null,
        };
      }

      if (status === 'hanwha-commission-approved') {
        const approvedDate = String(extra?.hanwha_commission_date ?? dayjs().format('YYYY-MM-DD')).trim();
        const submittedDate = String(extra?.hanwha_commission_date_sub ?? '').trim();
        const pdfPath = String(extra?.hanwha_commission_pdf_path ?? '').trim();
        const pdfName = String(extra?.hanwha_commission_pdf_name ?? '').trim();

        if (!approvedDate || !isValidYmd(approvedDate)) {
          return badRequest('한화 위촉 URL 승인일이 필요합니다.');
        }
        extra = {
          ...(extra ?? {}),
          hanwha_commission_date: approvedDate,
        };
        if (!pdfPath || !pdfName) {
          return badRequest('한화 위촉 URL PDF가 등록된 뒤에만 승인할 수 있습니다.');
        }

        const { data: currentProfile, error: profileError } = await adminSupabase
          .from('fc_profiles')
          .select('hanwha_commission_date_sub')
          .eq('id', fcId)
          .maybeSingle();
        if (profileError) throw profileError;
        const effectiveSubmittedDate = submittedDate || String(currentProfile?.hanwha_commission_date_sub ?? '').trim();
        if (!effectiveSubmittedDate || !isValidYmd(effectiveSubmittedDate)) {
          return badRequest('한화 위촉 URL 완료일을 입력해주세요.');
        }
        extra = {
          ...(extra ?? {}),
          hanwha_commission_date_sub: effectiveSubmittedDate,
        };
      }

      const { data: updatedData, error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update({ status, ...(extra ?? {}) })
        .eq('id', fcId)
        .select();

      logger.debug('[api/admin/fc] updateStatus result', {
        fcId,
        status,
        updatedCount: updatedData?.length,
        updatedData,
        error: updateError
      });

      if (updateError) throw updateError;

      if (msg && phone) {
        const finalTitle = title || '상태 업데이트';
        let url = '/notifications';
        if (status === 'allowance-consented') url = '/docs-upload';
        else if (status === 'docs-approved') url = '/hanwha-commission';
        else if (status === 'hanwha-commission-approved') url = '/hanwha-commission';
        else if (status === 'temp-id-issued') url = '/consent';

        await adminSupabase.from('notifications').insert({
          title: finalTitle,
          body: msg,
          target_url: url,
          recipient_role: 'fc',
          resident_id: phone,
        });

        await sendPushNotification(phone, { title: finalTitle, body: msg, data: { url }, skipNotificationInsert: true });
      }

      return NextResponse.json({ ok: true });
    }

    if (action === 'updateAllowanceDate') {
      const { fcId, allowanceDate } = payload as {
        fcId?: string;
        allowanceDate?: string | null;
      };
      const normalizedAllowanceDate = String(allowanceDate ?? '').trim();
      if (!fcId || !normalizedAllowanceDate) return badRequest('fcId and allowanceDate are required');
      if (!isValidYmd(normalizedAllowanceDate)) return badRequest('유효한 수당 동의일을 입력해주세요.');

      const { data: profile, error: profileError } = await adminSupabase
        .from('fc_profiles')
        .select('status')
        .eq('id', fcId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return badRequest('FC profile not found');

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
      if (!isValidYmd(normalizedSubmittedDate)) return badRequest('유효한 한화 위촉 URL 완료일을 입력해주세요.');

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
        return badRequest('한화 위촉 URL 승인과 PDF 등록이 끝난 뒤에만 생명/손해 위촉 단계를 진행할 수 있습니다.');
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
      const { fcId, types, deadline, phone, currentDeadline } = payload as {
        fcId?: string;
        types?: string[];
        deadline?: string | null;
        currentDeadline?: string | null;
        phone?: string;
      };
      if (!fcId || !Array.isArray(types)) return badRequest('fcId and types are required');

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

      if (phone) {
        const title = '필수 서류 등록 알림';
        const body = '관리자가 필수 서류 목록을 갱신하였습니다. 확인 후 제출해주세요.';
        await adminSupabase.from('notifications').insert({
          title,
          body,
          target_url: '/docs-upload',
          recipient_role: 'fc',
          resident_id: phone,
        });
        await sendPushNotification(phone, { title, body, data: { url: '/docs-upload' }, skipNotificationInsert: true });
      }

      return NextResponse.json({ ok: true });
    }

    if (action === 'deleteDocFile') {
      const { fcId, docType, storagePath } = payload as {
        fcId?: string;
        docType?: string;
        storagePath?: string;
      };
      if (!fcId || !docType || !storagePath) return badRequest('fcId, docType, storagePath are required');

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

    if (action === 'createHanwhaPdfUploadUrl') {
      const { fcId, fileName } = payload as {
        fcId?: string;
        fileName?: string;
      };
      if (!fcId || !fileName) return badRequest('fcId and fileName are required');

      const safeName = sanitizeFileName(fileName);
      const storagePath = `${fcId}/hanwha-commission/${Date.now()}-${safeName}`;
      const { data, error } = await adminSupabase.storage
        .from('fc-documents')
        .createSignedUploadUrl(storagePath, { upsert: true });
      if (error || !data?.signedUrl || !data?.token) {
        throw error ?? new Error('Signed upload URL creation failed');
      }

      return NextResponse.json({
        ok: true,
        path: storagePath,
        signedUrl: data.signedUrl,
        token: data.token,
      });
    }

    if (action === 'deleteHanwhaPdf') {
      const { fcId, storagePath } = payload as {
        fcId?: string;
        storagePath?: string;
      };
      if (!fcId || !storagePath) return badRequest('fcId and storagePath are required');

      const { error: storageErr } = await adminSupabase.storage
        .from('fc-documents')
        .remove([storagePath]);
      if (storageErr) throw storageErr;

      const { error: updateErr } = await adminSupabase
        .from('fc_profiles')
        .update({
          hanwha_commission_pdf_path: null,
          hanwha_commission_pdf_name: null,
        })
        .eq('id', fcId);
      if (updateErr) throw updateErr;

      return NextResponse.json({ ok: true });
    }

    if (action === 'signDoc') {
      const { path } = payload as { path?: string };
      if (!path) return badRequest('path is required');
      const { data, error } = await adminSupabase.storage
        .from('fc-documents')
        .createSignedUrl(path, 60);
      if (error || !data?.signedUrl) {
        throw error ?? new Error('Signed URL creation failed');
      }
      return NextResponse.json({ ok: true, signedUrl: data.signedUrl });
    }

    if (action === 'sendReminder') {
      const { phone, title, body, url } = payload as {
        phone?: string;
        title?: string;
        body?: string;
        url?: string;
      };
      if (!phone || !title || !body) return badRequest('phone, title, body are required');

      await adminSupabase.from('notifications').insert({
        title,
        body,
        target_url: url ?? '/notifications',
        recipient_role: 'fc',
        resident_id: phone,
      });

        await sendPushNotification(phone, { title, body, data: url ? { url } : undefined, skipNotificationInsert: true });
      return NextResponse.json({ ok: true });
    }

    if (action === 'getReferralCode' || action === 'getInviteeReferralCode') {
      const { fcId } = payload as { fcId?: string };
      if (!fcId) return badRequest('fcId is required');

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
