import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('canonical notification persistence before provider delivery', () => {
  it('normal and lifecycle fc-notify branches fail before provider calls without a verified inbox UUID', () => {
    const source = read('supabase/functions/fc-notify/index.ts');
    const normalStart = source.indexOf("if (body.type === 'notify' || body.type === 'message')");
    const lifecycleStart = source.indexOf('// 기존 fc/admin');
    const normal = source.slice(normalStart, lifecycleStart);
    const lifecycle = source.slice(lifecycleStart);

    expect(normal).toContain('verifyExistingNotificationForDelivery');
    expect(normal.indexOf('if (logError || !notificationId)')).toBeLessThan(
      normal.indexOf('notifyAdminWebPush('),
    );
    expect(normal.indexOf('if (logError || !notificationId)')).toBeLessThan(
      normal.indexOf('sendExpoPushPayloads(pushPayload)'),
    );
    expect(normal).not.toContain('notificationId: notificationId ?? null');

    expect(lifecycle).toContain('if (notificationPersistenceFailed)');
    expect(lifecycle.indexOf('if (notificationPersistenceFailed)')).toBeLessThan(
      lifecycle.indexOf('notifyAdminWebPush('),
    );
    expect(lifecycle.indexOf('if (notificationPersistenceFailed)')).toBeLessThan(
      lifecycle.indexOf('sendExpoPushPayloads(payload)'),
    );
    expect(lifecycle).not.toContain(
      `notificationId: notificationIdByRecipient.get(String(t.resident_id ?? '')) ?? null`,
    );
  });

  it('group chat does not query tokens or call Expo when inbox fanout mapping is incomplete', () => {
    const source = read('supabase/functions/group-chat/index.ts');
    const notifyStart = source.indexOf('async function notifyRecipients');
    const notifyEnd = source.indexOf('function notificationFanoutFailureSummary');
    const notify = source.slice(notifyStart, notifyEnd);

    expect(notify).toContain('if (notificationInsert.failed)');
    expect(notify.indexOf('if (notificationInsert.failed)')).toBeLessThan(
      notify.indexOf(".from('device_tokens')"),
    );
    expect(notify.indexOf('if (notificationInsert.failed)')).toBeLessThan(
      notify.indexOf('sendExpoPushPayloads(pushPayload)'),
    );
    expect(notify).not.toContain(
      `notificationId: notificationInsert.ids_by_resident.get(row.resident_id ?? '') ?? null`,
    );
  });

  it('admin actions validate the returned persisted row before calling fc-notify', () => {
    const source = read('supabase/functions/admin-action/index.ts');
    const sendStart = source.indexOf("if (action === 'sendNotification')");
    const sendBranch = source.slice(sendStart);

    expect(sendBranch).toContain(
      ".select('id,target,recipient_role,recipient_actor_id,resident_id')",
    );
    expect(sendBranch).toContain('validatePersistedNotificationForDelivery');
    expect(sendBranch).toContain('const push = persisted.ok');
    expect(sendBranch).toContain("pushStatus: 'not_attempted'");
  });

  it('direct message send uses one idempotent atomic message-plus-notification RPC', () => {
    const edge = read('supabase/functions/fc-notify/index.ts');
    const migration = read(
      'supabase/migrations/20260725004017_add_typed_notification_targets_and_receipts.sql',
    );
    const schema = read('supabase/schema.sql');

    expect(edge).toContain("'send_garamin_direct_message_with_notification'");
    expect(edge).toContain('client_message_id');
    expect(edge).not.toContain(
      ".from('messages')\n        .insert({\n          conversation_id: resolution.id",
    );
    for (const sql of [migration, schema]) {
      expect(sql).toContain(
        'create or replace function public.send_garamin_direct_message_with_notification',
      );
      expect(sql).toContain('on conflict (delivery_key) do update');
      expect(sql).toContain(
        'create unique index if not exists idx_notifications_delivery_key_unique',
      );
      expect(sql).not.toMatch(
        /idx_notifications_delivery_key_unique[\s\S]{0,120}where delivery_key is not null/,
      );
      expect(sql).toContain("'direct_message:' || p_message_id::text");
      expect(sql).toContain(
        'grant execute on function public.send_garamin_direct_message_with_notification',
      );
    }
  });

  it('comment and like domain writes expose notification persistence failures', () => {
    for (const file of [
      'supabase/functions/board-comment-create/index.ts',
      'supabase/functions/board-comment-like-toggle/index.ts',
    ]) {
      const source = read(file);
      expect(source).toContain('notificationStored');
      expect(source).toContain('notificationWarning');
      expect(source).toContain('validatePersistedNotificationForDelivery');
    }
  });
});
