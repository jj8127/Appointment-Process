import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { parseDesignerCompanyNameFromAffiliation } from './request-board-auth.ts';

type ReferralCodeMutationResult = {
  ok?: boolean;
  changed?: boolean;
  action?: string | null;
  fcId?: string | null;
  codeId?: string | null;
  code?: string | null;
  eventType?: string | null;
};

type ReferralProfileEligibilityInput = {
  phone?: string | null;
  affiliation?: string | null;
  signup_completed?: boolean | null;
  is_manager_referral_shadow?: boolean | null;
};

type EnsureManagerReferralShadowProfileResult =
  | { ok: true }
  | { ok: false; message: string };

type EnsureActiveReferralCodeResult =
  | {
    ok: true;
    changed: boolean;
    action: string | null;
    codeId: string | null;
    code: string | null;
    eventType: string | null;
  }
  | {
    ok: false;
    message: string;
  };

export function cleanPhone(input?: string | null) {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

function normalizeRpcResult<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export function canAutoIssueReferralCodeProfile(
  profile: ReferralProfileEligibilityInput | null | undefined,
  options?: { allowManagerShadow?: boolean },
) {
  const normalizedPhone = cleanPhone(profile?.phone);
  if (normalizedPhone.length !== 11) {
    return false;
  }

  if (parseDesignerCompanyNameFromAffiliation(profile?.affiliation ?? null)) {
    return false;
  }

  if (profile?.signup_completed === true) {
    return true;
  }

  return options?.allowManagerShadow === true && profile?.is_manager_referral_shadow === true;
}

export async function ensureManagerReferralShadowProfile(
  supabase: SupabaseClient,
  managerPhone: string,
  managerName?: string | null,
): Promise<EnsureManagerReferralShadowProfileResult> {
  const { error } = await supabase.rpc('ensure_manager_referral_shadow_profile', {
    p_manager_phone: cleanPhone(managerPhone),
    p_manager_name: typeof managerName === 'string' && managerName.trim() ? managerName.trim() : null,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true };
}

export async function ensureActiveReferralCode(params: {
  supabase: SupabaseClient;
  fcId: string;
  actorPhone?: string | null;
  actorRole: string;
  actorStaffType?: string | null;
  reason?: string | null;
}): Promise<EnsureActiveReferralCodeResult> {
  const normalizedFcId = String(params.fcId ?? '').trim();
  if (!normalizedFcId) {
    return { ok: false, message: 'FC profile not found' };
  }

  const { data, error } = await params.supabase.rpc('admin_issue_referral_code', {
    p_fc_id: normalizedFcId,
    p_actor_phone: cleanPhone(params.actorPhone),
    p_actor_role: String(params.actorRole ?? '').trim() || 'system',
    p_actor_staff_type: typeof params.actorStaffType === 'string' && params.actorStaffType.trim()
      ? params.actorStaffType.trim()
      : null,
    p_reason: typeof params.reason === 'string' && params.reason.trim()
      ? params.reason.trim()
      : null,
    p_rotate: false,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  const result = normalizeRpcResult<ReferralCodeMutationResult>(
    data as ReferralCodeMutationResult | ReferralCodeMutationResult[] | null,
  );

  if (!result || result.ok !== true) {
    return { ok: false, message: '추천코드 작업 결과를 확인할 수 없습니다.' };
  }

  return {
    ok: true,
    changed: result.changed === true,
    action: typeof result.action === 'string' && result.action.trim() ? result.action.trim() : null,
    codeId: typeof result.codeId === 'string' && result.codeId.trim() ? result.codeId.trim() : null,
    code: typeof result.code === 'string' && result.code.trim() ? result.code.trim() : null,
    eventType: typeof result.eventType === 'string' && result.eventType.trim() ? result.eventType.trim() : null,
  };
}
