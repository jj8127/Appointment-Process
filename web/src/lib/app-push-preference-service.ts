import 'server-only';

import { adminSupabase } from '@/lib/admin-supabase';
import {
  evaluateExactActorExpoPreference,
  filterActorScopedFcExpoTokens,
  isCanonicalPushPreferenceActorId,
  mapNotificationCategoryToAppPushCategory,
  normalizePushPreferencePhone,
  type AppPushCategory,
  type FcExpoTokenRow,
  type FcPreferenceActorRow,
} from '@/lib/app-push-preference-policy';

export type ExpoPreferenceEligibility = {
  enabled: boolean;
  lookupFailed: boolean;
  category: AppPushCategory;
};

export type FcBroadcastExpoEligibility = {
  eligibleTokens: string[];
  suppressedTokens: number;
  lookupFailed: boolean;
  category: AppPushCategory;
};

export async function loadExactFcExpoPreference(
  actorId: string,
  rawCategory?: string | null,
): Promise<ExpoPreferenceEligibility> {
  const category = mapNotificationCategoryToAppPushCategory(rawCategory);
  if (!isCanonicalPushPreferenceActorId(actorId)) {
    return { enabled: false, lookupFailed: true, category };
  }

  try {
    const [globalResult, categoryResult] = await Promise.all([
      adminSupabase
        .from('app_push_preferences')
        .select('actor_id,actor_role,enabled')
        .eq('actor_id', actorId)
        .eq('actor_role', 'fc')
        .maybeSingle(),
      adminSupabase
        .from('app_push_category_preferences')
        .select('actor_id,actor_role,category,enabled')
        .eq('actor_id', actorId)
        .eq('actor_role', 'fc')
        .eq('category', category)
        .maybeSingle(),
    ]);
    const lookupFailed = Boolean(globalResult.error || categoryResult.error);
    const preference = evaluateExactActorExpoPreference({
      actor: { id: actorId, role: 'fc' },
      category,
      lookupFailed,
      globalRows: globalResult.data ? [globalResult.data] : [],
      categoryRows: categoryResult.data ? [categoryResult.data] : [],
    });
    return {
      enabled: preference.enabled,
      lookupFailed: lookupFailed || preference.mappingFailed,
      category,
    };
  } catch {
    return { enabled: false, lookupFailed: true, category };
  }
}

export async function loadActorScopedFcExpoTargets(
  tokens: FcExpoTokenRow[],
  rawCategory?: string | null,
): Promise<FcBroadcastExpoEligibility> {
  const category = mapNotificationCategoryToAppPushCategory(rawCategory);
  const residentIds = Array.from(new Set(
    tokens
      .map((token) => normalizePushPreferencePhone(token.resident_id))
      .filter(Boolean),
  ));
  if (tokens.length === 0) {
    return { eligibleTokens: [], suppressedTokens: 0, lookupFailed: false, category };
  }
  if (residentIds.length === 0) {
    return { eligibleTokens: [], suppressedTokens: 0, lookupFailed: true, category };
  }

  try {
    const actorResult = await adminSupabase
      .from('fc_profiles')
      .select('id,phone,affiliation,signup_completed,is_manager_referral_shadow')
      .in('phone', residentIds)
      .eq('signup_completed', true);
    if (actorResult.error) {
      return { eligibleTokens: [], suppressedTokens: 0, lookupFailed: true, category };
    }

    const actors = (actorResult.data ?? []) as FcPreferenceActorRow[];
    const actorIds = Array.from(new Set(
      actors
        .map((actor) => String(actor.id ?? '').trim().toLowerCase())
        .filter(isCanonicalPushPreferenceActorId),
    ));
    if (actorIds.length === 0) {
      return { eligibleTokens: [], suppressedTokens: 0, lookupFailed: true, category };
    }

    const [globalResult, categoryResult] = await Promise.all([
      adminSupabase
        .from('app_push_preferences')
        .select('actor_id,actor_role,enabled')
        .in('actor_id', actorIds)
        .eq('actor_role', 'fc'),
      adminSupabase
        .from('app_push_category_preferences')
        .select('actor_id,actor_role,category,enabled')
        .in('actor_id', actorIds)
        .eq('actor_role', 'fc')
        .eq('category', category),
    ]);
    if (globalResult.error || categoryResult.error) {
      return { eligibleTokens: [], suppressedTokens: 0, lookupFailed: true, category };
    }

    const filtered = filterActorScopedFcExpoTokens({
      tokens,
      actors,
      category,
      globalRows: globalResult.data ?? [],
      categoryRows: categoryResult.data ?? [],
    });
    return {
      eligibleTokens: filtered.eligibleTokens,
      suppressedTokens: filtered.suppressedTokens,
      lookupFailed: filtered.mappingFailed,
      category,
    };
  } catch {
    return { eligibleTokens: [], suppressedTokens: 0, lookupFailed: true, category };
  }
}
