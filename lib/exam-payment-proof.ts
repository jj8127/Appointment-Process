export const EXAM_PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const EXAM_PAYMENT_PROOF_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const EXAM_PAYMENT_PROOF_CAUTION =
  '입력하신 입금 날짜와 첨부한 입금 내역의 실제 입금 날짜가 다를 경우 시험 신청이 처리되지 않습니다.';

export type ExamPaymentProofMimeType =
  (typeof EXAM_PAYMENT_PROOF_ALLOWED_MIME_TYPES)[number];

export type ExamPaymentProofSelection = {
  requestId: string;
  uri: string;
  fileName: string;
  mimeType: ExamPaymentProofMimeType;
  fileSize: number;
};

type ImagePickerAssetLike = {
  uri?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
};

type NormalizeResult =
  | { ok: true; value: ExamPaymentProofSelection }
  | { ok: false; message: string };

const MIME_BY_EXTENSION: Record<string, ExamPaymentProofMimeType> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function normalizeMimeType(
  mimeType: string | null | undefined,
  fileName: string,
): ExamPaymentProofMimeType | null {
  const normalizedMimeType = String(mimeType ?? '').trim().toLowerCase();
  if (
    EXAM_PAYMENT_PROOF_ALLOWED_MIME_TYPES.includes(
      normalizedMimeType as ExamPaymentProofMimeType,
    )
  ) {
    return normalizedMimeType as ExamPaymentProofMimeType;
  }

  const extension = fileName.split('.').pop()?.trim().toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? null;
}

function defaultFileName(mimeType?: string | null) {
  const normalizedMimeType = String(mimeType ?? '').trim().toLowerCase();
  if (normalizedMimeType === 'image/png') return '입금내역.png';
  if (normalizedMimeType === 'image/webp') return '입금내역.webp';
  return '입금내역.jpg';
}

export function normalizeExamPaymentProofSelection(
  asset: ImagePickerAssetLike,
  requestId: string,
): NormalizeResult {
  const uri = String(asset.uri ?? '').trim();
  const normalizedRequestId = String(requestId ?? '').trim();
  if (!uri || !normalizedRequestId) {
    return { ok: false, message: '입금 내역 사진을 다시 선택해주세요.' };
  }

  const fileSize = Number(asset.fileSize);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    return { ok: false, message: '사진 용량을 확인할 수 없습니다. 다른 사진을 선택해주세요.' };
  }
  if (fileSize > EXAM_PAYMENT_PROOF_MAX_BYTES) {
    return { ok: false, message: '입금 내역 사진은 10MB 이하만 첨부할 수 있습니다.' };
  }

  const fileName = String(asset.fileName ?? '').trim() || defaultFileName(asset.mimeType);
  const mimeType = normalizeMimeType(asset.mimeType, fileName);
  if (!mimeType) {
    return { ok: false, message: 'JPG, PNG 또는 WebP 사진만 첨부할 수 있습니다.' };
  }

  return {
    ok: true,
    value: {
      requestId: normalizedRequestId,
      uri,
      fileName: fileName.slice(0, 180),
      mimeType,
      fileSize,
    },
  };
}

export function hasExamPaymentProof({
  selectedProof,
  existingProofAttached,
}: {
  selectedProof?: ExamPaymentProofSelection | null;
  existingProofAttached?: boolean | null;
}) {
  return Boolean(selectedProof || existingProofAttached);
}
