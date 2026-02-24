import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

type SubscriptionPayload = {
  subscription: {
    endpoint?: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };
  role?: 'admin' | 'fc';
  residentId?: string;
};

// Service role client: bypasses RLS (custom auth has no Supabase auth.uid())
const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(request: Request) {
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

  const { error } = await adminClient
    .from('web_push_subscriptions')
    .upsert(
      {
        resident_id: payload.residentId ?? null,
        role: payload.role ?? null,
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
