import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { isTrustedFcNotifyServiceKey } from '../_shared/fc-notify-auth-policy.ts';
import {
  GARAMLINK_ATTACHMENT_BUCKET,
  GARAMLINK_ATTACHMENT_MAX_BYTES,
  GARAMLINK_SYNC_TIME_BUDGET_MS,
  garamLinkDeletionUrl,
  garamLinkExportUrl,
  isAllowedAttachmentUrl,
  parseGaramLinkCursor,
  parseGaramLinkDeletionCursor,
  parseGaramLinkDeletionResponse,
  parseGaramLinkExportResponse,
  prepareGaramLinkMessages,
  runCursorFeed,
  type CopyAttachment,
} from '../_shared/messenger-garamlink-sync.ts';

// Scheduled by pg_cron (request_messenger_garamlink_sync_v1) every 10 minutes.
// Only the exact service-role key in both apikey and Authorization is accepted.

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const exportUrl = Deno.env.get('REQUEST_BOARD_MESSENGER_EXPORT_URL') ?? '';
const exportToken = Deno.env.get('REQUEST_BOARD_MESSENGER_EXPORT_TOKEN') ?? '';
// GaramLink's Supabase URL; signed file links must point there.
const storageOrigin = Deno.env.get('REQUEST_BOARD_STORAGE_ORIGIN') ?? '';
const EXPORT_TIMEOUT_MS = 15_000;
const FILE_TIMEOUT_MS = 20_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (!isTrustedFcNotifyServiceKey(request.headers.get('apikey'), serviceKey)
    || !isTrustedFcNotifyServiceKey(bearer, serviceKey)) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }
  if (!supabaseUrl || !exportUrl || !exportToken || !storageOrigin) return json({ ok: false, error: 'not_configured' }, 503);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const deadline = Date.now() + GARAMLINK_SYNC_TIME_BUDGET_MS;

  const getJson = async (url: string) => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${exportToken}` },
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`garamlink_export_http_${response.status}`);
    return await response.json();
  };
  const readCursor = async (source: string) => {
    const { data, error } = await supabase
      .from('messenger_import_cursors')
      .select('cursor')
      .eq('source', source)
      .maybeSingle();
    if (error) throw new Error(`cursor_read_failed: ${error.message}`);
    return data?.cursor ?? null;
  };

  const copy: CopyAttachment = async (attachment, storagePath) => {
    if (!attachment.downloadUrl || !isAllowedAttachmentUrl(attachment.downloadUrl, storageOrigin)) return 'missing';
    const response = await fetch(attachment.downloadUrl, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
    if (response.status === 400 || response.status === 404) return 'missing';
    if (!response.ok) throw new Error(`garamlink_file_http_${response.status}`);
    if (Number(response.headers.get('content-length') ?? 0) > GARAMLINK_ATTACHMENT_MAX_BYTES) {
      await response.body?.cancel();
      return 'missing';
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > GARAMLINK_ATTACHMENT_MAX_BYTES) return 'missing';
    const { error } = await supabase.storage.from(GARAMLINK_ATTACHMENT_BUCKET).upload(storagePath, bytes, {
      contentType: attachment.fileType || 'application/octet-stream',
      upsert: true,
    });
    if (error) throw new Error(`file_upload_failed: ${error.message}`);
    return 'copied';
  };

  let stage = 'messages';
  try {
    let copied = 0;
    let missing = 0;
    const messages = await runCursorFeed({
      readCursor: async () => parseGaramLinkCursor(await readCursor('request_board')),
      fetchBatch: async (cursor) => parseGaramLinkExportResponse(await getJson(garamLinkExportUrl(exportUrl, cursor))),
      importBatch: async (batch, expected) => {
        const prepared = await prepareGaramLinkMessages(batch.messages, copy);
        copied += prepared.copied;
        missing += prepared.missing;
        const { data, error } = await supabase.rpc('messenger_import_request_board_batch_v1', {
          p_payload: { users: batch.users, messages: prepared.messages },
          p_expected_cursor: expected,
          p_next_cursor: batch.cursor,
        });
        if (error) throw new Error(`import_failed: ${error.message}`);
        return Number(data?.messages ?? 0) + Number(data?.attachments ?? 0);
      },
      cursorOf: (batch) => batch.cursor,
      sizeOf: (batch) => batch.messages.length,
      hasMore: (batch) => batch.hasMore,
    }, deadline);

    stage = 'deletions';
    const deletions = await runCursorFeed({
      readCursor: async () => parseGaramLinkDeletionCursor(await readCursor('request_board_deletions')),
      fetchBatch: async (cursor) => parseGaramLinkDeletionResponse(await getJson(garamLinkDeletionUrl(exportUrl, cursor))),
      importBatch: async (batch, expected) => {
        const { data, error } = await supabase.rpc('messenger_import_request_board_deletions_batch_v1', {
          p_deletions: batch.deletions,
          p_expected_cursor: expected,
          p_next_cursor: batch.cursor,
        });
        if (error) throw new Error(`import_failed: ${error.message}`);
        return Number(data?.deleted ?? 0);
      },
      cursorOf: (batch) => batch.cursor,
      sizeOf: (batch) => batch.deletions.length,
      hasMore: (batch) => batch.hasMore,
    }, deadline);

    return json({ ok: true, messages, deletions, files: { copied, missing } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    const source = stage === 'messages' ? 'request_board' : 'request_board_deletions';
    await supabase.rpc('messenger_import_record_error_v1', { p_source: source, p_error: message });
    return json({ ok: false, stage, error: message }, 502);
  }
});
