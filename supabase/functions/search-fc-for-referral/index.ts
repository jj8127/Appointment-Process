import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getEnv,
  requireAppSessionFromRequest,
  type AppSessionTokenPayload,
} from '../_shared/request-board-auth.ts';
import { ensureActiveReferralCode } from '../_shared/referral-code.ts';
import { buildReferralNameSearchPattern } from '../_shared/referral-search.ts';

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
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

type SessionPayload = AppSessionTokenPayload;

async function ensureManagerReferralShadowProfile(managerPhone: string, managerName?: string | null) {
  const { error } = await supabase.rpc('ensure_manager_referral_shadow_profile', {
    p_manager_phone: managerPhone,
    p_manager_name: typeof managerName === 'string' && managerName.trim() ? managerName.trim() : null,
  });

  return error;
}

async function resolveCallerFcId(session: SessionPayload): Promise<{ fcId: string; phone: string } | null> {
  if (!session || (session.role !== 'fc' && session.role !== 'manager' && session.role !== 'admin')) return null;
  const sessionPhone = cleanPhone(session.phone ?? '');
  if (sessionPhone.length !== 11) return null;

  const { data: admin } = await supabase.from('admin_accounts').select('id').eq('phone', sessionPhone).maybeSingle();
  if (admin) return null;

  let managerAccount: { id: string; name: string | null } | null = null;
  if (session.role === 'manager' || session.role === 'admin') {
    const { data: managerRow, error: managerError } = await supabase
      .from('manager_accounts')
      .select('id, name')
      .eq('phone', sessionPhone)
      .eq('active', true)
      .maybeSingle();
    if (managerError || !managerRow?.id) return null;
    managerAccount = managerRow;
  }

  const sessionFcId = String(session.fcId ?? '').trim();
  let profileResult = sessionFcId
    ? await supabase.from('fc_profiles').select('id, phone, affiliation, signup_completed, is_manager_referral_shadow').eq('id', sessionFcId).maybeSingle()
    : await supabase.from('fc_profiles').select('id, phone, affiliation, signup_completed, is_manager_referral_shadow').eq('phone', sessionPhone).maybeSingle();

  if (!profileResult.data?.id && managerAccount) {
    const ensureError = await ensureManagerReferralShadowProfile(sessionPhone, managerAccount.name);
    if (ensureError) return null;
    profileResult = await supabase
      .from('fc_profiles')
      .select('id, phone, affiliation, signup_completed, is_manager_referral_shadow')
      .eq('phone', sessionPhone)
      .maybeSingle();
  }

  const profile = profileResult.data;
  if (!profile?.id) return null;
  if (cleanPhone(String(profile.phone ?? '')) !== sessionPhone) return null;
  if (profile.signup_completed !== true && !(managerAccount && profile.is_manager_referral_shadow === true)) {
    return null;
  }
  if (String(profile.affiliation ?? '').includes('설계매니저')) return null;

  return { fcId: profile.id as string, phone: sessionPhone };
}

export type SearchResult = {
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 'Method not allowed', 405);

  const sessionResult = await requireAppSessionFromRequest(req);
  if (sessionResult.ok === false) return fail(sessionResult.code, sessionResult.message);

  const caller = await resolveCallerFcId(sessionResult.session);
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
  const nameSearchPattern = buildReferralNameSearchPattern(query);

  const addProfileResult = (profile: {
    id: string;
    name?: string | null;
    affiliation?: string | null;
    signup_completed?: boolean | null;
    is_manager_referral_shadow?: boolean | null;
  }) => {
    if (profile.id === caller.fcId) return;
    if (!isEligibleProfile(profile)) return;

    resultMap.set(profile.id, {
      fcId: profile.id,
      name: profile.name ?? '',
      affiliation: profile.affiliation ?? '',
      code: null,
    });
  };

  // ── Query 1: search fc_profiles by name only ──
  const { data: profileRows, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id, name, affiliation, signup_completed, is_manager_referral_shadow')
    .ilike('name', nameSearchPattern)
    .neq('id', caller.fcId)        // exclude self
    .not('affiliation', 'ilike', '%설계매니저%')
    .limit(LIMIT);

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }

  for (const p of profileRows ?? []) {
    addProfileResult(p);
  }

  // ── Query 2: search active manager_accounts by name only and backfill referral shadow/profile code ──
  const { data: managerRows, error: managerError } = await supabase
    .from('manager_accounts')
    .select('phone, name')
    .eq('active', true)
    .ilike('name', nameSearchPattern)
    .limit(LIMIT);

  if (managerError) {
    return json({ ok: false, code: 'db_error', message: managerError.message }, 500);
  }

  for (const manager of managerRows ?? []) {
    const managerPhone = cleanPhone(manager.phone ?? '');
    if (managerPhone.length !== 11) continue;

    const ensureError = await ensureManagerReferralShadowProfile(managerPhone, manager.name);
    if (ensureError) continue;

    const { data: managerProfile } = await supabase
      .from('fc_profiles')
      .select('id, name, affiliation, signup_completed, is_manager_referral_shadow')
      .eq('phone', managerPhone)
      .maybeSingle();

    if (managerProfile?.id) {
      addProfileResult(managerProfile);
    }
  }

  // ── Ensure and attach active referral codes to all results ──
  const allFcIds = Array.from(resultMap.keys());
  if (allFcIds.length > 0) {
    const actorRole = sessionResult.session.role === 'manager' ? 'manager' : 'fc';
    await Promise.allSettled(
      allFcIds.map((fcId) => ensureActiveReferralCode({
        supabase,
        fcId,
        actorPhone: caller.phone,
        actorRole,
        reason: 'auto_issue_on_referral_search',
      })),
    );

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

  const results = Array.from(resultMap.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .slice(0, LIMIT);

  return json({ ok: true, results });
});
