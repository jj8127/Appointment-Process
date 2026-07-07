import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import {
  getAppSessionTokenFromRequest,
  getEnv,
  parseAppSessionToken,
  parseDesignerCompanyNameFromAffiliation,
} from '../_shared/request-board-auth.ts';

type RequestBody = {
  expoPushToken?: string;
  platform?: string;
  displayName?: string | null;
};

type DeviceTokenRole = 'admin' | 'fc' | 'manager';

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}

if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceKey);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(code: string, message: string, status = 400) {
  return json({ ok: false, code, message }, status);
}

function cleanPhone(input: string | null | undefined) {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

function cleanString(input: unknown, maxLength: number) {
  const value = typeof input === 'string' ? input.trim() : '';
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

async function resolveDeviceTokenOwner(session: NonNullable<Awaited<ReturnType<typeof parseAppSessionToken>>>) {
  const residentId = cleanPhone(session.phone);
  if (residentId.length !== 11) {
    return { ok: false as const, status: 401, code: 'invalid_phone', message: 'Invalid session phone' };
  }

  if (session.role === 'admin') {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('phone,active,name,staff_type')
      .eq('phone', residentId)
      .maybeSingle();
    if (error) return { ok: false as const, status: 500, code: 'db_error', message: error.message };
    if (!data?.phone || !data.active) return { ok: false as const, status: 403, code: 'forbidden', message: 'Forbidden' };
    return {
      ok: true as const,
      residentId,
      role: 'admin' as DeviceTokenRole,
      displayName: cleanString(data.name, 120),
    };
  }

  if (session.role === 'manager') {
    const { data, error } = await supabase
      .from('manager_accounts')
      .select('phone,active,name')
      .eq('phone', residentId)
      .maybeSingle();
    if (error) return { ok: false as const, status: 500, code: 'db_error', message: error.message };
    if (!data?.phone || !data.active) return { ok: false as const, status: 403, code: 'forbidden', message: 'Forbidden' };
    return {
      ok: true as const,
      residentId,
      role: 'manager' as DeviceTokenRole,
      displayName: cleanString(data.name, 120),
    };
  }

  const { data, error } = await supabase
    .from('fc_profiles')
    .select('phone,name,signup_completed,affiliation')
    .eq('phone', residentId)
    .maybeSingle();
  if (error) return { ok: false as const, status: 500, code: 'db_error', message: error.message };
  if (!data?.phone || !data.signup_completed) {
    return { ok: false as const, status: 403, code: 'forbidden', message: 'Forbidden' };
  }

  const designerCompany = parseDesignerCompanyNameFromAffiliation(data.affiliation);
  return {
    ok: true as const,
    residentId,
    role: designerCompany ? 'manager' as DeviceTokenRole : 'fc' as DeviceTokenRole,
    displayName: cleanString(data.name, 120),
  };
}

async function requireOwner(req: Request) {
  const token = getAppSessionTokenFromRequest(req);
  if (!token) {
    return { ok: false as const, status: 401, code: 'missing_session_token', message: 'Missing session token' };
  }

  const session = await parseAppSessionToken(token);
  if (!session) {
    return { ok: false as const, status: 401, code: 'invalid_session_token', message: 'Invalid session token' };
  }

  return resolveDeviceTokenOwner(session);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return fail('method_not_allowed', 'Method not allowed', 405);
  }

  const owner = await requireOwner(req);
  if (!owner.ok) {
    return fail(owner.code, owner.message, owner.status);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return fail('invalid_json', 'Invalid JSON');
  }

  const expoPushToken = cleanString(body.expoPushToken, 512);
  if (!expoPushToken) {
    return fail('missing_push_token', 'Expo push token is required');
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('device_tokens')
      .delete()
      .eq('expo_push_token', expoPushToken)
      .eq('resident_id', owner.residentId);
    if (error) return fail('db_error', error.message, 500);
    return json({ ok: true });
  }

  const platform = cleanString(body.platform, 32) || 'unknown';
  const displayName = cleanString(body.displayName, 120) || owner.displayName || null;
  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      {
        expo_push_token: expoPushToken,
        role: owner.role,
        resident_id: owner.residentId,
        display_name: displayName,
        platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' },
    );

  if (error) return fail('db_error', error.message, 500);
  return json({ ok: true, role: owner.role });
});
