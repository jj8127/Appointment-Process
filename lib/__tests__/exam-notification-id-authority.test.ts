import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const migration = readFileSync(
  join(
    root,
    'supabase',
    'migrations',
    '20260725004017_add_typed_notification_targets_and_receipts.sql',
  ),
  'utf8',
);
const schema = readFileSync(join(root, 'supabase', 'schema.sql'), 'utf8');
const adminAction = readFileSync(
  join(root, 'supabase', 'functions', 'admin-action', 'index.ts'),
  'utf8',
);

describe('exam decision notification identity authority', () => {
  it.each([migration, schema])('returns the exact inserted notification and recipient actor from the RPC', (source) => {
    expect(source).toMatch(/exam_type text,\s+notification_id uuid,\s+recipient_actor_id uuid/);
    expect(source).toContain('returning id into v_notification_id');
    expect(source).toMatch(
      /v_registration\.resident_id, v_exam_type, v_notification_id,\s+v_registration\.fc_id/,
    );
  });

  it('revalidates only the exact RPC notification row before provider push', () => {
    const transitionBlock =
      adminAction.split("if (action === 'transitionExamRegistration'")[1]
        ?.split('// ── deleteFc ──')[0] ?? '';
    expect(transitionBlock).toContain("const notificationId = String(result?.notification_id ?? '').trim()");
    expect(transitionBlock).toContain("const recipientActorId = String(result?.recipient_actor_id ?? '').trim()");
    expect(transitionBlock).toContain('notificationId,');
    expect(transitionBlock).toContain('recipientActorId,');
    expect(transitionBlock).toContain(".from('notifications')");
    expect(transitionBlock).toContain(".eq('id', notificationId)");
    expect(transitionBlock).toContain('validatePersistedNotificationForDelivery(');
    expect(transitionBlock).toContain('notificationId: persisted.notificationId');
    expect(transitionBlock).not.toContain("order('created_at'");
  });
});
