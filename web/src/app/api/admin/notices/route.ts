import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS, validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

type DeleteBody = {
  id?: string;
};

async function getSession() {
  const cookieStore = await cookies();
  const session = {
    role: cookieStore.get('session_role')?.value ?? null,
    residentId: cookieStore.get('session_resident')?.value ?? '',
  };

  const valid = validateSession(session);
  if (!valid.valid) {
    return { ok: false as const, status: 401, error: valid.error ?? 'Unauthorized' };
  }

  if (session.role !== 'admin' && session.role !== 'manager') {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  return { ok: true as const, session };
}

export async function GET() {
  const sessionCheck = await getSession();
  if (!sessionCheck.ok) {
    return NextResponse.json(
      { error: sessionCheck.error },
      { status: sessionCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const rateLimit = checkRateLimit(`notices:list:${sessionCheck.session.residentId}`, 60, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  try {
    const withAttachments = await adminSupabase
      .from('notices')
      .select('id,title,body,category,created_at,images,files')
      .order('created_at', { ascending: false });

    if (!withAttachments.error) {
      return NextResponse.json(
        { ok: true, notices: withAttachments.data ?? [] },
        { headers: SECURITY_HEADERS },
      );
    }

    // Backward compatible fallback for environments without images/files columns.
    if (withAttachments.error.code === '42703') {
      const basic = await adminSupabase
        .from('notices')
        .select('id,title,body,category,created_at')
        .order('created_at', { ascending: false });

      if (basic.error) {
        return NextResponse.json({ error: basic.error.message }, { status: 500, headers: SECURITY_HEADERS });
      }

      return NextResponse.json(
        { ok: true, notices: basic.data ?? [] },
        { headers: SECURITY_HEADERS },
      );
    }

    return NextResponse.json(
      { error: withAttachments.error.message },
      { status: 500, headers: SECURITY_HEADERS },
    );
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[api/admin/notices][GET] failed', error);
    return NextResponse.json(
      { error: error?.message ?? 'Request failed' },
      { status: 500, headers: SECURITY_HEADERS },
    );
  }
}

export async function DELETE(req: Request) {
  const sessionCheck = await getSession();
  if (!sessionCheck.ok) {
    return NextResponse.json(
      { error: sessionCheck.error },
      { status: sessionCheck.status, headers: SECURITY_HEADERS },
    );
  }

  if (sessionCheck.session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: SECURITY_HEADERS });
  }

  const rateLimit = checkRateLimit(`notices:delete:${sessionCheck.session.residentId}`, 30, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch (err) {
    logger.error('[api/admin/notices][DELETE] invalid json', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }

  const id = body.id?.trim();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400, headers: SECURITY_HEADERS });
  }

  try {
    const { error } = await adminSupabase.from('notices').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: SECURITY_HEADERS });
    }
    return NextResponse.json({ ok: true }, { headers: SECURITY_HEADERS });
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[api/admin/notices][DELETE] failed', error);
    return NextResponse.json(
      { error: error?.message ?? 'Request failed' },
      { status: 500, headers: SECURITY_HEADERS },
    );
  }
}

