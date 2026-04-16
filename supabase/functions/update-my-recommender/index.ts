import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  getEnv,
  requireAppSessionFromRequest,
  type AppSessionTokenPayload,
} from '../_shared/request-board-auth.ts';

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
type ConfirmedReferralRow = {
  id: string;
  invitee_fc_id: string | null;
};

function isUniqueViolation(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === '23505' || error.message?.toLowerCase().includes('duplicate key') === true;
}

async function ensureManagerReferralShadowProfile(managerPhone: string, managerName?: string | null) {
  const { error } = await supabase.rpc('ensure_manager_referral_shadow_profile', {
    p_manager_phone: managerPhone,
    p_manager_name: typeof managerName === 'string' && managerName.trim() ? managerName.trim() : null,
  });

  return error;
}

async function resolveSession(session: SessionPayload) {
  if (!session || (session.role !== 'fc' && session.role !== 'manager' && session.role !== 'admin')) {
    return { error: fail('forbidden', '추천인을 변경할 수 없는 계정입니다.') };
  }
  const sessionPhone = cleanPhone(session.phone ?? '');
  if (sessionPhone.length !== 11) {
    return { error: fail('invalid_app_session', '세션이 유효하지 않습니다. 다시 로그인해주세요.') };
  }

  const { data: adminRow } = await supabase.from('admin_accounts').select('id').eq('phone', sessionPhone).maybeSingle();
  if (adminRow) return { error: fail('forbidden', '추천인을 변경할 수 없는 계정입니다.') };

  let managerAccount: { id: string; name: string | null } | null = null;
  if (session.role === 'manager' || session.role === 'admin') {
    const { data: managerRow, error: managerError } = await supabase
      .from('manager_accounts')
      .select('id, name')
      .eq('phone', sessionPhone)
      .eq('active', true)
      .maybeSingle();
    if (managerError) return { error: json({ ok: false, code: 'db_error', message: managerError.message }, 500) };
    if (!managerRow?.id) return { error: fail('forbidden', '추천인을 변경할 수 없는 계정입니다.') };
    managerAccount = managerRow;
  }

  const sessionFcId = String(session.fcId ?? '').trim();
  const profileQuery = supabase.from('fc_profiles').select('id, phone, affiliation, signup_completed, is_manager_referral_shadow');
  let profileResult = sessionFcId
    ? await profileQuery.eq('id', sessionFcId).maybeSingle()
    : await profileQuery.eq('phone', sessionPhone).maybeSingle();

  if (!profileResult.data?.id && managerAccount) {
    const ensureError = await ensureManagerReferralShadowProfile(sessionPhone, managerAccount.name);
    if (ensureError) return { error: json({ ok: false, code: 'db_error', message: ensureError.message }, 500) };
    profileResult = await profileQuery.eq('phone', sessionPhone).maybeSingle();
  }

  const { data: profile, error: profileError } = profileResult;
  if (profileError) return { error: json({ ok: false, code: 'db_error', message: profileError.message }, 500) };
  if (!profile?.id) return { error: fail('not_found', '계정을 찾을 수 없습니다.') };
  if (cleanPhone(String(profile.phone ?? '')) !== sessionPhone) {
    return { error: fail('invalid_app_session', '세션이 유효하지 않습니다. 다시 로그인해주세요.') };
  }
  const isManagerShadow = profile.is_manager_referral_shadow === true;
  if (profile.signup_completed !== true && !(managerAccount && isManagerShadow)) {
    return { error: fail('not_found', '계정을 찾을 수 없습니다.') };
  }
  if (String(profile.affiliation ?? '').includes('설계매니저')) return { error: fail('forbidden', '추천인을 변경할 수 없는 계정입니다.') };

  return { profile: { id: profile.id as string, phone: sessionPhone } };
}

async function captureConfirmedAttribution(params: {
  inviteeFcId: string;
  inviteePhone: string;
  inviterFcId: string;
  inviterPhone: string;
  inviterName: string;
  referralCodeId: string;
  referralCode: string;
  now: string;
}) {
  const confirmedSelect = 'id, invitee_fc_id, confirmed_at, created_at';
  const { data: confirmedRowsByFc, error: confirmedLookupError } = await supabase
    .from('referral_attributions')
    .select(confirmedSelect)
    .eq('status', 'confirmed')
    .eq('invitee_fc_id', params.inviteeFcId)
    .order('confirmed_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (confirmedLookupError) {
    return { error: json({ ok: false, code: 'db_error', message: confirmedLookupError.message }, 500) };
  }

  const confirmedRows = (confirmedRowsByFc ?? []) as ConfirmedReferralRow[];
  const primaryConfirmed = confirmedRows[0] ?? null;
  const otherConfirmedIds = primaryConfirmed ? confirmedRows.slice(1).map((row) => row.id) : [];
  let attributionId = primaryConfirmed?.id ?? null;

  const confirmedPayload = {
    inviter_fc_id: params.inviterFcId,
    inviter_phone: params.inviterPhone,
    inviter_name: params.inviterName,
    invitee_fc_id: params.inviteeFcId,
    invitee_phone: params.inviteePhone,
    referral_code_id: params.referralCodeId,
    referral_code: params.referralCode,
    source: 'manual_entry',
    capture_source: 'manual_entry',
    selection_source: 'manual_entry_only',
    status: 'confirmed',
    cancelled_at: null,
    confirmed_at: params.now,
  };

  if (primaryConfirmed) {
    const { error: updateError } = await supabase
      .from('referral_attributions')
      .update(confirmedPayload)
      .eq('id', primaryConfirmed.id);
    if (updateError) {
      return { error: json({ ok: false, code: 'db_error', message: updateError.message }, 500) };
    }
  } else {
    const { data: insertedAttribution, error: insertError } = await supabase
      .from('referral_attributions')
      .insert({
        ...confirmedPayload,
        captured_at: params.now,
      })
      .select('id')
      .maybeSingle();

    if (insertError && !isUniqueViolation(insertError)) {
      return { error: json({ ok: false, code: 'db_error', message: insertError.message }, 500) };
    }

    if (isUniqueViolation(insertError)) {
      const { data: retriedRows, error: retryLookupError } = await supabase
        .from('referral_attributions')
        .select(confirmedSelect)
        .eq('status', 'confirmed')
        .eq('invitee_fc_id', params.inviteeFcId)
        .order('confirmed_at', { ascending: false })
        .order('created_at', { ascending: false });

      if (retryLookupError) {
        return { error: json({ ok: false, code: 'db_error', message: retryLookupError.message }, 500) };
      }

      const retryPrimary = ((retriedRows ?? []) as { id: string }[])[0];
      if (!retryPrimary?.id) {
        return { error: fail('attribution_insert_conflict', '추천인 이력을 저장하지 못했습니다.', 409) };
      }

      const { error: retryUpdateError } = await supabase
        .from('referral_attributions')
        .update(confirmedPayload)
        .eq('id', retryPrimary.id);
      if (retryUpdateError) {
        return { error: json({ ok: false, code: 'db_error', message: retryUpdateError.message }, 500) };
      }

      attributionId = retryPrimary.id;
    } else if (!insertedAttribution?.id) {
      return { error: fail('attribution_insert_missing_id', '추천인 이력을 저장하지 못했습니다.', 500) };
    } else {
      attributionId = insertedAttribution.id;
    }
  }

  if (otherConfirmedIds.length > 0) {
    const { error: overrideError } = await supabase
      .from('referral_attributions')
      .update({
        status: 'overridden',
        source: 'manual_entry',
        selection_source: 'manual_entry_only',
        cancelled_at: params.now,
      })
      .in('id', otherConfirmedIds);

    if (overrideError) {
      return { error: json({ ok: false, code: 'db_error', message: overrideError.message }, 500) };
    }
  }

  if (!attributionId) {
    return { error: fail('attribution_missing_id', '추천인 이력을 저장하지 못했습니다.', 500) };
  }

  return { attributionId };
}

async function insertReferralEvent(params: {
  attributionId: string;
  referralCodeId: string;
  referralCode: string;
  inviterFcId: string;
  inviterPhone: string;
  inviterName: string;
  inviteeFcId: string;
  inviteePhone: string;
}) {
  const { error } = await supabase
    .from('referral_events')
    .insert({
      attribution_id: params.attributionId,
      referral_code_id: params.referralCodeId,
      referral_code: params.referralCode,
      inviter_fc_id: params.inviterFcId,
      inviter_phone: params.inviterPhone,
      inviter_name: params.inviterName,
      invitee_fc_id: params.inviteeFcId,
      invitee_phone: params.inviteePhone,
      event_type: 'referral_confirmed',
      source: 'manual_entry',
      metadata: {
        captureSource: 'referral_self_service',
        selectionSource: 'manual_entry_only',
      },
    });

  return error;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 'Method not allowed', 405);

  const sessionResult = await requireAppSessionFromRequest(req);
  if (!sessionResult.ok) return fail(sessionResult.code, sessionResult.message);

  // Parse body
  let code = '';
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const parsed = JSON.parse(raw);
      code = typeof parsed?.code === 'string' ? parsed.code.trim().toUpperCase() : '';
    }
  } catch {
    return fail('invalid_json', 'Invalid JSON');
  }

  if (!code || code.length !== 8) {
    return fail('invalid_code', '추천 코드는 8자리입니다.');
  }

  // Resolve self profile
  const { profile, error: sessionError } = await resolveSession(sessionResult.session);
  if (sessionError) return sessionError;

  // Lookup referral code → inviter
  const { data: referralRow, error: codeError } = await supabase
    .from('referral_codes')
    .select('id, fc_id, is_active')
    .ilike('code', code)
    .maybeSingle();

  if (codeError) return json({ ok: false, code: 'db_error', message: codeError.message }, 500);
  if (!referralRow || !referralRow.is_active) {
    return fail('invalid_code', '유효하지 않은 추천 코드입니다.');
  }

  // Fetch inviter profile
  const { data: inviter, error: inviterError } = await supabase
    .from('fc_profiles')
    .select('id, name, phone, affiliation, signup_completed, is_manager_referral_shadow')
    .eq('id', referralRow.fc_id)
    .maybeSingle();

  if (inviterError) return json({ ok: false, code: 'db_error', message: inviterError.message }, 500);
  if (!inviter) return fail('invalid_code', '유효하지 않은 추천 코드입니다.');
  if (inviter.signup_completed !== true && inviter.is_manager_referral_shadow !== true) {
    return fail('invalid_code', '유효하지 않은 추천 코드입니다.');
  }
  if (String(inviter.affiliation ?? '').includes('설계매니저')) return fail('invalid_code', '유효하지 않은 추천 코드입니다.');

  const inviterPhone = cleanPhone(String(inviter.phone ?? ''));
  if (inviterPhone.length !== 11) return fail('invalid_code', '유효하지 않은 추천 코드입니다.');

  // Self-referral check
  if (inviterPhone === profile!.phone) {
    return fail('self_referral', '본인의 추천 코드는 사용할 수 없습니다.');
  }

  const inviterName = String(inviter.name ?? '').trim();
  const inviterFcId = inviter.id as string;
  const inviteeFcId = profile!.id;
  const inviteePhone = profile!.phone;
  const now = new Date().toISOString();

  const attributionResult = await captureConfirmedAttribution({
    inviteeFcId,
    inviteePhone,
    inviterFcId,
    inviterPhone,
    inviterName,
    referralCodeId: referralRow.id,
    referralCode: code,
    now,
  });
  if (attributionResult.error) {
    return attributionResult.error;
  }

  const { error: profileUpdateError } = await supabase
    .from('fc_profiles')
    .update({ recommender: inviterName, recommender_fc_id: inviterFcId })
    .eq('id', inviteeFcId);

  if (profileUpdateError) {
    return json({ ok: false, code: 'db_error', message: profileUpdateError.message }, 500);
  }

  const eventError = await insertReferralEvent({
    attributionId: attributionResult.attributionId,
    referralCodeId: referralRow.id,
    referralCode: code,
    inviterFcId,
    inviterPhone,
    inviterName,
    inviteeFcId,
    inviteePhone,
  });
  if (eventError) {
    return json({ ok: false, code: 'db_error', message: eventError.message }, 500);
  }

  return json({ ok: true, inviterName, inviterFcId });
});
