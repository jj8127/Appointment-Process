const encoder = new TextEncoder();

export type RequestBoardBridgeRole = 'fc' | 'designer' | 'admin' | 'manager';
export type AppSessionSourceRole = 'fc' | 'admin' | 'manager';

type SignedTokenKind = 'request_board_bridge' | 'fc_onboarding_session';

type SignedTokenPayloadBase = {
  kind: SignedTokenKind;
  phone: string;
  iat: number;
  exp: number;
};

type BridgeTokenPayload = SignedTokenPayloadBase & {
  kind: 'request_board_bridge';
  role: RequestBoardBridgeRole;
};

type AppSessionTokenPayload = SignedTokenPayloadBase & {
  kind: 'fc_onboarding_session';
  role: AppSessionSourceRole;
};

export function getEnv(name: string): string | undefined {
  const g = globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (base64.length % 4)) % 4;
    const binary = atob(base64 + '='.repeat(padLength));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function signPayload(payloadPart: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadPart));
  return toBase64Url(new Uint8Array(signatureBuffer));
}

async function buildSignedToken<TPayload extends SignedTokenPayloadBase>(
  payload: TPayload,
  secret: string,
) {
  const payloadPart = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signaturePart = await signPayload(payloadPart, secret);
  return `${payloadPart}.${signaturePart}`;
}

async function verifySignedToken<TPayload extends SignedTokenPayloadBase>(
  token: string,
  secret: string,
) {
  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) return null;

  const expectedSignature = await signPayload(payloadPart, secret);
  const expectedBytes = decodeBase64Url(expectedSignature);
  const providedBytes = decodeBase64Url(signaturePart);
  if (!expectedBytes || !providedBytes) return null;
  if (expectedBytes.length !== providedBytes.length) return null;

  let mismatch = 0;
  for (let i = 0; i < expectedBytes.length; i += 1) {
    mismatch |= expectedBytes[i] ^ providedBytes[i];
  }
  if (mismatch !== 0) return null;

  const payloadBytes = decodeBase64Url(payloadPart);
  if (!payloadBytes) return null;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<TPayload>;
    if (typeof parsed.phone !== 'string' || typeof parsed.exp !== 'number') return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (parsed.exp <= nowSec) return null;
    return parsed as TPayload;
  } catch {
    return null;
  }
}

export async function createRequestBoardBridgeToken(
  phone: string,
  role: RequestBoardBridgeRole,
) {
  const secret = (getEnv('REQUEST_BOARD_AUTH_BRIDGE_SECRET') ?? '').trim();
  if (!secret) return null;

  const ttlRaw = Number((getEnv('REQUEST_BOARD_AUTH_BRIDGE_TTL_SEC') ?? '2592000').trim());
  const ttlSec = Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.floor(ttlRaw) : 2592000;
  const nowSec = Math.floor(Date.now() / 1000);

  const payload: BridgeTokenPayload = {
    kind: 'request_board_bridge',
    phone,
    role,
    iat: nowSec,
    exp: nowSec + ttlSec,
  };

  return buildSignedToken(payload, secret);
}

export async function createAppSessionToken(
  phone: string,
  role: AppSessionSourceRole,
) {
  const secret = (getEnv('REQUEST_BOARD_AUTH_BRIDGE_SECRET') ?? '').trim();
  if (!secret) return null;

  const ttlRaw = Number((getEnv('FC_APP_SESSION_TTL_SEC') ?? '2592000').trim());
  const ttlSec = Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.floor(ttlRaw) : 2592000;
  const nowSec = Math.floor(Date.now() / 1000);

  const payload: AppSessionTokenPayload = {
    kind: 'fc_onboarding_session',
    phone,
    role,
    iat: nowSec,
    exp: nowSec + ttlSec,
  };

  return buildSignedToken(payload, secret);
}

export async function parseAppSessionToken(token: string) {
  const secret = (getEnv('REQUEST_BOARD_AUTH_BRIDGE_SECRET') ?? '').trim();
  if (!secret) return null;

  const parsed = await verifySignedToken<AppSessionTokenPayload>(token, secret);
  if (!parsed || parsed.kind !== 'fc_onboarding_session') return null;
  if (parsed.role !== 'fc' && parsed.role !== 'admin' && parsed.role !== 'manager') return null;
  return parsed;
}

export function parseDesignerCompanyNameFromAffiliation(affiliation?: string | null) {
  const raw = String(affiliation ?? '').trim();
  if (!raw) return null;

  const marker = '설계매니저';
  const markerIndex = raw.lastIndexOf(marker);
  if (markerIndex < 0) return null;

  const companyName = raw
    .slice(0, markerIndex)
    .replace(/[:\-\s]+$/g, '')
    .trim();

  return companyName || null;
}
