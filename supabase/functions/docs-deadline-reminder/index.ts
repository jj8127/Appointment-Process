import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  classifyExpoPushDelivery,
  mergeExpoPushDeliverySummaries,
  type ExpoPushDeliverySummary,
} from '../_shared/expo-push-delivery.ts';

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
const EXPO_PUSH_CHUNK_SIZE = 100;
const EXPO_PUSH_TIMEOUT_MS = 10_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEADLINE_HOUR_KST = 18;
const REMINDER_DAYS = new Set([3, 1, 0, -1]);
const REMINDER_CATEGORY = 'docs-deadline';

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

function constantTimeTextEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

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

const getKstDayBounds = (dateStr: string) => {
  const start = toKstDate(dateStr);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + MS_PER_DAY).toISOString(),
  };
};

type ReminderWarningCounts = {
  notification_log_lookup_failed: number;
  notification_log_failed: number;
  token_lookup_failed: number;
  no_registered_tokens: number;
  provider_delivery_not_accepted: number;
  provider_ticket_rejected: number;
  deadline_update_failed: number;
};

const createWarningCounts = (): ReminderWarningCounts => ({
  notification_log_lookup_failed: 0,
  notification_log_failed: 0,
  token_lookup_failed: 0,
  no_registered_tokens: 0,
  provider_delivery_not_accepted: 0,
  provider_ticket_rejected: 0,
  deadline_update_failed: 0,
});

const summarizeWarnings = (counts: ReminderWarningCounts) =>
  Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([code, count]) => ({ code, count }));

async function sendExpoPushPayloads(
  pushPayload: Record<string, unknown>[],
): Promise<ExpoPushDeliverySummary> {
  const chunks: ExpoPushDeliverySummary[] = [];

  for (let index = 0; index < pushPayload.length; index += EXPO_PUSH_CHUNK_SIZE) {
    const chunk = pushPayload.slice(index, index + EXPO_PUSH_CHUNK_SIZE);
    try {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS),
      });
      const responseText = await resp.text().catch(() => '');
      let responseBody: unknown = null;
      try {
        responseBody = responseText ? JSON.parse(responseText) : null;
      } catch {
        responseBody = null;
      }
      chunks.push(classifyExpoPushDelivery(chunk.length, resp.status, responseBody));
    } catch {
      chunks.push(classifyExpoPushDelivery(chunk.length, 0, null));
    }
  }

  return mergeExpoPushDeliverySummaries(chunks);
}

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

async function hasNotificationForKstDay(input: {
  fcId: string;
  category: string;
  kstDate: string;
}) {
  const bounds = getKstDayBounds(input.kstDate);
  const { data, error } = await supabase
    .from('notifications')
    .select('id')
    .eq('fc_id', input.fcId)
    .eq('category', input.category)
    .gte('created_at', bounds.start)
    .lt('created_at', bounds.end)
    .limit(1);

  return {
    exists: Array.isArray(data) && data.length > 0,
    failed: Boolean(error),
  };
}

function cronAuthorizationFailure(req: Request): Response | null {
  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (!constantTimeTextEqual(authorization, `Bearer ${serviceKey}`)) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  return null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authorizationFailure = cronAuthorizationFailure(req);
  if (authorizationFailure) return authorizationFailure;

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
  const warningCounts = createWarningCounts();

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

    const existingNotification = await hasNotificationForKstDay({
      fcId: row.id,
      category: REMINDER_CATEGORY,
      kstDate: today,
    });
    if (existingNotification.failed) {
      warningCounts.notification_log_lookup_failed += 1;
      continue;
    }

    if (!existingNotification.exists) {
      const logError = await insertNotificationWithFallback({
        title,
        body,
        category: REMINDER_CATEGORY,
        target_url: '/docs-upload',
        fc_id: row.id,
        resident_id: residentId || null,
        recipient_role: 'fc',
      });
      if (logError) {
        warningCounts.notification_log_failed += 1;
        continue;
      }
    }

    const { data: tokens, error: tokenError } = await supabase
      .from('device_tokens')
      .select('expo_push_token,resident_id,display_name')
      .eq('role', 'fc')
      .eq('resident_id', residentId);

    if (tokenError) {
      warningCounts.token_lookup_failed += 1;
      continue;
    }

    if (!tokens?.length) {
      warningCounts.no_registered_tokens += 1;
      continue;
    }

    const payload = (tokens as TokenRow[]).map((t) => ({
      to: t.expo_push_token,
      title,
      body,
      data: { url: '/docs-upload' },
      sound: 'default',
      priority: 'high',
      channelId: 'alerts',
    }));
    const delivery = await sendExpoPushPayloads(payload);
    sent += delivery.accepted;
    warningCounts.provider_ticket_rejected += delivery.rejected;

    const deliveryConfirmed = delivery.attempted > 0
      && delivery.accepted === delivery.attempted
      && delivery.rejected === 0;
    if (!deliveryConfirmed) {
      warningCounts.provider_delivery_not_accepted += 1;
      continue;
    }

    const { error: updateError } = await supabase
      .from('fc_profiles')
      .update({ docs_deadline_last_notified_at: today })
      .eq('id', row.id);
    if (updateError) {
      warningCounts.deadline_update_failed += 1;
    }
  }

  const errors = summarizeWarnings(warningCounts);
  if (errors.length > 0) {
    console.warn('[docs-deadline-reminder] completed with retryable warnings', { errors });
  }

  return new Response(JSON.stringify({ ok: true, total: rows.length, sent, errors }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
});
