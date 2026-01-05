import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload =
  | { type: 'fc_update'; fc_id: string; message?: string }
  | { type: 'fc_delete'; fc_id: string; message?: string }
  | { type: 'admin_update'; fc_id: string; message?: string }
  | {
      type: 'message';
      target_role: 'admin' | 'fc';
      target_id: string | null;
      message: string;
      sender_id: string;
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

const supabaseUrl = getEnv('SUPABASE_URL') ?? '';
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  // 메시지 알림 처리
  if (body.type === 'message') {
    const { target_role, target_id, message, sender_id } = body;
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
      }
    }

    if (!tokens.length) {
      return ok({ ok: true, sent: 0, msg: 'No tokens found' });
    }

    let url = '/chat';
    if (target_role === 'admin') {
      url = `/chat?targetId=${sender_id}&targetName=FC`;
    }

    const pushTitle = '새 메시지';
    const pushBody = message || '새로운 메시지가 도착했습니다.';

    const pushPayload = tokens.map((t) => ({
      to: t.expo_push_token,
      title: pushTitle,
      body: pushBody,
      data: { url },
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

    return ok({ ok: true, sent: tokens.length, result });
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
  if (logError) console.error('notifications insert failed', logError.message);

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
