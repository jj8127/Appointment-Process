import { adminSupabase } from '@/lib/admin-supabase';
import { logger } from '@/lib/logger';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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

export async function readResidentNumbersDirect(fcIds: string[]): Promise<Record<string, string | null> | null> {
  const identityKey = process.env.FC_IDENTITY_KEY;
  if (!identityKey) {
    return null;
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

type ReadResidentNumbersWithFallbackOptions = {
  fcIds: string[];
  staffPhone: string;
  logPrefix?: string;
};

export async function readResidentNumbersWithFallback({
  fcIds,
  staffPhone,
  logPrefix = '[server-resident-numbers]',
}: ReadResidentNumbersWithFallbackOptions): Promise<Record<string, string | null>> {
  if (fcIds.length === 0) {
    return {};
  }

  try {
    const residentNumbers = await readResidentNumbersDirect(fcIds);
    if (residentNumbers) {
      return residentNumbers;
    }
  } catch (err: unknown) {
    logger.error(`${logPrefix} direct decrypt failed; falling back to edge function`, err);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing server Supabase credentials');
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
    logger.error(`${logPrefix} edge function failed`, {
      status: resp.status,
      body: data,
    });

    let msg = 'Edge Function failed';
    if (isRecord(data)) {
      if (typeof data.message === 'string') msg = data.message;
      else if (typeof data.error === 'string') msg = data.error;
    }

    throw new Error(msg);
  }

  return (data as Record<string, unknown>).residentNumbers as Record<string, string | null>;
}
