import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveReferralPermissionDisplay } from './referral-permission-display.ts';
import {
  isRecommenderSelectionResult,
  isReferralAdminMutationResponse,
} from '../types/referrals.ts';

test('referral mutation guards bind successful results to the requested target', () => {
  const rotateRequest = {
    action: 'rotate_code' as const,
    payload: { fcId: 'fc-1', reason: '운영 요청' },
  };
  const rotateResult = {
    ok: true,
    action: 'rotate_code',
    result: {
      ok: true,
      changed: true,
      action: 'rotated',
      fcId: 'fc-1',
      previousCodeId: 'code-old',
      previousCode: 'OLD',
      codeId: 'code-new',
      code: 'NEW',
      eventType: 'code_rotated',
    },
  };
  assert.equal(isReferralAdminMutationResponse(rotateResult, rotateRequest), true);
  assert.equal(isReferralAdminMutationResponse({
    ...rotateResult,
    result: { ...rotateResult.result, fcId: 'fc-other' },
  }, rotateRequest), false);
  assert.equal(isReferralAdminMutationResponse({
    ...rotateResult,
    result: {},
  }, rotateRequest), false);

  const expectedSelection = { inviteeFcId: 'fc-1', inviterFcId: 'fc-2' };
  const selection = {
    changed: true,
    inviteeFcId: 'fc-1',
    inviterFcId: 'fc-2',
    recommenderName: '추천인',
    referralCode: 'ABC123',
  };
  assert.equal(isRecommenderSelectionResult(selection, expectedSelection), true);
  assert.equal(isRecommenderSelectionResult({ ...selection, inviterFcId: 'fc-3' }, expectedSelection), false);
  assert.equal(isRecommenderSelectionResult({ ...selection, referralCode: null }, expectedSelection), false);
});

test('referral bulk mutation guards require complete count invariants', () => {
  const backfillRequest = { action: 'backfill_missing_codes' as const, payload: { limit: 100 } };
  const backfillResult = {
    ok: true,
    action: 'backfill_missing_codes',
    result: { ok: true, processed: 3, created: 2, skipped: 1, remaining: 4, limit: 100 },
  };
  assert.equal(isReferralAdminMutationResponse(backfillResult, backfillRequest), true);
  assert.equal(isReferralAdminMutationResponse({
    ...backfillResult,
    result: { ...backfillResult.result, processed: 4 },
  }, backfillRequest), false);

  const autoRequest = { action: 'auto_resolve_legacy_recommenders' as const, payload: { limit: 100 } };
  const autoResult = {
    ok: true,
    action: 'auto_resolve_legacy_recommenders',
    result: { processed: 3, linked: 1, skipped: 1, failed: 1, remaining: 2, limit: 100 },
  };
  assert.equal(isReferralAdminMutationResponse(autoResult, autoRequest), true);
  assert.equal(isReferralAdminMutationResponse({
    ...autoResult,
    result: { ...autoResult.result, failed: -1 },
  }, autoRequest), false);
  assert.equal(isReferralAdminMutationResponse({
    ...autoResult,
    result: { linked: 1, skipped: 1, failed: 1 },
  }, autoRequest), false);
});

test('does not mislabel a developer/admin session as read-only before API permissions load', () => {
  assert.deepEqual(
    resolveReferralPermissionDisplay({
      role: 'admin',
      isReadOnly: false,
      serverCanMutate: undefined,
    }),
    {
      showMutateControls: false,
      showReadOnlyState: false,
    },
  );
});

test('shows mutation controls after the server confirms an admin/developer session', () => {
  assert.deepEqual(
    resolveReferralPermissionDisplay({
      role: 'admin',
      isReadOnly: false,
      serverCanMutate: true,
    }),
    {
      showMutateControls: true,
      showReadOnlyState: false,
    },
  );
});

test('keeps a manager read-only after permissions resolve', () => {
  assert.deepEqual(
    resolveReferralPermissionDisplay({
      role: 'manager',
      isReadOnly: true,
      serverCanMutate: false,
    }),
    {
      showMutateControls: false,
      showReadOnlyState: true,
    },
  );
});

test('referral page renders read-only messaging only from the resolved permission state', () => {
  const source = readFileSync(
    new URL('../app/dashboard/referrals/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /resolveReferralPermissionDisplay\(\{/);
  assert.match(source, /\{showReadOnlyState \? \(/);
  assert.doesNotMatch(source, /\{!showMutateControls \? \(/);
  assert.match(source, /data\.items\.every\(isReferralListItem\)/);
  assert.match(source, /data\.unresolvedItems\.every\(isUnresolvedItem\)/);
  assert.match(source, /isSummary\(data\.summary\)/);
  assert.match(source, /requireMutationSuccess\(data\)/);
  assert.match(source, /data\.detail !== null && !isReferralAdminDetail\(data\.detail\)/);
  assert.match(source, /<QueryErrorAlert/);
  assert.match(source, /hasData=\{Boolean\(listQuery\.data \|\| detailQuery\.data\)\}/);
  assert.match(source, /total === undefined \? '총 건수 확인 불가'/);
  assert.match(source, /listQuery\.data \? `총 \$\{summary\?\.unresolvedLegacyCount \?\? 0\}건` : '총 건수 확인 불가'/);
  assert.match(source, /레거시 추천인 검토 결과를 확인할 수 없습니다/);
  assert.match(source, /visible=\{listQuery\.isFetching && !listQuery\.data\}/);
  assert.match(source, /visible=\{detailQuery\.isFetching && !detailQuery\.data && Boolean\(effectiveSelectedFcId\)\}/);
  assert.match(source, /loading=\{listQuery\.isFetching \|\| detailQuery\.isFetching\}/);
});
