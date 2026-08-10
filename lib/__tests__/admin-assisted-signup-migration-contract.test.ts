import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260810054317_admin_assisted_signup_v1.sql'),
  'utf8',
).replace(/\s+/g, ' ').toLowerCase();
const schema = fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('administrator-assisted signup database contract', () => {
  it.each([migration, schema])('preserves OTP truth and stores a distinct verification basis', (sql) => {
    expect(sql).toContain("signup_verification_method in ('phone_otp', 'admin_written_consent')");
    expect(sql).toContain("signup_verification_method = 'admin_written_consent'");
    expect(sql).toContain('phone_verified = false');
    expect(sql).not.toContain('phone_verified = true, signup_verification_method = \'admin_written_consent\'');
  });

  it.each([migration, schema])('keeps consent and challenge stores outside client access', (sql) => {
    for (const table of ['admin_assisted_signup_consents', 'fc_password_change_challenges']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(
        `revoke all privileges on table public.${table} from public, anon, authenticated`,
      );
    }
    expect(sql).not.toMatch(/create policy [^;]+admin_assisted_signup_consents/);
    expect(sql).not.toMatch(/create policy [^;]+fc_password_change_challenges/);
  });

  it.each([migration, schema])('binds the actor to an active administrator record', (sql) => {
    expect(sql).toContain('from public.admin_accounts account');
    expect(sql).toContain('and account.active = true');
    expect(sql).toContain('and account.staff_type = p_actor_staff_type');
    expect(sql).toContain("p_actor_staff_type not in ('admin', 'developer')");
  });

  it.each([migration, schema])('creates the profile, referral, credential, and consent in one RPC', (sql) => {
    expect(sql).toContain('create or replace function public.admin_create_assisted_signup_v1');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('public.apply_referral_link_state(');
    expect(sql).toContain("p_source => 'admin_override'");
    expect(sql).toContain('insert into public.fc_credentials');
    expect(sql).toContain('must_change_password');
    expect(sql).toContain('insert into public.admin_assisted_signup_consents');
  });

  it.each([migration, schema])('exposes all privileged RPCs only to service_role', (sql) => {
    for (const functionName of [
      'admin_create_assisted_signup_v1',
      'issue_admin_assisted_password_change_v1',
      'complete_admin_assisted_password_change_v1',
    ]) {
      expect(sql).toContain(`revoke all on function public.${functionName}`);
      expect(sql).toContain(`grant execute on function public.${functionName}`);
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${functionName}[\\s\\S]*?to service_role`));
    }
  });
});
