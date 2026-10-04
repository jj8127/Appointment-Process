import assert from 'node:assert/strict';
import test from 'node:test';

import { getWebStaffChatActorId } from './staff-identity.ts';

test('every signed staff role uses its own normalized phone for canonical direct messages', () => {
  for (const [role, staffType] of [['admin', 'admin'], ['admin', 'developer'], ['manager', null]] as const) {
    assert.equal(getWebStaffChatActorId({ role, staffType, residentId: '000-0000-0001' }), '00000000001');
  }
});

test('missing or non-staff identity never falls back to shared admin history', () => {
  assert.equal(getWebStaffChatActorId({ role: 'admin' }), '');
  assert.equal(getWebStaffChatActorId({ role: 'manager', residentId: null }), '');
  assert.equal(getWebStaffChatActorId({ role: null, residentId: '00000000001' }), '');
  assert.equal(getWebStaffChatActorId({ role: 'fc', residentId: '00000000001' }), '');
});
