import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import {
  authorizeDeleteAccountRequest,
  normalizeDeleteAccountPhone,
  type DeleteAccountRequestBody,
} from '../_shared/delete-account-auth.ts';
import { parseAppSessionTokenDetailed } from '../_shared/request-board-auth.ts';

type AccountDeleteResult = {
  deleted?: boolean;
  proof_paths?: unknown;
  document_paths?: unknown;
  board_attachment_paths?: unknown;
  chat_file_urls?: unknown;
  auth_user_ids?: unknown;
  cleanup_outbox_id?: unknown;
};

function getEnv(name: string): string | undefined {
  const runtime = globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  if (runtime.Deno?.env?.get) return runtime.Deno.env.get(name);
  return runtime.process?.env?.[name];
}

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin':
    allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-client-info, apikey, x-app-session-token, x-delete-account-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const internalSecret = getEnv('DELETE_ACCOUNT_INTERNAL_SECRET')?.trim() ?? '';
if (!supabaseUrl) throw new Error('Missing required environment variable: SUPABASE_URL');
if (!serviceKey) throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, serviceKey);

function ok(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function err(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? '').trim())
        .filter(Boolean),
    ),
  );
}

function extractChatUploadPath(fileUrl: string): string | null {
  const marker = '/chat-uploads/';
  const index = fileUrl.indexOf(marker);
  if (index < 0) return null;
  const path = (fileUrl.slice(index + marker.length).split('?')[0] ?? '')
    .replace(/^\/+/, '');
  return path || null;
}

async function removeStorageObjects(
  bucket: string,
  paths: string[],
  diagnostic:
    | {
        event: 'exam_payment_proof.storage';
        reason: 'storage_remove_failed';
      }
    | {
        event: 'delete_account.storage_cleanup';
        reason:
          | 'fc_documents_remove_failed'
          | 'board_attachments_remove_failed'
          | 'chat_uploads_remove_failed';
      },
) {
  if (paths.length === 0) return false;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) {
    reportEdgeDiagnostic({
      ...diagnostic,
      errorClass: 'upstream',
    });
  }
  return Boolean(error);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') return err('Method not allowed', 405);

  let payload: DeleteAccountRequestBody;
  try {
    payload = await req.json();
  } catch {
    return err('Invalid JSON', 400);
  }

  const authorizationHeader = req.headers.get('Authorization') ?? '';
  const isServiceRole = authorizationHeader === `Bearer ${serviceKey}`;
  let session = null;
  if (!isServiceRole) {
    const appSessionToken =
      String(payload.appSessionToken ?? '').trim()
      || String(req.headers.get('x-app-session-token') ?? '').trim();
    if (!appSessionToken) {
      return err('Unauthorized', 401);
    }
    const parsed = await parseAppSessionTokenDetailed(appSessionToken);
    if (parsed.ok === false) {
      return err('Unauthorized', 401);
    }
    session = parsed.payload;
  }

  const authorization = authorizeDeleteAccountRequest({
    body: payload,
    authorizationHeader,
    internalSecretHeader:
      req.headers.get('x-delete-account-internal-secret') ?? '',
    serviceRoleKey: serviceKey,
    internalSecret,
    session,
  });
  if (authorization.ok === false) {
    return err(authorization.code, authorization.status);
  }

  if (authorization.mode === 'fc_self') {
    const { data: selfProfile, error: selfProfileError } = await supabase
      .from('fc_profiles')
      .select('id,phone,is_manager_referral_shadow')
      .eq('id', authorization.targetId)
      .eq('is_manager_referral_shadow', false)
      .maybeSingle();
    if (selfProfileError) return err('Account lookup failed', 500);
    if (
      !selfProfile?.id
      || normalizeDeleteAccountPhone(selfProfile.phone)
        !== normalizeDeleteAccountPhone(session?.phone)
    ) {
      return err('self_delete_target_mismatch', 403);
    }
  }

  const { data, error } = await supabase.rpc(
    'delete_account_core_transaction_v1',
    {
      p_target_role: authorization.targetRole,
      p_target_id: authorization.targetId,
    },
  );
  if (error) {
    return err(error.message || 'Account deletion failed', 409);
  }

  const result = (data ?? {}) as AccountDeleteResult;
  const proofPaths = readStringArray(result.proof_paths);
  const documentPaths = readStringArray(result.document_paths);
  const boardPaths = readStringArray(result.board_attachment_paths);
  const chatPaths = readStringArray(result.chat_file_urls)
    .map(extractChatUploadPath)
    .filter((path): path is string => Boolean(path));
  const authUserIds = readStringArray(result.auth_user_ids);
  const cleanupOutboxId = String(result.cleanup_outbox_id ?? '').trim();

  const cleanupWarnings = await Promise.all([
    removeStorageObjects(
      'exam-payment-proofs',
      proofPaths,
      { event: 'exam_payment_proof.storage', reason: 'storage_remove_failed' },
    ),
    removeStorageObjects(
      'fc-documents',
      documentPaths,
      {
        event: 'delete_account.storage_cleanup',
        reason: 'fc_documents_remove_failed',
      },
    ),
    removeStorageObjects(
      'board-attachments',
      boardPaths,
      {
        event: 'delete_account.storage_cleanup',
        reason: 'board_attachments_remove_failed',
      },
    ),
    removeStorageObjects(
      'chat-uploads',
      chatPaths,
      {
        event: 'delete_account.storage_cleanup',
        reason: 'chat_uploads_remove_failed',
      },
    ),
  ]);

  let authCleanupWarning = false;
  for (const authUserId of authUserIds) {
    const { error: authError } = await supabase.auth.admin.deleteUser(authUserId);
    if (authError) {
      authCleanupWarning = true;
      reportEdgeDiagnostic({
        event: 'delete_account.auth_cleanup',
        reason: authorization.targetRole === 'manager'
          ? 'manager_shadow_auth_user_delete_failed'
          : 'auth_user_delete_failed',
        errorClass: 'authentication',
      });
    }
  }

  const postCommitCleanupFailed =
    cleanupWarnings.some(Boolean) || authCleanupWarning;
  const { error: outboxError } = cleanupOutboxId
    ? await supabase.rpc('record_account_deletion_cleanup_attempt_v1', {
      p_outbox_id: cleanupOutboxId,
      p_succeeded: !postCommitCleanupFailed,
      p_error_code: postCommitCleanupFailed
        ? 'post_commit_cleanup_partial_failure'
        : null,
    })
    : { error: new Error('cleanup_outbox_id_missing') };

  return ok({
    ok: true,
    role: authorization.targetRole,
    deleted: result.deleted === true,
    cleanupWarning: postCommitCleanupFailed || Boolean(outboxError),
  });
});
