import { NextResponse } from 'next/server';

import { monthRange, type AdminAuditCategory } from '@/lib/admin-audit-event';
import { listAdminAuditEvents } from '@/lib/admin-audit-server';
import { serverError } from '@/lib/api-error';
import { getVerifiedAdminSession } from '@/lib/server-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESPONSE_HEADERS = { 'Cache-Control': 'private, no-store' };
const CATEGORIES = new Set<AdminAuditCategory>(['fc_action', 'export', 'personal_info_view']);
const AUDIT_LIST_LIMIT = 500;

export async function GET(req: Request) {
  const sessionCheck = await getVerifiedAdminSession();
  if (!sessionCheck.ok) {
    return NextResponse.json({ ok: false, error: sessionCheck.error }, { status: sessionCheck.status, headers: RESPONSE_HEADERS });
  }

  const url = new URL(req.url);
  const range = monthRange(url.searchParams.get('month') ?? '');
  const categoryParam = url.searchParams.get('category');
  const category = categoryParam && CATEGORIES.has(categoryParam as AdminAuditCategory) ? categoryParam as AdminAuditCategory : null;
  if (!range || (categoryParam && !category)) {
    return NextResponse.json({ ok: false, error: '조회 조건을 확인해주세요.' }, { status: 400, headers: RESPONSE_HEADERS });
  }

  try {
    const events = await listAdminAuditEvents({ ...range, category, limit: AUDIT_LIST_LIMIT });
    return NextResponse.json({ ok: true, events, limited: events.length >= AUDIT_LIST_LIMIT }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    return serverError(error, 'api/admin/audit', RESPONSE_HEADERS);
  }
}
