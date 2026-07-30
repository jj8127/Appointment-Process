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

  return NextResponse.json({
    ok: true,
    subscribed: false,
    mode: 'in_app_only',
  });
}

export async function DELETE() {
  const sessionCheck = await getVerifiedReadOnlyAdminSession();
  if (!sessionCheck.ok) {
    return NextResponse.json({ error: sessionCheck.error }, { status: sessionCheck.status });
  }

  const { error } = await adminSupabase
    .from('web_push_subscriptions')
    .delete()
    .eq('resident_id', sessionCheck.session.residentDigits)
    .eq('role', sessionCheck.session.role);

  if (error) {
    return NextResponse.json({ error: 'Subscription retirement failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    retired: true,
    mode: 'in_app_only',
  });
}
