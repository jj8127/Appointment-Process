import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationName = '20260724093517_enforce_active_manager_shadow_recommender.sql';

describe('active manager-shadow recommender contract', () => {
  it('filters inactive manager shadows in web search and validates again before the RPC', () => {
    const source = readFileSync(
      join(process.cwd(), 'web', 'src', 'lib', 'admin-referrals.ts'),
      'utf8',
    );

    expect(source).toContain("from('manager_accounts')");
    expect(source).toContain(".eq('active', true)");
    expect(source).toContain('isManagerShadowRecommenderEligible({');
    expect(source).toContain('if (inviterFcId && !(await fetchRecommenderCandidateById(inviterFcId)))');
    expect(source).toContain("throw new Error('추천인으로 지정할 수 없는 FC입니다.')");
  });

  it('locks the active manager row before delegating to the existing atomic relation implementation', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', migrationName),
      'utf8',
    );

    expect(migration).toContain('rename to _apply_referral_link_state_unchecked_20260724');
    expect(migration).toContain('create or replace function public.apply_referral_link_state(');
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = public');
    expect(migration).toContain('manager_row.active = true');
    expect(migration).toContain('for share;');
    expect(migration).toContain("raise exception '추천인으로 지정할 수 없는 FC입니다.'");

    const inviteeLockIndex = migration.indexOf('from public.fc_profiles invitee_fc');
    const inviterLockIndex = migration.indexOf('from public.fc_profiles inviter_fc');
    const managerLockIndex = migration.indexOf('from public.manager_accounts manager_row');
    const delegateIndex = migration.indexOf('return public._apply_referral_link_state_unchecked_20260724(');
    expect(inviteeLockIndex).toBeGreaterThan(-1);
    expect(inviterLockIndex).toBeGreaterThan(inviteeLockIndex);
    expect(managerLockIndex).toBeGreaterThan(inviterLockIndex);
    expect(managerLockIndex).toBeGreaterThan(-1);
    expect(delegateIndex).toBeGreaterThan(managerLockIndex);

    expect(migration).toContain(
      'from public, anon, authenticated, service_role;',
    );
    expect(migration).toContain(
      'grant execute on function public.apply_referral_link_state(',
    );
    expect(migration).toContain(
      'create or replace function public.admin_apply_recommender_override(',
    );
  });

  it('matches formatted active-manager phone values after normalizing both sides', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', migrationName),
      'utf8',
    );
    const schema = readFileSync(join(process.cwd(), 'supabase', 'schema.sql'), 'utf8');
    const normalizedManagerPhoneMatch =
      "regexp_replace(coalesce(manager_row.phone, ''), '[^0-9]', '', 'g') = normalized_inviter_phone";

    expect(migration).toContain(normalizedManagerPhoneMatch);
    expect(schema).toContain(normalizedManagerPhoneMatch);
    expect(migration).toContain('for share;');
    expect(schema).toContain('for share;');
  });

  it('keeps the schema snapshot aligned with the forward migration wrapper and grants', () => {
    const schema = readFileSync(join(process.cwd(), 'supabase', 'schema.sql'), 'utf8');

    expect(schema).toContain(
      'create or replace function public._apply_referral_link_state_unchecked_20260724(',
    );
    expect(schema).toContain('create or replace function public.apply_referral_link_state(');
    expect(schema).toContain('manager_row.active = true');
    expect(schema).toContain('for share;');
    expect(schema).toContain(
      'revoke all on function public._apply_referral_link_state_unchecked_20260724',
    );
    expect(schema).toContain(
      'grant execute on function public.apply_referral_link_state',
    );
  });
});
