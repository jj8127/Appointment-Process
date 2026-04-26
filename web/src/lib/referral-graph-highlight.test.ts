import assert from 'node:assert/strict';
import test from 'node:test';

import { getReferralGraphNodeRadius } from './referral-graph-highlight.ts';

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
