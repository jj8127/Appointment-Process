import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS, validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

type Body = {
  fcIds?: string[];
};

async function getAdminSession() {
  const cookieStore = await cookies();
  const session = {
    role: cookieStore.get('session_role')?.value ?? null,
    residentId: cookieStore.get('session_resident')?.value ?? '',
  };

  const sessionCheck = validateSession(session);
  if (!sessionCheck.valid) {
    return { ok: false as const, status: 401, error: sessionCheck.error ?? 'Unauthorized' };
  }
  if (session.role !== 'admin') {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  return { ok: true as const, session };
}

export async function POST(req: Request) {
  const adminCheck = await getAdminSession();
  if (!adminCheck.ok) {
    return NextResponse.json(
      { error: adminCheck.error },
      { status: adminCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const rateLimit = checkRateLimit(`resident-numbers:${adminCheck.session.residentId}`, 30, 60_000);
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'Missing server Supabase credentials' },
      { status: 500, headers: SECURITY_HEADERS },
    );
  }

  try {
    // Harden a bit: confirm the admin phone exists & active (cookie role alone is not enough).
    const adminPhone = String(adminCheck.session.residentId ?? '').replace(/[^0-9]/g, '');
    const { data: adminRow } = await adminSupabase
      .from('admin_accounts')
      .select('id,active')
      .eq('phone', adminPhone)
      .eq('active', true)
      .maybeSingle();

    if (!adminRow?.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: SECURITY_HEADERS });
    }

    const resp = await fetch(`${supabaseUrl}/functions/v1/admin-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        adminPhone,
        action: 'getResidentNumbers',
        payload: { fcIds },
      }),
    });

    const data = (await resp.json().catch(() => null)) as any;
    if (!resp.ok || !data?.ok) {
      logger.error('[api/admin/resident-numbers] edge function failed', {
        status: resp.status,
        body: data,
      });
      const msg = data?.message ?? data?.error ?? 'Edge Function failed';
      return NextResponse.json({ error: msg }, { status: 500, headers: SECURITY_HEADERS });
    }

    return NextResponse.json(
      { ok: true, residentNumbers: data.residentNumbers ?? {} },
      { headers: SECURITY_HEADERS },
    );
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[api/admin/resident-numbers] failed', error);
    return NextResponse.json({ error: error?.message ?? 'Request failed' }, { status: 500, headers: SECURITY_HEADERS });
  }
}

