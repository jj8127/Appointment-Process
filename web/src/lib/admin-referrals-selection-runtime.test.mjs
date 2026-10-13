import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import * as referralTypes from '../types/referrals.ts';
import * as referralEventQuery from './admin-referral-event-query.ts';
import * as queryContract from './supabase-query-contract.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const serviceSource = readFileSync(new URL('./admin-referrals.ts', import.meta.url), 'utf8');
const ACTOR = {
  actorPhone: '01000000000',
  actorRole: 'admin',
  actorStaffType: 'admin',
};

function loadService(rpcData, queryResult = () => ({ data: [], count: 0, error: null })) {
  const code = ts.transpileModule(serviceSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const calls = [];
  const adminSupabase = {
    rpc: async () => ({ data: rpcData, error: null }),
    from(table) {
      const call = { table, filters: [], orders: [] };
      calls.push(call);
      const query = {
        select(columns, options = {}) { Object.assign(call, { columns, options }); return query; },
        order(column, options) { call.orders.push([column, options]); return query; },
        range(from, to) { call.range = [from, to]; return query; },
        limit(value) { call.limit = value; return query; },
        maybeSingle() { call.single = true; return Promise.resolve(queryResult(call)); },
        then(resolve, reject) { return Promise.resolve(queryResult(call)).then(resolve, reject); },
      };
      for (const method of ['eq', 'neq', 'not', 'like', 'ilike', 'is', 'in', 'or']) {
        query[method] = (...args) => { call.filters.push([method, ...args]); return query; };
      }
      return query;
    },
  };
  vm.runInNewContext(code, {
    exports,
    Intl,
    require: (id) => {
      if (id === 'server-only') return {};
      if (id === '@/types/referrals') return referralTypes;
      if (id === '@/lib/admin-supabase') return { adminSupabase };
      if (id === '@/lib/server-session') return { buildPhoneCandidates: () => [] };
      if (id === '@/lib/logger') return { logger: { warn() {}, error() {} } };
      if (id === '@/lib/fc-workflow') return { getCommissionCompletionState: () => ({ complete: false }) };
      if (id === '@/lib/referral-graph-edges') return { buildReferralGraphEdges: () => [] };
      if (id === '@/lib/referral-graph-highlight') return { resolveReferralGraphHighlightType: () => null };
      if (id === '@/lib/referral-graph-scope') return { collectReferralDownlineScopeIds: () => new Set() };
      if (id === '@/lib/recommender-relation-route-handler') {
        return { isManagerShadowRecommenderEligible: () => false, RECOMMENDER_RPC_NOT_READY_MESSAGE: 'not-ready' };
      }
      if (id === '@/lib/admin-referral-event-query') return referralEventQuery;
      if (id === '@/lib/supabase-query-contract') return queryContract;
      throw new Error(`Unexpected admin-referrals dependency ${id}`);
    },
  });
  return { ...exports, calls };
}

test('recommender selection service accepts only an exact clear receipt', async () => {
  const expected = {
    changed: false,
    inviteeFcId: 'invitee-1',
    inviterFcId: null,
    recommenderName: null,
    referralCode: null,
  };
  const service = loadService(expected);
  assert.equal(JSON.stringify(await service.applyRecommenderSelection({
    actor: ACTOR,
    inviteeFcId: 'invitee-1',
    inviterFcId: null,
    reason: '정정',
  })), JSON.stringify(expected));
});

test('referral list, graph, code, and event queries keep bounded database pagination contracts', () => {
  for (const queryName of [
    'admin_referrals_admin_accounts',
    'admin_referrals_manager_names',
    'admin_referrals_active_manager_phones',
    'admin_referrals_eligible_profiles',
    'admin_referrals_searchable_profiles',
    'admin_referrals_fc_profiles',
    'admin_referrals_codes',
    'admin_referrals_events',
    'admin_referrals_active_codes_for_profiles',
    'admin_referrals_unresolved_candidates',
  ]) {
    assert.match(serviceSource, new RegExp(`queryName: '${queryName}'`));
  }
  assert.match(serviceSource, /'admin_referrals_profile_page'/);
  assert.match(serviceSource, /\.range\(from, from \+ params\.pageSize - 1\)/);
  assert.match(serviceSource, /MAX_ADMIN_SEARCH_CODE_MATCHES \+ 1/);
  assert.match(serviceSource, /\.limit\(MAX_UNRESOLVED_PREVIEW\)/);
  for (const countQuery of [
    'admin_referrals_eligible',
    'admin_referrals_active_codes',
    'admin_referrals_disabled_codes',
    'admin_referrals_unresolved',
  ]) {
    assert.match(serviceSource, new RegExp(`requireExactCount\\([^\\n]+, '${countQuery}'\\)`));
  }
  assert.match(serviceSource, /isRow: isEligibleProfileRow/);
  assert.match(serviceSource, /isRow: isReferralCodeRow/);
  assert.match(serviceSource, /isRow: isReferralEventRow/);
});

const PROFILES = ['fc-a', 'fc-b', 'fc-c', 'fc-d'].map((id, index) => ({
  id,
  name: `Synthetic ${id}`,
  phone: `0100000010${index}`,
  affiliation: 'Synthetic affiliation',
  signup_completed: true,
  appointment_date_life: null,
  appointment_date_nonlife: null,
  life_commission_completed: false,
  nonlife_commission_completed: false,
  is_manager_referral_shadow: false,
}));

function referralReadResult(call) {
  const response = (data, count = null) => ({ data, count, error: null });
  if (call.options.head) {
    if (call.table === 'referral_codes') {
      const active = call.filters.find(([method, field]) => method === 'eq' && field === 'is_active')[2];
      return response(null, active ? 6 : 1);
    }
    return response(null, call.filters.some(([method]) => method === 'is') ? 0 : 10);
  }
  if (call.table === 'admin_accounts') return response([{ id: 'staff-1', phone: ACTOR.actorPhone }]);
  if (call.table === 'manager_accounts') return response([]);
  if (call.table === 'fc_profiles') {
    if (call.single) {
      const id = call.filters.find(([method, field]) => method === 'eq' && field === 'id')[2];
      return response(PROFILES.find((profile) => profile.id === id) ?? null);
    }
    if (call.options.count === 'exact') {
      return response(PROFILES.slice(call.range[0], call.range[1] + 1), PROFILES.length);
    }
    return response([]);
  }
  if (call.table === 'referral_codes') {
    if (call.columns === 'id,fc_id') return response([{ id: 'code-match', fc_id: 'fc-d' }]);
    const ids = call.filters.find(([method]) => method === 'in')[2];
    return response(ids.map((fcId) => ({
      id: `code-${fcId}`, fc_id: fcId, code: `CODE-${fcId}`, is_active: true,
      created_at: '2026-10-13T00:00:00Z', disabled_at: null,
    })));
  }
  if (call.table === 'referral_events') return response([]);
  throw new Error(`Unexpected referral read table ${call.table}`);
}

test('referral list reads the requested database page with search filters and a global summary', async () => {
  const service = loadService(null, referralReadResult);
  const result = JSON.parse(JSON.stringify(await service.getReferralAdminData(
    { role: 'admin' }, { page: '2', pageSize: '2', search: 'SEARCH', fcId: 'fc-a' },
  )));
  assert.deepEqual(result.items.map((item) => [item.fcId, item.activeCode]), [
    ['fc-c', 'CODE-fc-c'], ['fc-d', 'CODE-fc-d'],
  ]);
  assert.equal(result.total, 4);
  assert.deepEqual(result.summary, {
    eligibleCount: 10, activeCodeCount: 6, missingCodeCount: 4,
    disabledCodeCount: 1, unresolvedLegacyCount: 0,
  });
  assert.equal(result.detail.fcId, 'fc-a');
  assert.equal(result.detail.currentCode.code, 'CODE-fc-a');
  const pageQuery = service.calls.find((call) => call.table === 'fc_profiles'
    && call.options.count === 'exact' && !call.options.head);
  assert.deepEqual(pageQuery.range, [2, 3]);
  assert.deepEqual(JSON.parse(JSON.stringify(pageQuery.orders)), [
    ['created_at', { ascending: false }], ['id', { ascending: true }],
  ]);
  assert.ok(pageQuery.filters.some(([method, field, operator, value]) => method === 'not'
    && field === 'phone' && operator === 'in' && value === `(${ACTOR.actorPhone})`));
  const searchFilter = pageQuery.filters.find(([method]) => method === 'or')[1];
  for (const field of ['name', 'phone', 'affiliation']) assert.ok(searchFilter.includes(`${field}.ilike.\"*SEARCH*\"`));
  assert.ok(searchFilter.includes('id.in.(fc-d)'));
  const codeSearch = service.calls.find((call) => call.columns === 'id,fc_id');
  assert.equal(codeSearch.limit, 101);
  assert.deepEqual(codeSearch.filters, [['ilike', 'code', '%SEARCH%']]);
  assert.ok(service.calls.some((call) => call.single
    && call.filters.some(([method, field, id]) => method === 'eq' && field === 'id' && id === 'fc-a')));
});

test('referral list rejects unconfirmed page and summary counts instead of inventing totals', async () => {
  for (const summary of [false, true]) {
    const service = loadService(null, (call) => {
      const result = referralReadResult(call);
      if (call.table === 'fc_profiles' && call.options.count === 'exact'
        && Boolean(call.options.head) === summary) result.count = null;
      return result;
    });
    await assert.rejects(service.getReferralAdminData({ role: 'admin' }, {}),
      summary ? /admin_referrals_eligible_count_contract_invalid/ : /admin_referrals_profile_page_contract_invalid/);
  }
});

test('recommender selection service rejects empty and mismatched RPC receipts', async () => {
  for (const rpcData of [
    {},
    {
      changed: true,
      inviteeFcId: 'another-invitee',
      inviterFcId: null,
      recommenderName: null,
      referralCode: null,
    },
  ]) {
    const service = loadService(rpcData);
    await assert.rejects(
      service.applyRecommenderSelection({
        actor: ACTOR,
        inviteeFcId: 'invitee-1',
        inviterFcId: null,
        reason: '정정',
      }),
      /추천인 코드 작업 결과를 확인할 수 없습니다/,
    );
  }
});
