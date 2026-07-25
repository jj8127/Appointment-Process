import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

import {
  buildCorsHeaders,
  json,
  parseJson,
  supabase,
} from '../_shared/board.ts';
import {
  EXAM_PAYMENT_PROOF_BUCKET,
  buildExamPaymentProofStoragePath,
  getKoreanYmd,
  validateDiscardExamPaymentProof,
  validateCancelExamApplication,
  validatePrepareExamPaymentProof,
  validateSubmitExamPaymentProof,
  type DiscardExamPaymentProofInput,
  type CancelExamApplicationInput,
  type ListExamApplicationTargetsInput,
  type PrepareExamPaymentProofInput,
  type SubmitExamPaymentProofInput,
} from '../_shared/exam-payment-proof.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import { requireAppSessionFromRequest } from '../_shared/request-board-auth.ts';

type RequestBody =
  | PrepareExamPaymentProofInput
  | SubmitExamPaymentProofInput
  | DiscardExamPaymentProofInput
  | CancelExamApplicationInput
  | ListExamApplicationTargetsInput;

type AppSession = {
  phone: string;
  role: 'fc' | 'admin' | 'manager';
  fcId?: string;
  staffType?: 'admin' | 'developer';
};

type ExamApplicationActor =
  | {
      actorType: 'fc';
      actorPhone: string;
      actorFcId: string;
      actorAdminId: null;
      actorManagerId: null;
    }
  | {
      actorType: 'manager';
      actorPhone: string;
      actorFcId: null;
      actorAdminId: null;
      actorManagerId: string;
    }
  | {
      actorType: 'admin' | 'developer';
      actorPhone: string;
      actorFcId: null;
      actorAdminId: string;
      actorManagerId: null;
    };

type ExamApplicationTarget = {
  fcId: string;
  residentId: string;
  name: string;
  affiliation: string;
  phoneLast4: string;
};

type ProofUploadRow = {
  id: string;
  fc_id: string;
  storage_path: string;
  status: 'pending' | 'attached' | 'replaced' | 'discarded';
  registration_id: string | null;
  expires_at: string;
};

function cleanPhone(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

function buildPhoneCandidates(phone: string) {
  const digits = cleanPhone(phone);
  if (digits.length !== 11) return [];
  return [
    digits,
    `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`,
  ];
}

function failure(
  code: string,
  message: string,
  status: number,
  origin?: string,
) {
  return json({ ok: false, code, message }, status, origin);
}

async function resolveExamActor(session: AppSession, origin?: string) {
  const phone = cleanPhone(session.phone);
  if (phone.length !== 11) {
    return {
      ok: false as const,
      response: failure('invalid_session', '로그인 정보를 다시 확인해주세요.', 401, origin),
    };
  }

  if (session.role === 'admin') {
    const expectedStaffType = session.staffType === 'developer' ? 'developer' : 'admin';
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id,staff_type')
      .in('phone', buildPhoneCandidates(phone))
      .eq('active', true)
      .limit(2);
    const matches = (data ?? []).filter(
      (row) => (row.staff_type === 'developer' ? 'developer' : 'admin') === expectedStaffType,
    );
    if (error || matches.length !== 1 || !matches[0]?.id) {
      return {
        ok: false as const,
        response: failure('actor_not_found', '활성 관리자 계정을 확인하지 못했습니다.', 403, origin),
      };
    }
    return {
      ok: true as const,
      actor: {
        actorType: expectedStaffType,
        actorPhone: phone,
        actorFcId: null,
        actorAdminId: String(matches[0].id),
        actorManagerId: null,
      } satisfies ExamApplicationActor,
    };
  }

  if (session.role === 'manager') {
    const { data, error } = await supabase
      .from('manager_accounts')
      .select('id')
      .in('phone', buildPhoneCandidates(phone))
      .eq('active', true)
      .limit(2);
    if (error || data?.length !== 1 || !data[0]?.id) {
      return {
        ok: false as const,
        response: failure('actor_not_found', '활성 본부장 계정을 확인하지 못했습니다.', 403, origin),
      };
    }
    return {
      ok: true as const,
      actor: {
        actorType: 'manager',
        actorPhone: phone,
        actorFcId: null,
        actorAdminId: null,
        actorManagerId: String(data[0].id),
      } satisfies ExamApplicationActor,
    };
  }

  if (session.role !== 'fc') {
    return {
      ok: false as const,
      response: failure('forbidden', '시험 신청 권한이 없습니다.', 403, origin),
    };
  }

  let query = supabase
    .from('fc_profiles')
    .select('id,phone')
    .limit(2);

  if (session.fcId) {
    query = query.eq('id', session.fcId);
  } else {
    query = query.in('phone', buildPhoneCandidates(phone));
  }

  const { data, error } = await query;
  if (error) {
    reportEdgeDiagnostic({
      event: 'exam_payment_proof.database',
      reason: 'database_operation_failed',
      errorClass: 'database',
    });
    return {
      ok: false as const,
      response: failure('db_error', 'FC 정보를 확인하지 못했습니다.', 500, origin),
    };
  }

  const exactMatches = (data ?? []).filter((row) => cleanPhone(row.phone) === phone);
  if (exactMatches.length !== 1 || !exactMatches[0]?.id) {
    return {
      ok: false as const,
      response: failure('actor_not_found', 'FC 정보를 확인하지 못했습니다.', 403, origin),
    };
  }

  return {
    ok: true as const,
    actor: {
      actorType: 'fc',
      actorPhone: phone,
      actorFcId: exactMatches[0].id as string,
      actorAdminId: null,
      actorManagerId: null,
    } satisfies ExamApplicationActor,
  };
}

function cleanTargetFcId(body: RequestBody) {
  return typeof (body as { targetFcId?: unknown }).targetFcId === 'string'
    ? String((body as { targetFcId?: string }).targetFcId).trim()
    : '';
}

async function resolveApplicationTarget(
  body: RequestBody,
  actor: ExamApplicationActor,
  origin?: string,
) {
  const requestedTargetFcId = cleanTargetFcId(body);
  let targetFcId = actor.actorType === 'fc' ? actor.actorFcId : requestedTargetFcId;
  if (!targetFcId && actor.actorType === 'manager') {
    const { data: legacyTarget } = await supabase
      .from('fc_profiles')
      .select('id')
      .in('phone', buildPhoneCandidates(actor.actorPhone))
      .eq('signup_completed', true)
      .eq('is_manager_referral_shadow', false)
      .limit(2);
    if (legacyTarget?.length === 1 && legacyTarget[0]?.id) {
      targetFcId = String(legacyTarget[0].id);
    }
  }
  if (!targetFcId) {
    return {
      ok: false as const,
      response: failure('target_required', '시험 신청 대상 FC를 선택해주세요.', 400, origin),
    };
  }
  if (actor.actorType === 'fc' && requestedTargetFcId && requestedTargetFcId !== actor.actorFcId) {
    return {
      ok: false as const,
      response: failure('forbidden_target', '다른 FC의 시험을 신청할 수 없습니다.', 403, origin),
    };
  }

  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id,name,affiliation,phone,signup_completed,is_manager_referral_shadow')
    .eq('id', targetFcId)
    .maybeSingle();
  const residentId = cleanPhone(data?.phone);
  if (
    error
    || !data?.id
    || data.signup_completed !== true
    || data.is_manager_referral_shadow === true
    || residentId.length !== 11
  ) {
    return {
      ok: false as const,
      response: failure('target_not_found', '시험 신청 대상 FC를 확인하지 못했습니다.', 404, origin),
    };
  }

  return {
    ok: true as const,
    target: {
      fcId: String(data.id),
      residentId,
      name: String(data.name ?? '').trim() || '이름 미입력',
      affiliation: String(data.affiliation ?? '').trim(),
      phoneLast4: residentId.slice(-4),
    } satisfies ExamApplicationTarget,
  };
}

async function listApplicationTargets(actor: ExamApplicationActor, origin?: string) {
  if (actor.actorType === 'fc') {
    return failure('forbidden', '대리 신청 권한이 없습니다.', 403, origin);
  }
  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id,name,affiliation,phone')
    .eq('signup_completed', true)
    .eq('is_manager_referral_shadow', false)
    .order('name', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(2000);
  if (error) {
    return failure('db_error', 'FC 목록을 불러오지 못했습니다.', 500, origin);
  }
  const targets = (data ?? []).flatMap((row) => {
    const residentId = cleanPhone(row.phone);
    if (!row.id || residentId.length !== 11) return [];
    return [{
      fcId: String(row.id),
      residentId,
      name: String(row.name ?? '').trim() || '이름 미입력',
      affiliation: String(row.affiliation ?? '').trim(),
      phoneLast4: residentId.slice(-4),
    } satisfies ExamApplicationTarget];
  });
  return json({ ok: true, data: { targets } }, 200, origin);
}

async function prepareUpload(
  body: PrepareExamPaymentProofInput,
  target: { fcId: string },
  origin?: string,
) {
  const validated = validatePrepareExamPaymentProof(body);
  if (validated.ok === false) {
    return failure(validated.code, validated.message, 400, origin);
  }

  const { requestId, fileName, mimeType, fileSize } = validated.value;
  const { data: existing, error: existingError } = await supabase
    .from('exam_payment_proof_uploads')
    .select('id,fc_id,storage_path,status,registration_id,expires_at')
    .eq('fc_id', target.fcId)
    .eq('request_id', requestId)
    .maybeSingle<ProofUploadRow>();

  if (existingError) {
    return failure('db_error', '첨부 요청을 준비하지 못했습니다.', 500, origin);
  }

  if (existing?.status === 'attached') {
    return json({
      ok: true,
      data: {
        uploadId: existing.id,
        alreadyAttached: true,
      },
    }, 200, origin);
  }

  if (
    existing
    && (
      existing.status !== 'pending'
      || new Date(existing.expires_at).getTime() <= Date.now()
    )
  ) {
    return failure(
      'upload_request_expired',
      '첨부 요청이 만료되었습니다. 사진을 다시 선택해주세요.',
      409,
      origin,
    );
  }

  let uploadId = existing?.id ?? crypto.randomUUID();
  let storagePath = existing?.storage_path ?? buildExamPaymentProofStoragePath({
    fcId: target.fcId,
    objectId: uploadId,
    mimeType,
  });

  if (!existing) {
    const { error: insertError } = await supabase
      .from('exam_payment_proof_uploads')
      .insert({
        id: uploadId,
        request_id: requestId,
        fc_id: target.fcId,
        storage_path: storagePath,
        original_file_name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
      });

    if (insertError) {
      return failure('db_error', '첨부 요청을 준비하지 못했습니다.', 500, origin);
    }
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(EXAM_PAYMENT_PROOF_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: true });

  if (signError || !signed?.signedUrl) {
    if (!existing) {
      await supabase.from('exam_payment_proof_uploads').delete().eq('id', uploadId);
    }
    reportEdgeDiagnostic({
      event: 'exam_payment_proof.storage',
      reason: 'signed_upload_url_failed',
      errorClass: 'upstream',
    });
    return failure('storage_error', '사진 업로드를 준비하지 못했습니다.', 500, origin);
  }

  return json({
    ok: true,
    data: {
      uploadId,
      signedUrl: signed.signedUrl,
      alreadyAttached: false,
    },
  }, 200, origin);
}

async function storageObjectExists(upload: ProofUploadRow) {
  const pathParts = upload.storage_path.split('/');
  const objectName = pathParts.pop() ?? '';
  const folder = pathParts.join('/');
  if (!objectName || !folder) return false;

  const { data, error } = await supabase.storage
    .from(EXAM_PAYMENT_PROOF_BUCKET)
    .list(folder, {
      limit: 10,
      search: objectName,
    });
  return !error && Boolean(data?.some((object) => object.name === objectName));
}

async function submitApplication(
  body: SubmitExamPaymentProofInput,
  actor: ExamApplicationActor,
  target: { fcId: string; residentId: string },
  origin?: string,
) {
  const validated = validateSubmitExamPaymentProof(body);
  if (validated.ok === false) {
    return failure(validated.code, validated.message, 400, origin);
  }

  const {
    uploadId,
    roundId,
    locationId,
    examType,
    feePaidDate,
    includesPrimaryExam,
    isThirdExam,
  } = validated.value;

  if (feePaidDate && feePaidDate > getKoreanYmd()) {
    return failure(
      'future_fee_paid_date',
      '응시료 납입 일자는 오늘 이후로 선택할 수 없습니다.',
      400,
      origin,
    );
  }

  const { data: round, error: roundError } = await supabase
    .from('exam_rounds')
    .select('id,exam_type,registration_deadline')
    .eq('id', roundId)
    .maybeSingle();
  if (roundError) {
    return failure('db_error', '시험 일정을 확인하지 못했습니다.', 500, origin);
  }
  if (!round || round.exam_type !== examType) {
    return failure('invalid_exam_round', '시험 일정을 다시 선택해주세요.', 400, origin);
  }
  if (String(round.registration_deadline ?? '') < getKoreanYmd()) {
    return failure('exam_round_closed', '마감된 시험 일정입니다.', 409, origin);
  }

  const { data: location, error: locationError } = await supabase
    .from('exam_locations')
    .select('id')
    .eq('id', locationId)
    .eq('round_id', roundId)
    .maybeSingle();
  if (locationError) {
    return failure('db_error', '응시 지역을 확인하지 못했습니다.', 500, origin);
  }
  if (!location) {
    return failure('invalid_exam_location', '응시 지역을 다시 선택해주세요.', 400, origin);
  }

  if (uploadId) {
    const { data: upload, error: uploadError } = await supabase
      .from('exam_payment_proof_uploads')
      .select('id,fc_id,storage_path,status,registration_id,expires_at')
      .eq('id', uploadId)
      .eq('fc_id', target.fcId)
      .maybeSingle<ProofUploadRow>();
    if (uploadError) {
      return failure('db_error', '입금 내역을 확인하지 못했습니다.', 500, origin);
    }
    if (!upload) {
      return failure('payment_proof_not_found', '입금 내역 사진을 다시 선택해주세요.', 400, origin);
    }
    if (upload.status === 'pending' && !(await storageObjectExists(upload))) {
      return failure('payment_proof_not_uploaded', '입금 내역 사진 업로드를 다시 시도해주세요.', 409, origin);
    }
  }

  const { data, error } = await supabase.rpc(
    body.action === 'submit_v3'
      ? 'submit_exam_registration_with_payment_proof_v3'
      : body.action === 'submit_v2'
        ? 'submit_exam_registration_with_payment_proof_v2'
        : 'submit_exam_registration_with_payment_proof',
    {
      p_fc_id: target.fcId,
      p_resident_id: target.residentId,
      p_round_id: roundId,
      p_location_id: locationId,
      ...(body.action === 'submit_v2' || body.action === 'submit_v3'
        ? { p_includes_primary_exam: includesPrimaryExam }
        : {}),
      p_is_third_exam: isThirdExam,
      p_fee_paid_date: feePaidDate,
      p_upload_id: uploadId,
      ...(body.action === 'submit_v3'
        ? {
            p_actor_type: actor.actorType,
            p_actor_admin_id: actor.actorAdminId,
            p_actor_manager_id: actor.actorManagerId,
            p_actor_fc_id: actor.actorFcId,
          }
        : {}),
    },
  );

  if (error) {
    const knownMessages: Record<string, string> = {
      confirmed_exam_registration: '이미 접수가 확정되어 신청 내용을 수정할 수 없습니다.',
      payment_proof_required: '입금 내역 사진을 첨부해주세요.',
      payment_proof_expired: '첨부 요청이 만료되었습니다. 사진을 다시 선택해주세요.',
      payment_proof_already_used: '이미 사용된 입금 내역 사진입니다.',
      payment_proof_not_available: '입금 내역 사진을 다시 선택해주세요.',
      active_exam_month_already_registered:
        '선택한 FC는 해당 시험 월에 이미 신청 내역이 있습니다.',
      invalid_exam_actor: '시험 대리 신청 권한을 확인하지 못했습니다.',
      invalid_exam_target: '시험 신청 대상 FC를 다시 선택해주세요.',
    };
    return failure(
      'submit_failed',
      knownMessages[error.message] ?? '시험 신청을 저장하지 못했습니다.',
      409,
      origin,
    );
  }

  const result = Array.isArray(data) ? data[0] : data;
  const previousProofPath = String(result?.previous_proof_path ?? '').trim();
  let cleanupWarning = false;
  if (previousProofPath) {
    const { error: removeError } = await supabase.storage
      .from(EXAM_PAYMENT_PROOF_BUCKET)
      .remove([previousProofPath]);
    if (removeError) {
      cleanupWarning = true;
      reportEdgeDiagnostic({
        event: 'exam_payment_proof.storage',
        reason: 'storage_remove_failed',
        errorClass: 'upstream',
      });
    }
  }

  return json({
    ok: true,
    data: {
      registrationId: result?.registration_id ?? null,
      proofAttached: true,
      cleanupWarning,
    },
  }, 200, origin);
}

async function discardUpload(
  body: DiscardExamPaymentProofInput,
  target: { fcId: string },
  origin?: string,
) {
  const validated = validateDiscardExamPaymentProof(body);
  if (validated.ok === false) {
    return failure(validated.code, validated.message, 400, origin);
  }

  const { data: upload, error } = await supabase
    .from('exam_payment_proof_uploads')
    .select('id,fc_id,storage_path,status,registration_id,expires_at')
    .eq('id', validated.value.uploadId)
    .eq('fc_id', target.fcId)
    .maybeSingle<ProofUploadRow>();
  if (error) {
    return failure('db_error', '첨부 사진을 정리하지 못했습니다.', 500, origin);
  }
  if (!upload || upload.status === 'discarded') {
    return json({ ok: true }, 200, origin);
  }
  if (upload.status !== 'pending') {
    return failure('proof_in_use', '신청에 사용된 입금 내역은 삭제할 수 없습니다.', 409, origin);
  }

  const { error: removeError } = await supabase.storage
    .from(EXAM_PAYMENT_PROOF_BUCKET)
    .remove([upload.storage_path]);
  if (removeError) {
    return failure('storage_error', '첨부 사진을 정리하지 못했습니다.', 500, origin);
  }

  const { error: updateError } = await supabase
    .from('exam_payment_proof_uploads')
    .update({ status: 'discarded' })
    .eq('id', upload.id)
    .eq('status', 'pending');
  if (updateError) {
    return failure('db_error', '첨부 사진을 정리하지 못했습니다.', 500, origin);
  }

  return json({ ok: true }, 200, origin);
}

async function cancelApplication(
  body: CancelExamApplicationInput,
  actor: ExamApplicationActor,
  origin?: string,
) {
  const validated = validateCancelExamApplication(body);
  if (validated.ok === false) {
    return failure(validated.code, validated.message, 400, origin);
  }
  if (actor.actorType !== 'fc' || !actor.actorFcId) {
    return failure(
      'forbidden',
      '대리 신청한 시험의 취소는 시험 관리 화면에서 처리해주세요.',
      403,
      origin,
    );
  }

  const { data, error } = await supabase.rpc('transition_exam_registration', {
    p_registration_id: validated.value.registrationId,
    p_action: 'cancel_by_fc',
    p_actor_type: 'fc',
    p_actor_admin_id: null,
    p_actor_fc_id: actor.actorFcId,
    p_reason: null,
  });
  if (error) {
    return failure(
      'cancel_failed',
      error.message === 'exam_registration_not_found'
        ? '취소할 시험 신청 내역이 없습니다.'
        : '현재 상태에서는 시험 신청을 취소할 수 없습니다.',
      error.message === 'exam_registration_not_found' ? 404 : 409,
      origin,
    );
  }

  let cleanupWarning = false;
  const result = Array.isArray(data) ? data[0] : data;
  const proofPath = String(result?.proof_path ?? '').trim();
  if (proofPath) {
    const { error: removeError } = await supabase.storage
      .from(EXAM_PAYMENT_PROOF_BUCKET)
      .remove([proofPath]);
    if (removeError) {
      cleanupWarning = true;
      reportEdgeDiagnostic({
        event: 'exam_payment_proof.storage',
        reason: 'storage_remove_failed',
        errorClass: 'upstream',
      });
    }
  }

  return json({ ok: true, data: { cleanupWarning } }, 200, origin);
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? undefined;
  const corsHeaders = buildCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return failure('method_not_allowed', 'Method not allowed', 405, origin);
  }

  const body = await parseJson<RequestBody>(req);
  if (!body || !body.action) {
    return failure('invalid_json', '요청 내용을 확인할 수 없습니다.', 400, origin);
  }

  const sessionResult = await requireAppSessionFromRequest(req);
  if (sessionResult.ok === false) {
    return failure(
      sessionResult.code,
      sessionResult.message,
      sessionResult.status,
      origin,
    );
  }

  const actorResult = await resolveExamActor(sessionResult.session, origin);
  if (actorResult.ok === false) {
    return actorResult.response;
  }

  if (body.action === 'list_targets') {
    return listApplicationTargets(actorResult.actor, origin);
  }
  if (body.action === 'cancel') {
    return cancelApplication(body, actorResult.actor, origin);
  }

  const targetResult = await resolveApplicationTarget(body, actorResult.actor, origin);
  if (targetResult.ok === false) {
    return targetResult.response;
  }

  if (body.action === 'prepare') {
    return prepareUpload(body, targetResult.target, origin);
  }
  if (body.action === 'submit' || body.action === 'submit_v2' || body.action === 'submit_v3') {
    return submitApplication(body, actorResult.actor, targetResult.target, origin);
  }
  if (body.action === 'discard') {
    return discardUpload(body, targetResult.target, origin);
  }
  return failure('invalid_action', '지원하지 않는 요청입니다.', 400, origin);
});
