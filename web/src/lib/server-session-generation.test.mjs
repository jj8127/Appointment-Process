import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as staffSession from './staff-session.ts';
import * as fcSession from './fc-graph-session.ts';
import { checkSessionGeneration } from '../../../supabase/functions/_shared/session-generation.ts';

const require = createRequire(import.meta.url);
const id = '10000000-0000-4000-8000-000000000001';
const phone = '00000000001';
const secret = 'synthetic-web-session-generation-secret';
const compiled = ts.transpileModule(readFileSync(new URL('./server-session.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(role, cookieVersion, currentVersion) {
  const generation = { accountKind: role, accountId: id, sessionVersion: cookieVersion };
  const signed = role === 'fc'
    ? fcSession.createFcGraphSessionValue({ fcId: id, residentDigits: phone, secret, ...(cookieVersion === undefined ? {} : generation) })
    : staffSession.createStaffSessionValue({ role, residentDigits: phone, secret, ...(cookieVersion === undefined ? {} : generation) });
  const jar = {
    session_role: role,
    session_resident: phone,
    [role === 'fc' ? fcSession.FC_GRAPH_SESSION_COOKIE : staffSession.STAFF_SESSION_COOKIE]: signed,
  };
  const queries = [];
  let reads = 0;
  const record = { id, name: 'Synthetic', active: true, signup_completed: true, staff_type: 'admin' };
  const query = {
    select() { return query; }, in() { return query; }, eq() { return query; },
    async maybeSingle() { queries.push('record'); return { data: record, error: null }; },
  };
  const deps = {
    'next/headers': { cookies: async () => ({ get: name => jar[name] === undefined ? undefined : { value: jar[name] } }) },
    '@/lib/admin-supabase': { adminSupabase: { from: () => query } },
    '@/lib/csrf': { validateSession: () => ({ valid: true }) },
    '@/lib/logger': { logger: { warn() { assert.fail('raw diagnostic path should not run'); } } },
    '@/lib/phone-candidates': { buildPhoneCandidates: () => [phone] },
    '@/lib/staff-session': { ...staffSession, verifyStaffSessionValue: (value, options) => staffSession.verifyStaffSessionValue(value, { ...options, secret }) },
    '@/lib/fc-graph-session': { ...fcSession, verifyFcGraphSessionValue: (value, options) => fcSession.verifyFcGraphSessionValue(value, { ...options, secret }) },
    '@/lib/request-board-app-session': { lookupWebSessionGeneration: async input => {
      reads++;
      return currentVersion === 'unavailable' ? { ok: false, reason: 'unavailable' }
        : checkSessionGeneration(input, { accountKind: role, accountId: id, sessionVersion: currentVersion, createdAt: '2000-01-01T00:00:00Z' });
    } },
  };
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(specifier => {
    if (specifier in deps) return deps[specifier];
    return require(specifier);
  }, loaded, loaded.exports);
  return { run: () => loaded.exports.getVerifiedServerSession({ allowedRoles: [role] }), queries, reads: () => reads, jar };
}

for (const role of ['fc', 'admin', 'manager']) {
  test(`${role}: legacy cookie is accepted at zero, then rejected after only its password changes`, async () => {
    const legacy = fixture(role, undefined, 0);
    assert.equal((await legacy.run()).ok, true);
    assert.equal(legacy.reads(), 1);
    const revoked = fixture(role, undefined, 1);
    assert.deepEqual(await revoked.run(), { ok: false, status: 401, error: 'Invalid session' });
    assert.equal(revoked.queries.length, 0);
    const current = fixture(role, 1, 1);
    const result = await current.run();
    assert.equal(result.ok, true);
    assert.equal(result.session.sessionVersion, 1);
    assert.equal(result.session.accountId, id);
  });
}

test('web verification outages return 503 and invalid signatures never consult the database', async () => {
  const outage = fixture('admin', 2, 'unavailable');
  assert.equal((await outage.run()).status, 503);
  assert.equal(outage.queries.length, 0);
  const invalid = fixture('admin', 2, 2);
  invalid.jar.staff_session += 'x';
  assert.equal((await invalid.run()).status, 401);
  assert.equal(invalid.reads(), 0);
});
