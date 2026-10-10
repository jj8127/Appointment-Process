/// <reference lib="deno.ns" />
import { serve as serveHttp } from 'https://deno.land/std@0.224.0/http/server.ts';
import { withConfiguredCors } from './configured-cors.ts';

const configuredOrigins = () => (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((value) => value.trim()).filter(Boolean);

/** Existing referral POST policy; public validation excludes the app session header. */
export function referralCorsHeaders(appSession = true) {
  return {
    'Access-Control-Allow-Origin': configuredOrigins()[0] ?? 'https://yourdomain.com',
    'Access-Control-Allow-Headers': `Content-Type, Authorization, ${appSession ? 'x-app-session-token, ' : ''}x-client-info, apikey`,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };
}

/** Keep the existing handler's auth, origin guard, headers, and status intact. */
export function serveWithConfiguredCors(
  handler: (request: Request) => Response | Promise<Response>,
  preflightHeaders?: HeadersInit,
) {
  return serveHttp(withConfiguredCors(
    (request) => request.method === 'OPTIONS' && preflightHeaders
      ? new Response('ok', { headers: preflightHeaders }) : handler(request),
    configuredOrigins(),
  ));
}
