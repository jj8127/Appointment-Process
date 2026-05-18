const encoder = new TextEncoder();

export type RequestBoardBridgeRole = 'fc' | 'designer' | 'admin' | 'manager';
export type AppSessionSourceRole = 'fc' | 'admin' | 'manager';
export type AppSessionStaffType = 'admin' | 'developer';

type SignedTokenKind = 'request_board_bridge' | 'fc_onboarding_session';

type SignedTokenPayloadBase = {
  kind: SignedTokenKind;
  phone: string;
  iat: number;
  exp: number;
};

export type BridgeTokenPayload = SignedTokenPayloadBase & {
  kind: 'request_board_bridge';
  role: RequestBoardBridgeRole;
  affiliation?: string | null;
};

export type AppSessionTokenPayload = SignedTokenPayloadBase & {
  kind: 'fc_onboarding_session';
  role: AppSessionSourceRole;
  staffType?: AppSessionStaffType;
  fcId?: string;
};

type SignedTokenVerificationResult<TPayload extends SignedTokenPayloadBase> =
  | { ok: true; payload: TPayload }
  | { ok: false; reason: 'invalid_token' | 'expired_token' };

type AppSessionTokenParseResult =
  | { ok: true; payload: AppSessionTokenPayload }
  | {
    ok: false;
    code: 'invalid_app_session' | 'expired_app_session';
    message: string;
  };

type BridgeTokenParseResult =
  | { ok: true; payload: BridgeTokenPayload }
  | {
    ok: false;
    code: 'invalid_bridge_token' | 'expired_bridge_token';
    message: string;
  };

type RequiredAppSessionResult =
  | { ok: true; session: AppSessionTokenPayload }
  | {
    ok: false;
    code: 'missing_app_session' | 'invalid_app_session' | 'expired_app_session';
    message: string;
    status: number;
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
) : Promise<SignedTokenVerificationResult<TPayload>> {
  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) {
    return { ok: false, reason: 'invalid_token' };
  }

  const expectedSignature = await signPayload(payloadPart, secret);
  const expectedBytes = decodeBase64Url(expectedSignature);
  const providedBytes = decodeBase64Url(signaturePart);
  if (!expectedBytes || !providedBytes) {
    return { ok: false, reason: 'invalid_token' };
  }
  if (expectedBytes.length !== providedBytes.length) {
    return { ok: false, reason: 'invalid_token' };
  }

  let mismatch = 0;
  for (let i = 0; i < expectedBytes.length; i += 1) {
    mismatch |= expectedBytes[i] ^ providedBytes[i];
  }
  if (mismatch !== 0) {
    return { ok: false, reason: 'invalid_token' };
  }

  const payloadBytes = decodeBase64Url(payloadPart);
  if (!payloadBytes) {
    return { ok: false, reason: 'invalid_token' };
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<TPayload>;
    if (typeof parsed.phone !== 'string' || typeof parsed.exp !== 'number') {
      return { ok: false, reason: 'invalid_token' };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (parsed.exp <= nowSec) {
      return { ok: false, reason: 'expired_token' };
    }
    return { ok: true, payload: parsed as TPayload };
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }
}

export async function createRequestBoardBridgeToken(
  phone: string,
  role: RequestBoardBridgeRole,
  affiliation?: string | null,
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
    ...((role === 'fc' || role === 'manager') && String(affiliation ?? '').trim()
      ? { affiliation: String(affiliation ?? '').trim() }
      : {}),
    iat: nowSec,
    exp: nowSec + ttlSec,
  };

  return buildSignedToken(payload, secret);
}

export async function createAppSessionToken(
  phone: string,
  role: AppSessionSourceRole,
  staffType?: AppSessionStaffType,
  fcId?: string | null,
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
    ...(role === 'admin' && staffType ? { staffType } : {}),
    ...(role === 'fc' && String(fcId ?? '').trim() ? { fcId: String(fcId ?? '').trim() } : {}),
    iat: nowSec,
    exp: nowSec + ttlSec,
  };

  return buildSignedToken(payload, secret);
}

export async function parseAppSessionTokenDetailed(
  token: string,
): Promise<AppSessionTokenParseResult> {
  const secret = (getEnv('REQUEST_BOARD_AUTH_BRIDGE_SECRET') ?? '').trim();
  if (!secret) {
    return {
      ok: false,
      code: 'invalid_app_session',
      message: '세션이 유효하지 않습니다. 다시 로그인해주세요.',
    };
  }

  const parsed = await verifySignedToken<AppSessionTokenPayload>(token, secret);
  if (!parsed.ok) {
    return parsed.reason === 'expired_token'
      ? {
        ok: false,
        code: 'expired_app_session',
        message: '세션이 만료되었습니다. 다시 로그인해주세요.',
      }
      : {
        ok: false,
        code: 'invalid_app_session',
        message: '세션이 유효하지 않습니다. 다시 로그인해주세요.',
      };
  }

  const payload = parsed.payload;
  if (payload.kind !== 'fc_onboarding_session') {
    return {
      ok: false,
      code: 'invalid_app_session',
      message: '세션이 유효하지 않습니다. 다시 로그인해주세요.',
    };
  }
  if (payload.role !== 'fc' && payload.role !== 'admin' && payload.role !== 'manager') {
    return {
      ok: false,
      code: 'invalid_app_session',
      message: '세션이 유효하지 않습니다. 다시 로그인해주세요.',
    };
  }
  if (
    payload.staffType !== undefined
    && payload.staffType !== 'admin'
    && payload.staffType !== 'developer'
  ) {
    return {
      ok: false,
      code: 'invalid_app_session',
      message: '세션이 유효하지 않습니다. 다시 로그인해주세요.',
    };
  }
  if (payload.fcId !== undefined && typeof payload.fcId !== 'string') {
    return {
      ok: false,
      code: 'invalid_app_session',
      message: '세션이 유효하지 않습니다. 다시 로그인해주세요.',
    };
  }
  return { ok: true, payload };
}

export async function parseAppSessionToken(token: string) {
  const result = await parseAppSessionTokenDetailed(token);
  return result.ok ? result.payload : null;
}

export async function parseRequestBoardBridgeTokenDetailed(
  token: string,
): Promise<BridgeTokenParseResult> {
  const secret = (getEnv('REQUEST_BOARD_AUTH_BRIDGE_SECRET') ?? '').trim();
  if (!secret) {
    return {
      ok: false,
      code: 'invalid_bridge_token',
      message: '브릿지 세션이 유효하지 않습니다. 다시 로그인해주세요.',
    };
  }

  const parsed = await verifySignedToken<BridgeTokenPayload>(token, secret);
  if (!parsed.ok) {
    return parsed.reason === 'expired_token'
      ? {
        ok: false,
        code: 'expired_bridge_token',
        message: '세션이 만료되었습니다. 다시 로그인해주세요.',
      }
      : {
        ok: false,
        code: 'invalid_bridge_token',
        message: '브릿지 세션이 유효하지 않습니다. 다시 로그인해주세요.',
      };
  }

  const payload = parsed.payload;
  if (payload.kind !== 'request_board_bridge') {
    return {
      ok: false,
      code: 'invalid_bridge_token',
      message: '브릿지 세션이 유효하지 않습니다. 다시 로그인해주세요.',
    };
  }
  if (
    payload.role !== 'fc'
    && payload.role !== 'designer'
    && payload.role !== 'admin'
    && payload.role !== 'manager'
  ) {
    return {
      ok: false,
      code: 'invalid_bridge_token',
      message: '브릿지 세션이 유효하지 않습니다. 다시 로그인해주세요.',
    };
  }

  return { ok: true, payload };
}

export async function parseRequestBoardBridgeToken(token: string) {
  const result = await parseRequestBoardBridgeTokenDetailed(token);
  return result.ok ? result.payload : null;
}

export function getAppSessionTokenFromRequest(req: Request) {
  const headerToken = req.headers.get('x-app-session-token')?.trim();
  if (headerToken) {
    return headerToken;
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) {
    return null;
  }

  const bearerToken = bearerMatch[1]?.trim();
  return bearerToken || null;
}

export async function requireAppSessionFromRequest(
  req: Request,
): Promise<RequiredAppSessionResult> {
  const token = getAppSessionTokenFromRequest(req);
  if (!token) {
    return {
      ok: false,
      code: 'missing_app_session',
      message: '추천인 기능을 사용하려면 다시 로그인해주세요.',
      status: 401,
    };
  }

  const parsed = await parseAppSessionTokenDetailed(token);
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code,
      message: parsed.message,
      status: 401,
    };
  }

  return { ok: true, session: parsed.payload };
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
