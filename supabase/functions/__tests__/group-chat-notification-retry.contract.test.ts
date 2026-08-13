import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('group-chat notification-only retry contract', () => {
  const edge = read('supabase/functions/group-chat/index.ts');
  const event = read(
    'supabase/functions/_shared/group-chat-notification-event.ts',
  );
  const batching = read(
    'supabase/functions/_shared/group-chat-data-api-batching.ts',
  );
  const schema = read('supabase/schema.sql');
  const migration = read(
    'supabase/migrations/20260725004017_add_typed_notification_targets_and_receipts.sql',
  );
  const retryStart = edge.indexOf('async function handleNotificationRetry');
  const retryEnd = edge.indexOf('async function handleMarkRead', retryStart);
  const retry = edge.slice(retryStart, retryEnd);
  const notifyStart = edge.indexOf('async function notifyRecipients');
  const notifyEnd = edge.indexOf(
    'function notificationFanoutFailureSummary',
    notifyStart,
  );
  const notify = edge.slice(notifyStart, notifyEnd);

  it('returns a server-derived retry token only for a committed message inbox failure', () => {
    expect(edge).toContain("type: 'group_chat_notification_retry'");
    expect(edge).toContain('deriveGroupChatNotificationEventKey({');
    expect(edge).toContain('delivery: notification.delivery');
    expect(edge).toContain(
      'notificationRetry: notification.delivery.notificationStored',
    );
    expect(edge).toContain(
      ': { messageId: message.id, retryToken }',
    );
    expect(edge).toContain(
      ': { messageId: message.id, retryToken: currentRetryToken }',
    );
    expect(event).toContain(
      '`${roomId}\\n${messageId}\\n${senderActorId}\\n${createdAt}`',
    );
    expect(event).toContain("'SHA-256'");
    expect(event).toContain("return `gcnr1.${toHex");
    expect(event).toContain("name: 'HMAC'");
    expect(edge).toContain("getEnv('FC_APP_SESSION_TOKEN_SECRET')");
    expect(edge).toContain(
      "getEnv('FC_APP_SESSION_TOKEN_PREVIOUS_SECRET')",
    );
  });

  it('authenticates the active sender and rejects foreign room, message, or token state', () => {
    const session = edge.indexOf('await requireAppSessionFromRequest(req)');
    const actor = edge.indexOf('await resolveActor(sessionResult.session');
    const dispatch = edge.indexOf(
      "payload.type === 'group_chat_notification_retry'",
    );

    expect(session).toBeGreaterThan(-1);
    expect(actor).toBeGreaterThan(session);
    expect(dispatch).toBeGreaterThan(actor);
    expect(retry).toContain('const room = await ensureRoom()');
    expect(retry).toContain('await getMessageInRoom(room.id, messageId)');
    expect(retry).toContain('message.sender_actor_id !== actor.id');
    expect(retry).toContain('message.deleted_at');
    expect(retry).toContain(
      'await verifyGroupChatNotificationRetryToken({',
    );
    expect(retry).toContain('if (!tokenVerified)');
    expect(retry).toContain(
      'members.some((member) => member.actor_id === actor.id)',
    );
    expect(retry).not.toContain(".from('group_chat_messages')\n    .insert");
  });

  it('derives the current audience and every notification field on the server', () => {
    expect(retry).toContain('const members = await listEligibleMembers()');
    expect(notify).toContain(".from('group_chat_preferences')");
    expect(notify).toContain('shouldFanoutGroupChatPush({');
    expect(notify).toContain(
      'senderActorId: input.message.sender_actor_id',
    );
    expect(notify).toContain('recipient_actor_id: member.immutable_actor_id');
    expect(notify).toContain('title: GROUP_CHAT_ROOM_TITLE');
    expect(notify).toContain('buildGroupChatPreview(input.message)');
    expect(notify).toContain(
      "target: { version: 1, kind: 'group_chat', roomId: input.roomId }",
    );
    expect(retry).not.toContain('payload.recipient');
    expect(retry).not.toContain('payload.content');
    expect(retry).not.toContain('payload.target');
    expect(retry).not.toContain('payload.notification');
  });

  it('upserts one delivery key per current recipient and validates exact canonical rows before push', () => {
    const persist = edge.slice(
      edge.indexOf('async function insertNotificationsWithFallback'),
      edge.indexOf('function selectEligibleRecipientTokens'),
    );
    const persistenceCall = notify.indexOf(
      'await insertNotificationsWithFallback(notificationRows)',
    );
    const providerCall = notify.indexOf(
      'await sendExpoPushPayloads(pushPayload)',
    );

    expect(notify).toContain('groupChatNotificationDeliveryKey(');
    expect(batching).toContain('GROUP_CHAT_DATA_API_BATCH_SIZE = 100');
    expect(persist).toContain(
      'for (const batch of chunkGroupChatDataApiValues(rows))',
    );
    expect(persist).toContain(
      ".upsert(batch, { onConflict: 'delivery_key' })",
    );
    expect(persist).not.toContain(
      ".upsert(rows, { onConflict: 'delivery_key' })",
    );
    expect(persist).toContain(
      ".select('id,resident_id,recipient_role,recipient_actor_id,target,delivery_key')",
    );
    expect(persist).toContain(
      'row.delivery_key !== expected.delivery_key',
    );
    expect(persist).toContain(
      'validatePersistedNotificationForDelivery',
    );
    expect(persist).toContain(
      'idsByActor.size - confirmedBeforeBatch !== batch.length',
    );
    expect(providerCall).toBeGreaterThan(persistenceCall);
    expect(notify).toContain('if (notificationInsert.failed)');
    expect(notify.indexOf('if (notificationInsert.failed)')).toBeLessThan(
      providerCall,
    );
  });

  it('bounds large-room member, preference, token, and notification Data API operations', () => {
    const membersStart = edge.indexOf('async function listEligibleMembers()');
    const membersEnd = edge.indexOf(
      'async function getEligibleFcMemberByActorId',
      membersStart,
    );
    const members = edge.slice(membersStart, membersEnd);
    const nativePreferenceStart = edge.indexOf(
      'async function resolveNativePushRecipients',
    );
    const nativePreferenceEnd = edge.indexOf(
      'async function notifyRecipients',
      nativePreferenceStart,
    );
    const nativePreferences = edge.slice(
      nativePreferenceStart,
      nativePreferenceEnd,
    );

    expect(members).toContain('collectGroupChatDataApiPages');
    expect(members).toContain(".order('id', { ascending: true })");
    expect(members).toContain('.range(from, to)');
    expect(nativePreferences).toContain('collectGroupChatDataApiBatches(actorIds');
    expect(notify).toContain(
      'collectGroupChatDataApiBatches(immutableActorIds',
    );
    expect(notify).toContain(
      'collectGroupChatDataApiBatches(legacyActorIds',
    );
    expect(notify).toContain(
      'collectGroupChatDataApiBatches(\n    recipientPhones',
    );
    expect(notify).not.toContain(".in('actor_id', immutableActorIds)");
    expect(notify).not.toContain(".in('resident_id', recipientPhones)");
  });

  it('keeps duplicate and partial-audience retry idempotency compatible in schema and migration', () => {
    for (const source of [schema, migration]) {
      expect(source).toMatch(
        /create unique index if not exists idx_notifications_delivery_key_unique\s+on public\.notifications \(delivery_key\);/,
      );
      expect(source).not.toMatch(
        /idx_notifications_delivery_key_unique[\s\S]{0,120}\bwhere\b/,
      );
    }
    expect(notify).toContain('members.filter((member) =>');
    expect(edge).toContain('ids_by_actor: idsByActor');
    expect(notify).toContain(
      'notificationIds: Array.from(notificationInsert.ids_by_actor.values())',
    );
  });

  it('never turns read-state, no-device, provider, or unread outcomes into a sender retry token', () => {
    expect(edge).toContain('read_state: { updated: readStateUpdated }');
    expect(edge).toContain("reason: 'read_state_update_failed'");
    expect(edge).not.toContain(
      '메시지는 저장됐지만 읽음 상태 반영을 확인하지 못했습니다.',
    );
    expect(edge).toContain("pushStatus: 'no_registered_device'");
    expect(notify).toContain("pushStatus: 'provider_rejected'");
    expect(notify).toContain('retryable: false');
    expect(edge).toContain(
      'if (summary.delivery.notificationStored) return null',
    );
  });
});
