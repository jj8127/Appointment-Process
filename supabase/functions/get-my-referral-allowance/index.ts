import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { getEnv, requireAppSessionFromRequest } from '../_shared/request-board-auth.ts';
import {
  authorizeReferralAllowance,
  readAllowanceCommand,
  type AllowanceAuthRepository,
} from '../_shared/referral-allowance-auth.ts';

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const responseHeaders = (req: Request) => {
  const origin = req.headers.get('origin');
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'Vary': 'Origin',
    'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? 'https://yourdomain.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
};

serve(async (req: Request) => {
  const headers = responseHeaders(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  const fail = (code: string, message: string, status: number) => json({ ok: false, code, message }, status);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return fail('method_not_allowed', '지원하지 않는 요청입니다.', 405);
  const origin = req.headers.get('origin');
  if (origin && !allowedOrigins.includes(origin)) return fail('forbidden', '수당 조회 권한이 없습니다.', 403);

  try {
    const auth = await requireAppSessionFromRequest(req);
    if (!auth.ok) return fail(auth.code, auth.message, auth.status);
    const command = await readAllowanceCommand(req);
    if (!command) return fail('invalid_request', '조회 조건을 확인해주세요.', 400);

    const url = getEnv('SUPABASE_URL');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return fail('unavailable', '수당 정보를 준비하고 있습니다.', 503);
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const repository: AllowanceAuthRepository = {
      managerByPhone: async (phone) => {
        const { data, error } = await supabase.from('manager_accounts').select('id,active')
          .eq('phone', phone).maybeSingle();
        if (error) throw new Error('allowance_lookup_failed');
        return data;
      },
      hasAdminAccount: async (phone) => {
        const { data, error } = await supabase.from('admin_accounts').select('id').eq('phone', phone).limit(1);
        if (error) throw new Error('allowance_lookup_failed');
        return Boolean(data?.length);
      },
      profilesForSession: async (phone, fcId) => {
        const query = supabase.from('fc_profiles')
          .select('id,phone,affiliation,signup_completed,is_manager_referral_shadow').limit(2);
        const { data, error } = await (fcId ? query.eq('id', fcId) : query.eq('phone', phone));
        if (error) throw new Error('allowance_lookup_failed');
        return (data ?? []).map((row) => ({ id: row.id, phone: row.phone, affiliation: row.affiliation,
          signupCompleted: row.signup_completed === true, isManagerReferralShadow: row.is_manager_referral_shadow === true }));
      },
      pilot: async (beneficiaryFcId) => {
        const { data, error } = await supabase.from('referral_allowance_recipients')
          .select('manager_account_id,beneficiary_fc_id,employee_code,enabled,revision').eq('beneficiary_fc_id', beneficiaryFcId).maybeSingle();
        if (error) throw new Error('allowance_lookup_failed');
        return data ? { managerAccountId: data.manager_account_id, beneficiaryFcId: data.beneficiary_fc_id,
          employeeCode: data.employee_code, enabled: data.enabled, revision: Number(data.revision) } : null;
      },
    };
    const access = await authorizeReferralAllowance(auth.session, repository);
    if (!access.enabled) {
      return command.action === 'access' ? json({ ok: true, enabled: false })
        : fail('forbidden', '수당 조회 권한이 없습니다.', 403);
    }
    // The database rechecks this recipient's permission revision under a shared lock.
    const { data, error } = await supabase.rpc('read_referral_allowance_pilot', {
      p_manager_account_id: access.identity.managerAccountId,
      p_beneficiary_fc_id: access.identity.beneficiaryFcId,
      p_action: command.action,
      p_month: command.month ?? null,
    });
    if (error) {
      if (error.code === '42501') return fail('forbidden', '수당 조회 권한이 없습니다.', 403);
      return fail('unavailable', '수당 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 503);
    }
    if (!data || typeof data !== 'object' || data.ok !== true || typeof data.enabled !== 'boolean') {
      return fail('unavailable', '수당 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 503);
    }
    if (!data.enabled && command.action === 'statement') return fail('forbidden', '수당 조회 권한이 없습니다.', 403);
    return json(data);
  } catch {
    return fail('unavailable', '수당 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 503);
  }
});
