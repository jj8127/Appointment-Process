import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import {
  isExactStalePresenceReceipt,
  isExactTouchPresenceReceipt,
  isPresenceMutationSnapshot,
  isPresencePhoneRow,
  isPresenceSnapshot,
  isPresenceTableRow,
  mergePresenceSnapshots,
  normalizePresencePhone,
  presenceRowsHaveUniquePhones,
  presenceRowsMatchRequestedPhones,
  samePresenceTimestamp,
  type PresenceSnapshot,
  type PresenceTableRow,
} from '../_shared/presence-query-contract.ts';
import { parseQueryRows } from '../_shared/query-result-contract.ts';
import { getEnv, parseAppSessionTokenDetailed } from '../_shared/request-board-auth.ts';

type PresenceAction = 'heartbeat' | 'offline' | 'read';

type RequestBody = {
  sessionToken: string;
  action: PresenceAction;
  expectedAt: string | null;
  phones: Array<string | null>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function parseRequestBody(value: unknown): RequestBody | null {
  if (!isRecord(value) || typeof value.sessionToken !== 'string') return null;
  const sessionToken = value.sessionToken.trim();
  const action = value.action === 'heartbeat'
    ? 'heartbeat'
    : value.action === 'offline'
      ? 'offline'
      : value.action === 'read'
        ? 'read'
        : null;
  if (!sessionToken || !action) return null;

  const phones = value.phones === undefined ? [] : value.phones;
  if (!Array.isArray(phones)
    || phones.some((phone) => phone !== null && typeof phone !== 'string')) {
    return null;
  }

  let expectedAt: string | null = null;
  if (value.expectedAt !== undefined && value.expectedAt !== null) {
    if (!isTimestamp(value.expectedAt)) return null;
    expectedAt = value.expectedAt;
  }

  return { sessionToken, action, expectedAt, phones };
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

async function getPresenceTableRow(phone: string) {
  const { data, error } = await supabase
    .from('user_presence')
    .select(selectPresenceColumns)
    .eq('phone', phone)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data === null) return null;
  if (!isPresenceTableRow(data) || normalizePresencePhone(data.phone) !== phone) {
    throw new Error('invalid presence row');
  }
  return data;
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
    const rows = parseQueryRows(data, isPresenceSnapshot);
    if (!rows || !presenceRowsMatchRequestedPhones(rows, normalizedPhones, true)) {
      throw new Error('invalid presence RPC result');
    }
    return mergePresenceSnapshots(normalizedPhones, rows);
  } catch {
    reportEdgeDiagnostic({
      event: 'user_presence.rpc_fallback',
      reason: 'get_failed',
      retryable: true,
      errorClass: 'database',
    });

    const { data, error: tableError } = await supabase
      .from('user_presence')
      .select(selectPresenceColumns)
      .in('phone', normalizedPhones);

    if (tableError) {
      throw tableError;
    }

    const rows = parseQueryRows(data, isPresenceTableRow);
    if (!rows || !presenceRowsMatchRequestedPhones(rows, normalizedPhones, false)) {
      throw new Error('invalid presence table result');
    }

    return mergePresenceSnapshots(
      normalizedPhones,
      rows.map(toPresenceSnapshot),
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

    const rows = parseQueryRows(data, isPresenceSnapshot);
    if (!rows || rows.length !== 1 || !isExactTouchPresenceReceipt(rows[0], phone)) {
      throw new Error('invalid touch presence receipt');
    }
    return rows[0];
  } catch {
    reportEdgeDiagnostic({
      event: 'user_presence.rpc_fallback',
      reason: 'touch_failed',
      retryable: true,
      errorClass: 'database',
    });

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
      if (!isPresenceTableRow(updatedRow) || normalizePresencePhone(updatedRow.phone) !== phone) {
        throw new Error('invalid touch presence update receipt');
      }
      const snapshot = toPresenceSnapshot(updatedRow);
      if (!samePresenceTimestamp(updatedRow.garam_in_at, touchedAt)
        || !samePresenceTimestamp(updatedRow.updated_at, touchedAt)
        || !isExactTouchPresenceReceipt(snapshot, phone)) {
        throw new Error('invalid touch presence update receipt');
      }
      return snapshot;
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

    if (!isPresenceTableRow(insertedRow) || normalizePresencePhone(insertedRow.phone) !== phone) {
      throw new Error('invalid touch presence insert receipt');
    }
    const snapshot = toPresenceSnapshot(insertedRow);
    if (!samePresenceTimestamp(insertedRow.garam_in_at, touchedAt)
      || !samePresenceTimestamp(insertedRow.updated_at, touchedAt)
      || !isExactTouchPresenceReceipt(snapshot, phone)) {
      throw new Error('invalid touch presence insert receipt');
    }
    return snapshot;
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

    const rows = parseQueryRows(data, isPresenceMutationSnapshot);
    if (!rows
      || rows.length > 1
      || (rows[0] && !isExactStalePresenceReceipt(
        rows[0],
        phone,
        expectedAt,
        STALE_PRESENCE_AT,
      ))) {
      throw new Error('invalid stale presence receipt');
    }
    return rows[0] ?? null;
  } catch {
    reportEdgeDiagnostic({
      event: 'user_presence.rpc_fallback',
      reason: 'stale_failed',
      retryable: true,
      errorClass: 'database',
    });

    const currentRow = await getPresenceTableRow(phone);
    if (!currentRow) {
      return null;
    }

    if (expectedAt && !samePresenceTimestamp(currentRow.garam_in_at, expectedAt)) {
      const receipt = {
        ...toPresenceSnapshot(currentRow),
        applied: false,
      };
      if (!isExactStalePresenceReceipt(receipt, phone, expectedAt, STALE_PRESENCE_AT)) {
        throw new Error('invalid stale presence current receipt');
      }
      return receipt;
    }

    const updatedAt = new Date().toISOString();
    let updateQuery = supabase
      .from('user_presence')
      .update({
        garam_in_at: STALE_PRESENCE_AT,
        updated_at: updatedAt,
      })
      .eq('phone', phone);
    if (expectedAt !== null) {
      updateQuery = updateQuery.eq('garam_in_at', expectedAt);
    }
    const { data: updatedRow, error: updateError } = await updateQuery
      .select(selectPresenceColumns)
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    if (updatedRow) {
      if (!isPresenceTableRow(updatedRow) || normalizePresencePhone(updatedRow.phone) !== phone) {
        throw new Error('invalid stale presence update receipt');
      }
      const receipt = { ...toPresenceSnapshot(updatedRow), applied: true };
      if (!samePresenceTimestamp(updatedRow.updated_at, updatedAt)
        || !isExactStalePresenceReceipt(receipt, phone, expectedAt, STALE_PRESENCE_AT)) {
        throw new Error('invalid stale presence update receipt');
      }
      return receipt;
    }

    const latestRow = await getPresenceTableRow(phone);
    if (!latestRow) return null;
    const receipt = { ...toPresenceSnapshot(latestRow), applied: false };
    if (!isExactStalePresenceReceipt(receipt, phone, expectedAt, STALE_PRESENCE_AT)) {
      throw new Error('invalid stale presence unchanged receipt');
    }
    return receipt;
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
      return fail('db_error', '계정 확인에 실패했습니다.', 500);
    }

    if (data === null) {
      return fail('not_found', '계정을 찾을 수 없습니다.', 404);
    }
    if (!isRecord(data)
      || typeof data.phone !== 'string'
      || data.phone !== phone
      || typeof data.active !== 'boolean') {
      return fail('db_error', '계정 확인에 실패했습니다.', 500);
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
      return fail('db_error', '계정 확인에 실패했습니다.', 500);
    }

    if (data === null) {
      return fail('not_found', '계정을 찾을 수 없습니다.', 404);
    }
    if (!isRecord(data)
      || typeof data.phone !== 'string'
      || data.phone !== phone
      || typeof data.active !== 'boolean') {
      return fail('db_error', '계정 확인에 실패했습니다.', 500);
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
    return fail('db_error', '계정 확인에 실패했습니다.', 500);
  }

  if (data === null) {
    return fail('not_found', '계정을 찾을 수 없습니다.', 404);
  }
  if (!isRecord(data)
    || typeof data.phone !== 'string'
    || data.phone !== phone
    || typeof data.signup_completed !== 'boolean') {
    return fail('db_error', '계정 확인에 실패했습니다.', 500);
  }

  if (!data.signup_completed) {
    return fail('not_completed', '회원가입이 완료되지 않았습니다.', 403);
  }

  return null;
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
      supabase.from('manager_accounts').select('phone').eq('active', true).in('phone', scopedPhones),
      supabase.from('admin_accounts').select('phone').eq('active', true).in('phone', scopedPhones),
    ]);

    if (managersResult.error) {
      throw managersResult.error;
    }
    if (adminsResult.error) {
      throw adminsResult.error;
    }

    const managerRows = parseQueryRows(managersResult.data, isPresencePhoneRow);
    const adminRows = parseQueryRows(adminsResult.data, isPresencePhoneRow);
    if (!managerRows
      || !adminRows
      || !presenceRowsHaveUniquePhones(managerRows)
      || !presenceRowsHaveUniquePhones(adminRows)) {
      throw new Error('invalid readable staff phone result');
    }

    managerRows.forEach((row) => {
      const phone = normalizePresencePhone(row.phone);
      if (phone.length === 11) {
        allowedPhones.add(phone);
      }
    });
    adminRows.forEach((row) => {
      const phone = normalizePresencePhone(row.phone);
      if (phone.length === 11) {
        allowedPhones.add(phone);
      }
    });

    return allowedPhones;
  }

  const [fcResult, managersResult, adminsResult] = await Promise.all([
    supabase.from('fc_profiles').select('phone').eq('signup_completed', true).in('phone', scopedPhones),
    supabase.from('manager_accounts').select('phone').eq('active', true).in('phone', scopedPhones),
    supabase.from('admin_accounts').select('phone').eq('active', true).in('phone', scopedPhones),
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

  const fcRows = parseQueryRows(fcResult.data, isPresencePhoneRow);
  const managerRows = parseQueryRows(managersResult.data, isPresencePhoneRow);
  const adminRows = parseQueryRows(adminsResult.data, isPresencePhoneRow);
  if (!fcRows
    || !managerRows
    || !adminRows
    || !presenceRowsHaveUniquePhones(fcRows)
    || !presenceRowsHaveUniquePhones(managerRows)
    || !presenceRowsHaveUniquePhones(adminRows)) {
    throw new Error('invalid readable account phone result');
  }

  [fcRows, managerRows, adminRows].forEach((rows) => {
    rows.forEach((row) => {
      const phone = normalizePresencePhone(row.phone);
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

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail('invalid_json', 'Invalid JSON');
  }
  if (!isRecord(rawBody)
    || typeof rawBody.sessionToken !== 'string'
    || !rawBody.sessionToken.trim()) {
    return fail('missing_session_token', '앱 세션 토큰이 없습니다.');
  }
  if (rawBody.action !== 'heartbeat'
    && rawBody.action !== 'offline'
    && rawBody.action !== 'read') {
    return fail('invalid_action', '유효한 액션이 아닙니다.');
  }
  const body = parseRequestBody(rawBody);
  if (!body) return fail('invalid_request', '요청 형식이 올바르지 않습니다.');
  const { action, sessionToken } = body;

  const parsed = await parseAppSessionTokenDetailed(sessionToken);
  if (parsed.ok === false) return fail(parsed.code, parsed.message, parsed.status ?? 401);
  const session = parsed.payload;

  const phone = normalizePresencePhone(session.phone);
  if (phone.length !== 11) {
    return fail('invalid_phone', '유효한 전화번호가 아닙니다.', 401);
  }

  const authFailure = await ensureAuthorizedPhone(session.role, phone);
  if (authFailure) {
    return authFailure;
  }

  if (action === 'read') {
    const requestedPhones = normalizePhones(body.phones);
    if (requestedPhones.length === 0) {
      return json({ ok: true, data: [] });
    }

    let allowedPhones: Set<string>;
    try {
      allowedPhones = await getReadablePhones(session.role, phone, requestedPhones);
    } catch {
      return fail('db_error', '활동 상태 조회에 실패했습니다.', 500);
    }

    const scopedPhones = requestedPhones.filter((value) => allowedPhones.has(value));
    if (scopedPhones.length === 0) {
      return json({ ok: true, data: [] });
    }

    try {
      const rows = await getPresenceSnapshots(scopedPhones);
      return json({ ok: true, data: rows });
    } catch {
      return fail('db_error', '활동 상태 조회에 실패했습니다.', 500);
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
  } catch {
    return fail('db_error', '활동 상태를 동기화하지 못했습니다.', 500);
  }
});
