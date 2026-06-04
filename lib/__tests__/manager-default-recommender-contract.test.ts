import { readFileSync } from 'node:fs';

describe('manager default recommender contract', () => {
  const migration = readFileSync(
    'supabase/migrations/20260604000003_default_manager_recommender_kim_hyeongsu.sql',
    'utf8',
  );
  const schema = readFileSync('supabase/schema.sql', 'utf8');

  it('pins active manager profiles to Kim Hyeongsu as the default recommender', () => {
    for (const source of [migration, schema]) {
      expect(source).toContain('link_manager_profile_to_default_recommender');
      expect(source).toContain('01094272550');
      expect(source).toContain('김형수');
      expect(source).toContain('self_link_blocked');
      expect(source).toContain('apply_referral_link_state');
    }
  });

  it('keeps manager shadow profile refreshes idempotently linked to the default recommender', () => {
    expect(migration).toContain('manager_shadow_refresh');
    expect(migration).toContain('manager_profile_refresh');
    expect(migration).toContain('manager_shadow_created');
    expect(migration).toContain('manager_profile_backfill');
    expect(schema).toContain('manager_shadow_refresh');
    expect(schema).toContain('manager_profile_refresh');
    expect(schema).toContain('manager_shadow_created');
  });
});
