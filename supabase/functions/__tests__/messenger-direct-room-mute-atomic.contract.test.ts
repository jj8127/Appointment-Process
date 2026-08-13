import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');
const migrationPath = join(
  root,
  'supabase',
  'migrations',
  '20260804113409_atomic_direct_room_mute_notifications.sql',
);
const predecessorPath = join(
  root,
  'supabase',
  'migrations',
  '20260729032148_direct_message_target_isolation.sql',
);

const migration = readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');
const predecessor = readFileSync(predecessorPath, 'utf8').replace(/\r\n/g, '\n');
const compact = migration.replace(/\s+/g, ' ').toLowerCase();

function predecessorFunction(name: string): string {
  const start = predecessor.indexOf(`create or replace function public.${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = predecessor.indexOf(`\nrevoke all on function public.${name}`, start);
  expect(end).toBeGreaterThan(start);
  return predecessor.slice(start, end);
}

describe('atomic GaramIn direct-message room mute migration', () => {
  it('uses the exact recipient actor tuple and canonical resolved thread key', () => {
    expect(migration).toContain(
      'from public.messenger_room_notification_preferences preference',
    );
    expect(migration).toContain(
      'preference.actor_id = p_recipient_actor_id',
    );
    expect(migration).toContain(
      'preference.actor_role = p_recipient_role',
    );
    expect(migration).toContain('preference.room_key = p_room_key');
    expect(migration).toContain('preference.muted = true');
    expect(migration).toContain(
      "'garamin:direct-thread:' || v_thread_id::text",
    );
    expect(migration).toContain('select message.thread_id');
    expect(migration).toContain('where message.id = v_message_id');
  });

  it('fails preference/resolution reads closed by skipping only the notification insert', () => {
    expect(migration).toMatch(
      /create or replace function public\.garamin_direct_room_notification_allowed_v1[\s\S]*?exception[\s\S]*?when others then\s+return false;/,
    );
    expect(migration).toMatch(
      /create trigger notifications_garamin_direct_room_mute_v1\s+before insert on public\.notifications/,
    );
    expect(migration).toMatch(
      /when others then\s+null;[\s\S]*?return null;/,
    );
    expect(migration).toContain(
      "coalesce(new.target ->> 'kind', '') <> 'garamin_direct_chat'",
    );
    expect(migration).toContain(
      "new.category is distinct from 'message'",
    );
    expect(migration).not.toMatch(/security\s+definer/i);
  });

  it('preserves an already-persisted notification on an idempotent replay', () => {
    expect(migration).toMatch(
      /if exists \(\s+select 1\s+from public\.notifications notification\s+where notification\.delivery_key = new\.delivery_key\s+\) then\s+return new;/,
    );
    expect(
      migration.indexOf('notification.delivery_key = new.delivery_key'),
    ).toBeLessThan(
      migration.indexOf(
        'public.garamin_direct_room_notification_allowed_v1(',
        migration.indexOf(
          'create or replace function public.enforce_garamin_direct_room_mute_on_notification_v1',
        ),
      ),
    );
  });

  it.each([
    [
      'send_garamin_direct_message_with_notification',
      'direct_text_room_mute_patch_source_drift',
      "jsonb_array_length(coalesce(v_notification_rows, '[]'::jsonb)) = 0",
    ],
    [
      'commit_garamin_direct_message_with_attachments_v2',
      'direct_attachment_room_mute_patch_source_drift',
      'cardinality(v_notification_ids) < 1',
    ],
    [
      'commit_garamin_direct_broadcast_with_attachments_v2',
      'direct_broadcast_room_mute_patch_source_drift',
      'cardinality(v_notification_ids) <> v_count',
    ],
  ])(
    'patches %s to reset and consume the same-transaction suppression predicate',
    (functionName, driftGuard, predecessorIntegrityCheck) => {
      const body = predecessorFunction(functionName);
      expect(body).toContain('insert into public.notifications');
      expect(body).toContain(predecessorIntegrityCheck);
      expect(migration).toContain(`'public.${functionName}(`);
      expect(migration).toContain(driftGuard);
    },
  );

  it('counts muted rows separately while preserving unexpected unmuted insert failures', () => {
    expect(migration).toContain(
      "perform set_config(\\'app.garamin_direct_room_notifications_suppressed\\', \\'0\\', true);",
    );
    expect(migration).toContain(
      "current_setting(\\'app.garamin_direct_room_notifications_suppressed\\', true)",
    );
    expect(migration.match(/v_notification_expected_count integer/g)).toHaveLength(2);
    expect(migration.match(/v_notification_persisted_count integer/g)).toHaveLength(2);
    expect(migration.match(/v_notification_suppressed_count integer/g)).toHaveLength(2);
    expect(migration.match(/v_notification_persisted_count \+ v_notification_suppressed_count/g)).toHaveLength(2);
    expect(migration.match(/<> v_notification_expected_count then/g)).toHaveLength(2);
    expect(migration).toMatch(
      /cardinality\(v_notification_ids\)[\s\S]*?notifications_suppressed[\s\S]*?<> v_count then/,
    );
    expect(migration).toContain(
      "raise exception \\'direct_message_notification_not_persisted\\'",
    );
  });

  it('keeps helper and all three RPC boundaries service-role-only', () => {
    for (const functionName of [
      'garamin_direct_room_notification_allowed_v1',
      'enforce_garamin_direct_room_mute_on_notification_v1',
      'send_garamin_direct_message_with_notification',
      'commit_garamin_direct_message_with_attachments_v2',
      'commit_garamin_direct_broadcast_with_attachments_v2',
    ]) {
      expect(compact).toContain(
        `revoke all on function public.${functionName}`,
      );
      expect(compact).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}[\\s\\S]*?to service_role;`,
        ),
      );
    }
    expect(compact).not.toMatch(/\bto\s+(anon|authenticated|public)\s*;/);
  });
});
