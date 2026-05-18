import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

function getEnv(name: string): string | undefined {
  const g: unknown = globalThis;
  const g_ = g as { Deno?: { env?: { get?: (key: string) => string | undefined } }; process?: { env?: Record<string, string | undefined> } };
  if (g_?.Deno?.env?.get) return g_.Deno.env.get(name);
  if (g_?.process?.env) return g_.process.env[name];
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

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(code: string, message: string) {
  return json({ ok: false, code, message });
}

function cleanPhone(input: string): string {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

function isNormalizedPhone(input: string): boolean {
  return /^[0-9]{11}$/.test(input);
}

function isRequestBoardDesignerAffiliation(affiliation: unknown): boolean {
  return String(affiliation ?? '').includes('설계매니저');
}

// Rate limiting: IP -> { count, resetAt }
type RateLimitEntry = { count: number; resetAt: number };
const rate_limit_store = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10;

function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rate_limit_store.get(ip);

  if (!entry || now >= entry.resetAt) {
    rate_limit_store.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true; // allowed
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false; // blocked
  }

  entry.count += 1;
  return true; // allowed
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, phone.length - 4) + '****';
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405);
  }
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, code: 'server_misconfigured', message: 'Missing Supabase credentials' }, 500);
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return fail('rate_limited', '잠시 후 다시 시도해주세요.');
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('invalid_json', 'Invalid JSON');
  }

  const rawCode = String(body.code ?? '').trim().toUpperCase();
  if (!rawCode) {
    return json({ ok: true, valid: false, reason: 'not_found' });
  }

  const { data: referralCode, error } = await supabase
    .from('referral_codes')
    .select('id, code, is_active, fc_id')
    .eq('code', rawCode)
    .maybeSingle();

  if (error) {
    return json({ ok: false, code: 'db_error', message: error.message }, 500);
  }

  // Not found or inactive — same response to prevent enumeration
  if (!referralCode || referralCode.is_active !== true) {
    return json({ ok: true, valid: false, reason: 'not_found' });
  }

  // Fetch inviter profile
  const { data: inviterProfile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('name, phone, signup_completed, affiliation')
    .eq('id', referralCode.fc_id)
    .maybeSingle();

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }

  const inviterPhone = cleanPhone(inviterProfile?.phone ?? '');
  if (!inviterProfile || inviterProfile.signup_completed !== true || !isNormalizedPhone(inviterPhone)) {
    return json({ ok: true, valid: false, reason: 'not_found' });
  }

  if (isRequestBoardDesignerAffiliation(inviterProfile.affiliation)) {
    return json({ ok: true, valid: false, reason: 'not_found' });
  }

  const inviterName = inviterProfile?.name ?? '';
  const inviterPhoneMasked = maskPhone(inviterPhone);

  return json({
    ok: true,
    valid: true,
    inviterName,
    inviterPhoneMasked,
    inviterFcId: referralCode.fc_id,
    codeId: referralCode.id,
  });
});
