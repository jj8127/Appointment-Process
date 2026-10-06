export type VerifiedWebLoginSessionPayload = {
  kind: 'fc_onboarding_session';
  phone: string;
  role: 'fc' | 'admin' | 'manager';
  accountKind: 'fc' | 'admin' | 'manager';
  accountId: string;
  sessionVersion: number;
  iat: number;
  exp: number;
};

export type WebLoginSessionVerificationResult =
  | { ok: true; payload: VerifiedWebLoginSessionPayload }
  | {
    ok: false;
    code: 'invalid_app_session' | 'expired_app_session' | 'session_verification_unavailable';
    message: string;
    status: 401 | 503;
  };

type VerificationConfig = {
  supabaseUrl?: string;
  expectedSupabaseUrl?: string;
  serviceRoleKey?: string;
  fetchImpl?: typeof fetch;
  nowSeconds?: () => number;
};

export const WEB_LOGIN_SESSION_VERIFICATION_TIMEOUT_MS = 5_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles = ['fc', 'admin', 'manager'];

function rejectedSession(expired = false): WebLoginSessionVerificationResult {
  return {
    ok: false,
    code: expired ? 'expired_app_session' : 'invalid_app_session',
    message: expired
      ? '세션이 만료되었습니다. 다시 로그인해주세요.'
      : '세션이 유효하지 않습니다. 다시 로그인해주세요.',
    status: 401,
  };
}

function unavailableSession(): WebLoginSessionVerificationResult {
  return {
    ok: false,
    code: 'session_verification_unavailable',
    message: '세션을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
    status: 503,
  };
}

function verifiedPayload(value: unknown, now: number): VerifiedWebLoginSessionPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'fc_onboarding_session'
    || typeof candidate.phone !== 'string'
    || !/^(?:01[0-9]{9}|01[0-9]-[0-9]{4}-[0-9]{4})$/.test(candidate.phone.trim())
    || typeof candidate.role !== 'string' || !roles.includes(candidate.role)
    || candidate.accountKind !== candidate.role
    || typeof candidate.accountId !== 'string' || !uuid.test(candidate.accountId)
    || typeof candidate.sessionVersion !== 'number'
    || !Number.isSafeInteger(candidate.sessionVersion) || candidate.sessionVersion < 0
    || typeof candidate.iat !== 'number' || !Number.isSafeInteger(candidate.iat)
    || candidate.iat < 0 || candidate.iat > now + 60
    || typeof candidate.exp !== 'number' || !Number.isSafeInteger(candidate.exp)
    || candidate.exp <= candidate.iat) return null;

  // Return only the signed claims needed by the login cookie contract.
  return {
    kind: candidate.kind,
    phone: candidate.phone.replace(/\D/g, ''),
    role: candidate.role as VerifiedWebLoginSessionPayload['role'],
    accountKind: candidate.accountKind as VerifiedWebLoginSessionPayload['accountKind'],
    accountId: candidate.accountId,
    sessionVersion: candidate.sessionVersion,
    iat: candidate.iat,
    exp: candidate.exp,
  };
}

function issuerEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.search || url.hash || url.pathname !== '/'
      || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) return null;
    return `${url.origin}/functions/v1/verify-app-session`;
  } catch {
    return null;
  }
}

/** Verify at the issuer, without placing app signing keys in the web runtime. */
export async function verifyWebLoginSessionAtIssuer(
  token: string,
  config: VerificationConfig,
): Promise<WebLoginSessionVerificationResult> {
  const appSessionToken = String(token ?? '').trim();
  if (!appSessionToken || appSessionToken.length > 8_192) return rejectedSession();
  const supabaseUrl = String(config.supabaseUrl ?? '').trim().replace(/\/+$/, '');
  const serviceRoleKey = String(config.serviceRoleKey ?? '').trim();
  if (!supabaseUrl || !serviceRoleKey) return unavailableSession();
  const endpoint = issuerEndpoint(supabaseUrl);
  if (!endpoint || (config.expectedSupabaseUrl !== undefined
    && endpoint !== issuerEndpoint(config.expectedSupabaseUrl.trim()))) return unavailableSession();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_LOGIN_SESSION_VERIFICATION_TIMEOUT_MS);
  try {
    const response = await (config.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'x-app-session-token': appSessionToken,
      },
      body: '{}',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status !== 200 && response.status !== 401) return unavailableSession();
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) return unavailableSession();
    const data = result as Record<string, unknown>;
    if (response.status === 401) {
      if (data.ok !== false
        || (data.code !== 'invalid_app_session' && data.code !== 'expired_app_session')) {
        return unavailableSession();
      }
      return rejectedSession(data.code === 'expired_app_session');
    }
    if (data.ok !== true) return unavailableSession();
    const now = config.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    const payload = verifiedPayload(data.payload, now);
    if (!payload) return unavailableSession();
    if (payload.exp <= now) return rejectedSession(true);
    return { ok: true, payload };
  } catch {
    return unavailableSession();
  } finally {
    clearTimeout(timeout);
  }
}
