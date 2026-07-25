import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hasRetiredLegacyRecommenderMutationFields,
  handleRecommenderRelationGet,
  handleRecommenderRelationPost,
  isManagerShadowRecommenderEligible,
  isRetiredLegacyRecommenderSearchAction,
  type RecommenderRelationRouteDeps,
} from './recommender-relation-route-handler.ts';
import type { VerifiedServerSession } from './server-session.ts';

const session = (
  role: VerifiedServerSession['role'],
  staffType: VerifiedServerSession['staffType'],
): VerifiedServerSession => ({
  role,
  residentId: '010-1234-5678',
  residentDigits: '01012345678',
  displayName: '검증 사용자',
  staffType,
});

const makeDeps = (
  verifiedSession: VerifiedServerSession,
  applyCalls: unknown[],
): RecommenderRelationRouteDeps => ({
  getSession: async () => ({ ok: true, session: verifiedSession }),
  searchCandidates: async () => ({ candidates: [], selectedCandidate: null }),
  applySelection: async (params) => {
    applyCalls.push(params);
    return {
      changed: true,
      inviteeFcId: params.inviteeFcId,
      inviterFcId: params.inviterFcId,
      recommenderName: '추천인',
      referralCode: 'ABCDEFGH',
    };
  },
});

test('broad FC route policy identifies every retired recommender bypass', () => {
  assert.equal(isRetiredLegacyRecommenderSearchAction('searchRecommenders'), true);
  assert.equal(isRetiredLegacyRecommenderSearchAction('getProfile'), false);

  assert.equal(hasRetiredLegacyRecommenderMutationFields({ recommender: 'legacy' }), true);
  assert.equal(hasRetiredLegacyRecommenderMutationFields({ recommenderFcId: 'fc-1' }), true);
  assert.equal(hasRetiredLegacyRecommenderMutationFields({ recommenderOverrideReason: 'spoof' }), true);
  assert.equal(hasRetiredLegacyRecommenderMutationFields({ name: 'allowed profile field' }), false);
});

test('inactive manager shadows are ineligible while normal FC eligibility is unchanged', () => {
  const activeManagerPhones = new Set(['01012345678']);

  assert.equal(isManagerShadowRecommenderEligible({
    isManagerReferralShadow: true,
    normalizedPhone: '01012345678',
    activeManagerPhones,
  }), true);
  assert.equal(isManagerShadowRecommenderEligible({
    isManagerReferralShadow: true,
    normalizedPhone: '01099999999',
    activeManagerPhones,
  }), false);
  assert.equal(isManagerShadowRecommenderEligible({
    isManagerReferralShadow: false,
    normalizedPhone: '01099999999',
    activeManagerPhones,
  }), true);
});

test('relation route rejects FC sessions before parsing a mutation body', async () => {
  let jsonCalls = 0;
  const response = await handleRecommenderRelationPost(
    async () => {
      jsonCalls += 1;
      return {};
    },
    makeDeps(session('fc', null), []),
  );

  assert.deepEqual(response, { status: 403, body: { error: 'Forbidden' } });
  assert.equal(jsonCalls, 0);
});

test('relation route requires a non-empty reason', async () => {
  const response = await handleRecommenderRelationPost(
    async () => ({
      inviteeFcId: 'fc-invitee',
      inviterFcId: 'fc-inviter',
      reason: ' ',
    }),
    makeDeps(session('manager', null), []),
  );

  assert.deepEqual(response, {
    status: 400,
    body: { error: '추천인 변경 사유를 입력해주세요.' },
  });
});

test('verified manager actor metadata ignores body role and phone spoofing', async () => {
  const applyCalls: unknown[] = [];
  const response = await handleRecommenderRelationPost(
    async () => ({
      inviteeFcId: 'fc-invitee',
      inviterFcId: 'fc-inviter',
      reason: '담당 조직 변경',
      actorRole: 'admin',
      actorStaffType: 'developer',
      actorPhone: '01000000000',
    }),
    makeDeps(session('manager', null), applyCalls),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(applyCalls, [{
    actor: {
      actorPhone: '01012345678',
      actorRole: 'manager',
      actorStaffType: null,
    },
    inviteeFcId: 'fc-invitee',
    inviterFcId: 'fc-inviter',
    reason: '담당 조직 변경',
  }]);
});

test('verified general-affairs and developer sessions retain their server actor subtype', async () => {
  for (const staffType of ['admin', 'developer'] as const) {
    const applyCalls: unknown[] = [];
    const response = await handleRecommenderRelationPost(
      async () => ({
        inviteeFcId: 'fc-invitee',
        inviterFcId: null,
        reason: '관계 정정',
      }),
      makeDeps(session('admin', staffType), applyCalls),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(applyCalls, [{
      actor: {
        actorPhone: '01012345678',
        actorRole: 'admin',
        actorStaffType: staffType,
      },
      inviteeFcId: 'fc-invitee',
      inviterFcId: null,
      reason: '관계 정정',
    }]);
  }
});

test('candidate search uses the same verified staff-only policy', async () => {
  const searchCalls: unknown[] = [];
  const deps = makeDeps(session('manager', null), []);
  deps.searchCandidates = async (params) => {
    searchCalls.push(params);
    return { candidates: [], selectedCandidate: null };
  };

  const response = await handleRecommenderRelationGet(
    'https://example.test/api/admin/fc/recommender?query=kim&inviteeFcId=fc-1&selectedFcId=fc-2',
    deps,
  );

  assert.deepEqual(response, {
    status: 200,
    body: { ok: true, candidates: [], selectedCandidate: null },
  });
  assert.deepEqual(searchCalls, [{
    query: 'kim',
    excludeFcId: 'fc-1',
    selectedFcId: 'fc-2',
  }]);
});
