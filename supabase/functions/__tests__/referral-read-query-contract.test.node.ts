import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('referral tree wires every database list through strict query contracts', () => {
  const source = read('supabase/functions/get-referral-tree/index.ts');

  for (const parser of [
    'parseReferralProfilesForIds',
    'parseReferralProfilesForPhone',
    'parseReferralCodeHistoryRows',
    'parseReferralAdminPhoneRows',
    'parseActiveReferralCodeRows',
    'parseReferralChildRows',
    'parseReferralChildProfiles',
    'parseReferralManagerAccountRows',
    'parseReferralAdminAccountRows',
    'parseReferralTreeRows',
  ]) {
    assert.match(source, new RegExp(`\\b${parser}\\(`));
  }
  assert.doesNotMatch(source, /\(data \?\? \[\]\)/);
  assert.doesNotMatch(source, /rows \?\? \[\]/);
  assert.doesNotMatch(source, /as TreeRpcRow\[\]/);
  assert.doesNotMatch(source, /supabase\.rpc\('get_referral_subtree'/);
  assert.match(source, /async function loadTreeRows[\s\S]*buildFallbackTreeRows\(rootFcId, depth\)/);
});

test('allowance authorization and RPC results reuse the existing strict response contracts', () => {
  const source = read('supabase/functions/get-my-referral-allowance/index.ts');

  for (const parser of [
    'parseAllowanceManagerQuery',
    'parseAllowanceAdminQuery',
    'parseAllowanceProfilesQuery',
    'parseAllowancePilotQuery',
    'parseReferralAllowanceResponse',
  ]) {
    assert.match(source, new RegExp(`\\b${parser}\\(`));
  }
  assert.doesNotMatch(source, /data \?\? \[\]/);
  assert.doesNotMatch(source, /Boolean\(data\?\.length\)/);
  assert.doesNotMatch(source, /\.maybeSingle\(\)/);
});

test('signup referral search fails closed on malformed or partial database results', () => {
  const source = read('supabase/functions/search-signup-referral/index.ts');

  assert.match(source, /parseQueryRows\(profileRows, isSearchProfileRow\)/);
  assert.match(source, /parseQueryRows\(managerRows, isSearchManagerRow\)/);
  assert.match(source, /parseQueryRows\(activeCodes, isActiveCodeRow\)/);
  assert.match(source, /if \(!ensureResult\.ok\) return searchUnavailable\(\)/);
  assert.match(source, /seenFcIds\.size !== allFcIds\.length/);
  assert.doesNotMatch(source, /profileRows \?\? \[\]/);
  assert.doesNotMatch(source, /managerRows \?\? \[\]/);
  assert.doesNotMatch(source, /activeCodes \?\? \[\]/);
});

test('my referral code distinguishes a missing or malformed recommender profile', () => {
  const source = read('supabase/functions/get-my-referral-code/index.ts');

  assert.match(source, /if \(profileRes\.data === null\)/);
  assert.match(source, /isRecommenderAffiliationRow\(profileRes\.data\)/);
  assert.match(source, /recommender_profile_missing/);
  assert.doesNotMatch(source, /if \(!profileRes\.error && profileRes\.data\?\.affiliation\)/);
});

test('my invitees rejects null or malformed successful rows without fabricating timestamps', () => {
  const source = read('supabase/functions/get-my-invitees/index.ts');

  assert.match(source, /collectSupabaseRows<InviteeQueryRow>\(\{/);
  assert.match(source, /isRow: isInviteeQueryRow/);
  assert.match(source, /maxRows: 10_000/);
  assert.match(source, /rowKey: \(row\) => row\.id/);
  assert.match(source, /\.range\(from, to\)/);
  assert.match(source, /cleanPhone\(row\.phone\)\.length === 11/);
  assert.match(source, /isTimestamp\(row\.created_at\)/);
  assert.match(source, /isTimestamp\(row\.updated_at\)/);
  assert.match(source, /const referenceDate = row\.recommender_linked_at \?\? row\.updated_at/);
  assert.match(source, /\.order\('id', \{ ascending: true \}\)/);
  assert.match(source, /return fail\('db_error', '초대 목록 응답을 확인하지 못했습니다\.', 500\)/);
  assert.doesNotMatch(source, /message:\s*\w+(?:Error|Result)\.message/);
  assert.doesNotMatch(source, /inviteeRows \?\? \[\]/);
  assert.doesNotMatch(source, /new Date\(0\)/);
  assert.doesNotMatch(source, /new Date\(\)/);
});
