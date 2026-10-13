import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeReferralAllowance,
  parseAllowanceAdminQuery,
  parseAllowanceManagerQuery,
  parseAllowancePilotQuery,
  parseAllowanceProfilesQuery,
  parseAllowanceReadRequest,
  readAllowanceCommand,
  type AllowanceAuthRepository,
  type AllowancePilot,
  type AllowanceProfile,
} from '../referral-allowance-auth.ts';

const managerId = '10000000-0000-4000-8000-000000000001';
const fcId = '20000000-0000-4000-8000-000000000001';
const foreignId = '30000000-0000-4000-8000-000000000001';
const phone = '01000000000';
const session = { role: 'manager', phone, fcId };
const profile: AllowanceProfile = { id: fcId, phone, affiliation: '가상본부', signupCompleted: false, isManagerReferralShadow: true };
const pilot: AllowancePilot = { managerAccountId: managerId, beneficiaryFcId: fcId, employeeCode: '000001', enabled: true, revision: 1 };

function repository(overrides: Partial<AllowanceAuthRepository> = {}): AllowanceAuthRepository {
  return {
    managerByPhone: async () => ({ id: managerId, active: true }),
    hasAdminAccount: async () => false,
    profilesForSession: async () => [profile],
    pilot: async () => pilot,
    ...overrides,
  };
}

test('allows only the active signed manager with both configured UUIDs', async () => {
  assert.deepEqual(await authorizeReferralAllowance(session, repository()), {
    enabled: true, identity: { managerAccountId: managerId, beneficiaryFcId: fcId }, pilot,
  });
  assert.equal((await authorizeReferralAllowance(session, repository({ profilesForSession: async () => [
    { ...profile, signupCompleted: true, isManagerReferralShadow: false },
  ] }))).enabled, true);
  assert.equal((await authorizeReferralAllowance({ role: 'manager', phone }, repository())).enabled, true);
  assert.equal((await authorizeReferralAllowance(session, repository({ profilesForSession: async () => [
    { ...profile, affiliation: null },
  ] }))).enabled, true);
});

test('fails closed for other roles, disabled accounts, mismatched sessions, and ambiguous profiles', async () => {
  for (const role of ['admin', 'developer', 'designer', '']) {
    assert.equal((await authorizeReferralAllowance({ ...session, role }, repository({
      managerByPhone: async () => { throw new Error('Must not query for this role'); },
    }))).enabled, false);
  }
  const cases: Partial<AllowanceAuthRepository>[] = [
    { managerByPhone: async () => null },
    { managerByPhone: async () => ({ id: managerId, active: false }) },
    { hasAdminAccount: async () => true },
    { profilesForSession: async () => [] },
    { profilesForSession: async () => [profile, profile] },
    { profilesForSession: async () => [{ ...profile, id: foreignId }] },
    { profilesForSession: async () => [{ ...profile, phone: '01000000001' }] },
    { profilesForSession: async () => [{ ...profile, affiliation: '가상 설계매니저' }] },
    { profilesForSession: async () => [{ ...profile, isManagerReferralShadow: false }] },
    { pilot: async () => null },
    { pilot: async () => ({ ...pilot, enabled: false }) },
    { pilot: async () => ({ ...pilot, managerAccountId: foreignId }) },
    { pilot: async () => ({ ...pilot, beneficiaryFcId: foreignId }) },
    { pilot: async () => ({ ...pilot, employeeCode: '' }) },
  ];
  for (const overrides of cases) assert.equal((await authorizeReferralAllowance(session, repository(overrides))).enabled, false);
  assert.equal((await authorizeReferralAllowance({ ...session, fcId: 'not-a-uuid' }, repository())).enabled, false);
});

test('allows an enrolled FC only for their own profile and rejects manager/FC role confusion', async () => {
  let lookedUp = '';
  const fcPilot = { ...pilot, managerAccountId: null };
  const fcProfile = { ...profile, signupCompleted: true, isManagerReferralShadow: false };
  const repo = repository({ managerByPhone: async () => null, profilesForSession: async () => [fcProfile],
    pilot: async (id) => { lookedUp = id; return fcPilot; } });
  assert.equal((await authorizeReferralAllowance({ ...session, role: 'fc' }, repo)).enabled, true);
  assert.equal(lookedUp, fcId);
  assert.equal((await authorizeReferralAllowance(session, repo)).enabled, false);
  assert.equal((await authorizeReferralAllowance({ ...session, role: 'fc' }, repository())).enabled, false);
  assert.equal((await authorizeReferralAllowance({ ...session, role: 'fc' }, { ...repo,
    pilot: async () => ({ ...fcPilot, beneficiaryFcId: foreignId }) })).enabled, false);
  assert.equal((await authorizeReferralAllowance({ ...session, role: 'fc' }, { ...repo,
    profilesForSession: async () => [{ ...fcProfile, signupCompleted: false }] })).enabled, false);
});

test('rechecks pilot permission on every read and does not retain an earlier allowance', async () => {
  let enabled = true;
  let reads = 0;
  const repo = repository({ pilot: async () => { reads += 1; return { ...pilot, enabled }; } });
  assert.equal((await authorizeReferralAllowance(session, repo)).enabled, true);
  enabled = false;
  assert.equal((await authorizeReferralAllowance(session, repo)).enabled, false);
  assert.equal(reads, 2);
  await assert.rejects(authorizeReferralAllowance(session, repository({ pilot: async () => { throw new Error('fake database unavailable'); } })));
});

test('parses allowance account rows only when the error-free payload matches the signed phone', () => {
  assert.deepEqual(parseAllowanceManagerQuery([{ id: managerId, phone, active: true }], phone), {
    id: managerId,
    active: true,
  });
  assert.equal(parseAllowanceManagerQuery([], phone), null);
  assert.equal(parseAllowanceAdminQuery([{ id: managerId, phone }], phone), true);
  assert.equal(parseAllowanceAdminQuery([], phone), false);

  for (const value of [null, {}, [{ id: managerId, active: true }], [
    { id: managerId, phone, active: true },
    { id: foreignId, phone, active: true },
  ], [{ id: managerId, phone: '01000000001', active: true }]]) {
    assert.throws(() => parseAllowanceManagerQuery(value, phone), /allowance_lookup_failed/);
  }
  assert.throws(
    () => parseAllowanceAdminQuery([{ id: managerId, phone: '01000000001' }], phone),
    /allowance_lookup_failed/,
  );
});

test('parses allowance profile and pilot rows without coercing partial values', () => {
  const profileRow = {
    id: fcId,
    phone,
    affiliation: null,
    signup_completed: true,
    is_manager_referral_shadow: false,
  };
  assert.deepEqual(parseAllowanceProfilesQuery([profileRow], phone, fcId), [{
    id: fcId,
    phone,
    affiliation: null,
    signupCompleted: true,
    isManagerReferralShadow: false,
  }]);
  assert.deepEqual(parseAllowanceProfilesQuery([], phone, fcId), []);
  assert.deepEqual(parseAllowancePilotQuery([{
    manager_account_id: managerId,
    beneficiary_fc_id: fcId,
    employee_code: '000001',
    enabled: true,
    revision: 1,
  }], fcId), pilot);
  assert.equal(parseAllowancePilotQuery([], fcId), null);

  for (const value of [null, [profileRow, profileRow], [{ ...profileRow, id: foreignId }],
    [{ ...profileRow, signup_completed: null }]]) {
    assert.throws(() => parseAllowanceProfilesQuery(value, phone, fcId), /allowance_lookup_failed/);
  }
  for (const value of [null, [{ manager_account_id: managerId, beneficiary_fc_id: foreignId,
    employee_code: '000001', enabled: true, revision: 1 }], [{ manager_account_id: managerId,
    beneficiary_fc_id: fcId, employee_code: '000001', enabled: true, revision: 0 }]]) {
    assert.throws(() => parseAllowancePilotQuery(value, fcId), /allowance_lookup_failed/);
  }
});

test('accepts only bounded action/month commands and rejects caller identity selectors', async () => {
  assert.deepEqual(parseAllowanceReadRequest({ action: 'access' }), { action: 'access' });
  assert.deepEqual(parseAllowanceReadRequest({ action: 'statement', month: '2026-08' }), { action: 'statement', month: '2026-08' });
  for (const body of [null, [], {}, { action: 'publish' }, { action: 'statement', month: '2026-13' },
    { action: 'statement', month: '2026-8' }, { action: 'access', fcId }, { action: 'access', managerId },
    { action: 'access', employeeCode: '000001' }, { action: 'access', month: null }]) {
    assert.equal(parseAllowanceReadRequest(body), null);
  }
  const request = (body: string) => new Request('https://example.invalid', { method: 'POST', body });
  assert.deepEqual(await readAllowanceCommand(request('{"action":"access"}')), { action: 'access' });
  assert.equal(await readAllowanceCommand(request('{')), null);
  assert.equal(await readAllowanceCommand(request(' '.repeat(1025))), null);
});
