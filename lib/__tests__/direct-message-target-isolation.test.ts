import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const migrationPath = join(
  root,
  'supabase',
  'migrations',
  '20260729032148_direct_message_target_isolation.sql',
);
const schemaPath = join(root, 'supabase', 'schema.sql');
const edgePath = join(
  root,
  'supabase',
  'functions',
  'fc-notify',
  'index.ts',
);
const chatPath = join(root, 'app', 'chat.tsx');
const attachmentAuthPath = join(
  root,
  'supabase',
  'functions',
  '_shared',
  'messenger-attachment-auth.ts',
);

describe('GaramIn direct-message target isolation', () => {
  it('passes the FC-selected target to the trusted resolver', () => {
    const source = readFileSync(chatPath, 'utf8');
    expect(source).toContain('targetId: normalizedTargetId || null');
    expect(source).not.toContain("role === 'fc' ? null : normalizedTargetId");
  });

  it.each([migrationPath, schemaPath])(
    'defines additive target threads and preserves the legacy envelope in %s',
    (path) => {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain(
        'create table if not exists public.garamin_direct_threads',
      );
      expect(source).toContain(
        'constraint garamin_direct_threads_target_unique',
      );
      expect(source).toContain('unique nulls not distinct');
      expect(source).toContain(
        'add column if not exists thread_id uuid',
      );
      expect(source).toContain(
        'create trigger messages_assign_legacy_direct_thread_v2',
      );
      expect(source).toContain(
        'create or replace function public.assert_garamin_direct_message_identity_v2',
      );
      expect(source).toContain(
        'v_existing_message.thread_id',
      );
      expect(source).toContain(
        'reserve_messenger_attachment_upload_batch_legacy_v2',
      );
      expect(source).toContain(
        "v_identity.resolved_counterparty_role = 'admin'",
      );
      expect(source).toContain(
        "v_identity.resolved_counterparty_role = 'manager'",
      );
      expect(source).not.toContain('tokens truncated');
    },
  );

  it('keeps the canonical schema override byte-equivalent to the migration', () => {
    const migration = readFileSync(migrationPath, 'utf8')
      .replace(/\r\n/g, '\n')
      .trimEnd();
    const schema = readFileSync(schemaPath, 'utf8').replace(/\r\n/g, '\n');
    const marker =
      '-- Keep this block byte-equivalent to migration 20260729032148.\n';
    const markerIndex = schema.indexOf(marker);
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    const blockStart = markerIndex + marker.length;
    expect(schema.slice(blockStart, blockStart + migration.length)).toBe(migration);
    expect(schema.slice(blockStart + migration.length)).toMatch(/^\n\n/);
  });

  it('resolves, queries and responds with the exact target thread', () => {
    const source = readFileSync(edgePath, 'utf8');
    expect(source).toContain(".from('garamin_direct_threads')");
    expect(source).toContain(
      "counterparty_role: counterpartyResult.counterparty.role",
    );
    expect(source).toContain(
      "targetId: body.target_id",
    );
    expect(source).toContain(
      'counterparty_id:',
    );
    expect(source).toContain(
      '? resolution.counterpartyId',
    );
    expect(source).toContain(
      ".eq('thread_id', resolution.threadId)",
    );
    expect(source).toContain(
      'counterparty: resolution.counterparty',
    );
  });

  it('authorizes direct attachments from linked target threads, not a shared staff inbox', () => {
    const source = readFileSync(attachmentAuthPath, 'utf8');
    expect(source).toContain(
      ".select('thread_id,sender_actor_id,receiver_actor_id')",
    );
    expect(source).toContain(".from('garamin_direct_threads')");
    expect(source).toContain(
      "thread.counterparty_role === 'developer'",
    );
    expect(source).toContain(
      "thread.counterparty_role === 'manager'",
    );
    expect(source).not.toContain(
      "if (input.actor.role === 'admin' || input.actor.role === 'manager') return true",
    );
  });
});
