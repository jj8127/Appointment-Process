import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('board notification-only retry contract', () => {
  const retry = read('supabase/functions/board-notification-retry/index.ts');
  const create = read('supabase/functions/board-create/index.ts');
  const update = read('supabase/functions/board-update/index.ts');
  const event = read(
    'supabase/functions/_shared/board-notification-event.ts',
  );
  const actorPolicy = read(
    'supabase/functions/_shared/board-actor-policy.ts',
  );
  const schema = read('supabase/schema.sql');
  const migration = read(
    'supabase/migrations/20260725004017_add_typed_notification_targets_and_receipts.sql',
  );

  it('returns a stable retry token without asking the caller to resubmit a post', () => {
    for (const source of [create, update]) {
      expect(source).toContain('deriveBoardNotificationEventKey({');
      expect(source).toContain('boardNotificationDeliveryKey(eventKey');
      expect(source).toContain('delivery_key:');
      expect(source).toContain(
        ".select('id,recipient_role,recipient_actor_id,resident_id,target,delivery_key')",
      );
      expect(source).toContain('row.delivery_key !== expected.delivery_key');
      expect(source).toContain('notificationStored: inboxOk');
      expect(source).toContain('notificationRetry: inboxOk ? null');
      expect(source).toContain("{ postId");
    }
    expect(create).toContain(".select('id,updated_at')");
    expect(update).toContain(".select('id,title,updated_at')");
    expect(event).toContain("'SHA-256'");
    expect(event).toContain('`${postId}\\n${updatedAt}`');
  });

  it('authenticates a current writer and derives retry scope from the committed post', () => {
    const actorCheck = retry.indexOf('await requireActor(');
    const roleCheck = retry.indexOf(
      "requireRole(actorCheck.actor, ['admin', 'manager']",
    );
    const postLookup = retry.indexOf(".from('board_posts')");
    const eventDerivation = retry.indexOf(
      'const canonicalEventKey = await deriveBoardNotificationEventKey',
    );
    const persistence = retry.indexOf('await persistBoardNotifications({');

    expect(actorCheck).toBeGreaterThan(-1);
    expect(roleCheck).toBeGreaterThan(actorCheck);
    expect(postLookup).toBeGreaterThan(roleCheck);
    expect(eventDerivation).toBeGreaterThan(postLookup);
    expect(persistence).toBeGreaterThan(eventDerivation);
    expect(retry).toContain("code: 'stale_notification_event'");
    expect(retry).toContain("post.author_role !== 'manager'");
    expect(retry).toContain(
      'post.author_resident_id !== actorCheck.actor.residentId',
    );
    expect(actorPolicy).not.toMatch(
      /BOARD_AUTOMATION_ACTIONS[\s\S]*board-notification-retry/,
    );
    expect(retry).not.toContain('target_role: body.');
    expect(retry).not.toContain('recipient_role: body.');
    expect(retry).not.toContain('resident_id: body.');
    expect(retry).not.toContain('target: body.');
    expect(retry).not.toContain('notification_id: body.');
  });

  it('upserts one inbox row per server-derived role before any provider call', () => {
    const persistStart = retry.indexOf('async function persistBoardNotifications');
    const persistEnd = retry.indexOf('async function sendProviderPush');
    const handlerStart = retry.indexOf('serve(async');
    const persistedGate = retry.indexOf('if (!persisted.ok)', handlerStart);
    const provider = retry.indexOf('sendProviderPush({', persistedGate);
    const persistSource = retry.slice(persistStart, persistEnd);

    expect(persistSource).toContain('BOARD_NOTIFICATION_ROLES.map');
    expect(persistSource).toContain(
      ".upsert(rows, { onConflict: 'delivery_key' })",
    );
    expect(persistSource).toContain(
      ".select('id,recipient_role,recipient_actor_id,resident_id,target,delivery_key')",
    );
    expect(persistSource).toContain(
      'validatePersistedNotificationForDelivery',
    );
    expect(persistSource).toContain(
      'notificationIdByRole.size === BOARD_NOTIFICATION_ROLES.length',
    );
    expect(persistedGate).toBeGreaterThan(handlerStart);
    expect(provider).toBeGreaterThan(persistedGate);
    expect(retry).toContain('notification_id: input.notificationId');
    expect(retry).toContain('skip_notification_insert: true');
    expect(retry).not.toMatch(/notificationId:\s*[^,\n]*\?\?\s*null/);
  });

  it('locks database idempotency and the committed update version in schema and migration', () => {
    for (const source of [schema, migration]) {
      expect(source).toMatch(
        /create unique index if not exists idx_notifications_delivery_key_unique\s+on public\.notifications \(delivery_key\);/,
      );
      expect(source).not.toMatch(
        /idx_notifications_delivery_key_unique[\s\S]{0,120}\bwhere\b/,
      );
      const atomicUpdate = source.match(
        /create or replace function public\.update_board_post_atomic\([\s\S]*?grant execute on function public\.update_board_post_atomic[\s\S]*?to service_role;/,
      )?.[0] ?? '';
      expect(atomicUpdate).toContain('security invoker');
      expect(atomicUpdate).toContain('updated_at = now()');
      expect(atomicUpdate).toContain(
        'from public, anon, authenticated',
      );
    }
  });

  it('reports only inbox persistence as retryable sender failure', () => {
    expect(retry).toContain('notificationStored: false');
    expect(retry).toContain("pushStatus: 'not_attempted'");
    expect(retry).toContain('retryable: true');
    expect(retry).toContain('notificationStored: true');
    expect(retry).toContain('retryable: false');
    expect(retry).toContain('notificationWarning: null');
  });
});
