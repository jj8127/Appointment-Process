import {
  isGeneralExpoPushEnabled,
  mapNotificationCategoryToAppPushCategory,
  selectSingleCanonicalPreferenceActor,
} from '../general-push-preference-policy.ts';

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

Deno.test('maps raw notification categories into the four app push categories', () => {
  const cases = new Map<string, string>([
    ['message', 'messages'],
    ['group_chat_message', 'messages'],
    ['request_board_message', 'messages'],
    ['request_board_completed', 'request_activity'],
    ['request_board_arbitrary', 'request_activity'],
    ['notice', 'notices'],
    ['공지사항', 'notices'],
    ['exam_apply', 'operations'],
    ['app_event', 'operations'],
  ]);

  for (const [rawCategory, expected] of cases) {
    const actual = mapNotificationCategoryToAppPushCategory(rawCategory);
    if (actual !== expected) {
      throw new Error(`${rawCategory} mapped to ${actual}, expected ${expected}`);
    }
  }
});

Deno.test('global and mapped category OFF suppress only Expo for the exact actor tuple', () => {
  const actor = { id: ACTOR_ID, role: 'manager' as const };
  const globalOff = isGeneralExpoPushEnabled({
    actor,
    category: 'operations',
    globalRows: [{ actor_id: ACTOR_ID, actor_role: 'manager', enabled: false }],
  });
  const categoryOff = isGeneralExpoPushEnabled({
    actor,
    category: 'operations',
    categoryRows: [{
      actor_id: ACTOR_ID,
      actor_role: 'manager',
      category: 'operations',
      enabled: false,
    }],
  });
  const foreignRoleOff = isGeneralExpoPushEnabled({
    actor,
    category: 'operations',
    globalRows: [{ actor_id: ACTOR_ID, actor_role: 'admin', enabled: false }],
    categoryRows: [{
      actor_id: ACTOR_ID,
      actor_role: 'admin',
      category: 'operations',
      enabled: false,
    }],
  });

  if (globalOff || categoryOff) throw new Error('OFF preference did not suppress Expo');
  if (!foreignRoleOff) throw new Error('admin preference leaked into the manager tuple');
});

Deno.test('lookup and actor mapping failures fail closed for Expo', () => {
  const lookupFailure = isGeneralExpoPushEnabled({
    actor: { id: ACTOR_ID, role: 'fc' },
    category: 'operations',
    lookupFailed: true,
  });
  const mappingFailure = isGeneralExpoPushEnabled({
    actor: { id: 'not-a-canonical-actor', role: 'fc' },
    category: 'operations',
  });

  if (lookupFailure) throw new Error('preference lookup failure must suppress Expo');
  if (mappingFailure) throw new Error('actor mapping failure must suppress Expo');
});

Deno.test('a manager token accepts one canonical manager actor and rejects source collisions', () => {
  const manager = { id: ACTOR_ID, role: 'manager' as const };
  const designer = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    role: 'manager' as const,
  };

  if (selectSingleCanonicalPreferenceActor([manager]) !== manager) {
    throw new Error('one active manager actor must remain canonical');
  }
  if (selectSingleCanonicalPreferenceActor([designer]) !== designer) {
    throw new Error('one active designer FC actor must remain canonical for a manager token');
  }
  if (selectSingleCanonicalPreferenceActor([manager, designer]) !== null) {
    throw new Error('manager/designer source collision must fail closed');
  }
  if (selectSingleCanonicalPreferenceActor([]) !== null) {
    throw new Error('an unresolved manager token must fail closed');
  }
});
