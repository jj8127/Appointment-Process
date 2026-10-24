/** Account generations are independent of token signing-key rotation. */
export type SessionAccountKind = 'fc' | 'admin' | 'manager';
export type SessionGenerationClaims = {
  accountKind: SessionAccountKind;
  accountId: string;
  sessionVersion: number;
};
export type OptionalSessionGenerationClaims = Partial<SessionGenerationClaims>;
export type SessionGenerationInput = OptionalSessionGenerationClaims & {
  phone: string;
  role: string;
  fcId?: string;
  iat?: number;
};
export type SessionGenerationResult =
  | { ok: true; claims: SessionGenerationClaims }
  | { ok: false; reason: 'invalid_session' | 'unavailable' };

export function sessionGenerationClaims(input: SessionGenerationClaims): SessionGenerationClaims {
  const claims = parseSessionGenerationClaims(input);
  if (!claims || claims.legacy === true) throw new Error('Invalid session generation');
  return { accountKind: claims.accountKind, accountId: claims.accountId, sessionVersion: claims.sessionVersion };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only the complete absence of claims is the legacy generation zero. */
export function parseSessionGenerationClaims(value: OptionalSessionGenerationClaims):
  | { legacy: true; sessionVersion: 0 }
  | ({ legacy: false } & SessionGenerationClaims)
  | null {
  const { accountKind, accountId, sessionVersion } = value;
  if (accountKind === undefined && accountId === undefined && sessionVersion === undefined) {
    return { legacy: true, sessionVersion: 0 };
  }
  if (
    !['fc', 'admin', 'manager'].includes(String(accountKind))
    || typeof accountId !== 'string' || !uuid.test(accountId)
    || typeof sessionVersion !== 'number'
    || !Number.isSafeInteger(sessionVersion) || sessionVersion < 0
  ) return null;
  return { legacy: false, accountKind: accountKind as SessionAccountKind, accountId, sessionVersion };
}

export function checkSessionGeneration(
  input: SessionGenerationInput,
  state: unknown,
): SessionGenerationResult {
  const token = parseSessionGenerationClaims(input);
  if (!token) return { ok: false, reason: 'invalid_session' };
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, reason: state === null ? 'invalid_session' : 'unavailable' };
  }
  const current = parseSessionGenerationClaims(state as OptionalSessionGenerationClaims);
  if (!current || current.legacy === true) return { ok: false, reason: 'unavailable' };
  if (token.legacy === true && input.fcId === undefined) {
    const createdAt = (state as { createdAt?: unknown }).createdAt;
    const createdMs = typeof createdAt === 'string' ? Date.parse(createdAt) : Number.NaN;
    if (!Number.isFinite(createdMs)) return { ok: false, reason: 'unavailable' };
    // Legacy tokens have no immutable account id. Reject a reused phone when
    // the current account was created after the signed whole-second issue time.
    // A same-second ambiguous legacy login must sign in again for bound claims.
    if (typeof input.iat !== 'number' || !Number.isSafeInteger(input.iat)
      || input.iat * 1000 <= createdMs) return { ok: false, reason: 'invalid_session' };
  }
  if (
    token.sessionVersion !== current.sessionVersion
    || (token.legacy === false && (token.accountKind !== current.accountKind || token.accountId !== current.accountId))
    || (input.fcId !== undefined && (current.accountKind !== 'fc' || input.fcId !== current.accountId))
  ) return { ok: false, reason: 'invalid_session' };
  return { ok: true, claims: {
    accountKind: current.accountKind,
    accountId: current.accountId,
    sessionVersion: current.sessionVersion,
  } };
}

export type SessionGenerationLookup = (
  input: SessionGenerationInput,
  purpose: 'app' | 'bridge',
) => Promise<SessionGenerationResult>;

/** No positive cache: a committed password change applies to the next request. */
export async function verifySessionGeneration(
  input: SessionGenerationInput,
  purpose: 'app' | 'bridge',
  config: { supabaseUrl?: string; serviceRoleKey?: string; fetchImpl?: typeof fetch },
): Promise<SessionGenerationResult> {
  const claims = parseSessionGenerationClaims(input);
  if (!claims) return { ok: false, reason: 'invalid_session' };
  if (!config.supabaseUrl || !config.serviceRoleKey) return { ok: false, reason: 'unavailable' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await (config.fetchImpl ?? fetch)(
      `${config.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/get_auth_session_generation`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.serviceRoleKey,
          Authorization: `Bearer ${config.serviceRoleKey}`,
        },
        body: JSON.stringify({
          p_phone: input.phone,
          p_role: input.role,
          p_purpose: purpose,
          p_account_kind: claims.legacy === true ? null : claims.accountKind,
          p_account_id: claims.legacy === true ? (input.fcId ?? null) : claims.accountId,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    return checkSessionGeneration(input, await response.json());
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}
