import { getEnv, parseAppSessionTokenDetailed } from './request-board-auth.ts';

/** The existing web backend verifies an upstream login without receiving signing keys. */
export function createWebAppSessionVerificationHandler(
  verify = parseAppSessionTokenDetailed,
  getServiceRoleKey = () => getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '',
) {
  const sameSecret = (actual: string, expected: string) => {
    const encoder = new TextEncoder();
    const left = encoder.encode(actual);
    const right = encoder.encode(expected);
    let mismatch = left.length ^ right.length;
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
    }
    return mismatch === 0;
  };
  return async (req: Request): Promise<Response> => {
    const json = (body: object, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    });
    if (req.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
    const serviceRoleKey = getServiceRoleKey().trim();
    if (!serviceRoleKey) return json({ ok: false, code: 'session_verification_unavailable' }, 503);
    const authorization = req.headers.get('authorization') ?? '';
    if (!sameSecret(authorization, `Bearer ${serviceRoleKey}`)) {
      return json({ ok: false, code: 'forbidden' }, 403);
    }
    const token = (req.headers.get('x-app-session-token') ?? '').trim();
    if (!token || token.length > 8192) return json({ ok: false, code: 'invalid_app_session' }, 401);
    try {
      const result = await verify(token);
      if (result.ok === false) {
        return json({ ok: false, code: result.code }, result.status ?? 401);
      }
      const { kind, phone, role, accountKind, accountId, sessionVersion, iat, exp } = result.payload;
      return json({ ok: true, payload: { kind, phone, role, accountKind, accountId, sessionVersion, iat, exp } });
    } catch {
      return json({ ok: false, code: 'session_verification_unavailable' }, 503);
    }
  };
}
