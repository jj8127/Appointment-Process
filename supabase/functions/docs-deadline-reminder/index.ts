import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type FcRow = {
  id: string;
  name: string | null;
  phone: string | null;
  docs_deadline_at: string | null;
  docs_deadline_last_notified_at: string | null;
  status: string | null;
};

type TokenRow = { expo_push_token: string; resident_id: string | null; display_name: string | null };
type NotificationInsert = {
  title: string;
  body: string;
  category: string;
  target_url?: string | null;
  fc_id?: string | null;
  resident_id?: string | null;
  recipient_role?: string | null;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEADLINE_HOUR_KST = 18;
const REMINDER_DAYS = new Set([3, 1, 0, -1]);

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

const sanitize = (v?: string | null) => (v ?? '').replace(/[^0-9]/g, '');

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const getKstDateString = (date: Date) => {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 10);
};

const toKstDate = (dateStr: string) => new Date(`${dateStr}T00:00:00+09:00`);
const toKstDateTime = (dateStr: string, hour: number, minute = 0) =>
  new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`);
const formatDateKorean = (dateStr: string) => dateStr.replace(/-/g, '. ') + '.';

async function insertNotificationWithFallback(payload: NotificationInsert) {
  const withTarget = {
    ...payload,
    target_url: payload.target_url ?? null,
  };

  const firstTry = await supabase.from('notifications').insert(withTarget);
  if (!firstTry.error) return null;

  const missingTargetColumn =
    firstTry.error.code === '42703' || String(firstTry.error.message ?? '').includes('target_url');
  if (!missingTargetColumn) return firstTry.error;

  const { target_url: _ignored, ...fallbackPayload } = withTarget;
  const secondTry = await supabase.from('notifications').insert(fallbackPayload);
  return secondTry.error ?? null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const now = new Date();
  const today = getKstDateString(now);
  const startDateObj = new Date(now.getTime() + KST_OFFSET_MS);
  startDateObj.setDate(startDateObj.getDate() - 1);
  const startDate = startDateObj.toISOString().slice(0, 10);
  const endDateObj = new Date(now.getTime() + KST_OFFSET_MS);
  endDateObj.setDate(endDateObj.getDate() + 3);
  const endDate = endDateObj.toISOString().slice(0, 10);

  const { data: targets, error } = await supabase
    .from('fc_profiles')
    .select('id,name,phone,docs_deadline_at,docs_deadline_last_notified_at,status')
    .gte('docs_deadline_at', startDate)
    .lte('docs_deadline_at', endDate)
    .or(`docs_deadline_last_notified_at.is.null,docs_deadline_last_notified_at.lt.${today}`)
    .in('status', ['docs-requested', 'docs-pending', 'docs-submitted', 'docs-rejected']);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const rows = (targets ?? []) as FcRow[];
  let sent = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.docs_deadline_at) continue;
    const residentId = sanitize(row.phone);
    const deadlineDate = toKstDate(row.docs_deadline_at);
    const deadlineDateTime = toKstDateTime(row.docs_deadline_at, DEADLINE_HOUR_KST);
    const todayDate = toKstDate(today);
    const daysLeft = Math.round((deadlineDate.getTime() - todayDate.getTime()) / MS_PER_DAY);
    if (!REMINDER_DAYS.has(daysLeft)) continue;

    const title = '서류 마감 안내';
    let body = '';
    if (daysLeft === 3) {
      body = `서류 마감이 ${formatDateKorean(row.docs_deadline_at)} 18:00입니다. 미리 제출해주세요. (D-3)`;
    } else if (daysLeft === 1) {
      body = `서류 마감이 내일(${formatDateKorean(row.docs_deadline_at)} 18:00)입니다. 제출을 완료해주세요.`;
    } else if (daysLeft === 0) {
      body =
        now.getTime() < deadlineDateTime.getTime()
          ? '오늘 18:00이 서류 마감입니다. 마감 전 제출을 완료해주세요.'
          : '오늘 18:00 서류 마감 시간이 지났습니다. 즉시 관리자에게 문의해주세요.';
    } else {
      body = `서류 마감(${formatDateKorean(row.docs_deadline_at)} 18:00)이 지났습니다. 즉시 관리자에게 문의해주세요.`;
    }

    const logError = await insertNotificationWithFallback({
      title,
      body,
      category: 'docs-deadline',
      target_url: '/docs-upload',
      fc_id: row.id,
      resident_id: residentId || null,
      recipient_role: 'fc',
    });
    if (logError) {
      errors.push(`notifications insert failed for ${row.id}: ${logError.message}`);
      continue;
    }

    const { data: tokens, error: tokenError } = await supabase
      .from('device_tokens')
      .select('expo_push_token,resident_id,display_name')
      .eq('role', 'fc')
      .eq('resident_id', residentId);

    if (tokenError) {
      errors.push(`device_tokens fetch failed for ${row.id}: ${tokenError.message}`);
    }

    if (tokens?.length) {
      const payload = (tokens as TokenRow[]).map((t) => ({
        to: t.expo_push_token,
        title,
        body,
        data: { url: '/docs-upload' },
        sound: 'default',
        priority: 'high',
        channelId: 'alerts',
      }));

      const resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      try {
        await resp.json();
        sent += tokens.length;
      } catch {
        // Ignore Expo response parse errors; logs still saved.
      }
    }

    const { error: updateError } = await supabase
      .from('fc_profiles')
      .update({ docs_deadline_last_notified_at: today })
      .eq('id', row.id);
    if (updateError) {
      errors.push(`deadline update failed for ${row.id}: ${updateError.message}`);
    }
  }

  return new Response(JSON.stringify({ ok: true, total: rows.length, sent, errors }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
});
