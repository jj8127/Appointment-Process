import { NextResponse } from 'next/server';

import { adminRouteAuthErrorResponse, requireAdminRoute } from '@/lib/admin-route-auth';
import { checkRateLimit } from '@/lib/csrf';
import { logger } from '@/lib/logger';

type DeleteRequestBody = {
  fcId?: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req: Request) {
  let body: DeleteRequestBody;
  try {
    body = (await req.json()) as DeleteRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const sessionCheck = await requireAdminRoute();
  if (!sessionCheck.ok) {
    return adminRouteAuthErrorResponse(sessionCheck);
  }

  const rateLimit = checkRateLimit(
    `fc-delete:${sessionCheck.session.residentId}`,
    10,
    60_000,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const fcId = String(body.fcId ?? '').trim();
  if (!UUID_PATTERN.test(fcId)) {
    return NextResponse.json({ error: '유효하지 않은 FC 식별자입니다.' }, { status: 400 });
  }
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Missing Supabase admin credentials.' }, { status: 500 });
  }

  // admin-action deleteFc retires the GaramLink account before the local
  // deletion transaction, so the web keeps no second deletion path.
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/admin-action`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        adminPhone: sessionCheck.session.residentId,
        action: 'deleteFc',
        payload: { fcId },
      }),
    });
  } catch {
    logger.warn('[api/fc-delete] admin-action unavailable');
    return NextResponse.json({ error: '삭제 요청을 처리하지 못했습니다. 다시 시도해 주세요.' }, { status: 502 });
  }

  const result = await response.json().catch(() => null) as {
    ok?: unknown;
    deleted?: unknown;
    cleanupWarning?: unknown;
    message?: unknown;
  } | null;
  if (!response.ok || result?.ok !== true) {
    logger.warn('[api/fc-delete] deletion rejected', { status: response.status });
    return NextResponse.json({
      error: typeof result?.message === 'string' && result.message
        ? result.message
        : '삭제 요청을 처리하지 못했습니다. 다시 시도해 주세요.',
    }, { status: response.ok ? 502 : response.status });
  }

  return NextResponse.json({
    ok: true,
    deleted: result.deleted === true,
    cleanupWarning: result.cleanupWarning === true,
  });
}
