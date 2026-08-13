import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  getEnv,
  requireAppSessionFromRequest,
} from '../_shared/request-board-auth.ts';

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(code: string, message: string, status = 200) {
  return json({ ok: false, code, message }, status);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 'Method not allowed', 405);

  const sessionResult = await requireAppSessionFromRequest(req);
  if (sessionResult.ok === false) {
    return fail(sessionResult.code, sessionResult.message);
  }

  return fail(
    'forbidden',
    '추천인은 본인이 변경할 수 없습니다. 담당 본부장 또는 총무에게 요청해주세요.',
    403,
  );
});
