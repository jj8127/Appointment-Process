import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const preferences = readFileSync(
  join(root, 'supabase', 'functions', 'notification-preferences', 'index.ts'),
  'utf8',
);
const deviceTokens = readFileSync(
  join(root, 'supabase', 'functions', 'device-token-register', 'index.ts'),
  'utf8',
);
const directProducer = readFileSync(
  join(root, 'supabase', 'functions', 'fc-notify', 'index.ts'),
  'utf8',
);
const migration = readFileSync(
  join(root, 'supabase', 'migrations', '20260804093738_add_app_push_and_messenger_room_preferences.sql'),
  'utf8',
);
const hubActionsMigration = readFileSync(
  join(root, 'supabase', 'migrations', '20260808141824_messenger_room_hub_actions_v1.sql'),
  'utf8',
);
const atomicPatchMigration = readFileSync(
  join(root, 'supabase', 'migrations', '20260808151912_atomic_messenger_room_preference_patch_v1.sql'),
  'utf8',
);

describe('notification preference privileged boundaries', () => {
  it('derives the immutable actor tuple and re-authorizes canonical room access', () => {
    expect(preferences).toContain('parseAppSessionTokenDetailed(token)');
    expect(preferences).toContain('status: parsed.status ?? 401');
    expect(preferences).not.toContain('parseAppSessionToken(token)');
    expect(preferences).toContain(".from('admin_accounts')");
    expect(preferences).toContain(".from('manager_accounts')");
    expect(preferences).toContain(".from('fc_profiles')");
    expect(preferences).toContain('canAccessRoom(resolved.actor, action.roomKey)');
    expect(preferences).not.toContain('body.actor');
    expect(preferences).not.toContain('body.role');
  });

  it('stores pin and leave watermarks without deleting rooms or messages', () => {
    expect(preferences).toContain("body.action === 'set_room_pinned'");
    expect(preferences).toContain("body.action === 'leave_room'");
    expect(preferences).toContain("supabase.rpc('patch_messenger_room_preference_v1'");
    expect(preferences).toContain('new Date(row.updated_at).toISOString()');
    expect(preferences).toContain(".select('room_key,muted,pinned_at,left_at,updated_at,actor_id,actor_role')");
    expect(hubActionsMigration).toContain('add column if not exists pinned_at timestamptz');
    expect(hubActionsMigration).toContain('add column if not exists left_at timestamptz');
    expect(hubActionsMigration).not.toMatch(/delete from|drop table/i);
    expect(atomicPatchMigration).toContain('on conflict (actor_id, actor_role, room_key) do update');
    expect(atomicPatchMigration).toContain("when p_action = 'leave_room' then excluded.left_at");
    expect(atomicPatchMigration).toContain("when p_action = 'set_room_pinned' then excluded.pinned_at");
    expect(atomicPatchMigration).toContain('to service_role');
    expect(atomicPatchMigration).toMatch(/revoke all[\s\S]*from public, anon, authenticated/i);
  });

  it('rejects malformed read successes and confirms each requested write', () => {
    expect(preferences).toContain('parseQueryRows(categoryResult.data, isCategoryPreferenceRow)');
    expect(preferences).toContain('parseQueryRows(roomResult.data, isRoomPreferenceRow)');
    expect(preferences).toContain('collectSupabaseRows<RoomPreferenceRow>({');
    expect(preferences).toContain("queryName: 'notification_preferences_room_preferences'");
    expect(preferences).toMatch(/\.order\('updated_at', \{ ascending: false \}\)[\s\S]*\.order\('room_key', \{ ascending: true \}\)[\s\S]*\.range\(from, to\)/);
    expect(preferences).toContain('rowKey: (row) => row.room_key');
    expect(preferences).toContain('matchesAppPreferenceActor(globalRow, actor)');
    expect(preferences).toContain('isAppPushPreferenceRow(value)');
    expect(preferences).toContain('isAppPushCategoryPreferenceRow(value)');
    expect(preferences).toContain('isMessengerRoomPreferenceRow(value)');
    expect(preferences).not.toContain('function isExactPreferenceActor(');
    expect(preferences).toContain('globalPushEnabled: globalRow?.enabled ?? true');
    expect(preferences).not.toContain('categoryResult.data ?? []');
    expect(preferences).not.toContain('roomResult.data ?? []');
    expect(preferences).toContain(".select('enabled,updated_at,actor_id,actor_role')");
    expect(preferences).toContain(".select('category,enabled,updated_at,actor_id,actor_role')");
    expect(preferences).toContain('sameTimestamp(data.updated_at, updatedAt)');
    expect(preferences).toContain('const receiptMatchesAction = isRoomPreferenceRow(receipt)');
    expect(preferences).toContain('sameTimestamp(receipt.updated_at, updatedAt)');
    expect(preferences).toContain('data.phone !== phone');
    expect(preferences).toContain("value.staff_type === 'admin' || value.staff_type === 'developer'");
  });

  it('keeps all preference tables service-role-only with four frozen categories', () => {
    for (const table of [
      'app_push_preferences',
      'app_push_category_preferences',
      'messenger_room_notification_preferences',
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
    }
    expect(migration).toContain("'messages', 'request_activity', 'notices', 'operations'");
    expect(migration).toContain("'garamin:group:' || preferences.room_id::text");
  });

  it('allows actor-wide token deletion only through the signed owner tuple', () => {
    expect(deviceTokens).toContain('body.disableAll === true');
    expect(deviceTokens).toContain(".eq('resident_id', owner.residentId)");
    expect(deviceTokens).toContain(".eq('role', owner.role)");
    expect(deviceTokens).not.toContain('body.residentId');
  });

  it('deletes only room-muted inbox rows and filters Expo separately', () => {
    expect(directProducer).toContain(".from('messenger_room_notification_preferences')");
    expect(directProducer).toContain('if (preference.suppressInbox)');
    expect(directProducer).toContain(".from('notifications')");
    expect(directProducer).toContain('if (!preference.suppressExpo)');
    expect(directProducer).toContain('retryable: false');
  });
});
