import { NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS } from '@/lib/csrf';
import { EXAM_PAYMENT_PROOF_BUCKET } from '@/lib/exam-payment-proof-admin';
import { logger } from '@/lib/logger';
import { getVerifiedReadOnlyAdminSession } from '@/lib/server-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const EXTENSION_BY_MIME_TYPE = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: SECURITY_HEADERS });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionCheck = await getVerifiedReadOnlyAdminSession();
  if (!sessionCheck.ok) {
    return jsonError(sessionCheck.error, sessionCheck.status);
  }

  const { id } = await params;
  const registrationId = id.trim();
  if (!UUID_PATTERN.test(registrationId)) {
    return jsonError('유효하지 않은 시험 신청 식별자입니다.', 400);
  }

  const rateLimit = checkRateLimit(
    `exam-payment-proof-view:${sessionCheck.session.residentDigits}`,
    60,
    60_000,
  );
  if (!rateLimit.allowed) {
    return jsonError('Too many requests', 429);
  }

  try {
    const { data: registration, error: registrationError } = await adminSupabase
      .from('exam_registrations')
      .select('id,payment_proof_attached')
      .eq('id', registrationId)
      .maybeSingle();

    if (registrationError) throw registrationError;
    if (!registration?.payment_proof_attached) {
      return jsonError('첨부된 입금 증빙이 없습니다.', 404);
    }

    const { data: proof, error: proofError } = await adminSupabase
      .from('exam_payment_proof_uploads')
      .select('storage_path,mime_type,file_size')
      .eq('registration_id', registrationId)
      .eq('status', 'attached')
      .maybeSingle();

    if (proofError) throw proofError;
    if (!proof) {
      return jsonError('첨부된 입금 증빙이 없습니다.', 404);
    }

    const storagePath = String(proof.storage_path ?? '').trim();
    const mimeType = String(proof.mime_type ?? '').toLowerCase();
    const fileSize = Number(proof.file_size);
    const extension = EXTENSION_BY_MIME_TYPE.get(mimeType);
    if (
      !storagePath
      || !extension
      || !Number.isSafeInteger(fileSize)
      || fileSize <= 0
      || fileSize > MAX_PROOF_BYTES
    ) {
      return jsonError('입금 증빙 파일을 열 수 없습니다.', 422);
    }

    const { data: file, error: downloadError } = await adminSupabase.storage
      .from(EXAM_PAYMENT_PROOF_BUCKET)
      .download(storagePath);

    if (downloadError || !file) {
      throw downloadError ?? new Error('Payment proof download failed');
    }

    const bytes = await file.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
        Vary: 'Cookie',
        'Content-Type': mimeType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `inline; filename="payment-proof.${extension}"`,
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch (error: unknown) {
    logger.error('[api/admin/exam-applicants/payment-proof] read failed', {
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return jsonError('입금 증빙 파일을 불러오지 못했습니다.', 500);
  }
}
