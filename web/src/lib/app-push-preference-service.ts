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
import { collectSupabaseRows } from '@/lib/supabase-query-contract';

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

type ExactGlobalPreferenceRow = {
  actor_id: string;
  actor_role: 'fc';
  enabled: boolean;
};

type ExactCategoryPreferenceRow = ExactGlobalPreferenceRow & {
  category: AppPushCategory;
};

const IN_FILTER_BATCH_SIZE = 200;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

function isExactGlobalPreferenceRow(
  value: unknown,
  actorIds: Set<string>,
): value is ExactGlobalPreferenceRow {
  return isRecord(value)
    && typeof value.actor_id === 'string'
    && actorIds.has(value.actor_id)
    && value.actor_role === 'fc'
    && typeof value.enabled === 'boolean';
}

function isExactCategoryPreferenceRow(
  value: unknown,
  actorIds: Set<string>,
  category: AppPushCategory,
): value is ExactCategoryPreferenceRow {
  return isExactGlobalPreferenceRow(value, actorIds)
    && isRecord(value)
    && (value as Record<string, unknown>).category === category;
}

function hasUniqueKeys<T>(rows: T[], key: (row: T) => string): boolean {
  return new Set(rows.map(key)).size === rows.length;
}

function isExactFcPreferenceActorRow(
  value: unknown,
  residentIds: Set<string>,
): value is FcPreferenceActorRow {
  return isRecord(value)
    && typeof value.id === 'string'
    && isCanonicalPushPreferenceActorId(value.id)
    && value.id === value.id.trim().toLowerCase()
    && typeof value.phone === 'string'
    && value.phone === normalizePushPreferencePhone(value.phone)
    && /^010\d{8}$/.test(value.phone)
    && residentIds.has(value.phone)
    && (value.affiliation === null || typeof value.affiliation === 'string')
    && value.signup_completed === true
    && typeof value.is_manager_referral_shadow === 'boolean';
}

function isExactFcExpoTokenRow(value: unknown): value is Required<FcExpoTokenRow> {
  if (!isRecord(value)) return false;
  const residentId = normalizePushPreferencePhone(
    typeof value.resident_id === 'string' ? value.resident_id : null,
  );
  return typeof value.expo_push_token === 'string'
    && value.expo_push_token.trim().length > 0
    && value.expo_push_token === value.expo_push_token.trim()
    && typeof value.resident_id === 'string'
    && value.resident_id === residentId
    && /^010\d{8}$/.test(residentId);
}

function inFilterBatches(values: string[]): string[][] {
  const batches: string[][] = [];
  for (let offset = 0; offset < values.length; offset += IN_FILTER_BATCH_SIZE) {
    batches.push(values.slice(offset, offset + IN_FILTER_BATCH_SIZE));
  }
  return batches;
}

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
    const actorIds = new Set([actorId]);
    const globalRow = globalResult.data;
    const categoryRow = categoryResult.data;
    const lookupFailed = Boolean(
      globalResult.error
      || categoryResult.error
      || (globalRow !== null && !isExactGlobalPreferenceRow(globalRow, actorIds))
      || (categoryRow !== null
        && !isExactCategoryPreferenceRow(categoryRow, actorIds, category))
    );
    const preference = evaluateExactActorExpoPreference({
      actor: { id: actorId, role: 'fc' },
      category,
      lookupFailed,
      globalRows: !lookupFailed && globalRow ? [globalRow] : [],
      categoryRows: !lookupFailed && categoryRow ? [categoryRow] : [],
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
  if (
    !tokens.every(isExactFcExpoTokenRow)
    || !hasUniqueKeys(tokens, (token) => String(token.expo_push_token).trim())
  ) {
    return { eligibleTokens: [], suppressedTokens: 0, lookupFailed: true, category };
  }
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
    const actors: FcPreferenceActorRow[] = [];
    for (const residentIdBatch of inFilterBatches(residentIds)) {
      const residentIdSet = new Set(residentIdBatch);
      const rows = await collectSupabaseRows<FcPreferenceActorRow>({
        queryName: 'app_push_preference_actors',
        isRow: (value): value is FcPreferenceActorRow => (
          isExactFcPreferenceActorRow(value, residentIdSet)
        ),
        rowKey: (row) => String(row.id).trim().toLowerCase(),
        fetchPage: async (from, to) => adminSupabase
          .from('fc_profiles')
          .select('id,phone,affiliation,signup_completed,is_manager_referral_shadow')
          .in('phone', residentIdBatch)
          .eq('signup_completed', true)
          .order('phone', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      });
      actors.push(...rows);
    }
    if (
      !hasUniqueKeys(actors, (actor) => String(actor.id).trim().toLowerCase())
      || !hasUniqueKeys(actors, (actor) => normalizePushPreferencePhone(actor.phone))
    ) return { eligibleTokens: [], suppressedTokens: 0, lookupFailed: true, category };
    const actorIds = Array.from(new Set(
      actors
        .map((actor) => String(actor.id ?? '').trim().toLowerCase())
        .filter(isCanonicalPushPreferenceActorId),
    ));
    if (actorIds.length === 0) {
      return { eligibleTokens: [], suppressedTokens: 0, lookupFailed: true, category };
    }

    const globalRows: ExactGlobalPreferenceRow[] = [];
    const categoryRows: ExactCategoryPreferenceRow[] = [];
    for (const actorIdBatch of inFilterBatches(actorIds)) {
      const actorIdSet = new Set(actorIdBatch);
      const [globalBatch, categoryBatch] = await Promise.all([
        collectSupabaseRows<ExactGlobalPreferenceRow>({
          queryName: 'app_push_global_preferences',
          isRow: (value): value is ExactGlobalPreferenceRow => (
            isExactGlobalPreferenceRow(value, actorIdSet)
          ),
          rowKey: (row) => row.actor_id,
          fetchPage: async (from, to) => adminSupabase
            .from('app_push_preferences')
            .select('actor_id,actor_role,enabled')
            .in('actor_id', actorIdBatch)
            .eq('actor_role', 'fc')
            .order('actor_id', { ascending: true })
            .range(from, to),
        }),
        collectSupabaseRows<ExactCategoryPreferenceRow>({
          queryName: 'app_push_category_preferences',
          isRow: (value): value is ExactCategoryPreferenceRow => (
            isExactCategoryPreferenceRow(value, actorIdSet, category)
          ),
          rowKey: (row) => row.actor_id,
          fetchPage: async (from, to) => adminSupabase
            .from('app_push_category_preferences')
            .select('actor_id,actor_role,category,enabled')
            .in('actor_id', actorIdBatch)
            .eq('actor_role', 'fc')
            .eq('category', category)
            .order('actor_id', { ascending: true })
            .range(from, to),
        }),
      ]);
      globalRows.push(...globalBatch);
      categoryRows.push(...categoryBatch);
    }
    if (
      !hasUniqueKeys(globalRows, (row) => row.actor_id)
      || !hasUniqueKeys(categoryRows, (row) => row.actor_id)
    ) return { eligibleTokens: [], suppressedTokens: 0, lookupFailed: true, category };

    const filtered = filterActorScopedFcExpoTokens({
      tokens,
      actors,
      category,
      globalRows,
      categoryRows,
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
