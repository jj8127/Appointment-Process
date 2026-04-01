import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS, validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';

type DeleteBody = {
  registrationId?: string;
};

type UpdateBody = {
  registrationId?: string;
  isConfirmed?: boolean;
};

type ExamRegistrationRow = {
  id: string;
  status: string;
  created_at: string;
  resident_id: string;
  is_confirmed: boolean;
  is_third_exam?: boolean | null;
  fee_paid_date?: string | null;
  exam_locations?: { location_name?: string | null } | null;
  exam_rounds?: { round_label?: string | null; exam_date?: string | null; exam_type?: string | null } | null;
};

type ProfileRow = {
  id: string;
  phone: string;
  name: string | null;
  affiliation: string | null;
  address: string | null;
};

function fromBase64(input: string): Uint8Array {
  return Uint8Array.from(Buffer.from(input, 'base64'));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function importAesKeyForDecrypt(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key);
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, false, ['decrypt']);
}

async function decryptResidentNumber(value: string, key: CryptoKey): Promise<string | null> {
  const parts = value.split('.');
  if (parts.length !== 2) return null;

  try {
    const iv = fromBase64(parts[0]);
    const cipher = fromBase64(parts[1]);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(cipher),
    );
    const digits = Buffer.from(plain).toString('utf8').replace(/[^0-9]/g, '');
    return digits.length === 13 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : null;
  } catch {
    return null;
  }
}

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

  if (session.role !== 'admin') {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  return { ok: true as const, session };
}

async function getReadSession() {
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

async function verifyStaffSession(role: 'admin' | 'manager', residentId: string) {
  const staffPhoneCandidates = buildPhoneCandidates(residentId);
  const accountTable = role === 'manager' ? 'manager_accounts' : 'admin_accounts';
  const { data, error } = await adminSupabase
    .from(accountTable)
    .select('id,active')
    .in('phone', staffPhoneCandidates)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    logger.error('[api/admin/exam-applicants] session verification failed', error);
    return false;
  }

  return Boolean(data?.id);
}

async function readResidentNumbers(fcIds: string[]): Promise<Record<string, string | null>> {
  if (fcIds.length === 0) {
    return {};
  }

  const identityKey = process.env.FC_IDENTITY_KEY;
  if (!identityKey) {
    return Object.fromEntries(fcIds.map((fcId) => [fcId, null]));
  }

  const key = await importAesKeyForDecrypt(identityKey);
  const residentNumbers: Record<string, string | null> = Object.fromEntries(fcIds.map((fcId) => [fcId, null]));
  const chunkSize = 100;

  for (let i = 0; i < fcIds.length; i += chunkSize) {
    const chunk = fcIds.slice(i, i + chunkSize);
    const { data: rows, error } = await adminSupabase
      .from('fc_identity_secure')
      .select('fc_id,resident_number_encrypted')
      .in('fc_id', chunk);

    if (error) {
      throw error;
    }

    for (const row of rows ?? []) {
      const fcId = String(row.fc_id ?? '').trim();
      const encrypted = typeof row.resident_number_encrypted === 'string'
        ? row.resident_number_encrypted
        : '';
      if (!fcId || !encrypted) continue;
      residentNumbers[fcId] = await decryptResidentNumber(encrypted, key);
    }
  }

  return residentNumbers;
}

async function listApplicants() {
  const { data, error } = await adminSupabase
    .from('exam_registrations')
    .select(`
      id, status, created_at, resident_id, is_confirmed, is_third_exam, fee_paid_date,
      exam_locations!exam_registrations_location_round_fkey ( location_name ),
      exam_rounds ( round_label, exam_date, exam_type )
    `)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as ExamRegistrationRow[];
  const base = rows.map((row) => ({
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    resident_id: row.resident_id,
    is_confirmed: row.is_confirmed,
    is_third_exam: row.is_third_exam ?? false,
    location_name: row.exam_locations?.location_name || '미정',
    round_label: row.exam_rounds?.round_label || '-',
    exam_date: row.exam_rounds?.exam_date ?? null,
    exam_type: row.exam_rounds?.exam_type ?? null,
    fee_paid_date: row.fee_paid_date ?? null,
  }));

  const phones = Array.from(new Set(base.map((item) => item.resident_id).filter(Boolean)));
  if (phones.length === 0) {
    return [];
  }

  const { data: profiles, error: profileError } = await adminSupabase
    .from('fc_profiles')
    .select('id,phone,name,affiliation,address')
    .eq('signup_completed', true)
    .in('phone', phones);

  if (profileError) {
    throw profileError;
  }

  const profileRows = (profiles ?? []) as ProfileRow[];
  const profileMap = new Map(profileRows.map((profile) => [profile.phone, profile]));
  const fcIds = Array.from(new Set(profileRows.map((profile) => profile.id).filter(Boolean)));
  const residentNumbersByFcId = await readResidentNumbers(fcIds);

  return base.map((item) => {
    const profile = profileMap.get(item.resident_id);
    const fullResidentNumber = profile?.id ? residentNumbersByFcId[profile.id] : null;
    return {
      ...item,
      name: profile?.name ?? '이름없음',
      phone: profile?.phone ?? item.resident_id,
      affiliation: profile?.affiliation ?? '-',
      address: profile?.address ?? '-',
      resident_id: fullResidentNumber ?? '주민번호 조회 실패',
    };
  });
}

export async function GET() {
  const readCheck = await getReadSession();
  if (!readCheck.ok) {
    return NextResponse.json(
      { error: readCheck.error },
      { status: readCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const rateLimit = checkRateLimit(`exam-applicant-list:${readCheck.session.residentId}`, 30, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  try {
    const isAuthorized = await verifyStaffSession(
      readCheck.session.role as 'admin' | 'manager',
      readCheck.session.residentId,
    );
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: SECURITY_HEADERS });
    }

    const applicants = await listApplicants();
    return NextResponse.json({ ok: true, applicants }, { headers: SECURITY_HEADERS });
  } catch (err: unknown) {
    logger.error('[api/admin/exam-applicants] list failed', err);
    return NextResponse.json(
      { error: '시험 신청 목록을 불러오지 못했습니다.' },
      { status: 500, headers: SECURITY_HEADERS },
    );
  }
}

export async function PATCH(req: Request) {
  const adminCheck = await getAdminSession();
  if (!adminCheck.ok) {
    return NextResponse.json(
      { error: adminCheck.error },
      { status: adminCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const rateLimit = checkRateLimit(`exam-applicant-update:${adminCheck.session.residentId}`, 30, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch (err) {
    logger.error('[api/admin/exam-applicants] invalid json', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }

  const registrationId = String(body.registrationId ?? '').trim();
  if (!registrationId || typeof body.isConfirmed !== 'boolean') {
    return NextResponse.json(
      { error: 'registrationId and isConfirmed are required' },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  try {
    const isAuthorized = await verifyStaffSession('admin', adminCheck.session.residentId);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: SECURITY_HEADERS });
    }

    const nextStatus = body.isConfirmed ? 'confirmed' : 'applied';
    const { error } = await adminSupabase
      .from('exam_registrations')
      .update({ is_confirmed: body.isConfirmed, status: nextStatus })
      .eq('id', registrationId);

    if (error) {
      throw error;
    }

    return NextResponse.json(
      { ok: true, registrationId, isConfirmed: body.isConfirmed, status: nextStatus },
      { headers: SECURITY_HEADERS },
    );
  } catch (err: unknown) {
    logger.error('[api/admin/exam-applicants] update failed', err);
    return NextResponse.json(
      { error: '시험 신청 상태 변경에 실패했습니다.' },
      { status: 500, headers: SECURITY_HEADERS },
    );
  }
}

export async function DELETE(req: Request) {
  const adminCheck = await getAdminSession();
  if (!adminCheck.ok) {
    return NextResponse.json(
      { error: adminCheck.error },
      { status: adminCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const rateLimit = checkRateLimit(`exam-applicant-delete:${adminCheck.session.residentId}`, 20, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch (err) {
    logger.error('[api/admin/exam-applicants] invalid json', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }

  const adminPhone = String(adminCheck.session.residentId ?? '').replace(/[^0-9]/g, '');
  const registrationId = String(body.registrationId ?? '').trim();

  if (!registrationId) {
    return NextResponse.json({ error: 'registrationId is required' }, { status: 400, headers: SECURITY_HEADERS });
  }

  try {
    const isAuthorized = await verifyStaffSession('admin', adminPhone);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: SECURITY_HEADERS });
    }

    const { error, count } = await adminSupabase
      .from('exam_registrations')
      .delete({ count: 'exact' })
      .eq('id', registrationId);

    if (error) {
      throw error;
    }

    return NextResponse.json(
      { ok: true, deleted: Boolean(count && count > 0) },
      { headers: SECURITY_HEADERS },
    );
  } catch (err: unknown) {
    logger.error('[api/admin/exam-applicants] delete failed', err);
    return NextResponse.json({ error: '시험 신청 삭제에 실패했습니다.' }, { status: 500, headers: SECURITY_HEADERS });
  }
}
