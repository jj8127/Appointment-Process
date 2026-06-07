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

test('getReferralGraphNodeRadius uses descendant count when provided', () => {
  const leafRadius = getReferralGraphNodeRadius({
    referralCount: 16,
    inboundCount: 8,
    descendantCount: 0,
    highlightType: null,
  });
  const branchRadius = getReferralGraphNodeRadius({
    referralCount: 1,
    inboundCount: 1,
    descendantCount: 24,
    highlightType: null,
  });

  assert.ok(leafRadius <= 5.5, `expected descendant leaf to stay compact, got ${leafRadius}`);
  assert.ok(branchRadius > leafRadius, `expected descendant branch to be larger than leaf, got ${branchRadius}`);
});

test('getReferralGraphNodeRadius caps descendant-scaled hubs and keeps highlight boost additive', () => {
  const hubRadius = getReferralGraphNodeRadius({
    referralCount: 0,
    inboundCount: 0,
    descendantCount: 10_000,
    highlightType: null,
  });
  const highlightedHubRadius = getReferralGraphNodeRadius({
    referralCount: 0,
    inboundCount: 0,
    descendantCount: 10_000,
    highlightType: 'manager',
  });

  assert.ok(hubRadius <= 14.2, `expected capped descendant hub size, got ${hubRadius}`);
  assert.ok(Math.abs((highlightedHubRadius - hubRadius) - 3.4) < 0.001);
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
