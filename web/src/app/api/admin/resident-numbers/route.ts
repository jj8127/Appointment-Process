import { checkRateLimit, SECURITY_HEADERS } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { readResidentNumbersWithFallback } from '@/lib/server-resident-numbers';
import { getVerifiedServerSession } from '@/lib/server-session';
import { NextResponse } from 'next/server';

type Body = {
  fcIds?: string[];
};

export async function POST(req: Request) {
  const sessionCheck = await getVerifiedServerSession({
    allowedRoles: ['admin', 'manager'],
    requireActive: true,
  });
  if (!sessionCheck.ok) {
    return NextResponse.json(
      { error: sessionCheck.error },
      { status: sessionCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const rateLimit = checkRateLimit(`resident-numbers:${sessionCheck.session.residentDigits}`, 30, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch (err) {
    logger.error('[api/admin/resident-numbers] invalid json', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }

  const fcIds = Array.isArray(body.fcIds)
    ? Array.from(new Set(body.fcIds.map((v) => String(v ?? '').trim()).filter(Boolean)))
    : [];

  if (fcIds.length === 0) {
    return NextResponse.json({ ok: true, residentNumbers: {} }, { headers: SECURITY_HEADERS });
  }
  try {
    const residentNumbers = await readResidentNumbersWithFallback({
      fcIds,
      staffPhone: sessionCheck.session.residentDigits,
      logPrefix: '[api/admin/resident-numbers]',
    });

    return NextResponse.json(
      { ok: true, residentNumbers },
      { headers: SECURITY_HEADERS },
    );
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[api/admin/resident-numbers] failed', error);
    return NextResponse.json({ error: '요청 처리에 실패했습니다.' }, { status: 500, headers: SECURITY_HEADERS });
  }
}
