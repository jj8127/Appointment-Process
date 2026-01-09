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

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const getKstDateString = (date: Date) => {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 10);
};

const toKstDate = (dateStr: string) => new Date(`${dateStr}T00:00:00+09:00`);

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const today = getKstDateString(new Date());
  const startDateObj = new Date(Date.now() + KST_OFFSET_MS);
  startDateObj.setDate(startDateObj.getDate() - 7);
  const startDate = startDateObj.toISOString().slice(0, 10);

  const { data: targets, error } = await supabase
    .from('fc_profiles')
    .select('id,name,phone,docs_deadline_at,docs_deadline_last_notified_at,status')
    .gte('docs_deadline_at', startDate)
    .lte('docs_deadline_at', today)
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
    const todayDate = toKstDate(today);
    const daysLeft = Math.round((deadlineDate.getTime() - todayDate.getTime()) / MS_PER_DAY);

    const title = '서류 마감 안내';
    const body =
      daysLeft <= 0
        ? '오늘이 서류 마감일입니다. 제출 여부를 확인해주세요.'
        : `서류 마감까지 D-${daysLeft}입니다. 제출을 완료해주세요.`;

    const { error: logError } = await supabase.from('notifications').insert({
      title,
      body,
      category: 'docs-deadline',
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
