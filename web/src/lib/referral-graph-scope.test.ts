import assert from 'node:assert/strict';
import test from 'node:test';

import { collectReferralDownlineScopeIds } from './referral-graph-scope.ts';

test('collectReferralDownlineScopeIds includes root and every reachable descendant only', () => {
  const scopedIds = collectReferralDownlineScopeIds('root', [
    { source: 'root', target: 'child-a' },
    { source: 'child-a', target: 'grandchild-a' },
    { source: 'root', target: 'child-b' },
    { source: 'outside', target: 'outside-child' },
    { source: 'outside-child', target: 'root' },
  ]);

  assert.deepEqual(
    Array.from(scopedIds).sort(),
    ['child-a', 'child-b', 'grandchild-a', 'root'].sort(),
  );
});

test('collectReferralDownlineScopeIds handles cycles without leaking unrelated nodes', () => {
  const scopedIds = collectReferralDownlineScopeIds('a', [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'a' },
    { source: 'x', target: 'y' },
  ]);

  assert.deepEqual(Array.from(scopedIds).sort(), ['a', 'b', 'c']);
});
