import { cleanupFailed } from '@/lib/upstream-response-policy';
import { NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { serverError } from '@/lib/api-error';
import { checkRateLimit, SECURITY_HEADERS } from '@/lib/csrf';
import {
  applyExamApplicantApplicationTypes,
  buildExamApplicantBaseRows,
  buildExamApplicantPhoneCandidates,
  buildExamApplicantProfileMatchPlan,
  enrichExamApplicantsWithResidentNumbers,
  isExamApplicantProfileRow,
  isExamRegistrationRow,
  type ExamApplicantProfileRow,
  type ExamRegistrationRow,
} from '@/lib/exam-applicant-resident-number-enrichment';
import { logger } from '@/lib/logger';
import { readResidentNumbersWithFallback } from '@/lib/server-resident-numbers';
import { buildPhoneCandidates, getVerifiedAdminSession, getVerifiedReadOnlyAdminSession } from '@/lib/server-session';
import { collectSupabaseRows } from '@/lib/supabase-query-contract';
import { classifyFcNotifyDeliveryResult } from '@shared/lib/fc-notify-delivery-result';
import {
  requireExamTransitionReceipt,
  type ExamTransitionReceipt,
} from '@shared/supabase/functions/_shared/ux-mutation-contract';

type DeleteBody = {
  registrationId?: string;
};

type UpdateBody = {
  registrationId?: string;
  isConfirmed?: boolean;
  action?: 'confirm' | 'unconfirm' | 'reject' | 'cancel_by_admin';
  reason?: string | null;
};

type AdminExamTransitionAction = NonNullable<UpdateBody['action']>;

type ExamTransitionErrorDetails = {
  message: string;
  status: 403 | 404 | 409;
};

function parseAdminExamTransitionAction(
  action: unknown,
  isConfirmed: unknown,
): AdminExamTransitionAction | null {
  const requestedAction = action
    ?? (typeof isConfirmed === 'boolean'
      ? isConfirmed ? 'confirm' : 'unconfirm'
      : null);
  return requestedAction === 'confirm'
    || requestedAction === 'unconfirm'
    || requestedAction === 'reject'
    || requestedAction === 'cancel_by_admin'
    ? requestedAction
    : null;
}

function getExamTransitionErrorDetails(error: unknown): ExamTransitionErrorDetails | null {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : '';

  if (message === 'exam_registration_not_found') {
    return { message: '시험 신청 내역을 찾을 수 없습니다.', status: 404 };
  }
  if (message === 'exam_transition_forbidden') {
    return { message: '시험 신청 상태를 변경할 권한이 없습니다.', status: 403 };
  }
  if (message === 'terminal_exam_registration') {
    return { message: '완료되었거나 불참 처리된 시험 신청은 변경할 수 없습니다.', status: 409 };
  }
  if (message === 'invalid_exam_transition') {
    return { message: '현재 상태에서는 요청한 시험 신청 상태로 변경할 수 없습니다.', status: 409 };
  }
  return null;
}

function knownExamTransitionErrorResponse(error: unknown) {
  const details = getExamTransitionErrorDetails(error);
  return details
    ? NextResponse.json({ error: details.message }, { status: details.status, headers: SECURITY_HEADERS })
    : null;
}

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
    throw error;
  }

  return Boolean(data?.id);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXAM_REGISTRATION_SELECT = `
  id, status, created_at, round_id, resident_id, is_confirmed, includes_primary_exam, is_third_exam, fee_paid_date, payment_proof_attached, rejection_reason, rejected_at,
  exam_locations!exam_registrations_location_round_fkey ( location_name ),
  exam_rounds!exam_registrations_round_exam_type_fkey ( round_label, exam_date, exam_type )
`;

async function readRegistrationRows(registrationId?: string, roundId?: string): Promise<ExamRegistrationRow[]> {
  if (!registrationId) {
    return collectSupabaseRows({
      queryName: 'exam_registrations',
      isRow: isExamRegistrationRow,
      rowKey: (row) => row.id,
      fetchPage: async (from, to) => {
        let query = adminSupabase.from('exam_registrations').select(EXAM_REGISTRATION_SELECT);
        if (roundId) query = query.eq('round_id', roundId);
        return query
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
      },
    });
  }

  const { data: selected, error: selectedError } = await adminSupabase
    .from('exam_registrations')
    .select(EXAM_REGISTRATION_SELECT)
    .eq('id', registrationId)
    .maybeSingle();

  if (selectedError) throw selectedError;
  if (!selected) return [];
  if (!isExamRegistrationRow(selected)) {
    throw new Error('exam_registration_selected_row_contract_invalid');
  }

  const selectedRow = selected;
  return collectSupabaseRows({
    queryName: 'exam_registration_history',
    isRow: isExamRegistrationRow,
    rowKey: (row) => row.id,
    fetchPage: async (from, to) => adminSupabase
      .from('exam_registrations')
      .select(EXAM_REGISTRATION_SELECT)
      .eq('resident_id', selectedRow.resident_id)
      .lte('created_at', selectedRow.created_at)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  });
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

  if (error) throw error;
  if (!data?.id) return null;
  return {
    id: String(data.id),
    staffType: data.staff_type === 'developer' ? 'developer' as const : 'admin' as const,
  };
}

async function sendExamDecisionPush(
  result: ExamTransitionReceipt,
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
    const transport = await adminSupabase.functions.invoke('fc-notify', {
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
    if (transport.error) return true;
    const response = transport.data;
    if (!response || typeof response !== 'object' || Array.isArray(response)) return true;
    const receipt = response as Record<string, unknown>;
    const delivery = classifyFcNotifyDeliveryResult(transport);
    return receipt.ok !== true
      || receipt.confirmed !== true
      || receipt.stored !== true
      || String(receipt.notificationId ?? '').trim().toLowerCase() !== notificationId
      || !delivery.confirmed
      || delivery.notificationStored !== true;
  } catch {
    return true;
  }
}

async function readApplicantNavigation(registrationId: string) {
  const { data: selected, error: selectedError } = await adminSupabase
    .from('exam_registrations').select('id,created_at').eq('id', registrationId).maybeSingle();
  if (selectedError) throw selectedError;
  if (!selected) return { previousId: null, nextId: null };
  if (
    typeof selected.id !== 'string'
    || selected.id.toLowerCase() !== registrationId.toLowerCase()
    || typeof selected.created_at !== 'string'
    || !selected.created_at.trim()
    || !Number.isFinite(Date.parse(selected.created_at))
  ) {
    throw new Error('exam_registration_navigation_anchor_contract_invalid');
  }
  // Keep the database timestamp verbatim. Converting through Date truncates
  // PostgreSQL microseconds and can skip a neighbor within the same millisecond.
  const timestamp = selected.created_at;
  const readNeighbor = async (newer: boolean) => {
    const comparison = newer ? 'gt' : 'lt';
    const { data, error } = await adminSupabase.from('exam_registrations').select('id')
      .or(`created_at.${comparison}.${timestamp},and(created_at.eq.${timestamp},id.${comparison}.${registrationId})`)
      .order('created_at', { ascending: newer }).order('id', { ascending: newer })
      .limit(1).maybeSingle();
    if (error) throw error;
    return data ? String(data.id) : null;
  };
  const [previousId, nextId] = await Promise.all([readNeighbor(true), readNeighbor(false)]);
  return { previousId, nextId };
}

async function listApplicants(staffPhone: string, roundId?: string, registrationId?: string) {
  const rows = await readRegistrationRows(registrationId, roundId);
  const allBase = applyExamApplicantApplicationTypes(buildExamApplicantBaseRows(rows));
  const selectedBase = registrationId
    ? allBase.filter((row) => row.id === registrationId)
    : allBase;
  const base = roundId ? selectedBase.filter((row) => row.round_id === roundId) : selectedBase;
  const phoneCandidates = buildExamApplicantPhoneCandidates(base, buildPhoneCandidates);

  if (phoneCandidates.length === 0) {
    return [];
  }

  const profileRows: ExamApplicantProfileRow[] = [];
  const seenProfileIds = new Set<string>();
  const seenProfilePhones = new Set<string>();
  for (let offset = 0; offset < phoneCandidates.length; offset += 100) {
    const candidateBatch = phoneCandidates.slice(offset, offset + 100);
    const candidateSet = new Set(candidateBatch);
    const batchRows = await collectSupabaseRows({
      queryName: 'exam_applicant_profiles',
      isRow: isExamApplicantProfileRow,
      rowKey: (row) => row.id,
      fetchPage: async (from, to) => adminSupabase
        .from('fc_profiles')
        .select('id,phone,name,affiliation,address')
        .eq('signup_completed', true)
        .in('phone', candidateBatch)
        .order('phone', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    });
    for (const row of batchRows) {
      if (!candidateSet.has(row.phone)
        || seenProfileIds.has(row.id)
        || seenProfilePhones.has(row.phone)) {
        throw new Error('exam_applicant_profiles_identity_contract_invalid');
      }
      seenProfileIds.add(row.id);
      seenProfilePhones.add(row.phone);
      profileRows.push(row);
    }
  }
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
  } catch (error: unknown) {
    return serverError(error, 'api/admin/exam-applicants GET', SECURITY_HEADERS);
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }

  const registrationId = String(body.registrationId ?? '').trim();
  const requestedAction = parseAdminExamTransitionAction(body.action, body.isConfirmed);
  const reason = String(body.reason ?? '').trim();
  if (!registrationId || !requestedAction) {
    return NextResponse.json(
      { error: 'registrationId and action are required' },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }
  if (!UUID_PATTERN.test(registrationId)) {
    return NextResponse.json(
      { error: '유효하지 않은 시험 신청 식별자입니다.' },
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
      const knownError = knownExamTransitionErrorResponse(error);
      if (knownError) return knownError;
      return serverError(error, 'api/admin/exam-applicants transition', SECURITY_HEADERS);
    }
    const result = requireExamTransitionReceipt(data, registrationId, requestedAction);
    const proofPath = String(result?.proof_path ?? '').trim();
    let cleanupWarning = false;
    if (proofPath) {
      cleanupWarning = await cleanupFailed(() => adminSupabase.storage.from('exam-payment-proofs').remove([proofPath]));
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
        isConfirmed: result.status === 'confirmed',
        status: result.status,
        cleanupWarning,
        pushWarning,
      },
      { headers: SECURITY_HEADERS },
    );
  } catch (error: unknown) {
    return serverError(error, 'api/admin/exam-applicants PATCH', SECURITY_HEADERS);
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }

  const adminPhone = String(adminCheck.session.residentId ?? '').replace(/[^0-9]/g, '');
  const registrationId = String(body.registrationId ?? '').trim();

  if (!registrationId) {
    return NextResponse.json({ error: 'registrationId is required' }, { status: 400, headers: SECURITY_HEADERS });
  }
  if (!UUID_PATTERN.test(registrationId)) {
    return NextResponse.json(
      { error: '유효하지 않은 시험 신청 식별자입니다.' },
      { status: 400, headers: SECURITY_HEADERS },
    );
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
      const knownError = knownExamTransitionErrorResponse(error);
      if (knownError) return knownError;
      return serverError(error, 'api/admin/exam-applicants cancellation', SECURITY_HEADERS);
    }
    const result = requireExamTransitionReceipt(data, registrationId, 'cancel_by_admin');
    const proofPath = String(result?.proof_path ?? '').trim();
    const cleanupWarning = proofPath ? await cleanupFailed(() => adminSupabase.storage.from('exam-payment-proofs').remove([proofPath])) : false;
    const pushWarning = await sendExamDecisionPush(result, registrationId, 'cancel_by_admin', null);

    return NextResponse.json(
      {
        ok: true,
        registrationId,
        isConfirmed: false,
        deleted: false,
        cleanupWarning,
        status: result.status,
        pushWarning,
      },
      { headers: SECURITY_HEADERS },
    );
  } catch (error: unknown) {
    return serverError(error, 'api/admin/exam-applicants DELETE', SECURITY_HEADERS);
  }
}
