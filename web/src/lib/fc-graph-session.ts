import { createHmac, timingSafeEqual } from 'node:crypto';

export const FC_GRAPH_SESSION_COOKIE = 'fc_graph_session';
export const FC_GRAPH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

type FcGraphSessionPayload = {
  v: 1;
  role: 'fc';
  fcId: string;
  residentDigits: string;
  iat: number;
  exp: number;
};

type SessionSecretOptions = {
  secret?: string;
};

type CreateSessionOptions = SessionSecretOptions & {
  fcId: string;
  residentDigits: string;
  nowMs?: number;
  ttlSeconds?: number;
};

type VerifySessionOptions = SessionSecretOptions & {
  expectedResidentDigits?: string;
  nowMs?: number;
};

function getSessionSecret(explicitSecret?: string) {
  const secret = explicitSecret
    ?? process.env.FC_GRAPH_SESSION_SECRET
    ?? process.env.AUTH_SECRET
    ?? process.env.NEXTAUTH_SECRET
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret || secret.trim().length < 16) {
    throw new Error('FC graph session secret is not configured.');
  }

  return secret;
}

function signPayload(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function encodePayload(payload: FcGraphSessionPayload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(value: string): FcGraphSessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<FcGraphSessionPayload>;
    if (
      parsed.v !== 1
      || parsed.role !== 'fc'
      || typeof parsed.fcId !== 'string'
      || typeof parsed.residentDigits !== 'string'
      || typeof parsed.iat !== 'number'
      || typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    return parsed as FcGraphSessionPayload;
  } catch {
    return null;
  }
}

export function createFcGraphSessionValue({
  fcId,
  residentDigits,
  nowMs = Date.now(),
  ttlSeconds = FC_GRAPH_SESSION_MAX_AGE_SECONDS,
  secret: explicitSecret,
}: CreateSessionOptions) {
  const secret = getSessionSecret(explicitSecret);
  const nowSeconds = Math.floor(nowMs / 1000);
  const payload = encodePayload({
    v: 1,
    role: 'fc',
    fcId,
    residentDigits,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  });
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function verifyFcGraphSessionValue(
  value: string | null | undefined,
  {
    expectedResidentDigits,
    nowMs = Date.now(),
    secret: explicitSecret,
  }: VerifySessionOptions = {},
) {
  const rawValue = String(value ?? '').trim();
  const [payloadPart, signaturePart, extraPart] = rawValue.split('.');
  if (!payloadPart || !signaturePart || extraPart) {
    return null;
  }

  const secret = getSessionSecret(explicitSecret);
  const expectedSignature = signPayload(payloadPart, secret);
  if (!safeEqual(signaturePart, expectedSignature)) {
    return null;
  }

  const payload = decodePayload(payloadPart);
  if (!payload) {
    return null;
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (payload.exp <= nowSeconds) {
    return null;
  }

  if (expectedResidentDigits && payload.residentDigits !== expectedResidentDigits) {
    return null;
  }

  return payload;
}
