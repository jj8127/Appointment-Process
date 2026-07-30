import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveReferralPermissionDisplay } from './referral-permission-display.ts';

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
});
