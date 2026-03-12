import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { getEnv, parseAppSessionToken } from '../_shared/request-board-auth.ts';

type PresenceAction = 'heartbeat' | 'offline' | 'read';

type RequestBody = {
  sessionToken?: string;
  action?: PresenceAction;
  expectedAt?: string | null;
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

type PresenceMutationSnapshot = PresenceSnapshot & {
  applied?: boolean;
};

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}

if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceKey);
const PRESENCE_THRESHOLD_MS = 65_000;
const STALE_PRESENCE_AT = '1970-01-01T00:00:00.000Z';
const selectPresenceColumns = 'phone, garam_in_at, garam_link_at, updated_at';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(code: string, message: string, status = 400) {
  return json({ ok: false, code, message }, status);
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

function createEmptyPresenceSnapshot(phone: string): PresenceSnapshot {
  return {
    phone,
    garam_in_at: null,
    garam_link_at: null,
    updated_at: null,
    last_seen_at: null,
    is_online: false,
  };
}

function mergePresenceSnapshots(
  phones: string[],
  snapshots: PresenceSnapshot[],
): PresenceSnapshot[] {
  const snapshotByPhone = new Map(
    snapshots.map((snapshot) => [cleanPhone(snapshot.phone), snapshot] as const),
  );

  return normalizePhones(phones).map(
    (phone) => snapshotByPhone.get(phone) ?? createEmptyPresenceSnapshot(phone),
  );
}

async function getPresenceTableRow(phone: string) {
  const { data, error } = await supabase
    .from('user_presence')
    .select(selectPresenceColumns)
    .eq('phone', phone)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data ?? null) as PresenceTableRow | null;
}

async function getPresenceSnapshots(phones: string[]) {
  const normalizedPhones = normalizePhones(phones);
  if (normalizedPhones.length === 0) {
    return [] as PresenceSnapshot[];
  }

  try {
    const { data, error } = await supabase.rpc('get_user_presence', { p_phones: normalizedPhones });
    if (error) {
      throw error;
    }
    return mergePresenceSnapshots(normalizedPhones, (data ?? []) as PresenceSnapshot[]);
  } catch (error) {
    console.warn('[user-presence] get_user_presence rpc failed; falling back to table read', error);

    const { data, error: tableError } = await supabase
      .from('user_presence')
      .select(selectPresenceColumns)
      .in('phone', normalizedPhones);

    if (tableError) {
      throw tableError;
    }

    return mergePresenceSnapshots(
      normalizedPhones,
      ((data ?? []) as PresenceTableRow[]).map(toPresenceSnapshot),
    );
  }
}

async function touchPresence(phone: string) {
  try {
    const { data, error } = await supabase.rpc('touch_user_presence', {
      p_phone: phone,
      p_platform: 'garam_in',
    });

    if (error) {
      throw error;
    }

    const snapshot = Array.isArray(data) ? data[0] ?? null : null;
    return snapshot as PresenceSnapshot | null;
  } catch (error) {
    console.warn('[user-presence] touch_user_presence rpc failed; falling back to table write', error);

    const touchedAt = new Date().toISOString();
    const { data: updatedRow, error: updateError } = await supabase
      .from('user_presence')
      .update({
        garam_in_at: touchedAt,
        updated_at: touchedAt,
      })
      .eq('phone', phone)
      .select(selectPresenceColumns)
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    if (updatedRow) {
      return toPresenceSnapshot(updatedRow as PresenceTableRow);
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from('user_presence')
      .insert({
        phone,
        garam_in_at: touchedAt,
        garam_link_at: null,
        updated_at: touchedAt,
      })
      .select(selectPresenceColumns)
      .single();

    if (insertError) {
      throw insertError;
    }

    return insertedRow ? toPresenceSnapshot(insertedRow as PresenceTableRow) : null;
  }
}

async function stalePresence(phone: string, expectedAt: string | null) {
  try {
    const { data, error } = await supabase.rpc('stale_user_presence', {
      p_phone: phone,
      p_platform: 'garam_in',
      p_expected_at: expectedAt,
    });

    if (error) {
      throw error;
    }

    const snapshot = Array.isArray(data) ? data[0] ?? null : null;
    return snapshot as PresenceMutationSnapshot | null;
  } catch (error) {
    console.warn('[user-presence] stale_user_presence rpc failed; falling back to table write', error);

    const currentRow = await getPresenceTableRow(phone);
    if (!currentRow) {
      return null;
    }

    if (expectedAt && currentRow.garam_in_at !== expectedAt) {
      return {
        ...toPresenceSnapshot(currentRow),
        applied: false,
      };
    }

    const updatedAt = new Date().toISOString();
    const { data: updatedRow, error: updateError } = await supabase
      .from('user_presence')
      .update({
        garam_in_at: STALE_PRESENCE_AT,
        updated_at: updatedAt,
      })
      .eq('phone', phone)
      .select(selectPresenceColumns)
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    return {
      ...(updatedRow ? toPresenceSnapshot(updatedRow as PresenceTableRow) : toPresenceSnapshot(currentRow)),
      applied: Boolean(updatedRow),
    };
  }
}

async function ensureAuthorizedPhone(
  role: 'fc' | 'admin' | 'manager',
  phone: string,
) {
  if (role === 'admin') {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('phone,active')
      .eq('phone', phone)
      .maybeSingle();

    if (error) {
      return fail('db_error', error.message, 500);
    }

    if (!data?.phone) {
      return fail('not_found', '계정을 찾을 수 없습니다.', 404);
    }

    if (!data.active) {
      return fail('inactive_account', '비활성화된 계정입니다.', 403);
    }

    return null;
  }

  if (role === 'manager') {
    const { data, error } = await supabase
      .from('manager_accounts')
      .select('phone,active')
      .eq('phone', phone)
      .maybeSingle();

    if (error) {
      return fail('db_error', error.message, 500);
    }

    if (!data?.phone) {
      return fail('not_found', '계정을 찾을 수 없습니다.', 404);
    }

    if (!data.active) {
      return fail('inactive_account', '비활성화된 계정입니다.', 403);
    }

    return null;
  }

  const { data, error } = await supabase
    .from('fc_profiles')
    .select('phone,signup_completed')
    .eq('phone', phone)
    .maybeSingle();

  if (error) {
    return fail('db_error', error.message, 500);
  }

  if (!data?.phone) {
    return fail('not_found', '계정을 찾을 수 없습니다.', 404);
  }

  if (!data.signup_completed) {
    return fail('not_completed', '회원가입이 완료되지 않았습니다.', 403);
  }

  return null;
}

async function getReadablePhones(role: 'fc' | 'admin' | 'manager', currentPhone: string) {
  const allowedPhones = new Set<string>([currentPhone]);

  if (role === 'fc') {
    const [managersResult, adminsResult] = await Promise.all([
      supabase.from('manager_accounts').select('phone').eq('active', true),
      supabase.from('admin_accounts').select('phone').eq('active', true),
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
    supabase.from('fc_profiles').select('phone').eq('signup_completed', true),
    supabase.from('manager_accounts').select('phone').eq('active', true),
    supabase.from('admin_accounts').select('phone').eq('active', true),
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'Method not allowed', 405);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return fail('invalid_json', 'Invalid JSON');
  }

  const sessionToken = String(body.sessionToken ?? '').trim();
  if (!sessionToken) {
    return fail('missing_session_token', '앱 세션 토큰이 없습니다.');
  }

  const action = body.action === 'offline'
    ? 'offline'
    : body.action === 'heartbeat'
      ? 'heartbeat'
      : body.action === 'read'
        ? 'read'
        : null;

  if (!action) {
    return fail('invalid_action', '유효한 액션이 아닙니다.');
  }

  const session = await parseAppSessionToken(sessionToken);
  if (!session) {
    return fail('invalid_session_token', '앱 세션 토큰이 유효하지 않습니다.', 401);
  }

  const phone = cleanPhone(session.phone);
  if (phone.length !== 11) {
    return fail('invalid_phone', '유효한 전화번호가 아닙니다.', 401);
  }

  const authFailure = await ensureAuthorizedPhone(session.role, phone);
  if (authFailure) {
    return authFailure;
  }

  if (action === 'read') {
    const requestedPhones = normalizePhones(body.phones ?? []);
    if (requestedPhones.length === 0) {
      return json({ ok: true, data: [] });
    }

    let allowedPhones: Set<string>;
    try {
      allowedPhones = await getReadablePhones(session.role, phone);
    } catch (error) {
      return fail(
        'db_error',
        error instanceof Error ? error.message : '활동 상태 조회에 실패했습니다.',
        500,
      );
    }

    const scopedPhones = requestedPhones.filter((value) => allowedPhones.has(value));
    if (scopedPhones.length === 0) {
      return json({ ok: true, data: [] });
    }

    try {
      const rows = await getPresenceSnapshots(scopedPhones);
      return json({ ok: true, data: rows });
    } catch (error) {
      return fail(
        'db_error',
        error instanceof Error ? error.message : '활동 상태 조회에 실패했습니다.',
        500,
      );
    }
  }

  const expectedAt = typeof body.expectedAt === 'string' && body.expectedAt.trim()
    ? body.expectedAt.trim()
    : null;

  try {
    const snapshot = action === 'heartbeat'
      ? await touchPresence(phone)
      : await stalePresence(phone, expectedAt);

    if (!snapshot) {
      return fail('presence_sync_failed', '활동 상태를 동기화하지 못했습니다.', 500);
    }

    return json({
      ok: true,
      data: {
        ...snapshot,
        platform: 'garam_in',
        platform_at: snapshot.garam_in_at ?? null,
      },
    });
  } catch (error) {
    return fail(
      'db_error',
      error instanceof Error ? error.message : '활동 상태를 동기화하지 못했습니다.',
      500,
    );
  }
});
