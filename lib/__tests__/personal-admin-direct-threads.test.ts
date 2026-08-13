import fs from 'node:fs';
import path from 'node:path';
import { getStaffChatActorId, getStaffChatSenderName } from '../staff-identity';

const root = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260808131459_personal_admin_direct_threads_v1.sql',
);

const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('personal plain-admin direct-message contract', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const schema = read('supabase/schema.sql');
  const edge = read('supabase/functions/fc-notify/index.ts');
  const policy = read('supabase/functions/_shared/direct-message-policy.ts');
  const hub = read('lib/messenger-hub-model.ts');
  const notificationPreferences = read('supabase/functions/notification-preferences/index.ts');

  test('ships an additive actor-bound migration and matching schema snapshot', () => {
    expect(migration).toContain(
      "counterparty_role = 'admin'\n    or (",
    );
    expect(migration).toContain(
      "v_thread.counterparty_actor_id is distinct from p_sender_actor_id",
    );
    expect(migration).toContain(
      "v_identity.resolved_counterparty_actor_id is null then",
    );
    expect(migration).toContain(
      "grant execute on function public.assert_garamin_direct_message_identity_v2(",
    );
    expect(schema).toContain('-- Migration 20260808131459: personal admin direct threads v1.');
    expect(schema).toContain('personal_admin_direct_text_source_drift');
  });

  test('resolves a plain admin target by exact active account phone and actor UUID', () => {
    expect(edge).toContain("role: 'admin' as const,\n      actorId: row.id");
    expect(edge).toContain(": { role: 'admin', actorId: input.actor.actorId }");
    expect(edge).toContain(".eq('counterparty_actor_id', actor.actorId)");
    expect(edge).toContain(
      "actor.sessionRole === 'fc'\n        && row.counterparty_role === 'admin'\n        && row.counterparty_actor_id === null",
    );
    expect(edge).toContain(
      "...((admins ?? []) as { phone?: string | null }[]).map((admin) => sanitize(admin.phone))",
    );
    expect(edge).not.toContain('...adminSummary');
  });

  test('keeps cross-admin visibility denied while retaining explicit legacy compatibility', () => {
    expect(policy).toContain('input.counterparty.actorId === actor.actorId');
    expect(policy).toContain('input.counterparty.actorId === null');
    expect(policy).toContain("? ADMIN_CHAT_ID\n        : digits(input.counterparty.phone)");
    expect(edge).toContain("&& input.thread.counterparty.actorId === null");
    expect(notificationPreferences).toContain(
      'thread.counterparty_actor_id === actor.id',
    );
  });

  test('renders exact personal targets without the shared admin destination', () => {
    expect(hub).toContain("return realName ? `${realName}총무` : '총무';");
    expect(hub).toContain("kind === 'developer'\n        ? '개발자'");
    expect(hub).toContain("input.admins.forEach((target) => appendTarget(target, 'operations'))");
    expect(hub).not.toContain('internal-target:${ADMIN_CHAT_ID}');
  });

  test('uses the signed plain-admin phone and real-name label for sent messages', () => {
    expect(getStaffChatActorId({
      residentId: '010-1234-5678',
      staffType: 'admin',
      readOnly: false,
    })).toBe('01012345678');
    expect(getStaffChatSenderName({
      displayName: '김가람 총무',
      residentId: '010-1234-5678',
      staffType: 'admin',
      readOnly: false,
    })).toBe('김가람총무');
  });
});
