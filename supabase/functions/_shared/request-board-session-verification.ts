import { parseRequestBoardBridgeTokenDetailed } from './request-board-auth.ts';

/** This endpoint returns no identity, database row, or token contents. */
export function createRequestBoardSessionVerificationHandler(
  verify = parseRequestBoardBridgeTokenDetailed,
  allowedOrigins: string[] = [],
) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin') ?? '';
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] ?? 'https://yourdomain.com'),
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    };
    const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (req.method === 'OPTIONS') return new Response('ok', { headers });
    if (req.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
    let body: unknown;
    try { body = await req.json(); }
    catch { return json({ ok: false, code: 'invalid_json' }, 400); }
    const token = body && typeof body === 'object' && 'bridgeToken' in body
      && typeof body.bridgeToken === 'string' ? body.bridgeToken.trim() : '';
    if (!token || token.length > 8192) return json({ ok: false, code: 'invalid_bridge_token' }, 401);
    try {
      const result = await verify(token);
      if (result.ok === false) return json({ ok: false, code: result.code, message: result.message }, result.status ?? 401);
      return json({ ok: true, role: result.payload.role });
    } catch {
      return json({ ok: false, code: 'session_verification_unavailable' }, 503);
    }
  };
}
