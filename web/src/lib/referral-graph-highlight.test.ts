import assert from 'node:assert/strict';
import test from 'node:test';

import { getReferralGraphNodeRadius, resolveReferralGraphHighlightType } from './referral-graph-highlight.ts';

test('getReferralGraphNodeRadius keeps low-importance nodes compact for overview readability', () => {
  const radius = getReferralGraphNodeRadius({
    referralCount: 0,
    inboundCount: 0,
    highlightType: null,
  });

  assert.ok(radius <= 5.5, `expected compact overview node, got ${radius}`);
});

test('getReferralGraphNodeRadius gives hubs visual weight without oversized dots', () => {
  const isolatedRadius = getReferralGraphNodeRadius({
    referralCount: 0,
    inboundCount: 0,
    highlightType: null,
  });
  const hubRadius = getReferralGraphNodeRadius({
    referralCount: 16,
    inboundCount: 8,
    highlightType: null,
  });

  assert.ok(hubRadius > isolatedRadius);
  assert.ok(hubRadius <= 10.5, `expected bounded hub size, got ${hubRadius}`);
});

test('resolveReferralGraphHighlightType highlights managers, not Kim Hyeongsu by name alone', () => {
  assert.equal(
    resolveReferralGraphHighlightType({
      name: '김형수',
      isManagerReferralShadow: false,
      managerNames: new Set<string>(),
    }),
    null,
  );

  assert.equal(
    resolveReferralGraphHighlightType({
      name: '1본부장',
      isManagerReferralShadow: false,
      managerNames: new Set(['1본부장']),
    }),
    'manager',
  );
});
