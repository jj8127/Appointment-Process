import {
  evaluateNotificationPreference,
  type AppPreferenceActorRole,
  type AppPushCategory,
} from './notification-preferences.ts';

const MESSAGE_CATEGORY_SUFFIX = '_message';
const REQUEST_BOARD_CATEGORY_PREFIX = 'request_board_';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GeneralPushPreferenceActor = {
  id: string;
  role: AppPreferenceActorRole;
};

export function selectSingleCanonicalPreferenceActor(
  candidates: GeneralPushPreferenceActor[],
): GeneralPushPreferenceActor | null {
  return candidates.length === 1 ? candidates[0] : null;
}

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

export function isGeneralExpoPushEnabled(input: {
  actor: GeneralPushPreferenceActor;
  category: AppPushCategory;
  lookupFailed?: boolean;
  globalRows?: Array<{
    actor_id?: string;
    actor_role?: string;
    enabled?: boolean;
  }> | null;
  categoryRows?: Array<{
    actor_id?: string;
    actor_role?: string;
    category?: string;
    enabled?: boolean;
  }> | null;
}): boolean {
  if (input.lookupFailed === true || !UUID_PATTERN.test(input.actor.id)) {
    return false;
  }
  return !evaluateNotificationPreference({
    actor: input.actor,
    category: input.category,
    globalRows: input.globalRows,
    categoryRows: input.categoryRows,
  }).suppressExpo;
}

