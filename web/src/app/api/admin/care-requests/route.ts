import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { requireAdminRoute } from '@/lib/admin-route-auth';
import { toPlatformCareAnswer } from '@/lib/care-request-admin';
import { verifyOrigin } from '@/lib/csrf';
import { WEB_APP_SESSION_COOKIE } from '@/lib/request-board-app-session';

// Care request answers go through platform-service with the admin's app session, the same path the app used.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

type PlatformResult = { ok: true; data: Record<string, unknown> } | { ok: false; response: NextResponse };

async function callPlatform(payload: Record<string, unknown>): Promise<PlatformResult> {
  const failed = (error: string, status: number): PlatformResult => ({ ok: false, response: reply({ error }, status) });
  if (!supabaseUrl || !anonKey) return failed('서버 설정을 확인해 주세요.', 500);
  const token = String((await cookies()).get(WEB_APP_SESSION_COOKIE)?.value ?? '').trim();
  if (!token) return failed('다시 로그인해 주세요.', 401);
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/platform-service`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'x-app-session-token': token },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const data: unknown = await response.json().catch(() => null);
    const record = data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
    if (response.ok && record?.ok === true) return { ok: true, data: record };
    return failed(typeof record?.message === 'string' ? record.message : '요청을 처리하지 못했습니다.', response.ok ? 502 : response.status);
  } catch {
    return failed('서버에 연결하지 못했습니다. 다시 시도해 주세요.', 502);
  }
}

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return reply({ error: '관리자 로그인이 필요합니다.' }, auth.status);
  const result = await callPlatform({ action: 'get_admin' });
  if (!result.ok) return result.response;
  // Only the care queue leaves this route; partner and settlement rows stay server-side.
  const { careRequests, careMetrics } = result.data;
  if (!Array.isArray(careRequests)) return reply({ error: '요청 목록을 확인하지 못했습니다.' }, 502);
  return reply({ ok: true, requests: careRequests, metrics: careMetrics ?? null });
}

export async function POST(request: Request) {
  if (!(await verifyOrigin()).valid) return reply({ error: '허용되지 않은 요청입니다.' }, 403);
  const auth = await requireAdminRoute();
  if (!auth.ok) return reply({ error: '관리자 로그인이 필요합니다.' }, auth.status);
  const answer = toPlatformCareAnswer(await request.json().catch(() => null));
  if (!answer.ok) return reply({ error: answer.error }, 400);
  const result = await callPlatform(answer.payload);
  return result.ok ? reply({ ok: true }) : result.response;
}
