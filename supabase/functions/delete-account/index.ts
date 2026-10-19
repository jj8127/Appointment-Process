import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { drainAccountDeletionCleanup } from '../_shared/account-deletion-cleanup.ts';
import {
  authorizeDeleteAccountRequest,
  normalizeDeleteAccountPhone,
  type DeleteAccountRequestBody,
} from '../_shared/delete-account-auth.ts';
import { parseAppSessionTokenDetailed } from '../_shared/request-board-auth.ts';
import { fcRetirementBlockedResponse, retireFcBeforeAccountDeletion } from '../_shared/request-board-fc-retirement.ts';
import { requireAccountDeletionReceipt } from '../_shared/ux-mutation-contract.ts';

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
      return err(parsed.code === 'session_verification_unavailable' ? 'Session verification unavailable' : 'Unauthorized', parsed.status ?? 401);
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

  if (authorization.targetRole === 'fc') {
    const { data: fcProfile, error: fcProfileError } = await supabase
      .from('fc_profiles')
      .select('id,phone,is_manager_referral_shadow')
      .eq('id', authorization.targetId)
      .eq('is_manager_referral_shadow', false)
      .maybeSingle();
    if (fcProfileError) return err('Account lookup failed', 500);
    if (authorization.mode === 'fc_self' && (
      !fcProfile?.id
      || normalizeDeleteAccountPhone(fcProfile.phone)
        !== normalizeDeleteAccountPhone(session?.phone)
    )) {
      return err('self_delete_target_mismatch', 403);
    }
    if (!fcProfile?.id) return err('삭제할 계정을 찾을 수 없습니다.', 404);
    const retired = await retireFcBeforeAccountDeletion(fcProfile.id, fcProfile.phone);
    if (retired.ok === false) {
      const blocked = fcRetirementBlockedResponse(retired.reason);
      return err(blocked.message, blocked.status);
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
    return error.message === 'account_delete_target_not_found'
      ? err('삭제할 계정을 찾을 수 없습니다.', 404)
      : err('Account deletion failed', 500);
  }

  let result: ReturnType<typeof requireAccountDeletionReceipt>;
  try {
    result = requireAccountDeletionReceipt(data);
  } catch {
    return err('Account deletion result could not be verified', 500);
  }
  const cleanupWarning = await drainAccountDeletionCleanup(supabase, result, authorization.targetRole);

  return ok({
    ok: true,
    role: authorization.targetRole,
    deleted: result.deleted === true,
    cleanupWarning,
  });
});
