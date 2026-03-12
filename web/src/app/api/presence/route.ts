import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS, validateSession, verifyOrigin } from '@/lib/csrf';

type PresenceRequestBody = {
  phones?: Array<string | null | undefined>;
};

type PresenceTableRow = {
  phone: string;
  garam_in_at: string | null;
  garam_link_at: string | null;
  updated_at: string | null;
};

type PresenceSnapshot = PresenceTableRow & {
  last_seen_at: string | null;
  is_online: boolean;
};

const PRESENCE_THRESHOLD_MS = 65_000;
const selectPresenceColumns = 'phone, garam_in_at, garam_link_at, updated_at';

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: SECURITY_HEADERS,
  });
}

function cleanPhone(input: string | null | undefined) {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

function normalizePhones(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => cleanPhone(value))
        .filter((phone) => phone.length === 11),
    ),
  ).slice(0, 100);
}

function isMissingPresenceRpcError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { code?: string; message?: string };
  return maybeError.code === 'PGRST202'
    || String(maybeError.message ?? '').includes('Could not find the function public.');
}

function parsePresenceTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toPresenceSnapshot(row: PresenceTableRow): PresenceSnapshot {
  const timestamps = [row.garam_in_at, row.garam_link_at]
    .map((value) => parsePresenceTimestamp(value))
    .filter((value): value is number => value !== null);

  const lastSeenAt = timestamps.length > 0
    ? new Date(Math.max(...timestamps)).toISOString()
    : null;
  const threshold = Date.now() - PRESENCE_THRESHOLD_MS;
  const isOnline = [row.garam_in_at, row.garam_link_at].some((value) => {
    const timestamp = parsePresenceTimestamp(value);
    return timestamp !== null && timestamp > threshold;
  });

  return {
    phone: row.phone,
    garam_in_at: row.garam_in_at,
    garam_link_at: row.garam_link_at,
    updated_at: row.updated_at,
    last_seen_at: lastSeenAt,
    is_online: isOnline,
  };
}

async function getPresenceSnapshots(phones: string[]) {
  const normalizedPhones = normalizePhones(phones);
  if (normalizedPhones.length === 0) {
    return [] as PresenceSnapshot[];
  }

  try {
    const { data, error } = await adminSupabase.rpc('get_user_presence', { p_phones: normalizedPhones });
    if (error) {
      throw error;
    }

    return (data ?? []) as PresenceSnapshot[];
  } catch (error) {
    if (!isMissingPresenceRpcError(error)) {
      throw error;
    }

    const { data, error: tableError } = await adminSupabase
      .from('user_presence')
      .select(selectPresenceColumns)
      .in('phone', normalizedPhones);

    if (tableError) {
      throw tableError;
    }

    return ((data ?? []) as PresenceTableRow[]).map(toPresenceSnapshot);
  }
}

async function getReadablePhones(role: 'fc' | 'admin' | 'manager', currentPhone: string) {
  const allowedPhones = new Set<string>([currentPhone]);

  if (role === 'fc') {
    const [managersResult, adminsResult] = await Promise.all([
      adminSupabase.from('manager_accounts').select('phone').eq('active', true),
      adminSupabase.from('admin_accounts').select('phone').eq('active', true),
    ]);

    if (managersResult.error) {
      throw managersResult.error;
    }
    if (adminsResult.error) {
      throw adminsResult.error;
    }

    (managersResult.data ?? []).forEach((row) => {
      const phone = cleanPhone(row.phone);
      if (phone.length === 11) {
        allowedPhones.add(phone);
      }
    });
    (adminsResult.data ?? []).forEach((row) => {
      const phone = cleanPhone(row.phone);
      if (phone.length === 11) {
        allowedPhones.add(phone);
      }
    });

    return allowedPhones;
  }

  const [fcResult, managersResult, adminsResult] = await Promise.all([
    adminSupabase.from('fc_profiles').select('phone').eq('signup_completed', true),
    adminSupabase.from('manager_accounts').select('phone').eq('active', true),
    adminSupabase.from('admin_accounts').select('phone').eq('active', true),
  ]);

  if (fcResult.error) {
    throw fcResult.error;
  }
  if (managersResult.error) {
    throw managersResult.error;
  }
  if (adminsResult.error) {
    throw adminsResult.error;
  }

  [fcResult.data ?? [], managersResult.data ?? [], adminsResult.data ?? []].forEach((rows) => {
    rows.forEach((row) => {
      const phone = cleanPhone(row.phone);
      if (phone.length === 11) {
        allowedPhones.add(phone);
      }
    });
  });

  return allowedPhones;
}

export async function POST(req: Request) {
  const originCheck = await verifyOrigin();
  if (!originCheck.valid) {
    return json({ ok: false, message: originCheck.error ?? 'Invalid origin' }, 403);
  }

  const cookieStore = await cookies();
  const session = {
    role: cookieStore.get('session_role')?.value ?? null,
    residentId: cookieStore.get('session_resident')?.value ?? '',
  };

  const sessionCheck = validateSession(session);
  if (!sessionCheck.valid) {
    return json({ ok: false, message: sessionCheck.error ?? 'Unauthorized' }, 401);
  }

  if (session.role !== 'admin' && session.role !== 'manager' && session.role !== 'fc') {
    return json({ ok: false, message: 'Forbidden' }, 403);
  }

  const rateLimit = checkRateLimit(`presence:${session.role}:${session.residentId}`, 60, 60_000);
  if (!rateLimit.allowed) {
    return json({ ok: false, message: 'Too many requests' }, 429);
  }

  let body: PresenceRequestBody;
  try {
    body = (await req.json()) as PresenceRequestBody;
  } catch {
    return json({ ok: false, message: 'Invalid JSON payload' }, 400);
  }

  const currentPhone = cleanPhone(session.residentId);
  if (currentPhone.length !== 11) {
    return json({ ok: false, message: 'Invalid resident phone' }, 401);
  }

  const requestedPhones = normalizePhones(body.phones ?? []);
  if (requestedPhones.length === 0) {
    return json({ ok: true, data: [] });
  }

  try {
    const allowedPhones = await getReadablePhones(session.role, currentPhone);
    const scopedPhones = requestedPhones.filter((phone) => allowedPhones.has(phone));

    if (scopedPhones.length === 0) {
      return json({ ok: true, data: [] });
    }

    const rows = await getPresenceSnapshots(scopedPhones);
    return json({ ok: true, data: rows });
  } catch (error) {
    return json({
      ok: false,
      message: error instanceof Error ? error.message : '활동 상태 조회에 실패했습니다.',
    }, 500);
  }
}
