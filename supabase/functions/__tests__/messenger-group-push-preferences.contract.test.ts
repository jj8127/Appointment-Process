import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'supabase/functions/group-chat/index.ts'),
  'utf8',
);

function sliceBetween(startNeedle: string, endNeedle: string) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('group-chat global/category native-push suppression contract', () => {
  const preferenceSelector = sliceBetween(
    'function selectNativePushRecipients',
    'async function resolveNativePushRecipients',
  );
  const roomPreferenceResolution = sliceBetween(
    'function groupChatRoomPreferenceKey',
    'function selectNativePushRecipients',
  );
  const preferenceQuery = sliceBetween(
    'async function resolveNativePushRecipients',
    'async function notifyRecipients',
  );
  const notify = sliceBetween(
    'async function notifyRecipients',
    'function notificationFanoutFailureSummary',
  );
  const preferenceWrite = sliceBetween(
    'async function handlePreferences',
    'async function handleMemberSendPermission',
  );

  it('keeps room mute as the notification and native-push audience SSOT', () => {
    const roomPreferenceQuery = notify.indexOf(".from('group_chat_preferences')");
    const roomAudience = notify.indexOf('const recipients = members.filter');
    const notificationRows = notify.indexOf('const notificationRows = recipients.map');
    const appPushPreferences = notify.indexOf(
      'await resolveNativePushRecipients(recipients)',
    );

    expect(roomPreferenceQuery).toBeGreaterThanOrEqual(0);
    expect(roomAudience).toBeGreaterThan(roomPreferenceQuery);
    expect(notificationRows).toBeGreaterThan(roomAudience);
    expect(appPushPreferences).toBeGreaterThan(notificationRows);
    expect(notify).toContain(
      'recipientMuted: resolveRecipientRoomMuted({',
    );
    expect(notify).toContain('recipient_actor_id: member.immutable_actor_id');
  });

  it('prefers the canonical room tuple and falls back to legacy only when absent', () => {
    expect(roomPreferenceResolution).toContain(
      'return `garamin:group:${roomId.toLowerCase()}`',
    );
    expect(roomPreferenceResolution).toContain(
      'input.member.immutable_actor_id',
    );
    expect(roomPreferenceResolution).toContain('input.member.role');
    expect(roomPreferenceResolution).toContain(
      'input.canonicalMutedByActor.has(canonicalKey)',
    );
    expect(roomPreferenceResolution).toContain(
      'return input.canonicalMutedByActor.get(canonicalKey) === true',
    );
    expect(roomPreferenceResolution).toContain(
      'return input.legacyMutedByActor.get(input.member.actor_id) === true',
    );

    expect(notify).toContain(
      ".from('messenger_room_notification_preferences')",
    );
    expect(notify).toContain(
      ".select('actor_id,actor_role,muted')",
    );
    expect(notify).toContain(
      ".eq('room_key', groupChatRoomPreferenceKey(input.roomId))",
    );
    expect(notify).toContain(".in('actor_id', immutableActorIds)");
    expect(notify).toContain(".in('actor_role', effectiveActorRoles)");
    expect(notify).toContain(".from('group_chat_preferences')");
  });

  it('uses server-derived immutable actor UUID and effective role with missing rows defaulting ON', () => {
    expect(preferenceQuery).toContain(
      'recipients.map((member) => member.immutable_actor_id)',
    );
    expect(preferenceQuery).toContain(
      'recipients.map((member) => member.role)',
    );
    expect(preferenceQuery).toContain(".from('app_push_preferences')");
    expect(preferenceQuery).toContain(
      ".select('actor_id,actor_role,enabled')",
    );
    expect(preferenceQuery).toContain(".in('actor_id', actorIds)");
    expect(preferenceQuery).toContain(".in('actor_role', actorRoles)");
    expect(preferenceQuery).toContain(
      ".from('app_push_category_preferences')",
    );
    expect(preferenceQuery).toContain(
      ".eq('category', GROUP_CHAT_APP_PUSH_CATEGORY)",
    );
    expect(source).toContain(
      "const GROUP_CHAT_APP_PUSH_CATEGORY = 'messages'",
    );
    expect(preferenceSelector.match(/row\.enabled === false/g)).toHaveLength(2);
    expect(preferenceSelector).not.toContain('row.enabled !== true');
    expect(notify).not.toContain('payload.enabled');
    expect(notify).not.toContain('payload.actor');
    expect(notify).not.toContain('payload.role');
  });

  it('suppresses native push when either global or messages category is OFF', () => {
    expect(preferenceSelector).toContain('!globallyDisabled.has(key)');
    expect(preferenceSelector).toContain('!categoryDisabled.has(key)');
    expect(preferenceSelector).toContain(
      'appPushPreferenceKey(member.immutable_actor_id, member.role)',
    );
  });

  it('persists an unmuted recipient inbox row before suppression and skips token/provider work when all are suppressed', () => {
    const persistence = notify.indexOf(
      'await insertNotificationsWithFallback(notificationRows)',
    );
    const suppression = notify.indexOf(
      'await resolveNativePushRecipients(recipients)',
    );
    const allSuppressed = notify.indexOf(
      'if (nativePushRecipients.length === 0)',
    );
    const tokenQuery = notify.indexOf(".from('device_tokens')");
    const provider = notify.indexOf('await sendExpoPushPayloads(pushPayload)');
    const allSuppressedBranch = notify.slice(allSuppressed, tokenQuery);

    expect(persistence).toBeGreaterThanOrEqual(0);
    expect(suppression).toBeGreaterThan(persistence);
    expect(allSuppressed).toBeGreaterThan(suppression);
    expect(tokenQuery).toBeGreaterThan(allSuppressed);
    expect(provider).toBeGreaterThan(tokenQuery);
    expect(allSuppressedBranch).toContain("status: 'inbox_only'");
    expect(allSuppressedBranch).toContain('stored: true');
    expect(allSuppressedBranch).toContain('notificationStored: true');
    expect(allSuppressedBranch).toContain("pushStatus: 'no_registered_device'");
    expect(allSuppressedBranch).toContain('retryable: false');
    expect(allSuppressedBranch).not.toContain('provider_failed');
    expect(allSuppressedBranch).not.toContain('sendExpoPushPayloads');
  });

  it('queries tokens and builds payloads only for the remaining native-push audience', () => {
    expect(notify).toContain(
      'nativePushRecipients.map((member) => member.phone)',
    );
    expect(notify).toContain(
      '(tokenRows ?? []) as DeviceTokenRow[],\n    nativePushRecipients,',
    );
    expect(notify).toContain(
      'nativePushRecipients.map((member) => [',
    );
    expect(notify).not.toContain(
      'const recipientPhones = Array.from(new Set(recipients.map',
    );
  });

  it('fails native push closed on preference query errors without retrying persisted notifications', () => {
    expect(preferenceQuery).toContain(
      'if (globalResult.error || categoryResult.error)',
    );
    expect(preferenceQuery).toContain('return { ok: false }');
    const failureStart = notify.indexOf('if (!nativePushResolution.ok)');
    const failureEnd = notify.indexOf(
      'const nativePushRecipients',
      failureStart,
    );
    const failure = notify.slice(failureStart, failureEnd);
    expect(failure).toContain('notificationStored: true');
    expect(failure).toContain('retryable: false');
    expect(failure).not.toContain(".from('device_tokens')");
  });

  it('writes the canonical room SSOT before returning the persisted value', () => {
    expect(preferenceWrite).toContain('const members = await listEligibleMembers()');
    expect(preferenceWrite).toContain(
      'members.find((candidate) => candidate.actor_id === actor.id)',
    );
    expect(preferenceWrite).toContain(
      ".from('messenger_room_notification_preferences')",
    );
    expect(preferenceWrite).toContain(
      'actor_id: member.immutable_actor_id',
    );
    expect(preferenceWrite).toContain('actor_role: member.role');
    expect(preferenceWrite).toContain('const roomKey = groupChatRoomPreferenceKey(room.id)');
    expect(preferenceWrite).toContain('room_key: roomKey');
    expect(preferenceWrite).toContain(
      "onConflict: 'actor_id,actor_role,room_key'",
    );
    expect(preferenceWrite).not.toContain(".from('group_chat_preferences')");
    expect(preferenceWrite).not.toContain('legacyResult');
    expect(preferenceWrite).toContain('canonicalResult.error');
    expect(preferenceWrite.indexOf('canonicalResult.error'))
      .toBeLessThan(preferenceWrite.indexOf('return json({ ok: true, muted: saved.muted }'));
    expect(preferenceWrite).not.toContain('payload.actor_id');
    expect(preferenceWrite).not.toContain('payload.actor_role');
    expect(preferenceWrite).not.toContain('payload.room_key');
  });
});
