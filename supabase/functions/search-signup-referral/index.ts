import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { getEnv } from '../_shared/request-board-auth.ts';

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, serviceKey);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(code: string, message: string, status = 200) {
  return json({ ok: false, code, message }, status);
}

type RateLimitEntry = { count: number; resetAt: number };
const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;

function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count += 1;
  return true;
}

type SearchResult = {
  fcId: string;
  name: string;
  affiliation: string;
  code: string | null;
};

function isEligibleProfile(profile: {
  signup_completed?: boolean | null;
  is_manager_referral_shadow?: boolean | null;
  affiliation?: string | null;
}) {
  if (profile.signup_completed !== true && profile.is_manager_referral_shadow !== true) {
    return false;
  }

  return !String(profile.affiliation ?? '').includes('설계매니저');
}

function scoreResult(result: SearchResult, query: string) {
  const q = query.toLowerCase();
  const code = String(result.code ?? '').toLowerCase();
  const name = result.name.toLowerCase();
  const affiliation = result.affiliation.toLowerCase();

  if (code === q) return 0;
  if (name.includes(q)) return 1;
  if (affiliation.includes(q)) return 2;
  if (code.includes(q)) return 3;
  return 4;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'Method not allowed', 405);
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return fail('rate_limited', '잠시 후 다시 시도해주세요.');
  }

  let query = '';
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const parsed = JSON.parse(raw);
      query = typeof parsed?.query === 'string' ? parsed.query.trim() : '';
    }
  } catch {
    return fail('invalid_json', 'Invalid JSON');
  }

  if (query.length < 2) {
    return json({ ok: true, results: [] });
  }

  const LIMIT = 10;
  const resultMap = new Map<string, SearchResult>();

  const { data: profileRows, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id, name, affiliation, signup_completed, is_manager_referral_shadow')
    .or(`name.ilike.%${query}%,affiliation.ilike.%${query}%`)
    .limit(LIMIT);

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }

  for (const profile of profileRows ?? []) {
    if (!isEligibleProfile(profile)) continue;

    resultMap.set(profile.id, {
      fcId: profile.id,
      name: profile.name ?? '',
      affiliation: profile.affiliation ?? '',
      code: null,
    });
  }

  const { data: codeRows, error: codeError } = await supabase
    .from('referral_codes')
    .select('code, fc_id')
    .ilike('code', `%${query}%`)
    .eq('is_active', true)
    .limit(LIMIT);

  if (codeError) {
    return json({ ok: false, code: 'db_error', message: codeError.message }, 500);
  }

  const missingFcIds = (codeRows ?? [])
    .map((row) => row.fc_id as string)
    .filter((fcId) => fcId && !resultMap.has(fcId));

  if (missingFcIds.length > 0) {
    const { data: extraProfiles, error: extraProfilesError } = await supabase
      .from('fc_profiles')
      .select('id, name, affiliation, signup_completed, is_manager_referral_shadow')
      .in('id', missingFcIds);

    if (extraProfilesError) {
      return json({ ok: false, code: 'db_error', message: extraProfilesError.message }, 500);
    }

    for (const profile of extraProfiles ?? []) {
      if (!isEligibleProfile(profile)) continue;

      resultMap.set(profile.id, {
        fcId: profile.id,
        name: profile.name ?? '',
        affiliation: profile.affiliation ?? '',
        code: null,
      });
    }
  }

  const allFcIds = Array.from(resultMap.keys());
  if (allFcIds.length === 0) {
    return json({ ok: true, results: [] });
  }

  const { data: activeCodes, error: activeCodesError } = await supabase
    .from('referral_codes')
    .select('fc_id, code')
    .in('fc_id', allFcIds)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (activeCodesError) {
    return json({ ok: false, code: 'db_error', message: activeCodesError.message }, 500);
  }

  const seenFcIds = new Set<string>();
  for (const row of activeCodes ?? []) {
    if (seenFcIds.has(row.fc_id)) continue;

    const entry = resultMap.get(row.fc_id);
    if (!entry) continue;

    seenFcIds.add(row.fc_id);
    entry.code = row.code;
  }

  const results = Array.from(resultMap.values())
    .filter((result) => Boolean(result.code))
    .sort((left, right) => {
      const scoreDiff = scoreResult(left, query) - scoreResult(right, query);
      if (scoreDiff !== 0) return scoreDiff;
      return left.name.localeCompare(right.name, 'ko');
    })
    .slice(0, LIMIT);

  return json({ ok: true, results });
});
