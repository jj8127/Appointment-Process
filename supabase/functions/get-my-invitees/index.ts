import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getEnv,
  getAppSessionTokenFromRequest,
  parseAppSessionToken,
} from '../_shared/request-board-auth.ts';

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
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

async function ensureManagerReferralShadowProfile(managerPhone: string, managerName?: string | null) {
  const { error } = await supabase.rpc('ensure_manager_referral_shadow_profile', {
    p_manager_phone: managerPhone,
    p_manager_name: typeof managerName === 'string' && managerName.trim() ? managerName.trim() : null,
  });

  return error;
}

async function resolveMyInvitees(params: { session: SessionPayload }) {
  const session = params.session;
  if (!session || (session.role !== 'fc' && session.role !== 'manager' && session.role !== 'admin')) {
    return fail('forbidden', '초대 목록을 조회할 수 없는 계정입니다.');
  }

  const sessionPhone = cleanPhone(session.phone ?? '');
  if (sessionPhone.length !== 11) {
    return fail('unauthorized', '인증이 필요합니다.');
  }

  let managerAccount: { id: string; name: string | null } | null = null;
  if (session.role === 'manager' || session.role === 'admin') {
    const { data: managerRow, error: managerError } = await supabase
      .from('manager_accounts')
      .select('id, name')
      .eq('phone', sessionPhone)
      .eq('active', true)
      .maybeSingle();
    if (managerError) {
      return json({ ok: false, code: 'db_error', message: managerError.message }, 500);
    }
    if (!managerRow?.id) {
      return fail('forbidden', '초대 목록을 조회할 수 없는 계정입니다.');
    }
    managerAccount = managerRow;
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
    .select('id, phone, affiliation, signup_completed, is_manager_referral_shadow');

  let profileResult = sessionFcId
    ? await profileQuery.eq('id', sessionFcId).maybeSingle()
    : await profileQuery.eq('phone', sessionPhone).maybeSingle();
  if (!profileResult.data?.id && managerAccount) {
    const ensureError = await ensureManagerReferralShadowProfile(sessionPhone, managerAccount.name);
    if (ensureError) {
      return json({ ok: false, code: 'db_error', message: ensureError.message }, 500);
    }

    profileResult = await profileQuery.eq('phone', sessionPhone).maybeSingle();
  }
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
  const isManagerShadow = profile.is_manager_referral_shadow === true;
  if (profile.signup_completed !== true && !(managerAccount && isManagerShadow)) {
    return fail('not_found', '계정을 찾을 수 없습니다.');
  }

  const affiliation = String(profile.affiliation ?? '');
  if (affiliation.includes('설계매니저')) {
    return fail('forbidden', '초대 목록을 조회할 수 없는 계정입니다.');
  }

  const [
    { data: attributions, error: attrError },
    { data: structuredInviteeProfiles, error: structuredInviteeError },
  ] = await Promise.all([
    supabase
      .from('referral_attributions')
      .select('id, invitee_fc_id, invitee_phone, status, captured_at, confirmed_at')
      .eq('inviter_fc_id', profile.id)
      .order('confirmed_at', { ascending: false, nullsFirst: false })
      .order('captured_at', { ascending: false }),
    supabase
      .from('fc_profiles')
      .select('id, name, phone, created_at, updated_at')
      .eq('recommender_fc_id', profile.id)
      .neq('id', profile.id)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
  ]);

  if (attrError) {
    return json({ ok: false, code: 'db_error', message: attrError.message }, 500);
  }

  if (structuredInviteeError) {
    return json({ ok: false, code: 'db_error', message: structuredInviteeError.message }, 500);
  }

  const rows = attributions ?? [];
  const structuredProfiles = structuredInviteeProfiles ?? [];
  const fcProfileMap: Record<string, { name: string | null; phone: string | null; createdAt: string | null; updatedAt: string | null }> = {};

  for (const profileRow of structuredProfiles) {
    fcProfileMap[profileRow.id] = {
      name: profileRow.name ?? null,
      phone: profileRow.phone ?? null,
      createdAt: profileRow.created_at ?? null,
      updatedAt: profileRow.updated_at ?? null,
    };
  }

  const missingInviteeFcIds = rows
    .map((row) => row.invitee_fc_id)
    .filter((id): id is string => Boolean(id) && !fcProfileMap[id]);

  if (missingInviteeFcIds.length > 0) {
    const { data: inviteeProfiles, error: inviteeProfilesError } = await supabase
      .from('fc_profiles')
      .select('id, name, phone, created_at, updated_at')
      .in('id', Array.from(new Set(missingInviteeFcIds)));

    if (inviteeProfilesError) {
      return json({ ok: false, code: 'db_error', message: inviteeProfilesError.message }, 500);
    }

    for (const profileRow of inviteeProfiles ?? []) {
      fcProfileMap[profileRow.id] = {
        name: profileRow.name ?? null,
        phone: profileRow.phone ?? null,
        createdAt: profileRow.created_at ?? null,
        updatedAt: profileRow.updated_at ?? null,
      };
    }
  }

  type InviteeRow = {
    id: string;
    inviteeName: string | null;
    inviteePhone: string;
    status: 'captured' | 'pending_signup' | 'confirmed' | 'rejected' | 'cancelled' | 'overridden';
    capturedAt: string;
    confirmedAt: string | null;
    sortTimestamp: number;
  };

  const inviteeMap = new Map<string, InviteeRow>();

  for (const row of rows) {
    const profileRow = row.invitee_fc_id ? fcProfileMap[row.invitee_fc_id] : null;
    const rawPhone = row.invitee_phone ?? profileRow?.phone ?? '';
    const key = row.invitee_fc_id
      ? `fc:${row.invitee_fc_id}`
      : `phone:${cleanPhone(rawPhone) || row.id}`;
    const sortValue = Date.parse(row.confirmed_at ?? row.captured_at ?? '') || 0;

    inviteeMap.set(key, {
      id: row.id,
      inviteeName: profileRow?.name ?? null,
      inviteePhone: maskPhone(rawPhone),
      status: row.status,
      capturedAt: row.captured_at,
      confirmedAt: row.confirmed_at ?? null,
      sortTimestamp: sortValue,
    });
  }

  for (const structuredProfile of structuredProfiles) {
    const key = `fc:${structuredProfile.id}`;
    const referenceDate = structuredProfile.updated_at ?? structuredProfile.created_at ?? new Date(0).toISOString();
    const sortValue = Date.parse(referenceDate) || 0;

    if (inviteeMap.has(key)) {
      const current = inviteeMap.get(key);
      if (current && !current.inviteeName && structuredProfile.name) {
        current.inviteeName = structuredProfile.name;
      }
      if (current && !current.inviteePhone && structuredProfile.phone) {
        current.inviteePhone = maskPhone(structuredProfile.phone);
      }
      if (current && current.status !== 'confirmed') {
        current.status = 'confirmed';
        current.confirmedAt = current.confirmedAt ?? referenceDate;
        current.sortTimestamp = Math.max(current.sortTimestamp, sortValue);
      }
      continue;
    }

    inviteeMap.set(key, {
      id: `profile:${structuredProfile.id}`,
      inviteeName: structuredProfile.name ?? null,
      inviteePhone: maskPhone(structuredProfile.phone ?? ''),
      status: 'confirmed',
      capturedAt: referenceDate,
      confirmedAt: referenceDate,
      sortTimestamp: sortValue,
    });
  }

  const invitees = Array.from(inviteeMap.values())
    .sort((a, b) => b.sortTimestamp - a.sortTimestamp)
    .map(({ sortTimestamp: _sortTimestamp, ...invitee }) => invitee);

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
  const token = getAppSessionTokenFromRequest(req);
  if (!token) {
    return fail('unauthorized', '인증이 필요합니다.');
  }
  const session = await parseAppSessionToken(token);
  if (!session) {
    return fail('unauthorized', '인증이 필요합니다.');
  }

  return resolveMyInvitees({ session });
});
