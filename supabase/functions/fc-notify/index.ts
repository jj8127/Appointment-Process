import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload =
  | { type: 'fc_update'; fc_id: string; message?: string }
  | { type: 'fc_delete'; fc_id: string; message?: string }
  | { type: 'admin_update'; fc_id: string; message?: string }
  | {
      type: 'inbox_list';
      role: 'admin' | 'fc';
      resident_id?: string | null;
      limit?: number;
    }
  | {
      type: 'inbox_unread_count';
      role: 'admin' | 'fc';
      resident_id?: string | null;
      since?: string | null;
    }
  | {
      type: 'inbox_delete';
      role: 'admin' | 'fc';
      resident_id?: string | null;
      notification_ids?: string[];
      notice_ids?: string[];
    }
  | { type: 'latest_notice' }
  | {
      type: 'notify';
      target_role: 'admin' | 'fc';
      target_id: string | null;
      title: string;
      body: string;
      category?: string;
      url?: string;
      fc_id?: string | null;
    }
  | {
      type: 'message';
      target_role: 'admin' | 'fc';
      target_id: string | null;
      message: string;
      sender_id: string;
      title?: string;
      body?: string;
      category?: string;
      url?: string;
      fc_id?: string | null;
    };

type TokenRow = { expo_push_token: string; resident_id: string | null; display_name: string | null };
type FcRow = { id: string; name: string | null; resident_id_masked: string | null; phone: string | null };

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const sanitize = (v?: string | null) => (v ?? '').replace(/[^0-9]/g, '');

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

// Security: Validate required environment variables
const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}
if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceKey);

function getTargetUrl(role: 'admin' | 'fc', payload: Payload, message: string, fcId: string): string {
  const msg = message.toLowerCase();

  if (role === 'fc') {
    if (msg.includes('임시번호') || msg.includes('경력')) return '/consent';
    if (msg.includes('서류 요청')) return '/docs-upload';
    if (msg.includes('위촉 url') || msg.includes('위촉url') || msg.includes('위촉')) return '/appointment';
    return '/notifications';
  }

  if (msg.includes('수당동의')) return '/dashboard';
  if (msg.includes('업로드') || msg.includes('제출') || msg.includes('서류')) return `/docs-upload?userId=${fcId}`;
  return '/notifications';
}

function buildTitle(fcName: string | null, payload: Payload, message?: string) {
  const name = fcName ?? 'FC';
  const msg = (message ?? '').toLowerCase();

  if (payload.type === 'admin_update') {
    if (msg.includes('위촉')) return '위촉 URL 등록';
    if (msg.includes('temp')) return `${name}의 임시번호 안내`;
    if (msg.includes('docs') || msg.includes('서류')) return `${name} 서류 요청`;
    return `${name} 정보 업데이트`;
  }
  if (payload.type === 'fc_delete') {
    const parts = message?.split(' ') ?? [];
    const docName = parts.length > 1 ? parts[1].replace(/[:,]/g, '') : '파일';
    return `${name} ${docName} 삭제`;
  }
  if (payload.type === 'fc_update') {
    if (msg.includes('기본') || msg.includes('정보')) return `${name} 기본 정보 업데이트`;
    if (msg.includes('temp')) return `${name}의 임시번호 안내`;
    if (msg.includes('서류') || msg.includes('업로드') || msg.includes('upload')) {
      const parts = message?.split(' ') ?? [];
      const docName = parts.length > 1 ? parts[1].replace(/[:,]/g, '') : '서류';
      return `${name} ${docName} 제출`;
    }
  }
  return `${name} 업데이트`;
}

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

function ok(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function err(message: string, status = 400) {
  return new Response(message, { status, headers: corsHeaders });
}

serve(async (req: Request) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return err('Method not allowed', 405);
  }

  let body: Payload;
  try {
    body = await req.json();
    console.log('[fc-notify] payload', body);
  } catch {
    return err('Invalid JSON', 400);
  }

  // 알림센터 목록 조회 (RLS 우회)
  if (body.type === 'inbox_list') {
    const role = body.role;
    const residentId = sanitize(body.resident_id);
    const limit = Math.max(1, Math.min(Number(body.limit ?? 80) || 80, 200));

    let notifQuery = supabase
      .from('notifications')
      .select('id,title,body,category,created_at,resident_id,recipient_role')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (role === 'fc') {
      if (residentId) {
        notifQuery = notifQuery.eq('recipient_role', 'fc').or(`resident_id.eq.${residentId},resident_id.is.null`);
      } else {
        notifQuery = notifQuery.eq('recipient_role', 'fc').is('resident_id', null);
      }
    } else {
      notifQuery = notifQuery.eq('recipient_role', 'admin');
    }

    const { data: notifications, error: notifErr } = await notifQuery;
    if (notifErr) return err(notifErr.message, 500);

    const { data: notices, error: noticeErr } = await supabase
      .from('notices')
      .select('id,title,body,category,created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (noticeErr) return err(noticeErr.message, 500);

    return ok({
      ok: true,
      notifications: notifications ?? [],
      notices: notices ?? [],
    });
  }

  // 홈 벨 아이콘 unread 개수 조회 (RLS 우회)
  if (body.type === 'inbox_unread_count') {
    const role = body.role;
    const residentId = sanitize(body.resident_id);

    const sinceDate = body.since ? new Date(body.since) : new Date(0);
    const sinceIso = Number.isNaN(sinceDate.getTime()) ? new Date(0).toISOString() : sinceDate.toISOString();

    let countQuery = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', sinceIso);

    if (role === 'fc') {
      if (residentId) {
        countQuery = countQuery.eq('recipient_role', 'fc').or(`resident_id.eq.${residentId},resident_id.is.null`);
      } else {
        countQuery = countQuery.eq('recipient_role', 'fc').is('resident_id', null);
      }
    } else {
      countQuery = countQuery.eq('recipient_role', 'admin');
    }

    const { count, error: countErr } = await countQuery;
    if (countErr) return err(countErr.message, 500);

    return ok({ ok: true, count: count ?? 0 });
  }

  // 알림센터 선택 항목 삭제 (RLS 우회)
  if (body.type === 'inbox_delete') {
    const role = body.role;
    const residentId = sanitize(body.resident_id);
    const notificationIds = Array.isArray(body.notification_ids)
      ? body.notification_ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];
    const noticeIds = Array.isArray(body.notice_ids)
      ? body.notice_ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];

    let deletedNotifications = 0;
    let deletedNotices = 0;

    if (notificationIds.length > 0) {
      let deleteQuery = supabase
        .from('notifications')
        .delete({ count: 'exact' })
        .in('id', notificationIds);

      if (role === 'fc') {
        if (residentId) {
          deleteQuery = deleteQuery.eq('recipient_role', 'fc').or(`resident_id.eq.${residentId},resident_id.is.null`);
        } else {
          deleteQuery = deleteQuery.eq('recipient_role', 'fc').is('resident_id', null);
        }
      } else {
        deleteQuery = deleteQuery.eq('recipient_role', 'admin');
      }

      const { count, error: notifDeleteErr } = await deleteQuery;
      if (notifDeleteErr) return err(notifDeleteErr.message, 500);
      deletedNotifications = count ?? 0;
    }

    // notices는 전체 공지이므로 admin 계정에서만 서버 삭제 허용
    if (noticeIds.length > 0 && role === 'admin') {
      const { count, error: noticeDeleteErr } = await supabase
        .from('notices')
        .delete({ count: 'exact' })
        .in('id', noticeIds);
      if (noticeDeleteErr) return err(noticeDeleteErr.message, 500);
      deletedNotices = count ?? 0;
    }

    return ok({
      ok: true,
      deleted_notifications: deletedNotifications,
      deleted_notices: deletedNotices,
    });
  }

  // 홈 상단 최신 공지 조회 (RLS 우회)
  if (body.type === 'latest_notice') {
    const { data, error: latestErr } = await supabase
      .from('notices')
      .select('title,body,category,created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) return err(latestErr.message, 500);
    return ok({ ok: true, notice: data ?? null });
  }

  // 직접 알림 처리 (notify/message)
  if (body.type === 'notify' || body.type === 'message') {
    const target_role = body.target_role;
    const target_id = body.target_id;

    const title =
      body.type === 'notify'
        ? body.title
        : body.title ?? '새 메시지';
    const message =
      body.type === 'notify'
        ? body.body
        : body.body ?? body.message ?? '새로운 메시지가 도착했습니다.';
    const category =
      body.type === 'notify'
        ? body.category ?? 'app_event'
        : body.category ?? 'message';

    let url = body.type === 'notify' ? body.url ?? '/notifications' : body.url ?? '/chat';
    if (body.type === 'message' && target_role === 'admin' && !body.url) {
      url = `/chat?targetId=${body.sender_id}&targetName=FC`;
    }

    let tokens: TokenRow[] = [];

    if (target_role === 'admin') {
      const { data, error } = await supabase
        .from('device_tokens')
        .select('expo_push_token,resident_id,display_name')
        .eq('role', 'admin');
      if (!error && data) tokens = data;
    } else {
      if (target_id) {
        const { data, error } = await supabase
          .from('device_tokens')
          .select('expo_push_token,resident_id,display_name')
          .eq('role', 'fc')
          .eq('resident_id', target_id);
        if (!error && data) tokens = data;
      } else {
        const { data, error } = await supabase
          .from('device_tokens')
          .select('expo_push_token,resident_id,display_name')
          .eq('role', 'fc');
        if (!error && data) tokens = data;
      }
    }

    const { error: logError } = await supabase.from('notifications').insert({
      title,
      body: message,
      category,
      recipient_role: target_role,
      resident_id: target_id,
      fc_id: body.fc_id ?? null,
    });
    if (logError) {
      console.warn('notifications insert failed', logError.message);
    }

    if (!tokens.length) {
      return ok({ ok: true, sent: 0, logged: !logError, msg: 'No tokens found' });
    }

    const pushPayload = tokens.map((t) => ({
      to: t.expo_push_token,
      title,
      body: message,
      data: {
        url,
        type: category,
        resident_id: target_id,
      },
      sound: 'default',
      priority: 'high',
      channelId: 'alerts',
    }));

    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pushPayload),
    });
    const result = await resp.json();

    return ok({ ok: true, sent: tokens.length, logged: !logError, result });
  }

  // 기존 fc/admin 업데이트/삭제 로직
  if (!(body as any).fc_id) {
    return err('fc_id required', 400);
  }

  const fc_id = (body as any).fc_id;

  const { data: fc, error: fcError } = await supabase
    .from('fc_profiles')
    .select('id,name,resident_id_masked,phone')
    .eq('id', fc_id)
    .maybeSingle();

  if (fcError || !fc) {
    return err('fc not found', 404);
  }
  const fcRow = fc as FcRow;

  const targetRole: 'admin' | 'fc' = body.type === 'admin_update' ? 'fc' : 'admin';
  const targetResidentId = targetRole === 'fc' ? sanitize(fcRow.phone) : null;

  let tokens: TokenRow[] = [];
  if (body.type === 'fc_update' || body.type === 'fc_delete') {
    const { data, error } = await supabase
      .from('device_tokens')
      .select('expo_push_token,resident_id,display_name')
      .eq('role', 'admin');
    if (!error && data) tokens = data;
  } else {
    if (!targetResidentId) return err('FC phone number not found', 400);
    const { data, error } = await supabase
      .from('device_tokens')
      .select('expo_push_token,resident_id,display_name')
      .eq('role', 'fc')
      .eq('resident_id', targetResidentId);
    if (!error && data) tokens = data;
  }

  const title = buildTitle(fcRow.name, body, (body as any).message);
  const message = (body as any).message ?? title;
  const targetUrl = getTargetUrl(targetRole, body, message, fcRow.id);

  const { error: logError } = await supabase.from('notifications').insert({
    title,
    body: message,
    category: (body as any).type,
    fc_id: fcRow.id,
    resident_id: targetResidentId,
    recipient_role: targetRole,
  });
  if (logError) console.warn('notifications insert failed', logError.message);

  if (!tokens.length) {
    return ok({ ok: true, sent: 0, logged: true });
  }

  const payload = tokens.map((t) => ({
    to: t.expo_push_token,
    title,
    body: message,
    data: {
      fc_id: fcRow.id,
      resident_id: fcRow.phone ?? fcRow.resident_id_masked,
      name: fcRow.name,
      url: targetUrl,
    },
    sound: 'default',
    priority: 'high',
    channelId: 'alerts',
  }));

  const resp = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await resp.json();

  return ok({ ok: true, sent: tokens.length, logged: true, result });
});
