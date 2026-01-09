import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { sendWebPush } from '@/lib/web-push';

// Validate environment variables at module load time
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error(
    'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
  );
}

// Create admin client with service role key (server-side only)
const adminClient = createClient(supabaseUrl, serviceKey);

/**
 * Request body type for fc-notify
 */
interface NotifyRequestBody {
  type?: string;
  target_role?: 'admin' | 'fc';
  target_id?: string | null;
  message?: string;
  sender_id?: string;
  [key: string]: unknown;
}

/**
 * FC Notification API Route
 *
 * Security: This route is server-side only. Service role key never exposed to client.
 * The route acts as a proxy to Supabase Edge Functions and handles web push notifications.
 */
export async function POST(req: Request) {
  let body: NotifyRequestBody;

  try {
    body = await req.json() as NotifyRequestBody;
  } catch (parseError) {
    console.error('[fc-notify] JSON parse error:', parseError);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  // Validate body
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    // Handle web push notifications for messages
    if (body.type === 'message') {
      const targetRole = body.target_role;
      const targetId = body.target_id;
      const message = body.message ?? '새로운 메시지가 도착했습니다.';
      const senderId = body.sender_id;

      let query = adminClient.from('web_push_subscriptions').select('endpoint,p256dh,auth');

      if (targetRole === 'admin') {
        query = query.eq('role', 'admin');
      } else if (targetRole === 'fc' && targetId) {
        query = query.eq('role', 'fc').eq('resident_id', targetId);
      }

      const { data: subs, error: subsError } = await query;

      if (subsError) {
        console.error('[fc-notify] Error fetching subscriptions:', subsError);
      } else if (subs && subs.length > 0) {
        const url =
          targetRole === 'admin'
            ? `/dashboard/chat?targetId=${senderId ?? ''}`
            : '/chat';

        const result = await sendWebPush(subs, {
          title: '새 메시지',
          body: message,
          data: { url },
        });

        // Clean up expired subscriptions
        if (result.expired.length > 0) {
          const { error: deleteError } = await adminClient
            .from('web_push_subscriptions')
            .delete()
            .in('endpoint', result.expired);

          if (deleteError) {
            console.error('[fc-notify] Error deleting expired subscriptions:', deleteError);
          }
        }
      }
    }

    // Proxy request to Supabase Edge Function
    const resp = await fetch(`${supabaseUrl}/functions/v1/fc-notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey as string,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    let data: unknown = null;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return NextResponse.json(
      { status: resp.status, ok: resp.ok, data },
      { status: resp.status },
    );
  } catch (err: unknown) {
    const error = err as Error;
    console.error('[api/fc-notify] proxy error:', error?.message ?? err);

    return NextResponse.json(
      { error: error?.message ?? 'fc-notify proxy failed' },
      { status: 500 },
    );
  }
}
