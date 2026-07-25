import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { checkRateLimit, SECURITY_HEADERS, verifyOrigin } from '@/lib/csrf';
import { normalizeMessengerAttachmentProxyPayload } from '@/lib/messenger-attachment-proxy';
import {
  WEB_APP_SESSION_COOKIE,
  createWebGroupChatAppSessionToken,
} from '@/lib/request-board-app-session';
import { getVerifiedServerSession } from '@/lib/server-session';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UPSTREAM_TIMEOUT_MS = 12_000;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: SECURITY_HEADERS });
}

export async function POST(req: Request) {
  const origin = await verifyOrigin();
  if (!origin.valid) {
    return json({ ok: false, code: 'invalid_origin', message: origin.error ?? 'Invalid origin' }, 403);
  }
  const session = await getVerifiedServerSession({
    allowedRoles: ['admin', 'manager', 'fc'],
    requireActive: true,
  });
  if (!session.ok) {
    return json({ ok: false, code: 'invalid_session', message: session.error }, session.status);
  }
  const rateLimit = checkRateLimit(
    `messenger-attachments:${session.session.role}:${session.session.residentDigits}`,
    60,
    60_000,
  );
  if (!rateLimit.allowed) {
    return json({ ok: false, code: 'rate_limited', message: 'Too many requests' }, 429);
  }

  const rawBody = await req.json().catch(() => null);
  const normalized = normalizeMessengerAttachmentProxyPayload(rawBody);
  if (!normalized.ok) {
    return json({ ok: false, code: 'invalid_payload', message: normalized.message }, normalized.status);
  }
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, code: 'missing_attachment_config', message: 'Attachment service unavailable' }, 503);
  }

  const cookieStore = await cookies();
  const cookieToken = String(cookieStore.get(WEB_APP_SESSION_COOKIE)?.value ?? '').trim();
  const appSessionToken = cookieToken || createWebGroupChatAppSessionToken(
    session.session.residentDigits,
    session.session.role,
  );
  if (!appSessionToken) {
    return json({ ok: false, code: 'missing_app_session', message: '다시 로그인해 주세요.' }, 401);
  }

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/messenger-attachments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'x-app-session-token': appSessionToken,
        },
        body: JSON.stringify(normalized.payload),
        cache: 'no-store',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    const payload = await response.json().catch(() => null);
    return json(
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : { ok: false, code: 'invalid_attachment_response', message: 'Attachment service unavailable' },
      response.status,
    );
  } catch {
    return json({ ok: false, code: 'attachment_proxy_failed', message: 'Attachment service unavailable' }, 503);
  }
}
