import { NextResponse } from 'next/server';

import { serverError } from '@/lib/api-error';
import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS, verifyOrigin } from '@/lib/csrf';
import { getVerifiedServerSession } from '@/lib/server-session';
import { requireSupabaseRowsMatching } from '@/lib/supabase-query-contract';
import {
  isPresencePhoneRow,
  isPresenceSnapshot,
  isPresenceTableRow,
  mergePresenceSnapshots,
  normalizePresencePhone,
  presenceRowsHaveUniquePhones,
  presenceRowsMatchRequestedPhones,
  type PresenceSnapshot,
  type PresenceTableRow,
} from '@shared/supabase/functions/_shared/presence-query-contract.ts';

type PresenceRequestBody = {
  phones: Array<string | null>;
};

const PRESENCE_THRESHOLD_MS = 65_000;
const selectPresenceColumns = 'phone, garam_in_at, garam_link_at, updated_at';

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: SECURITY_HEADERS,
  });
}

function normalizePhones(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizePresencePhone(value))
        .filter((phone) => phone.length === 11),
    ),
  ).slice(0, 100);
}

function isPresenceRequestBody(value: unknown): value is PresenceRequestBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const phones = (value as { phones?: unknown }).phones;
  return Array.isArray(phones)
    && phones.every((phone) => phone === null || typeof phone === 'string');
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

    const rows = requireSupabaseRowsMatching(data, 'presence_rpc', isPresenceSnapshot);
    if (!presenceRowsMatchRequestedPhones(rows, normalizedPhones, true)) {
      throw new Error('presence_rpc_query_contract_invalid');
    }
    return rows;
  } catch {

    const { data, error: tableError } = await adminSupabase
      .from('user_presence')
      .select(selectPresenceColumns)
      .in('phone', normalizedPhones);

    if (tableError) {
      throw tableError;
    }

    const rows = requireSupabaseRowsMatching(data, 'presence_fallback', isPresenceTableRow);
    if (!presenceRowsMatchRequestedPhones(rows, normalizedPhones, false)) {
      throw new Error('presence_fallback_query_contract_invalid');
    }
    return mergePresenceSnapshots(normalizedPhones, rows.map(toPresenceSnapshot));
  }
}

function requirePresencePhoneRows(data: unknown, queryName: string) {
  const rows = requireSupabaseRowsMatching(data, queryName, isPresencePhoneRow);
  if (!presenceRowsHaveUniquePhones(rows)) {
    throw new Error(`${queryName}_query_contract_invalid`);
  }
  return rows;
}

async function getReadablePhones(
  role: 'fc' | 'admin' | 'manager',
  currentPhone: string,
  requestedPhones: string[],
) {
  const allowedPhones = new Set<string>([currentPhone]);
  const scopedPhones = normalizePhones(requestedPhones);

  if (role === 'fc') {
    const [managersResult, adminsResult] = await Promise.all([
      adminSupabase.from('manager_accounts').select('phone').eq('active', true).in('phone', scopedPhones),
      adminSupabase.from('admin_accounts').select('phone').eq('active', true).in('phone', scopedPhones),
    ]);

    if (managersResult.error) {
      throw managersResult.error;
    }
    if (adminsResult.error) {
      throw adminsResult.error;
    }

    requirePresencePhoneRows(managersResult.data, 'presence_scope_managers').forEach((row) => {
      const phone = normalizePresencePhone(row.phone);
      if (phone.length === 11) {
        allowedPhones.add(phone);
      }
    });
    requirePresencePhoneRows(adminsResult.data, 'presence_scope_admins').forEach((row) => {
      const phone = normalizePresencePhone(row.phone);
      if (phone.length === 11) {
        allowedPhones.add(phone);
      }
    });

    return allowedPhones;
  }

  const [fcResult, managersResult, adminsResult] = await Promise.all([
    adminSupabase.from('fc_profiles').select('phone').eq('signup_completed', true).in('phone', scopedPhones),
    adminSupabase.from('manager_accounts').select('phone').eq('active', true).in('phone', scopedPhones),
    adminSupabase.from('admin_accounts').select('phone').eq('active', true).in('phone', scopedPhones),
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

  [
    requirePresencePhoneRows(fcResult.data, 'presence_scope_fcs'),
    requirePresencePhoneRows(managersResult.data, 'presence_scope_managers'),
    requirePresencePhoneRows(adminsResult.data, 'presence_scope_admins'),
  ].forEach((rows) => {
    rows.forEach((row) => {
      const phone = normalizePresencePhone(row.phone);
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

  const sessionCheck = await getVerifiedServerSession({ allowedRoles: ['admin', 'manager', 'fc'] });
  if (!sessionCheck.ok) {
    return json({ ok: false, message: sessionCheck.error }, sessionCheck.status);
  }
  const session = sessionCheck.session;

  const rateLimit = checkRateLimit(`presence:${session.role}:${session.residentId}`, 60, 60_000);
  if (!rateLimit.allowed) {
    return json({ ok: false, message: 'Too many requests' }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, message: 'Invalid JSON payload' }, 400);
  }
  if (!isPresenceRequestBody(body)) {
    return json({ ok: false, message: 'Invalid JSON payload' }, 400);
  }

  const currentPhone = normalizePresencePhone(session.residentId);
  if (currentPhone.length !== 11) {
    return json({ ok: false, message: 'Invalid resident phone' }, 401);
  }

  const requestedPhones = normalizePhones(body.phones);
  if (requestedPhones.length === 0) {
    return json({ ok: true, data: [] });
  }

  try {
    const allowedPhones = await getReadablePhones(session.role, currentPhone, requestedPhones);
    const scopedPhones = requestedPhones.filter((phone) => allowedPhones.has(phone));

    if (scopedPhones.length === 0) {
      return json({ ok: true, data: [] });
    }

    const rows = await getPresenceSnapshots(scopedPhones);
    return json({ ok: true, data: rows });
  } catch (error) {
    return serverError(error, 'api/presence', SECURITY_HEADERS);
  }
}
