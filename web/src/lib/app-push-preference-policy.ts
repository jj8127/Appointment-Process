export const APP_PUSH_CATEGORIES = [
  'messages',
  'request_activity',
  'notices',
  'operations',
] as const;

export type AppPushCategory = typeof APP_PUSH_CATEGORIES[number];
export type AppPushActorRole = 'fc' | 'manager' | 'admin';

export type AppPushActor = {
  id: string;
  role: AppPushActorRole;
};

type GlobalPreferenceRow = {
  actor_id?: string | null;
  actor_role?: string | null;
  enabled?: boolean | null;
};

type CategoryPreferenceRow = GlobalPreferenceRow & {
  category?: string | null;
};

export type FcExpoTokenRow = {
  expo_push_token?: string | null;
  resident_id?: string | null;
};

export type FcPreferenceActorRow = {
  id?: string | null;
  phone?: string | null;
  affiliation?: string | null;
  signup_completed?: boolean | null;
  is_manager_referral_shadow?: boolean | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DESIGNER_MARKER = '설계매니저';
const MESSAGE_CATEGORY_SUFFIX = '_message';
const REQUEST_BOARD_CATEGORY_PREFIX = 'request_board_';

export const normalizePushPreferencePhone = (value?: string | null): string =>
  String(value ?? '').replace(/\D/g, '');

export const isCanonicalPushPreferenceActorId = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value.trim());

export function mapNotificationCategoryToAppPushCategory(
  rawCategory?: string | null,
): AppPushCategory {
  const category = String(rawCategory ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, '_');

  if (category === 'request_board_message') return 'messages';
  if (category.startsWith(REQUEST_BOARD_CATEGORY_PREFIX)) return 'request_activity';
  if (category === 'message' || category.endsWith(MESSAGE_CATEGORY_SUFFIX)) return 'messages';
  if (
    category === 'notice'
    || category === 'notices'
    || category.includes('announcement')
    || category.includes('notice')
    || category.includes('공지')
  ) {
    return 'notices';
  }
  return 'operations';
}

function readExactEnabledPreference(
  rows: GlobalPreferenceRow[] | null | undefined,
  actor: AppPushActor,
  category?: AppPushCategory,
): { enabled: boolean; invalid: boolean } {
  const matches = (rows ?? []).filter((row) =>
    row.actor_id === actor.id
    && row.actor_role === actor.role
    && (category === undefined || (row as CategoryPreferenceRow).category === category)
  );
  if (matches.length === 0) return { enabled: true, invalid: false };
  if (matches.length !== 1 || typeof matches[0].enabled !== 'boolean') {
    return { enabled: false, invalid: true };
  }
  return { enabled: matches[0].enabled, invalid: false };
}

export function evaluateExactActorExpoPreference(input: {
  actor: AppPushActor;
  category: AppPushCategory;
  lookupFailed?: boolean;
  globalRows?: GlobalPreferenceRow[] | null;
  categoryRows?: CategoryPreferenceRow[] | null;
}): { enabled: boolean; mappingFailed: boolean } {
  if (input.lookupFailed === true || !isCanonicalPushPreferenceActorId(input.actor.id)) {
    return { enabled: false, mappingFailed: true };
  }

  const globalPreference = readExactEnabledPreference(input.globalRows, input.actor);
  const categoryPreference = readExactEnabledPreference(
    input.categoryRows,
    input.actor,
    input.category,
  );
  const mappingFailed = globalPreference.invalid || categoryPreference.invalid;
  return {
    enabled: !mappingFailed && globalPreference.enabled && categoryPreference.enabled,
    mappingFailed,
  };
}

export function filterActorScopedFcExpoTokens(input: {
  tokens: FcExpoTokenRow[];
  actors: FcPreferenceActorRow[];
  category: AppPushCategory;
  globalRows?: GlobalPreferenceRow[] | null;
  categoryRows?: CategoryPreferenceRow[] | null;
}): {
  eligibleTokens: string[];
  suppressedTokens: number;
  mappingFailed: boolean;
} {
  const actorCandidatesByPhone = new Map<string, AppPushActor[]>();
  for (const row of input.actors) {
    const actorId = String(row.id ?? '').trim().toLowerCase();
    const phone = normalizePushPreferencePhone(row.phone);
    const affiliation = String(row.affiliation ?? '').replace(/\s+/g, '');
    if (
      row.signup_completed !== true
      || row.is_manager_referral_shadow === true
      || affiliation.includes(DESIGNER_MARKER)
      || !phone
      || !isCanonicalPushPreferenceActorId(actorId)
    ) {
      continue;
    }
    actorCandidatesByPhone.set(phone, [
      ...(actorCandidatesByPhone.get(phone) ?? []),
      { id: actorId, role: 'fc' },
    ]);
  }

  const eligibleTokens = new Set<string>();
  const seenTokens = new Set<string>();
  let suppressedTokens = 0;
  let mappingFailed = false;

  for (const row of input.tokens) {
    const token = String(row.expo_push_token ?? '').trim();
    if (!token || seenTokens.has(token)) continue;
    seenTokens.add(token);

    const phone = normalizePushPreferencePhone(row.resident_id);
    const candidates = actorCandidatesByPhone.get(phone) ?? [];
    if (candidates.length !== 1) {
      mappingFailed = true;
      continue;
    }

    const preference = evaluateExactActorExpoPreference({
      actor: candidates[0],
      category: input.category,
      globalRows: input.globalRows,
      categoryRows: input.categoryRows,
    });
    if (preference.mappingFailed) {
      mappingFailed = true;
    } else if (preference.enabled) {
      eligibleTokens.add(token);
    } else {
      suppressedTokens += 1;
    }
  }

  return {
    eligibleTokens: Array.from(eligibleTokens),
    suppressedTokens,
    mappingFailed,
  };
}
