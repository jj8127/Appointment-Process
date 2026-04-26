import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export type ReferralLinkSource = 'signup' | 'self_service' | 'admin_override' | 'legacy_migration';

type ReferralLinkStateRpcResult = {
  ok?: boolean;
  changed?: boolean;
  inviteeFcId?: string | null;
  inviterFcId?: string | null;
  recommenderName?: string | null;
  referralCodeId?: string | null;
  referralCode?: string | null;
  recommenderLinkSource?: ReferralLinkSource | null;
  recommenderLinkedAt?: string | null;
  eventType?: string | null;
};

type ApplyReferralLinkStateSuccess = {
  ok: true;
  changed: boolean;
  inviteeFcId: string;
  inviterFcId: string | null;
  recommenderName: string | null;
  referralCodeId: string | null;
  referralCode: string | null;
  recommenderLinkSource: ReferralLinkSource | null;
  recommenderLinkedAt: string | null;
  eventType: string | null;
};

type ApplyReferralLinkStateFailure = {
  ok: false;
  message: string;
};

export type ApplyReferralLinkStateResult =
  | ApplyReferralLinkStateSuccess
  | ApplyReferralLinkStateFailure;

function normalizeRpcResult<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export async function applyReferralLinkState(params: {
  supabase: SupabaseClient;
  inviteeFcId: string;
  inviterFcId?: string | null;
  referralCodeId?: string | null;
  referralCode?: string | null;
  source: ReferralLinkSource;
  actorPhone?: string | null;
  actorRole?: string | null;
  actorStaffType?: string | null;
  reason?: string | null;
}): Promise<ApplyReferralLinkStateResult> {
  const { data, error } = await params.supabase.rpc('apply_referral_link_state', {
    p_invitee_fc_id: String(params.inviteeFcId ?? '').trim() || null,
    p_inviter_fc_id: String(params.inviterFcId ?? '').trim() || null,
    p_referral_code_id: String(params.referralCodeId ?? '').trim() || null,
    p_referral_code: String(params.referralCode ?? '').trim().toUpperCase() || null,
    p_source: params.source,
    p_actor_phone: String(params.actorPhone ?? '').trim() || null,
    p_actor_role: String(params.actorRole ?? '').trim() || null,
    p_actor_staff_type: String(params.actorStaffType ?? '').trim() || null,
    p_reason: String(params.reason ?? '').trim() || null,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  const result = normalizeRpcResult<ReferralLinkStateRpcResult>(
    data as ReferralLinkStateRpcResult | ReferralLinkStateRpcResult[] | null,
  );

  if (!result || result.ok !== true || !result.inviteeFcId) {
    return { ok: false, message: '추천인 상태 변경 결과를 확인할 수 없습니다.' };
  }

  return {
    ok: true,
    changed: result.changed === true,
    inviteeFcId: String(result.inviteeFcId),
    inviterFcId: typeof result.inviterFcId === 'string' && result.inviterFcId.trim()
      ? result.inviterFcId.trim()
      : null,
    recommenderName: typeof result.recommenderName === 'string' && result.recommenderName.trim()
      ? result.recommenderName.trim()
      : null,
    referralCodeId: typeof result.referralCodeId === 'string' && result.referralCodeId.trim()
      ? result.referralCodeId.trim()
      : null,
    referralCode: typeof result.referralCode === 'string' && result.referralCode.trim()
      ? result.referralCode.trim()
      : null,
    recommenderLinkSource:
      result.recommenderLinkSource === 'signup'
        || result.recommenderLinkSource === 'self_service'
        || result.recommenderLinkSource === 'admin_override'
        || result.recommenderLinkSource === 'legacy_migration'
        ? result.recommenderLinkSource
        : null,
    recommenderLinkedAt: typeof result.recommenderLinkedAt === 'string' && result.recommenderLinkedAt.trim()
      ? result.recommenderLinkedAt.trim()
      : null,
    eventType: typeof result.eventType === 'string' && result.eventType.trim()
      ? result.eventType.trim()
      : null,
  };
}
