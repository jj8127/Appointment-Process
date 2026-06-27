import { createHmac, timingSafeEqual } from 'node:crypto';

export const STAFF_SESSION_COOKIE = 'staff_session';
export const STAFF_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

type StaffSessionRole = 'admin' | 'manager';

type StaffSessionPayload = {
  v: 1;
  role: StaffSessionRole;
  residentDigits: string;
  iat: number;
  exp: number;
};

type SessionSecretOptions = {
  secret?: string;
};

type CreateStaffSessionOptions = SessionSecretOptions & {
  role: StaffSessionRole;
  residentDigits: string;
  nowMs?: number;
  ttlSeconds?: number;
};

type VerifyStaffSessionOptions = SessionSecretOptions & {
  expectedRole?: StaffSessionRole;
  expectedResidentDigits?: string;
  nowMs?: number;
};

function getStaffSessionSecret(explicitSecret?: string) {
  const secret = explicitSecret
    ?? process.env.STAFF_SESSION_SECRET
    ?? process.env.AUTH_SECRET
    ?? process.env.NEXTAUTH_SECRET
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret || secret.trim().length < 16) {
    throw new Error('Staff session secret is not configured.');
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

function encodePayload(payload: StaffSessionPayload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(value: string): StaffSessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<StaffSessionPayload>;
    if (
      parsed.v !== 1
      || (parsed.role !== 'admin' && parsed.role !== 'manager')
      || typeof parsed.residentDigits !== 'string'
      || typeof parsed.iat !== 'number'
      || typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    return parsed as StaffSessionPayload;
  } catch {
    return null;
  }
}

export function createStaffSessionValue({
  role,
  residentDigits,
  nowMs = Date.now(),
  ttlSeconds = STAFF_SESSION_MAX_AGE_SECONDS,
  secret: explicitSecret,
}: CreateStaffSessionOptions) {
  const secret = getStaffSessionSecret(explicitSecret);
  const nowSeconds = Math.floor(nowMs / 1000);
  const payload = encodePayload({
    v: 1,
    role,
    residentDigits,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  });
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function verifyStaffSessionValue(
  value: string | null | undefined,
  {
    expectedRole,
    expectedResidentDigits,
    nowMs = Date.now(),
    secret: explicitSecret,
  }: VerifyStaffSessionOptions = {},
) {
  const rawValue = String(value ?? '').trim();
  const [payloadPart, signaturePart, extraPart] = rawValue.split('.');
  if (!payloadPart || !signaturePart || extraPart) {
    return null;
  }

  const secret = getStaffSessionSecret(explicitSecret);
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

  if (expectedRole && payload.role !== expectedRole) {
    return null;
  }

  if (expectedResidentDigits && payload.residentDigits !== expectedResidentDigits) {
    return null;
  }

  return payload;
}
