import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getEnv,
  parseAppSessionToken,
} from '../_shared/request-board-auth.ts';

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

function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

function maskPhone(phone: string): string {
  const cleaned = (phone ?? '').replace(/[^0-9]/g, '');
  if (cleaned.length === 11) {
    return `${cleaned.slice(0, 3)}-****-${cleaned.slice(7)}`;
  }
  if (cleaned.length > 4) {
    return `${cleaned.slice(0, 3)}-****`;
  }
  return '';
}

type SessionPayload = Awaited<ReturnType<typeof parseAppSessionToken>>;

async function resolveMyInvitees(params: { session: SessionPayload }) {
  const session = params.session;
  if (!session || (session.role !== 'fc' && session.role !== 'manager')) {
    return fail('forbidden', '초대 목록을 조회할 수 없는 계정입니다.');
  }

  const sessionPhone = cleanPhone(session.phone ?? '');
  if (sessionPhone.length !== 11) {
    return fail('unauthorized', '인증이 필요합니다.');
  }

  // Check if phone belongs to admin_accounts
  const { data: adminAccount, error: adminError } = await supabase
    .from('admin_accounts')
    .select('id')
    .eq('phone', sessionPhone)
    .maybeSingle();
  if (adminError) {
    return json({ ok: false, code: 'db_error', message: adminError.message }, 500);
  }
  if (adminAccount) {
    return fail('forbidden', '초대 목록을 조회할 수 없는 계정입니다.');
  }

  const sessionFcId = String(session.fcId ?? '').trim();
  const profileQuery = supabase
    .from('fc_profiles')
    .select('id, phone, affiliation, signup_completed');

  const profileResult = sessionFcId
    ? await profileQuery.eq('id', sessionFcId).maybeSingle()
    : await profileQuery.eq('phone', sessionPhone).eq('signup_completed', true).maybeSingle();
  const { data: profile, error: profileError } = profileResult;

  if (profileError) {
    return json({ ok: false, code: 'db_error', message: profileError.message }, 500);
  }
  if (!profile?.id) {
    return fail('not_found', '계정을 찾을 수 없습니다.');
  }

  if (cleanPhone(String(profile.phone ?? '')) !== sessionPhone) {
    return fail('unauthorized', '인증이 필요합니다.');
  }
  if (profile.signup_completed !== true) {
    return fail('not_found', '계정을 찾을 수 없습니다.');
  }

  const affiliation = String(profile.affiliation ?? '');
  if (affiliation.includes('설계매니저')) {
    return fail('forbidden', '초대 목록을 조회할 수 없는 계정입니다.');
  }

  // Query referral_attributions where inviter_fc_id = profile.id
  const { data: attributions, error: attrError } = await supabase
    .from('referral_attributions')
    .select('id, invitee_fc_id, invitee_phone, status, captured_at, confirmed_at')
    .eq('inviter_fc_id', profile.id)
    .order('captured_at', { ascending: false })
    .limit(50);

  if (attrError) {
    return json({ ok: false, code: 'db_error', message: attrError.message }, 500);
  }

  const rows = attributions ?? [];

  // Collect invitee_fc_ids to batch-fetch fc_profiles
  const inviteeFcIds = rows
    .map(r => r.invitee_fc_id)
    .filter((id): id is string => Boolean(id));

  let fcProfileMap: Record<string, { name: string; phone: string }> = {};
  if (inviteeFcIds.length > 0) {
    const { data: fcProfiles, error: fcProfilesError } = await supabase
      .from('fc_profiles')
      .select('id, name, phone')
      .in('id', inviteeFcIds);

    if (fcProfilesError) {
      return json({ ok: false, code: 'db_error', message: fcProfilesError.message }, 500);
    }

    for (const p of fcProfiles ?? []) {
      fcProfileMap[p.id] = { name: p.name, phone: p.phone };
    }
  }

  const invitees = rows.map(r => {
    const fcProfile = r.invitee_fc_id ? fcProfileMap[r.invitee_fc_id] : null;

    // Determine phone: prefer invitee_phone column, fallback to fc_profiles.phone
    const rawPhone = r.invitee_phone ?? fcProfile?.phone ?? '';
    const maskedPhone = maskPhone(rawPhone);

    return {
      id: r.id,
      inviteeName: fcProfile?.name ?? null,
      inviteePhone: maskedPhone,
      status: r.status,
      capturedAt: r.captured_at,
      confirmedAt: r.confirmed_at ?? null,
    };
  });

  return json({ ok: true, invitees });
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

  // Verify session token from Authorization header
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) {
    return fail('unauthorized', '인증이 필요합니다.');
  }

  const token = bearerMatch[1];
  const session = await parseAppSessionToken(token);
  if (!session) {
    return fail('unauthorized', '인증이 필요합니다.');
  }

  return resolveMyInvitees({ session });
});
