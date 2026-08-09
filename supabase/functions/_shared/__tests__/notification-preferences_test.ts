import {
  APP_PUSH_CATEGORIES,
  buildMessengerRoomKey,
  evaluateNotificationPreference,
  parseMessengerRoomKey,
} from '../notification-preferences.ts';

const actor = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'fc' as const };
const roomKey = 'garamin:direct-thread:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

Deno.test('notification preferences default global, categories, and rooms to enabled', () => {
  const result = evaluateNotificationPreference({ actor, category: 'messages', roomKey });
  if (!result.globalEnabled || !result.categoryEnabled || result.roomMuted) {
    throw new Error('missing rows must preserve the ON/unmuted defaults');
  }
  if (result.suppressInbox || result.suppressExpo) {
    throw new Error('default preferences must not suppress delivery');
  }
  if (APP_PUSH_CATEGORIES.length !== 4) throw new Error('category contract drift');
});

Deno.test('global and category OFF retain inbox while suppressing Expo', () => {
  const globalOff = evaluateNotificationPreference({
    actor,
    category: 'messages',
    roomKey,
    globalRows: [{ actor_id: actor.id, actor_role: actor.role, enabled: false }],
  });
  const categoryOff = evaluateNotificationPreference({
    actor,
    category: 'messages',
    roomKey,
    categoryRows: [{
      actor_id: actor.id,
      actor_role: actor.role,
      category: 'messages',
      enabled: false,
    }],
  });
  for (const result of [globalOff, categoryOff]) {
    if (result.suppressInbox || !result.suppressExpo) {
      throw new Error('push OFF must retain durable inbox rows');
    }
  }
});

Deno.test('room mute suppresses both durable notification and Expo for the exact tuple', () => {
  const result = evaluateNotificationPreference({
    actor,
    category: 'messages',
    roomKey,
    roomRows: [{
      actor_id: actor.id,
      actor_role: actor.role,
      room_key: roomKey,
      muted: true,
    }],
  });
  if (!result.suppressInbox || !result.suppressExpo || !result.roomMuted) {
    throw new Error('room mute delivery contract failed');
  }
  const foreignRole = evaluateNotificationPreference({
    actor,
    category: 'messages',
    roomKey,
    roomRows: [{
      actor_id: actor.id,
      actor_role: 'manager',
      room_key: roomKey,
      muted: true,
    }],
  });
  if (foreignRole.roomMuted) throw new Error('actor role is part of the immutable tuple');
});

Deno.test('canonical messenger room keys require valid UUIDs', () => {
  const direct = buildMessengerRoomKey('direct-thread', 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB');
  if (direct !== roomKey) throw new Error('direct key was not canonicalized');
  const parsed = parseMessengerRoomKey('garamin:group:cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  if (parsed?.kind !== 'group') throw new Error('group key was not parsed');
  if (parseMessengerRoomKey('garamin:direct-thread:not-a-uuid')) {
    throw new Error('invalid room key was accepted');
  }
});
