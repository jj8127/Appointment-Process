import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVerifiedInboxPayload, isSameOriginInboxRequest } from './fc-notify-inbox-policy.ts';

const session = {
  role: 'admin' as 'admin' | 'manager' | 'fc', residentId: '01000000001', residentDigits: '01000000001',
  displayName: 'Synthetic staff', staffType: 'admin' as 'admin' | 'developer' | null,
};

test('inbox identity is bound to the verified viewer, ignoring forged client claims', () => {
  const result = buildVerifiedInboxPayload({ limit: 60, ...{
    role: 'fc', resident_id: '01000000002', viewer_actor_role: 'fc', viewer_actor_phone: '01000000002',
  } }, session);
  assert.equal(result.role, 'admin');
  assert.equal(result.resident_id, null);
  assert.equal(result.viewer_actor_role, 'admin');
  assert.equal(result.viewer_actor_phone, session.residentDigits);
  assert.equal(result.include_request_board_fc, false);
});

test('manager and developer inboxes use their own identity and include linked notifications once', () => {
  for (const actor of [{ ...session, role: 'manager' as const, staffType: null }, { ...session, staffType: 'developer' as const }]) {
    const result = buildVerifiedInboxPayload({ limit: Infinity }, actor);
    assert.equal(result.role, 'admin');
    assert.equal(result.resident_id, session.residentDigits);
    assert.equal(result.include_request_board_fc, true);
    assert.equal(result.limit, 80);
  }
});

test('FC inbox scope stays personal and read limits stay bounded', () => {
  const result = buildVerifiedInboxPayload({ limit: 999 }, { ...session, role: 'fc', staffType: null });
  assert.equal(result.role, 'fc');
  assert.equal(result.resident_id, session.residentDigits);
  assert.equal(result.include_request_board_fc, false);
  assert.equal(result.limit, 200);
});

test('inbox rejects absent, malformed and foreign origin evidence', () => {
  for (const origin of ['', 'null', 'https://foreign.invalid', 'http://web.invalid']) {
    assert.equal(isSameOriginInboxRequest(new Request('https://web.invalid/api/fc-notify', { headers: { origin } })), false);
  }
  assert.equal(isSameOriginInboxRequest(new Request('https://web.invalid/api/fc-notify', { headers: { origin: 'https://web.invalid' } })), true);
  assert.equal(isSameOriginInboxRequest(new Request('https://web.invalid/api/fc-notify', { headers: { referer: 'https://web.invalid/dashboard' } })), true);
});
