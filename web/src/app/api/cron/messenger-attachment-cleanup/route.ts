import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const CLEANUP_TIMEOUT_MS = 45_000;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function GET(request: Request) {
  const cronSecret = String(process.env.CRON_SECRET ?? '').trim();
  if (
    !cronSecret
    || request.headers.get('authorization') !== `Bearer ${cronSecret}`
  ) {
    return json({ ok: false, code: 'unauthorized' }, 401);
  }

  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  ).trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, code: 'cleanup_not_configured' }, 503);
  }

  try {
    const upstream = await fetch(
      `${supabaseUrl}/functions/v1/messenger-attachments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ type: 'cleanup_drain', limit: 100 }),
        cache: 'no-store',
        signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS),
      },
    );
    const payload = await upstream.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    if (!upstream.ok || payload?.ok !== true) {
      return json({ ok: false, code: 'cleanup_upstream_failed' }, 503);
    }
    return json({
      ok: true,
      expired: Number(payload.expired ?? 0),
      claimed: Number(payload.claimed ?? 0),
      removed: Number(payload.removed ?? 0),
      requeued: Number(payload.requeued ?? 0),
      exhausted: Number(payload.exhausted ?? 0),
    });
  } catch {
    return json({ ok: false, code: 'cleanup_upstream_unavailable' }, 503);
  }
}
