import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { isTrustedFcNotifyServiceKey } from '../_shared/fc-notify-auth-policy.ts';
import {
  garamLinkExportUrl,
  parseGaramLinkCursor,
  parseGaramLinkExportResponse,
  runGaramLinkSync,
} from '../_shared/messenger-garamlink-sync.ts';

// Scheduled by pg_cron (request_messenger_garamlink_sync_v1) every 10 minutes.
// Only the exact service-role key in both apikey and Authorization is accepted.

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const exportUrl = Deno.env.get('REQUEST_BOARD_MESSENGER_EXPORT_URL') ?? '';
const exportToken = Deno.env.get('REQUEST_BOARD_MESSENGER_EXPORT_TOKEN') ?? '';
const EXPORT_TIMEOUT_MS = 15_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (!isTrustedFcNotifyServiceKey(request.headers.get('apikey'), serviceKey)
    || !isTrustedFcNotifyServiceKey(bearer, serviceKey)) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }
  if (!supabaseUrl || !exportUrl || !exportToken) return json({ ok: false, error: 'not_configured' }, 503);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  try {
    const result = await runGaramLinkSync({
      readCursor: async () => {
        const { data, error } = await supabase
          .from('messenger_import_cursors')
          .select('cursor')
          .eq('source', 'request_board')
          .maybeSingle();
        if (error) throw new Error(`cursor_read_failed: ${error.message}`);
        return parseGaramLinkCursor(data?.cursor ?? null);
      },
      fetchBatch: async (cursor) => {
        const response = await fetch(garamLinkExportUrl(exportUrl, cursor), {
          headers: { Authorization: `Bearer ${exportToken}` },
          signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`garamlink_export_http_${response.status}`);
        return parseGaramLinkExportResponse(await response.json());
      },
      importBatch: async (payload, expected, next) => {
        const { data, error } = await supabase.rpc('messenger_import_request_board_batch_v1', {
          p_payload: payload,
          p_expected_cursor: expected,
          p_next_cursor: next,
        });
        if (error) throw new Error(`import_failed: ${error.message}`);
        return { users: Number(data?.users ?? 0), messages: Number(data?.messages ?? 0) };
      },
    });
    return json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    await supabase.rpc('messenger_import_record_error_v1', { p_source: 'request_board', p_error: message });
    return json({ ok: false, error: message }, 502);
  }
});
