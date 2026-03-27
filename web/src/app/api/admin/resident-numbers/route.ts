import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS, validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

type Body = {
  fcIds?: string[];
};

function formatPhone(digits: string): string {
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function buildPhoneCandidates(value: string | null | undefined): string[] {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/[^0-9]/g, '');
  const values = new Set<string>();

  if (raw) values.add(raw);
  if (digits) values.add(digits);

  const formatted = formatPhone(digits);
  if (formatted) values.add(formatted);

  return Array.from(values).filter(Boolean);
}

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
  if (session.role !== 'admin' && session.role !== 'manager') {
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
    // Harden a bit: confirm the privileged staff phone exists & active.
    const staffPhone = String(adminCheck.session.residentId ?? '').replace(/[^0-9]/g, '');
    const staffPhoneCandidates = buildPhoneCandidates(adminCheck.session.residentId);
    const accountTable = adminCheck.session.role === 'manager' ? 'manager_accounts' : 'admin_accounts';
    const { data: staffRow } = await adminSupabase
      .from(accountTable)
      .select('id,active')
      .in('phone', staffPhoneCandidates)
      .eq('active', true)
      .maybeSingle();

    if (!staffRow?.id) {
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
        adminPhone: staffPhone,
        action: 'getResidentNumbers',
        payload: { fcIds },
      }),
    });

    const data: unknown = await resp.json().catch(() => null);
    const isOk =
      resp.ok &&
      isRecord(data) &&
      data.ok === true &&
      isRecord(data.residentNumbers);

    if (!isOk) {
      logger.error('[api/admin/resident-numbers] edge function failed', {
        status: resp.status,
        body: data,
      });

      let msg = 'Edge Function failed';
      if (isRecord(data)) {
        if (typeof data.message === 'string') msg = data.message;
        else if (typeof data.error === 'string') msg = data.error;
      }

      return NextResponse.json(
        { error: msg },
        { status: resp.status === 403 ? 403 : 500, headers: SECURITY_HEADERS },
      );
    }

    const residentNumbers = (data as Record<string, unknown>).residentNumbers as Record<
      string,
      string | null
    >;

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
