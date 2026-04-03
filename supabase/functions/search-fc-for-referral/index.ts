import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { getEnv, parseAppSessionToken } from '../_shared/request-board-auth.ts';

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
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
function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

type SessionPayload = Awaited<ReturnType<typeof parseAppSessionToken>>;

async function resolveCallerFcId(session: SessionPayload): Promise<{ fcId: string; phone: string } | null> {
  if (!session || (session.role !== 'fc' && session.role !== 'manager')) return null;
  const sessionPhone = cleanPhone(session.phone ?? '');
  if (sessionPhone.length !== 11) return null;

  const { data: admin } = await supabase.from('admin_accounts').select('id').eq('phone', sessionPhone).maybeSingle();
  if (admin) return null;

  const sessionFcId = String(session.fcId ?? '').trim();
  const profileResult = sessionFcId
    ? await supabase.from('fc_profiles').select('id, phone, affiliation, signup_completed').eq('id', sessionFcId).maybeSingle()
    : await supabase.from('fc_profiles').select('id, phone, affiliation, signup_completed').eq('phone', sessionPhone).eq('signup_completed', true).maybeSingle();

  const profile = profileResult.data;
  if (!profile?.id) return null;
  if (cleanPhone(String(profile.phone ?? '')) !== sessionPhone) return null;
  if (profile.signup_completed !== true) return null;
  if (String(profile.affiliation ?? '').includes('설계매니저')) return null;

  return { fcId: profile.id as string, phone: sessionPhone };
}

export type SearchResult = {
  fcId: string;
  name: string;
  affiliation: string;
  code: string | null;
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 'Method not allowed', 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) return fail('unauthorized', '인증이 필요합니다.');

  const session = await parseAppSessionToken(bearerMatch[1]);
  if (!session) return fail('unauthorized', '인증이 필요합니다.');

  const caller = await resolveCallerFcId(session);
  if (!caller) return fail('forbidden', '검색할 수 없는 계정입니다.');

  // Parse query
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

  // ── Query 1: search fc_profiles by name or affiliation ──
  const { data: profileRows, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id, name, affiliation')
    .eq('signup_completed', true)
    .or(`name.ilike.%${query}%,affiliation.ilike.%${query}%`)
    .neq('id', caller.fcId)        // exclude self
    .not('affiliation', 'ilike', '%설계매니저%')
    .limit(LIMIT);

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }

  for (const p of profileRows ?? []) {
    resultMap.set(p.id, {
      fcId: p.id,
      name: p.name ?? '',
      affiliation: p.affiliation ?? '',
      code: null,
    });
  }

  // ── Query 2: search referral_codes by code ──
  const { data: codeRows, error: codeError } = await supabase
    .from('referral_codes')
    .select('code, fc_id')
    .ilike('code', `%${query}%`)
    .eq('is_active', true)
    .neq('fc_id', caller.fcId)     // exclude self
    .limit(LIMIT);

  if (codeError) {
    return json({ ok: false, code: 'db_error', message: codeError.message }, 500);
  }

  // Collect fc_ids from code search that are not yet in the map
  const missingFcIds = (codeRows ?? [])
    .map(r => r.fc_id as string)
    .filter(id => id && !resultMap.has(id));

  if (missingFcIds.length > 0) {
    const { data: extraProfiles, error: extraError } = await supabase
      .from('fc_profiles')
      .select('id, name, affiliation')
      .in('id', missingFcIds)
      .eq('signup_completed', true)
      .not('affiliation', 'ilike', '%설계매니저%');

    if (!extraError) {
      for (const p of extraProfiles ?? []) {
        if (!resultMap.has(p.id)) {
          resultMap.set(p.id, {
            fcId: p.id,
            name: p.name ?? '',
            affiliation: p.affiliation ?? '',
            code: null,
          });
        }
      }
    }
  }

  // ── Attach active referral codes to all results ──
  const allFcIds = Array.from(resultMap.keys());
  if (allFcIds.length > 0) {
    const { data: activeCodes } = await supabase
      .from('referral_codes')
      .select('fc_id, code')
      .in('fc_id', allFcIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    // fc당 가장 최신 활성 코드만 사용 (order: desc → first match wins)
    const seenFcIds = new Set<string>();
    for (const row of activeCodes ?? []) {
      if (!seenFcIds.has(row.fc_id)) {
        seenFcIds.add(row.fc_id);
        const entry = resultMap.get(row.fc_id);
        if (entry) entry.code = row.code;
      }
    }
  }

  // ── Sort: name match first, then affiliation match, then code match ──
  const q = query.toLowerCase();
  const results = Array.from(resultMap.values())
    .sort((a, b) => {
      const aName = a.name.toLowerCase().includes(q) ? 0 : a.affiliation.toLowerCase().includes(q) ? 1 : 2;
      const bName = b.name.toLowerCase().includes(q) ? 0 : b.affiliation.toLowerCase().includes(q) ? 1 : 2;
      if (aName !== bName) return aName - bName;
      return a.name.localeCompare(b.name, 'ko');
    })
    .slice(0, LIMIT);

  return json({ ok: true, results });
});
