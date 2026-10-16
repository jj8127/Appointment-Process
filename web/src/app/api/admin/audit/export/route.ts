import { NextResponse } from 'next/server';

import { EXPORT_REASONS } from '@/lib/admin-audit-event';
import { recordAdminAuditEvent } from '@/lib/admin-audit-server';
import { getVerifiedServerSession } from '@/lib/server-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' };
const EXPORT_KINDS = new Set(['exam_applicants_xlsx']);

/** Records a personal-data download before the browser builds the file. The client aborts on failure. */
export async function POST(req: Request) {
  const sessionCheck = await getVerifiedServerSession({ allowedRoles: ['admin', 'manager'], requireActive: true });
  if (!sessionCheck.ok) {
    return NextResponse.json({ ok: false, error: sessionCheck.error }, { status: sessionCheck.status, headers: RESPONSE_HEADERS });
  }

  const body: unknown = await req.json().catch(() => null);
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const kind = typeof record.kind === 'string' ? record.kind : '';
  const rowCount = record.rowCount;
  const reason = typeof record.reason === 'string' ? record.reason : '';
  if (
    !EXPORT_KINDS.has(kind)
    || typeof rowCount !== 'number' || !Number.isInteger(rowCount) || rowCount < 1 || rowCount > 100000
    || !(EXPORT_REASONS as readonly string[]).includes(reason)
  ) {
    return NextResponse.json({ ok: false, error: '다운로드 정보를 확인할 수 없습니다.' }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const { session } = sessionCheck;
  const stored = await recordAdminAuditEvent(
    { role: session.role === 'manager' ? 'manager' : 'admin', staffType: session.staffType, residentDigits: session.residentDigits },
    { category: 'export', action: kind, targetCount: rowCount, reason },
  );
  if (!stored) {
    return NextResponse.json({ ok: false, error: '다운로드 기록을 남기지 못해 다운로드를 중단했습니다.' }, { status: 503, headers: RESPONSE_HEADERS });
  }
  return NextResponse.json({ ok: true }, { headers: RESPONSE_HEADERS });
}
