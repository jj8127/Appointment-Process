export const EXAM_PAYMENT_PROOF_BUCKET = 'exam-payment-proofs';
export const EXAM_PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const EXAM_PAYMENT_PROOF_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type ExamPaymentProofMimeType =
  (typeof EXAM_PAYMENT_PROOF_ALLOWED_MIME_TYPES)[number];
export type ExamType = 'life' | 'nonlife';

export type PrepareExamPaymentProofInput = {
  action: 'prepare';
  requestId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  fileSize?: unknown;
};

export type SubmitExamPaymentProofInput = {
  action: 'submit';
  uploadId?: unknown;
  roundId?: unknown;
  locationId?: unknown;
  examType?: unknown;
  feePaidDate?: unknown;
  isThirdExam?: unknown;
};

export type DiscardExamPaymentProofInput = {
  action: 'discard';
  uploadId?: unknown;
};

export type CancelExamApplicationInput = {
  action: 'cancel';
  registrationId?: unknown;
};

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isUuid(value: unknown): value is string {
  return UUID_PATTERN.test(cleanString(value));
}

export function isValidYmd(value: unknown): value is string {
  const text = cleanString(value);
  if (!YMD_PATTERN.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

export function getKoreanYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function validatePrepareExamPaymentProof(
  input: PrepareExamPaymentProofInput,
): ValidationResult<{
  requestId: string;
  fileName: string;
  mimeType: ExamPaymentProofMimeType;
  fileSize: number;
}> {
  const requestId = cleanString(input.requestId);
  const fileName = cleanString(input.fileName);
  const mimeType = cleanString(input.mimeType).toLowerCase();
  const fileSize = Number(input.fileSize);

  if (!isUuid(requestId)) {
    return { ok: false, code: 'invalid_request_id', message: '첨부 요청을 다시 시작해주세요.' };
  }
  if (!fileName || fileName.length > 180) {
    return { ok: false, code: 'invalid_file_name', message: '사진 파일 이름을 확인해주세요.' };
  }
  if (
    !EXAM_PAYMENT_PROOF_ALLOWED_MIME_TYPES.includes(
      mimeType as ExamPaymentProofMimeType,
    )
  ) {
    return {
      ok: false,
      code: 'invalid_mime_type',
      message: 'JPG, PNG 또는 WebP 사진만 첨부할 수 있습니다.',
    };
  }
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > EXAM_PAYMENT_PROOF_MAX_BYTES) {
    return {
      ok: false,
      code: 'invalid_file_size',
      message: '입금 내역 사진은 10MB 이하만 첨부할 수 있습니다.',
    };
  }

  return {
    ok: true,
    value: {
      requestId,
      fileName,
      mimeType: mimeType as ExamPaymentProofMimeType,
      fileSize,
    },
  };
}

export function validateSubmitExamPaymentProof(
  input: SubmitExamPaymentProofInput,
): ValidationResult<{
  uploadId: string | null;
  roundId: string;
  locationId: string;
  examType: ExamType;
  feePaidDate: string;
  isThirdExam: boolean;
}> {
  const uploadIdRaw = cleanString(input.uploadId);
  const roundId = cleanString(input.roundId);
  const locationId = cleanString(input.locationId);
  const examType = cleanString(input.examType);
  const feePaidDate = cleanString(input.feePaidDate);

  if (uploadIdRaw && !isUuid(uploadIdRaw)) {
    return { ok: false, code: 'invalid_upload_id', message: '입금 내역 사진을 다시 선택해주세요.' };
  }
  if (!isUuid(roundId) || !isUuid(locationId)) {
    return { ok: false, code: 'invalid_exam_selection', message: '시험 일정과 지역을 다시 선택해주세요.' };
  }
  if (examType !== 'life' && examType !== 'nonlife') {
    return { ok: false, code: 'invalid_exam_type', message: '시험 구분을 확인할 수 없습니다.' };
  }
  if (!isValidYmd(feePaidDate)) {
    return { ok: false, code: 'invalid_fee_paid_date', message: '응시료 납입 일자를 다시 선택해주세요.' };
  }
  if (typeof input.isThirdExam !== 'boolean') {
    return { ok: false, code: 'invalid_subject', message: '응시 과목을 다시 선택해주세요.' };
  }

  return {
    ok: true,
    value: {
      uploadId: uploadIdRaw || null,
      roundId,
      locationId,
      examType,
      feePaidDate,
      isThirdExam: input.isThirdExam,
    },
  };
}

export function validateDiscardExamPaymentProof(
  input: DiscardExamPaymentProofInput,
): ValidationResult<{ uploadId: string }> {
  const uploadId = cleanString(input.uploadId);
  if (!isUuid(uploadId)) {
    return { ok: false, code: 'invalid_upload_id', message: '삭제할 입금 내역을 확인할 수 없습니다.' };
  }
  return { ok: true, value: { uploadId } };
}

export function validateCancelExamApplication(
  input: CancelExamApplicationInput,
): ValidationResult<{ registrationId: string }> {
  const registrationId = cleanString(input.registrationId);
  if (!isUuid(registrationId)) {
    return { ok: false, code: 'invalid_registration_id', message: '취소할 신청 내역을 확인할 수 없습니다.' };
  }
  return { ok: true, value: { registrationId } };
}

export function getExtensionForMimeType(mimeType: ExamPaymentProofMimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

export function buildExamPaymentProofStoragePath({
  fcId,
  objectId,
  mimeType,
}: {
  fcId: string;
  objectId: string;
  mimeType: ExamPaymentProofMimeType;
}) {
  if (!isUuid(fcId) || !isUuid(objectId)) {
    throw new Error('invalid payment proof storage identity');
  }
  return `fc/${fcId}/${objectId}.${getExtensionForMimeType(mimeType)}`;
}
