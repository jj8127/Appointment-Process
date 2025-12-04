/// <reference path="./deno-types.d.ts" />

// deno lib reference removed; using local shims in deno-types.d.ts for IDE support

// Supabase Edge Function: fc-notify
// 역할
// - FC가 정보를 입력/수정하면: 관리자(admin)들에게 푸시 + notifications에 기록
// - 관리자가 FC 정보를 수정하면: 해당 FC에게 푸시 + notifications에 기록
// 공지(broadcast)는 notices 테이블을 사용하고, notifications는 개인/역할 대상 알림만 저장
//
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(자동 주입), EXPO_ACCESS_TOKEN(선택)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload =
  | { type: 'fc_update'; fc_id: string; message?: string } // FC → 관리자
  | { type: 'fc_delete'; fc_id: string; message?: string } // FC가 파일/데이터 삭제 → 관리자
  | { type: 'admin_update'; fc_id: string; message?: string }; // 관리자 → FC

type TokenRow = { expo_push_token: string; resident_id: string | null; display_name: string | null };
type FcRow = { id: string; name: string | null; resident_id_masked: string | null; phone: string | null };

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const sanitize = (v?: string | null) => (v ?? '').replace(/[^0-9]/g, '');

function getTargetUrl(role: 'admin' | 'fc', payload: Payload, message: string, fcId: string): string {
  const msg = message.toLowerCase();

  if (role === 'fc') {
    if (msg.includes('임시번호') || msg.includes('경력')) return '/consent'; // F2
    if (msg.includes('서류 요청')) return '/docs-upload'; // F3
    if (msg.includes('위촉 url') || msg.includes('위촉url') || msg.includes('위촉')) return '/appointment'; // F4
    return '/notifications';
  }

  if (msg.includes('수당동의')) return `/docs-upload?userId=${fcId}`; // A3
  if (msg.includes('업로드') || msg.includes('제출') || msg.includes('서류')) return `/docs-upload?userId=${fcId}`; // A4
  return '/notifications';
}

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

const supabaseUrl = getEnv('SUPABASE_URL') ?? '';
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(supabaseUrl, serviceKey);

async function logNotification(params: {
  fc: FcRow;
  title: string;
  message: string;
  payloadType: Payload['type'];
  targetRole: 'admin' | 'fc';
  targetResidentId: string | null;
}) {
  const { fc, title, message, payloadType, targetRole, targetResidentId } = params;
  const category = payloadType;

  const insertPayload = {
    title,
    body: message,
    category,
    fc_id: fc.id,
    resident_id: targetResidentId,
    recipient_role: targetRole,
  };

  const { error } = await supabase.from('notifications').insert(insertPayload);
  if (error) {
    console.error('notifications insert failed', error.message);
  }
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

  // fc_update: FC가 올린 것을 관리자에게
  if (msg.includes('기본') || msg.includes('정보')) return `${name} 기본 정보 업데이트`;
  if (msg.includes('temp')) return `${name}의 임시번호 안내`;
  if (msg.includes('서류') || msg.includes('업로드') || msg.includes('upload')) {
    const parts = message?.split(' ') ?? [];
    const docName = parts.length > 1 ? parts[1].replace(/[:,]/g, '') : '서류';
    return `${name} ${docName} 제출`;
  }
  return `${name} 업데이트`;
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: Payload;
  try {
    body = await req.json();
    console.log('[fc-notify] payload', body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body?.fc_id) {
    return new Response('fc_id required', { status: 400 });
  }

  // FC 정보 조회
  const { data: fc, error: fcError } = await supabase
    .from('fc_profiles')
    .select('id,name,resident_id_masked,phone')
    .eq('id', body.fc_id)
    .maybeSingle();
  if (fcError || !fc) {
    return new Response('fc not found', { status: 404 });
  }
  const fcRow = fc as FcRow;

  // 대상/토큰 결정
  const targetRole: 'admin' | 'fc' = body.type === 'admin_update' ? 'fc' : 'admin';
  const targetResidentId = targetRole === 'fc' ? sanitize(fcRow.phone) : null;
  console.log('[fc-notify] targetRole', targetRole, 'targetResidentId', targetResidentId, 'phoneRaw', fcRow.phone);

  let tokens: TokenRow[] = [];
  if (body.type === 'fc_update') {
    // FC가 입력/업로드 -> 관리자 전체
    const { data, error } = await supabase
      .from('device_tokens')
      .select('expo_push_token,resident_id,display_name')
      .eq('role', 'admin');
    if (error) return new Response(error.message, { status: 500 });
    tokens = data ?? [];
  } else {
    // 관리자가 FC 업데이트 -> 해당 FC (resident_id 매칭)
    if (!targetResidentId) return new Response('FC phone number not found', { status: 400 });
    const { data, error } = await supabase
      .from('device_tokens')
      .select('expo_push_token,resident_id,display_name')
      .eq('role', 'fc')
      .eq('resident_id', targetResidentId);
    if (error) return new Response(error.message, { status: 500 });
    tokens = data ?? [];
  }
  console.log('[fc-notify] tokens found', tokens.length, tokens);

  const title = buildTitle(fcRow.name, body, body.message);
  const message = body.message ?? title;
  const targetUrl = getTargetUrl(targetRole, body, message, fcRow.id);

  // DB 기록
  await logNotification({ fc: fcRow, title, message, payloadType: body.type, targetRole, targetResidentId });

  // 푸시 전송
  if (!tokens.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0, logged: true }), { status: 200 });
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
  }));

  const resp = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await resp.json();
  console.log('[fc-notify] push response', result);

  return new Response(JSON.stringify({ ok: true, sent: tokens.length, logged: true, result, targetResidentId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
