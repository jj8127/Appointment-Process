import { NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { getVerifiedReadOnlyAdminSession } from '@/lib/server-session';

type SubscriptionPayload = {
  subscription: {
    endpoint?: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };
};

export async function POST(request: Request) {
  const sessionCheck = await getVerifiedReadOnlyAdminSession();
  if (!sessionCheck.ok) {
    return NextResponse.json({ error: sessionCheck.error }, { status: sessionCheck.status });
  }

  let payload: SubscriptionPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const endpoint = payload.subscription?.endpoint?.trim();
  const p256dh = payload.subscription?.keys?.p256dh?.trim();
  const auth = payload.subscription?.keys?.auth?.trim();

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  const { error } = await adminSupabase
    .from('web_push_subscriptions')
    .upsert(
      {
        resident_id: sessionCheck.session.residentDigits,
        role: sessionCheck.session.role,
        endpoint,
        p256dh,
        auth,
        user_agent: request.headers.get('user-agent') ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
