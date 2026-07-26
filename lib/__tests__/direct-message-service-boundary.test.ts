import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const migrationPath = join(
  root,
  'supabase',
  'migrations',
  '20260725004017_add_typed_notification_targets_and_receipts.sql',
);
const schemaPath = join(root, 'supabase', 'schema.sql');
const edgePath = join(root, 'supabase', 'functions', 'fc-notify', 'index.ts');

describe('direct message trusted service boundary', () => {
  it.each([migrationPath, schemaPath])(
    'removes direct table and column CRUD from public clients while retaining service DML in %s',
    (path) => {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain('alter table public.messages enable row level security');
      expect(source).toMatch(
        /revoke all privileges on table public\.messages\s+from public, anon, authenticated, service_role/,
      );
      expect(source).toContain(
        "'revoke all privileges (%I) on table public.messages from public, anon, authenticated, service_role'",
      );
      expect(source).toContain("from pg_policies");
      expect(source).toContain("drop policy if exists %I on public.messages");
      expect(source).toContain('create policy "messages service role"');
      expect(source).toMatch(
        /grant select, insert, update, delete\s+on table public\.messages\s+to service_role/,
      );
      expect(source).toContain('add column if not exists sender_actor_id uuid');
      expect(source).toContain('add column if not exists receiver_actor_id uuid');
    },
  );

  it('backfills legacy message conversations only for an exact FC phone mapping', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration).toContain('from public.fc_profiles exact_profile');
    expect(migration).toContain('select count(*)');
    expect(migration).toContain('where exact_profile.phone = profile.phone');
  });

  it('backfills direct notification actors only from one active identity', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration).toContain('profile.signup_completed = true');
    expect(migration).toContain("notification.recipient_role = 'fc'");
    expect(migration).toContain('account.active = true');
    expect(migration).toContain("notification.recipient_role = 'admin'");
    expect(migration).toContain("notification.recipient_role = 'manager'");
    expect(migration).not.toMatch(/select min\((profile|account)\.id\)/);
    expect(migration).not.toMatch(
      /set recipient_actor_id[\s\S]*?limit 1[\s\S]*?where notification\.recipient_actor_id is null/,
    );
  });

  it('requires server-derived conversation membership and sender/receiver identity for direct actions', () => {
    const source = readFileSync(edgePath, 'utf8');
    for (const action of [
      'direct_message_list',
      'direct_message_send',
      'direct_message_mark_read',
      'direct_message_delete',
    ]) {
      expect(source).toContain(`body.type === '${action}'`);
    }
    expect(source).toContain('canAccessDirectConversation(appActor, resolution.fcId)');
    expect(source).toContain('buildDirectMessageIdentity({');
    expect(source).toContain('sender_id: identity.senderId');
    expect(source).toContain('receiver_id: identity.receiverId');
    expect(source).toContain('sender_actor_id: identity.senderActorId');
    expect(source).toContain('receiver_actor_id: identity.receiverActorId');
    const directInsert = source.match(
      /\.from\('messages'\)\s*\.insert\(\{[\s\S]*?sender_actor_id: identity\.senderActorId[\s\S]*?\}\)/,
    )?.[0] ?? '';
    expect(directInsert).not.toContain('sender_id: body.sender_id');
    expect(directInsert).not.toContain('receiver_id: body.receiver_id');
  });

  it('fails service notifications closed without an exact active recipient actor', () => {
    const source = readFileSync(edgePath, 'utf8');
    expect(source).toContain(
      "return err('recipient_actor_id is required for a direct service notification', 400)",
    );
    expect(source).toContain(
      "return err('Notification recipient actor does not match the active target', 403)",
    );
    expect(source).toContain("return err('Notification recipient is not active', 403)");
  });
});
