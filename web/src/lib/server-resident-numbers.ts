import { adminSupabase } from '@/lib/admin-supabase';
import { logger } from '@/lib/logger';

type ResidentNumberMap = Record<string, string | null>;
type DirectDecryptMode = 'auto' | 'disabled' | 'report-only';
type DirectFallbackReason =
  | 'missing_identity_key'
  | 'mode_disabled'
  | 'report_only'
  | 'direct_failed';

type DirectReadOutcome =
  | {
      source: 'direct';
      health: 'healthy';
      directMode: DirectDecryptMode;
      identityKeyConfigured: true;
      residentNumbers: ResidentNumberMap;
    }
  | {
      source: 'edge-function';
      health: 'degraded';
      directMode: DirectDecryptMode;
      identityKeyConfigured: boolean;
      residentNumbers: null;
      reason: DirectFallbackReason;
      error?: unknown;
    };

const loggedResidentNumberRuntimeStates = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function logResidentNumberRuntimeOnce(
  level: 'warn' | 'error',
  message: string,
  details: Record<string, unknown>,
): void {
  const key = `${level}:${message}`;
  if (loggedResidentNumberRuntimeStates.has(key)) {
    return;
  }

  loggedResidentNumberRuntimeStates.add(key);

  if (level === 'warn') {
    logger.warn(message, details);
    return;
  }

  logger.error(message, details);
}

function toErrorDetails(error: unknown): Record<string, string | undefined> | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

// `auto` preserves the current behavior. The optional mode env makes direct decrypt
// explicit for Vercel runtimes that want report-only or edge-only behavior.
function resolveDirectDecryptMode(logPrefix: string): DirectDecryptMode {
  const rawMode = process.env.FC_IDENTITY_DIRECT_DECRYPT_MODE;
  const normalizedMode = String(rawMode ?? '').trim().toLowerCase();

  if (!normalizedMode || normalizedMode === 'auto' || normalizedMode === 'enabled') {
    return 'auto';
  }

  if (normalizedMode === 'disabled' || normalizedMode === 'off') {
    return 'disabled';
  }

  if (normalizedMode === 'report' || normalizedMode === 'report-only') {
    return 'report-only';
  }

  logResidentNumberRuntimeOnce(
    'warn',
    `${logPrefix} invalid FC_IDENTITY_DIRECT_DECRYPT_MODE; defaulting to auto`,
    {
      configuredValue: rawMode ?? null,
      allowedValues: ['auto', 'disabled', 'report-only'],
    },
  );
  return 'auto';
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

async function inspectDirectResidentNumberRead(
  fcIds: string[],
  logPrefix: string,
): Promise<DirectReadOutcome> {
  const directMode = resolveDirectDecryptMode(logPrefix);
  const identityKey = String(process.env.FC_IDENTITY_KEY ?? '').trim();

  if (directMode === 'disabled') {
    return {
      source: 'edge-function',
      health: 'degraded',
      directMode,
      identityKeyConfigured: Boolean(identityKey),
      residentNumbers: null,
      reason: 'mode_disabled',
    };
  }

  if (directMode === 'report-only') {
    return {
      source: 'edge-function',
      health: 'degraded',
      directMode,
      identityKeyConfigured: Boolean(identityKey),
      residentNumbers: null,
      reason: 'report_only',
    };
  }

  if (!identityKey) {
    return {
      source: 'edge-function',
      health: 'degraded',
      directMode,
      identityKeyConfigured: false,
      residentNumbers: null,
      reason: 'missing_identity_key',
    };
  }

  try {
    const key = await importAesKeyForDecrypt(identityKey);
    const residentNumbers: ResidentNumberMap = Object.fromEntries(fcIds.map((fcId) => [fcId, null]));
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

    return {
      source: 'direct',
      health: 'healthy',
      directMode,
      identityKeyConfigured: true,
      residentNumbers,
    };
  } catch (error: unknown) {
    return {
      source: 'edge-function',
      health: 'degraded',
      directMode,
      identityKeyConfigured: true,
      residentNumbers: null,
      reason: 'direct_failed',
      error,
    };
  }
}

function getDirectFallbackDescription(reason: DirectFallbackReason): string {
  switch (reason) {
    case 'missing_identity_key':
      return 'FC_IDENTITY_KEY is not configured';
    case 'mode_disabled':
      return 'direct decrypt is disabled by FC_IDENTITY_DIRECT_DECRYPT_MODE';
    case 'report_only':
      return 'FC_IDENTITY_DIRECT_DECRYPT_MODE is report-only';
    case 'direct_failed':
      return 'direct decrypt failed at runtime';
  }
}

function getDirectFallbackWarningMessage(logPrefix: string, reason: Exclude<DirectFallbackReason, 'direct_failed'>): string {
  switch (reason) {
    case 'missing_identity_key':
      return `${logPrefix} FC_IDENTITY_KEY is not configured; using edge function fallback`;
    case 'mode_disabled':
      return `${logPrefix} direct resident-number decrypt is disabled by FC_IDENTITY_DIRECT_DECRYPT_MODE; using edge function fallback`;
    case 'report_only':
      return `${logPrefix} direct resident-number decrypt is in report-only mode; using edge function fallback`;
  }
}

function buildRuntimeDetails(
  fcIds: string[],
  directRead: Extract<DirectReadOutcome, { source: 'edge-function' }>,
): Record<string, unknown> {
  return {
    health: directRead.health,
    directMode: directRead.directMode,
    fallbackSource: directRead.source,
    fallbackReason: directRead.reason,
    identityKeyConfigured: directRead.identityKeyConfigured,
    fcIdCount: fcIds.length,
    ...(directRead.error ? { error: toErrorDetails(directRead.error) ?? directRead.error } : {}),
  };
}

export async function readResidentNumbersDirect(fcIds: string[]): Promise<ResidentNumberMap | null> {
  const directRead = await inspectDirectResidentNumberRead(fcIds, '[server-resident-numbers]');
  return directRead.source === 'direct' ? directRead.residentNumbers : null;
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
}: ReadResidentNumbersWithFallbackOptions): Promise<ResidentNumberMap> {
  if (fcIds.length === 0) {
    return {};
  }

  const directRead = await inspectDirectResidentNumberRead(fcIds, logPrefix);
  if (directRead.source === 'direct') {
    return directRead.residentNumbers;
  }

  const runtimeDetails = buildRuntimeDetails(fcIds, directRead);
  if (directRead.reason === 'direct_failed') {
    logger.error(`${logPrefix} direct resident-number decrypt failed; using edge function fallback`, runtimeDetails);
  } else {
    logResidentNumberRuntimeOnce(
      'warn',
      getDirectFallbackWarningMessage(logPrefix, directRead.reason),
      runtimeDetails,
    );
  }

  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!supabaseUrl || !serviceKey) {
    const missingEnv = [
      !supabaseUrl ? 'NEXT_PUBLIC_SUPABASE_URL' : null,
      !serviceKey ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    ].filter(Boolean);
    const message = `Resident-number runtime misconfigured: ${getDirectFallbackDescription(directRead.reason)} and edge fallback is unavailable (${missingEnv.join(', ')})`;
    logger.error(`${logPrefix} edge fallback unavailable`, {
      ...runtimeDetails,
      missingEnv,
    });
    throw new Error(message);
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
    logger.error(`${logPrefix} resident-number edge function failed`, {
      ...runtimeDetails,
      status: resp.status,
      body: data,
    });

    let msg = 'Edge Function failed';
    if (isRecord(data)) {
      if (typeof data.message === 'string') msg = data.message;
      else if (typeof data.error === 'string') msg = data.error;
    }

    throw new Error(`Resident-number edge fallback failed after ${getDirectFallbackDescription(directRead.reason)}: ${msg}`);
  }

  return (data as Record<string, unknown>).residentNumbers as Record<string, string | null>;
}
