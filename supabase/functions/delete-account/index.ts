import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = {
  residentId?: string;
  residentMask?: string;
  fcId?: string;
};

type FcProfileRow = {
  id: string;
  phone: string | null;
};

type FcDocumentRow = {
  storage_path: string | null;
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

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

async function ignoreMissingTable<T>(result: { error: any; data?: T }) {
  if (result.error?.code === '42P01') {
    return { data: result.data };
  }
  if (result.error) {
    throw result.error;
  }
  return result;
}

function formatPhone(digits: string) {
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

async function pickProfileByEq(
  column: 'id' | 'phone' | 'resident_id_masked',
  value: string,
): Promise<FcProfileRow | null> {
  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id,phone')
    .eq(column, value)
    .limit(1);

  if (error) {
    throw error;
  }

  const list = (data ?? []) as FcProfileRow[];
  return list[0] ?? null;
}

async function resolveProfile(payload: Payload): Promise<FcProfileRow | null> {
  const rawResident = String(payload.residentId ?? '').trim();
  const residentMask = String(payload.residentMask ?? '').trim();
  const rawFcId = String(payload.fcId ?? '').trim();
  const residentDigits = cleanPhone(rawResident);

  if (rawFcId) {
    const byId = await pickProfileByEq('id', rawFcId);
    if (byId) return byId;
  }

  if (residentDigits) {
    const byPhoneDigits = await pickProfileByEq('phone', residentDigits);
    if (byPhoneDigits) return byPhoneDigits;
  }

  if (rawResident && rawResident !== residentDigits) {
    const byPhoneRaw = await pickProfileByEq('phone', rawResident);
    if (byPhoneRaw) return byPhoneRaw;
  }

  if (residentMask) {
    const byMask = await pickProfileByEq('resident_id_masked', residentMask);
    if (byMask) return byMask;
  }

  if (rawResident && rawResident.includes('-')) {
    const byMaskRaw = await pickProfileByEq('resident_id_masked', rawResident);
    if (byMaskRaw) return byMaskRaw;
  }

  return null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return err('Method not allowed', 405);
  }
  if (!supabaseUrl || !serviceKey) {
    return err('Server misconfigured: missing Supabase credentials', 500);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON', 400);
  }

  const residentIdRaw = String(body.residentId ?? '').trim();
  const residentMask = String(body.residentMask ?? '').trim();
  const fcIdFromBody = String(body.fcId ?? '').trim();
  const residentIdDigits = cleanPhone(residentIdRaw);

  if (!residentIdRaw && !residentMask && !fcIdFromBody) {
    return err('residentId or fcId required', 400);
  }

  let profile: FcProfileRow | null = null;
  try {
    profile = await resolveProfile(body);
  } catch (profileError) {
    const message = profileError instanceof Error ? profileError.message : 'Profile lookup failed';
    return err(message, 500);
  }

  if (!profile?.id) {
    return err('FC profile not found', 404);
  }

  const fcId = profile.id;
  const residentId = cleanPhone(profile.phone ?? '') || residentIdDigits;
  const residentIdMasked = formatPhone(residentId);

  const docsResult = await ignoreMissingTable(
    await supabase.from('fc_documents').select('storage_path').eq('fc_id', fcId),
  );
  const paths = ((docsResult.data ?? []) as FcDocumentRow[]).map((doc) => doc.storage_path).filter(Boolean) as string[];
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('fc-documents').remove(paths);
    if (storageError) {
      console.warn('storage remove failed', storageError.message ?? storageError);
    }
  }

  await ignoreMissingTable(await supabase.from('fc_documents').delete().eq('fc_id', fcId));

  await ignoreMissingTable(
    await supabase.from('messages').delete().or(`sender_id.eq.${residentId},receiver_id.eq.${residentId}`),
  );

  await ignoreMissingTable(
    await supabase
      .from('exam_registrations')
      .delete()
      .or(`resident_id.eq.${residentId},resident_id.eq.${residentIdMasked}`),
  );
  await ignoreMissingTable(
    await supabase.from('notifications').delete().or(`resident_id.eq.${residentId},fc_id.eq.${fcId}`),
  );
  await ignoreMissingTable(await supabase.from('device_tokens').delete().eq('resident_id', residentId));
  await ignoreMissingTable(await supabase.from('web_push_subscriptions').delete().eq('resident_id', residentId));
  await ignoreMissingTable(await supabase.from('fc_identity_secure').delete().eq('fc_id', fcId));

  const { error: profileDeleteError } = await supabase.from('fc_profiles').delete().eq('id', fcId);
  if (profileDeleteError) return err(profileDeleteError.message, 500);

  return ok({ ok: true, deleted: true });
});
