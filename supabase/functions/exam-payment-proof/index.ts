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
  type PrepareExamPaymentProofInput,
  type SubmitExamPaymentProofInput,
} from '../_shared/exam-payment-proof.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import { requireAppSessionFromRequest } from '../_shared/request-board-auth.ts';

type RequestBody =
  | PrepareExamPaymentProofInput
  | SubmitExamPaymentProofInput
  | DiscardExamPaymentProofInput
  | CancelExamApplicationInput;

type AppSession = {
  phone: string;
  role: 'fc' | 'admin' | 'manager';
  fcId?: string;
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

async function resolveFcActor(session: AppSession, origin?: string) {
  if (session.role !== 'fc' && session.role !== 'manager') {
    return {
      ok: false as const,
      response: failure('forbidden', 'FC 본인 시험 신청만 이용할 수 있습니다.', 403, origin),
    };
  }

  const phone = cleanPhone(session.phone);
  if (phone.length !== 11) {
    return {
      ok: false as const,
      response: failure('invalid_session', '로그인 정보를 다시 확인해주세요.', 401, origin),
    };
  }

  let query = supabase
    .from('fc_profiles')
    .select('id,phone')
    .limit(2);

  if (session.role === 'fc' && session.fcId) {
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
      fcId: exactMatches[0].id as string,
      residentId: phone,
    },
  };
}

async function prepareUpload(
  body: PrepareExamPaymentProofInput,
  actor: { fcId: string },
  origin?: string,
) {
  const validated = validatePrepareExamPaymentProof(body);
  if (!validated.ok) {
    return failure(validated.code, validated.message, 400, origin);
  }

  const { requestId, fileName, mimeType, fileSize } = validated.value;
  const { data: existing, error: existingError } = await supabase
    .from('exam_payment_proof_uploads')
    .select('id,fc_id,storage_path,status,registration_id,expires_at')
    .eq('fc_id', actor.fcId)
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
    fcId: actor.fcId,
    objectId: uploadId,
    mimeType,
  });

  if (!existing) {
    const { error: insertError } = await supabase
      .from('exam_payment_proof_uploads')
      .insert({
        id: uploadId,
        request_id: requestId,
        fc_id: actor.fcId,
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
  actor: { fcId: string; residentId: string },
  origin?: string,
) {
  const validated = validateSubmitExamPaymentProof(body);
  if (!validated.ok) {
    return failure(validated.code, validated.message, 400, origin);
  }

  const {
    uploadId,
    roundId,
    locationId,
    examType,
    feePaidDate,
    isThirdExam,
  } = validated.value;

  if (feePaidDate > getKoreanYmd()) {
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
      .eq('fc_id', actor.fcId)
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
    'submit_exam_registration_with_payment_proof',
    {
      p_fc_id: actor.fcId,
      p_resident_id: actor.residentId,
      p_round_id: roundId,
      p_location_id: locationId,
      p_is_third_exam: isThirdExam,
      p_fee_paid_date: feePaidDate,
      p_upload_id: uploadId,
    },
  );

  if (error) {
    const knownMessages: Record<string, string> = {
      confirmed_exam_registration: '이미 접수가 확정되어 신청 내용을 수정할 수 없습니다.',
      payment_proof_required: '입금 내역 사진을 첨부해주세요.',
      payment_proof_expired: '첨부 요청이 만료되었습니다. 사진을 다시 선택해주세요.',
      payment_proof_already_used: '이미 사용된 입금 내역 사진입니다.',
      payment_proof_not_available: '입금 내역 사진을 다시 선택해주세요.',
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
  actor: { fcId: string },
  origin?: string,
) {
  const validated = validateDiscardExamPaymentProof(body);
  if (!validated.ok) {
    return failure(validated.code, validated.message, 400, origin);
  }

  const { data: upload, error } = await supabase
    .from('exam_payment_proof_uploads')
    .select('id,fc_id,storage_path,status,registration_id,expires_at')
    .eq('id', validated.value.uploadId)
    .eq('fc_id', actor.fcId)
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
  actor: { fcId: string; residentId: string },
  origin?: string,
) {
  const validated = validateCancelExamApplication(body);
  if (!validated.ok) {
    return failure(validated.code, validated.message, 400, origin);
  }

  const { data: registration, error: registrationError } = await supabase
    .from('exam_registrations')
    .select('id,is_confirmed')
    .eq('id', validated.value.registrationId)
    .eq('resident_id', actor.residentId)
    .maybeSingle();
  if (registrationError) {
    return failure('db_error', '시험 신청을 취소하지 못했습니다.', 500, origin);
  }
  if (!registration) {
    return json({ ok: true, data: { cleanupWarning: false } }, 200, origin);
  }
  if (registration.is_confirmed) {
    return failure('confirmed_exam_registration', '접수가 확정된 신청은 취소할 수 없습니다.', 409, origin);
  }

  const { data: proof, error: proofError } = await supabase
    .from('exam_payment_proof_uploads')
    .select('storage_path')
    .eq('registration_id', registration.id)
    .eq('status', 'attached')
    .maybeSingle();
  if (proofError) {
    return failure('db_error', '시험 신청을 취소하지 못했습니다.', 500, origin);
  }

  const { error: deleteError } = await supabase
    .from('exam_registrations')
    .delete()
    .eq('id', registration.id)
    .eq('resident_id', actor.residentId);
  if (deleteError) {
    return failure('db_error', '시험 신청을 취소하지 못했습니다.', 500, origin);
  }

  let cleanupWarning = false;
  const proofPath = String(proof?.storage_path ?? '').trim();
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
  if (!sessionResult.ok) {
    return failure(
      sessionResult.code,
      sessionResult.message,
      sessionResult.status,
      origin,
    );
  }

  const actorResult = await resolveFcActor(sessionResult.session, origin);
  if (!actorResult.ok) {
    return actorResult.response;
  }

  if (body.action === 'prepare') {
    return prepareUpload(body, actorResult.actor, origin);
  }
  if (body.action === 'submit') {
    return submitApplication(body, actorResult.actor, origin);
  }
  if (body.action === 'discard') {
    return discardUpload(body, actorResult.actor, origin);
  }
  if (body.action === 'cancel') {
    return cancelApplication(body, actorResult.actor, origin);
  }
  return failure('invalid_action', '지원하지 않는 요청입니다.', 400, origin);
});
