import { NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS } from '@/lib/csrf';
import {
  EXAM_PAYMENT_PROOF_BUCKET,
  EXAM_PAYMENT_PROOF_EXPORT_EXPIRES_IN_SECONDS,
  EXAM_PAYMENT_PROOF_EXPORT_VALID_DAYS,
  type ExamPaymentProofExportLink,
} from '@/lib/exam-payment-proof-admin';
import { logger } from '@/lib/logger';
import { getVerifiedReadOnlyAdminSession } from '@/lib/server-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EXPORT_REGISTRATIONS = 1000;
const STORAGE_BATCH_SIZE = 100;

type ExportBody = {
  registrationIds?: unknown;
};

type ProofRow = {
  registration_id: string;
  storage_path: string;
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: SECURITY_HEADERS });
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function POST(request: Request) {
  const sessionCheck = await getVerifiedReadOnlyAdminSession();
  if (!sessionCheck.ok) {
    return jsonError(sessionCheck.error, sessionCheck.status);
  }

  const rateLimit = checkRateLimit(
    `exam-payment-proof-export:${sessionCheck.session.residentDigits}`,
    10,
    60_000,
  );
  if (!rateLimit.allowed) {
    return jsonError('Too many requests', 429);
  }

  let body: ExportBody;
  try {
    body = (await request.json()) as ExportBody;
  } catch {
    return jsonError('Invalid JSON payload', 400);
  }

  if (!Array.isArray(body.registrationIds)) {
    return jsonError('시험 신청 식별자 목록이 필요합니다.', 400);
  }

  const registrationIds = Array.from(new Set(body.registrationIds));
  if (
    registrationIds.length === 0
    || registrationIds.length > MAX_EXPORT_REGISTRATIONS
    || registrationIds.some((value) => typeof value !== 'string' || !UUID_PATTERN.test(value))
  ) {
    return jsonError('유효하지 않은 시험 신청 식별자가 포함되어 있습니다.', 400);
  }

  try {
    const proofRows: ProofRow[] = [];
    for (const idChunk of chunk(registrationIds as string[], STORAGE_BATCH_SIZE)) {
      const { data, error } = await adminSupabase
        .from('exam_payment_proof_uploads')
        .select('registration_id,storage_path')
        .in('registration_id', idChunk)
        .eq('status', 'attached');

      if (error) throw error;
      proofRows.push(...((data ?? []) as ProofRow[]));
    }

    const proofByPath = new Map(
      proofRows
        .filter((row) => row.registration_id && row.storage_path)
        .map((row) => [row.storage_path, row]),
    );
    const links: ExamPaymentProofExportLink[] = [];

    for (const pathChunk of chunk([...proofByPath.keys()], STORAGE_BATCH_SIZE)) {
      const { data, error } = await adminSupabase.storage
        .from(EXAM_PAYMENT_PROOF_BUCKET)
        .createSignedUrls(pathChunk, EXAM_PAYMENT_PROOF_EXPORT_EXPIRES_IN_SECONDS);

      if (error || !data) {
        throw error ?? new Error('Payment proof signed URL creation failed');
      }

      for (const signed of data) {
        const proof = signed.path ? proofByPath.get(signed.path) : undefined;
        if (!proof || signed.error || !signed.signedUrl) {
          throw new Error('Payment proof signed URL creation returned an incomplete result');
        }
        links.push({
          registrationId: proof.registration_id,
          storagePath: proof.storage_path,
          signedUrl: signed.signedUrl,
        });
      }
    }

    return NextResponse.json(
      {
        ok: true,
        validDays: EXAM_PAYMENT_PROOF_EXPORT_VALID_DAYS,
        links,
      },
      {
        headers: {
          ...SECURITY_HEADERS,
          'Cache-Control': 'private, no-store, max-age=0',
        },
      },
    );
  } catch (error: unknown) {
    logger.error('[api/admin/exam-applicants/payment-proof-export] failed', {
      registrationCount: registrationIds.length,
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return jsonError('입금 증빙 링크를 발급하지 못했습니다.', 500);
  }
}
