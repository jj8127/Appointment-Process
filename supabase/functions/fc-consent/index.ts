// eslint-disable-next-line import/no-unresolved
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// eslint-disable-next-line import/no-unresolved
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = {
  phone?: string;
  allowance_date?: string;
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

function isValidYmd(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, message: 'Method not allowed' }, 405);
  }
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, message: 'Missing Supabase credentials' }, 500);
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return json({ ok: false, message: 'Invalid JSON' }, 400);
  }

  const phone = cleanPhone(body.phone ?? '');
  if (phone.length !== 11) {
    return json({ ok: false, message: 'Phone number must be 11 digits.' }, 400);
  }

  const allowanceDate = (body.allowance_date ?? '').trim();
  if (!allowanceDate || !isValidYmd(allowanceDate)) {
    return json({ ok: false, message: 'Invalid allowance date.' }, 400);
  }

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id,name,temp_id')
    .eq('phone', phone)
    .maybeSingle();

  if (profileError) {
    return json({ ok: false, message: profileError.message }, 500);
  }
  if (!profile?.id) {
    return json({ ok: false, message: 'Profile not found.' }, 404);
  }
  if (!profile?.temp_id) {
    return json({ ok: false, message: '임시사번이 발급된 후 수당 동의일을 입력할 수 있습니다.' });
  }

  const { data: updated, error: updateError } = await supabase
    .from('fc_profiles')
    .update({
      allowance_date: allowanceDate,
      status: 'allowance-pending',
      allowance_reject_reason: null,
    })
    .eq('id', profile.id)
    .select('id')
    .maybeSingle();

  if (updateError) {
    return json({ ok: false, message: updateError.message }, 500);
  }
  if (!updated?.id) {
    return json({ ok: false, message: 'Failed to save allowance date.' }, 500);
  }

  return json({
    ok: true,
    profile: { id: profile.id, name: profile.name ?? '' },
  });
});
