'use server';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { sendWebPush } from '@/lib/web-push';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req: Request) {
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      {
        error: 'SUPABASE env missing (check NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)',
      },
      { status: 503 },
    );
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    if (body?.type === 'message') {
      const targetRole = body?.target_role as 'admin' | 'fc' | undefined;
      const targetId = body?.target_id as string | null | undefined;
      const message = (body?.message ?? '새로운 메시지가 도착했습니다.') as string;
      const senderId = body?.sender_id as string | undefined;

      const supabase = createClient(supabaseUrl, serviceKey);
      let query = supabase.from('web_push_subscriptions').select('endpoint,p256dh,auth');

      if (targetRole === 'admin') {
        query = query.eq('role', 'admin');
      } else if (targetRole === 'fc' && targetId) {
        query = query.eq('role', 'fc').eq('resident_id', targetId);
      }

      const { data: subs } = await query;
      if (subs && subs.length > 0) {
        const url =
          targetRole === 'admin'
            ? `/dashboard/chat?targetId=${senderId ?? ''}`
            : '/chat';
        const result = await sendWebPush(subs, {
          title: '새 메시지',
          body: message,
          data: { url },
        });
        if (result.expired.length > 0) {
          await supabase.from('web_push_subscriptions').delete().in('endpoint', result.expired);
        }
      }
    }

    const resp = await fetch(`${supabaseUrl}/functions/v1/fc-notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return NextResponse.json(
      { status: resp.status, ok: resp.ok, data },
      { status: resp.status },
    );
  } catch (err: any) {
    console.error('[api/fc-notify] proxy error', err?.message ?? err);
    return NextResponse.json(
      { error: err?.message ?? 'fc-notify proxy failed' },
      { status: 500 },
    );
  }
}
