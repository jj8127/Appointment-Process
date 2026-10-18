import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import * as referralTypes from '../types/referrals.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const serviceSource = readFileSync(new URL('./admin-referrals.ts', import.meta.url), 'utf8');
const ACTOR = {
  actorPhone: '01000000000',
  actorRole: 'admin',
  actorStaffType: 'admin',
};

function loadService(rpcData) {
  const code = ts.transpileModule(serviceSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const adminSupabase = { rpc: async () => ({ data: rpcData, error: null }) };
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
      if (id === '@/lib/admin-referral-event-query') {
        return { chunkReferralEventFcIds: () => [], mergeReferralEventChunks: () => [] };
      }
      if (id === '@/lib/supabase-query-contract') {
        return { collectSupabaseRows: async () => [] };
      }
      throw new Error(`Unexpected admin-referrals dependency ${id}`);
    },
  });
  return exports;
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
  assert.equal((serviceSource.match(/collectSupabaseRows</g) ?? []).length, 10);
  assert.equal((serviceSource.match(/\.range\(from, to\)/g) ?? []).length, 10);
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
