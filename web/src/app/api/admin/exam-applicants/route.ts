import { NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS } from '@/lib/csrf';
import {
  applyExamApplicantApplicationTypes,
  buildExamApplicantBaseRows,
  buildExamApplicantPhoneCandidates,
  buildExamApplicantProfileMatchPlan,
  enrichExamApplicantsWithResidentNumbers,
  type ExamApplicantProfileRow,
  type ExamRegistrationRow,
} from '@/lib/exam-applicant-resident-number-enrichment';
import { logger } from '@/lib/logger';
import { readResidentNumbersWithFallback } from '@/lib/server-resident-numbers';
import { buildPhoneCandidates, getVerifiedAdminSession, getVerifiedReadOnlyAdminSession } from '@/lib/server-session';

type DeleteBody = {
  registrationId?: string;
};

type UpdateBody = {
  registrationId?: string;
  isConfirmed?: boolean;
  action?: 'confirm' | 'unconfirm' | 'reject' | 'cancel_by_admin';
  reason?: string | null;
};

type ExamTransitionResult = {
  status?: string | null;
  proof_path?: string | null;
  target_resident_id?: string | null;
  exam_type?: string | null;
  notification_id?: string | null;
  recipient_actor_id?: string | null;
};

async function getAdminSession() {
  return getVerifiedAdminSession();
}

async function getReadSession() {
  return getVerifiedReadOnlyAdminSession();
}

async function verifyStaffSession(role: 'admin' | 'manager', residentId: string) {
  const staffPhoneCandidates = buildPhoneCandidates(
    String(residentId ?? '').trim(),
    String(residentId ?? '').replace(/[^0-9]/g, ''),
  );
  const accountTable = role === 'manager' ? 'manager_accounts' : 'admin_accounts';
  const { data, error } = await adminSupabase
    .from(accountTable)
    .select('id,active')
    .in('phone', staffPhoneCandidates)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    logger.error('[api/admin/exam-applicants] session verification failed', error);
    return false;
  }

  return Boolean(data?.id);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXAM_REGISTRATION_SELECT = `
  id, status, created_at, round_id, resident_id, is_confirmed, includes_primary_exam, is_third_exam, fee_paid_date, payment_proof_attached, rejection_reason, rejected_at,
  exam_locations!exam_registrations_location_round_fkey ( location_name ),
  exam_rounds!exam_registrations_round_id_fkey ( round_label, exam_date, exam_type )
`;

async function readRegistrationRows(registrationId?: string): Promise<ExamRegistrationRow[]> {
  if (!registrationId) {
    const { data, error } = await adminSupabase
      .from('exam_registrations')
      .select(EXAM_REGISTRATION_SELECT)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1000);

    if (error) throw error;
    return (data ?? []) as ExamRegistrationRow[];
  }

  const { data: selected, error: selectedError } = await adminSupabase
    .from('exam_registrations')
    .select(EXAM_REGISTRATION_SELECT)
    .eq('id', registrationId)
    .maybeSingle();

  if (selectedError) throw selectedError;
  if (!selected) return [];

  const selectedRow = selected as ExamRegistrationRow;
  const { data: history, error: historyError } = await adminSupabase
    .from('exam_registrations')
    .select(EXAM_REGISTRATION_SELECT)
    .eq('resident_id', selectedRow.resident_id)
    .lte('created_at', selectedRow.created_at)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (historyError) throw historyError;
  return (history ?? []) as ExamRegistrationRow[];
}

async function resolveAdminActor(residentId: string) {
  const staffPhoneCandidates = buildPhoneCandidates(
    String(residentId ?? '').trim(),
    String(residentId ?? '').replace(/[^0-9]/g, ''),
  );
  const { data, error } = await adminSupabase
    .from('admin_accounts')
    .select('id,active,staff_type')
    .in('phone', staffPhoneCandidates)
    .eq('active', true)
    .maybeSingle();

  if (error || !data?.id) return null;
  return {
    id: String(data.id),
    staffType: data.staff_type === 'developer' ? 'developer' as const : 'admin' as const,
  };
}

async function sendExamDecisionPush(
  result: ExamTransitionResult,
  registrationId: string,
  action: NonNullable<UpdateBody['action']>,
  reason: string | null,
) {
  const targetId = String(result.target_resident_id ?? '').replace(/[^0-9]/g, '');
  if (!targetId) return true;
  const notificationId = String(result.notification_id ?? '').trim().toLowerCase();
  const recipientActorId = String(result.recipient_actor_id ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(notificationId) || !UUID_PATTERN.test(recipientActorId)) return true;

  const title = action === 'reject'
    ? '시험 접수가 반려되었습니다.'
    : action === 'confirm'
      ? '시험 접수가 승인되었습니다.'
      : action === 'unconfirm'
        ? '시험 접수 승인이 취소되었습니다.'
        : '시험 접수가 취소되었습니다.';
  const body = action === 'reject' && reason ? `${title} 사유: ${reason}` : title;
  const url = result.exam_type === 'nonlife' ? '/exam-apply2' : '/exam-apply';

  try {
    const { error } = await adminSupabase.functions.invoke('fc-notify', {
      body: {
        type: 'notify',
        target_role: 'fc',
        target_id: targetId,
        recipient_actor_id: recipientActorId,
        title,
        body,
        category: 'app_event',
        url,
        target: {
          version: 1,
          kind: 'exam',
          examType: result.exam_type === 'nonlife' ? 'nonlife' : 'life',
          examRegistrationId: registrationId,
        },
        skip_notification_insert: true,
        notification_id: notificationId,
      },
    });
    return Boolean(error);
  } catch {
    return true;
  }
}

async function readApplicantNavigation(registrationId: string) {
  const { data, error } = await adminSupabase
    .from('exam_registrations')
    .select('id')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1000);

  if (error) throw error;

  const orderedIds = (data ?? [])
    .map((row) => String(row.id ?? ''))
    .filter(Boolean);
  const currentIndex = orderedIds.indexOf(registrationId);

  return {
    previousId: currentIndex > 0 ? orderedIds[currentIndex - 1] : null,
    nextId: currentIndex >= 0 && currentIndex < orderedIds.length - 1
      ? orderedIds[currentIndex + 1]
      : null,
  };
}

async function listApplicants(staffPhone: string, roundId?: string, registrationId?: string) {
  const rows = await readRegistrationRows(registrationId);
  const allBase = applyExamApplicantApplicationTypes(buildExamApplicantBaseRows(rows));
  const selectedBase = registrationId
    ? allBase.filter((row) => row.id === registrationId)
    : allBase;
  const base = roundId ? selectedBase.filter((row) => row.round_id === roundId) : selectedBase;
  const phoneCandidates = buildExamApplicantPhoneCandidates(base, buildPhoneCandidates);

  if (phoneCandidates.length === 0) {
    return [];
  }

  const { data: profiles, error: profileError } = await adminSupabase
    .from('fc_profiles')
    .select('id,phone,name,affiliation,address')
    .eq('signup_completed', true)
    .in('phone', phoneCandidates);

  if (profileError) {
    throw profileError;
  }

  const profileRows = (profiles ?? []) as ExamApplicantProfileRow[];
  const profileMatchPlan = buildExamApplicantProfileMatchPlan(profileRows, buildPhoneCandidates);
  const residentNumbersByFcId = await readResidentNumbersWithFallback({
    fcIds: profileMatchPlan.fcIds,
    staffPhone,
    logPrefix: '[api/admin/exam-applicants]',
  });

  return enrichExamApplicantsWithResidentNumbers({
    applicants: base,
    profileByCandidate: profileMatchPlan.profileByCandidate,
    residentNumbersByFcId,
    buildPhoneCandidates,
  });
}

export async function GET(req: Request) {
  const readCheck = await getReadSession();
  if (!readCheck.ok) {
    return NextResponse.json(
      { error: readCheck.error },
      { status: readCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const rateLimit = checkRateLimit(`exam-applicant-list:${readCheck.session.residentId}`, 30, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const roundId = url.searchParams.get('roundId')?.trim() || undefined;
    const registrationId = url.searchParams.get('registrationId')?.trim() || undefined;
    if (registrationId && !UUID_PATTERN.test(registrationId)) {
      return NextResponse.json(
        { error: '유효하지 않은 시험 신청 식별자입니다.' },
        { status: 400, headers: SECURITY_HEADERS },
      );
    }
    const isAuthorized = await verifyStaffSession(
      readCheck.session.role as 'admin' | 'manager',
      readCheck.session.residentId,
    );
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: SECURITY_HEADERS });
    }

    const applicants = await listApplicants(
      readCheck.session.residentId.replace(/[^0-9]/g, ''),
      roundId,
      registrationId,
    );
    const navigation = registrationId
      ? await readApplicantNavigation(registrationId)
      : undefined;
    return NextResponse.json({ ok: true, applicants, navigation }, { headers: SECURITY_HEADERS });
  } catch (err: unknown) {
    logger.error('[api/admin/exam-applicants] list failed', err);
    return NextResponse.json(
      { error: '시험 신청 목록을 불러오지 못했습니다.' },
      { status: 500, headers: SECURITY_HEADERS },
    );
  }
}

export async function PATCH(req: Request) {
  const adminCheck = await getAdminSession();
  if (!adminCheck.ok) {
    return NextResponse.json(
      { error: adminCheck.error },
      { status: adminCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const rateLimit = checkRateLimit(`exam-applicant-update:${adminCheck.session.residentId}`, 30, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch (err) {
    logger.error('[api/admin/exam-applicants] invalid json', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }

  const registrationId = String(body.registrationId ?? '').trim();
  const requestedAction = body.action
    ?? (typeof body.isConfirmed === 'boolean'
      ? body.isConfirmed ? 'confirm' : 'unconfirm'
      : null);
  const reason = String(body.reason ?? '').trim();
  if (!registrationId || !requestedAction) {
    return NextResponse.json(
      { error: 'registrationId and action are required' },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }
  if (requestedAction === 'reject' && (reason.length < 1 || reason.length > 1000)) {
    return NextResponse.json(
      { error: '반려 사유를 1자 이상 1000자 이하로 입력해주세요.' },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  try {
    const actor = await resolveAdminActor(adminCheck.session.residentId);
    if (!actor) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: SECURITY_HEADERS });
    }

    const { data, error } = await adminSupabase.rpc('transition_exam_registration', {
      p_registration_id: registrationId,
      p_action: requestedAction,
      p_actor_type: actor.staffType,
      p_actor_admin_id: actor.id,
      p_actor_fc_id: null,
      p_reason: requestedAction === 'reject' ? reason : null,
    });

    if (error) {
      const status = error.message === 'exam_registration_not_found' ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status, headers: SECURITY_HEADERS });
    }
    const result = (Array.isArray(data) ? data[0] : data) as ExamTransitionResult;
    const proofPath = String(result?.proof_path ?? '').trim();
    let cleanupWarning = false;
    if (proofPath) {
      const { error: cleanupError } = await adminSupabase.storage
        .from('exam-payment-proofs')
        .remove([proofPath]);
      cleanupWarning = Boolean(cleanupError);
    }
    const pushWarning = await sendExamDecisionPush(
      result,
      registrationId,
      requestedAction,
      requestedAction === 'reject' ? reason : null,
    );

    return NextResponse.json(
      {
        ok: true,
        registrationId,
        isConfirmed: result?.status === 'confirmed',
        status: String(result?.status ?? ''),
        cleanupWarning,
        pushWarning,
      },
      { headers: SECURITY_HEADERS },
    );
  } catch (err: unknown) {
    logger.error('[api/admin/exam-applicants] update failed', err);
    return NextResponse.json(
      { error: '시험 신청 상태 변경에 실패했습니다.' },
      { status: 500, headers: SECURITY_HEADERS },
    );
  }
}

export async function DELETE(req: Request) {
  const adminCheck = await getAdminSession();
  if (!adminCheck.ok) {
    return NextResponse.json(
      { error: adminCheck.error },
      { status: adminCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const rateLimit = checkRateLimit(`exam-applicant-delete:${adminCheck.session.residentId}`, 20, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch (err) {
    logger.error('[api/admin/exam-applicants] invalid json', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }

  const adminPhone = String(adminCheck.session.residentId ?? '').replace(/[^0-9]/g, '');
  const registrationId = String(body.registrationId ?? '').trim();

  if (!registrationId) {
    return NextResponse.json({ error: 'registrationId is required' }, { status: 400, headers: SECURITY_HEADERS });
  }

  try {
    const actor = await resolveAdminActor(adminPhone);
    if (!actor) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: SECURITY_HEADERS });
    }

    const { data, error } = await adminSupabase.rpc('transition_exam_registration', {
      p_registration_id: registrationId,
      p_action: 'cancel_by_admin',
      p_actor_type: actor.staffType,
      p_actor_admin_id: actor.id,
      p_actor_fc_id: null,
      p_reason: null,
    });

    if (error) {
      const status = error.message === 'exam_registration_not_found' ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status, headers: SECURITY_HEADERS });
    }
    const result = (Array.isArray(data) ? data[0] : data) as ExamTransitionResult;
    const proofPath = String(result?.proof_path ?? '').trim();
    if (proofPath) {
      await adminSupabase.storage.from('exam-payment-proofs').remove([proofPath]);
    }
    const pushWarning = await sendExamDecisionPush(result, registrationId, 'cancel_by_admin', null);

    return NextResponse.json(
      {
        ok: true,
        deleted: false,
        status: String(result?.status ?? ''),
        pushWarning,
      },
      { headers: SECURITY_HEADERS },
    );
  } catch (err: unknown) {
    logger.error('[api/admin/exam-applicants] delete failed', err);
    return NextResponse.json({ error: '시험 신청 삭제에 실패했습니다.' }, { status: 500, headers: SECURITY_HEADERS });
  }
}
