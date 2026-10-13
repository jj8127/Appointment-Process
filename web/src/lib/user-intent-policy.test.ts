import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isNonEmptyResponseString,
  isHttpsResponseUrl,
  isValidCareerType,
  isValidFcStatusResponse,
  isValidYmdResponse,
  requireCleanupMutationReceipt,
  requireDocumentStatusReceipt,
  requireExamTransitionSuccess,
  requireExamRoundDeleteReceipt,
  requireExamRoundSaveReceipt,
  requireMutationSuccess,
  requireProfileMutationReceipt,
  shouldSubmitOnEnter,
} from './user-intent-policy.ts';

test('IME completion and shifted Enter do not send; an ordinary Enter does', () => {
  const event = { key: 'Enter', shiftKey: false, nativeEvent: {} };
  assert.equal(shouldSubmitOnEnter(event), true);
  assert.equal(shouldSubmitOnEnter({ ...event, nativeEvent: { isComposing: true } }), false);
  assert.equal(shouldSubmitOnEnter({ ...event, nativeEvent: { keyCode: 229 } }), false);
  assert.equal(shouldSubmitOnEnter({ ...event, shiftKey: true }), false);
});
test('career values distinguish explicit clearing from invalid input', () => {
  for (const value of ['신입', '경력', '', null]) assert.equal(isValidCareerType(value), true);
  for (const value of ['경력자', 1, undefined, {}]) assert.equal(isValidCareerType(value), false);
});
test('a malformed 200 body cannot acknowledge a committed mutation', () => {
  for (const value of [null, {}, [], { ok: false }, { success: true }]) {
    assert.throws(() => requireMutationSuccess(value));
  }
  assert.doesNotThrow(() => requireMutationSuccess({ ok: true }));
});
test('profile mutation acknowledgements must echo the committed fields', () => {
  const expected = { career_type: '경력', temp_id: 'T-100', status: 'temp-id-issued' };
  for (const value of [
    { ok: true },
    { ok: true, profile: null },
    { ok: true, profile: { ...expected, status: 'draft' } },
    { ok: true, profile: { ...expected, temp_id: 'T-200' } },
  ]) {
    assert.throws(() => requireProfileMutationReceipt(value, expected));
  }
  assert.deepEqual(
    requireProfileMutationReceipt({ ok: true, profile: expected }, expected),
    expected,
  );
  assert.equal(
    requireProfileMutationReceipt(
      { ok: true, profile: { allowance_prescreen_requested_at: '2026-10-13T09:00:00+09:00' } },
      { allowance_prescreen_requested_at: '2026-10-13T00:00:00.000Z' },
    ).allowance_prescreen_requested_at,
    '2026-10-13T09:00:00+09:00',
  );
});
test('cleanup mutations require their action flag and a boolean cleanup receipt', () => {
  for (const value of [
    { ok: true },
    { ok: true, updated: false, cleanupPending: false },
    { ok: true, updated: true, cleanupPending: null },
  ]) {
    assert.throws(() => requireCleanupMutationReceipt(value, 'updated'));
  }
  assert.deepEqual(
    requireCleanupMutationReceipt({ ok: true, deleted: true, cleanupPending: false }, 'deleted'),
    { cleanupPending: false },
  );
});
test('document status receipts are request-bound for API and server-action responses', () => {
  const expected = { status: 'rejected' as const, reviewerNote: '보완 필요' };
  for (const value of [
    { ok: true, status: 'approved', reviewerNote: null, allApproved: true },
    { ok: true, ...expected },
    { ok: false, success: true, ...expected, allApproved: false },
    { success: true, ...expected, allApproved: 'false' },
    { success: true, status: 'rejected', reviewerNote: '다른 사유', allApproved: false },
  ]) {
    assert.throws(() => requireDocumentStatusReceipt(value, expected));
  }
  assert.deepEqual(
    requireDocumentStatusReceipt({ success: true, ...expected, allApproved: false }, expected),
    { ...expected, allApproved: false },
  );
  assert.deepEqual(
    requireDocumentStatusReceipt({ ok: true, ...expected, allApproved: null }, expected),
    { ...expected, allApproved: null },
  );
});
test('exam transition acknowledgement must match the requested row and action result', () => {
  const registrationId = '00000000-0000-4000-8000-000000000001';
  const expected = { action: 'confirm' as const, registrationId };

  for (const value of [
    { ok: true },
    { ok: true, registrationId: '00000000-0000-4000-8000-000000000002', isConfirmed: true, status: 'confirmed' },
    { ok: true, registrationId, isConfirmed: false, status: 'confirmed' },
    { ok: true, registrationId, isConfirmed: true, status: 'applied' },
  ]) {
    assert.throws(() => requireExamTransitionSuccess(value, expected));
  }

  assert.deepEqual(
    requireExamTransitionSuccess(
      { ok: true, registrationId, isConfirmed: true, status: 'confirmed' },
      expected,
    ),
    { registrationId, isConfirmed: true, status: 'confirmed' },
  );
});
test('exam round receipts require the exact saved UUID and a real deletion', () => {
  const roundId = '00000000-0000-4000-8000-000000000001';
  assert.equal(requireExamRoundSaveReceipt(roundId, null), roundId);
  assert.equal(requireExamRoundSaveReceipt(roundId.toUpperCase(), roundId), roundId.toUpperCase());
  for (const [value, expected] of [
    ['', null],
    ['round-1', null],
    ['00000000-0000-4000-8000-000000000002', roundId],
  ] as const) {
    assert.throws(() => requireExamRoundSaveReceipt(value, expected));
  }
  assert.doesNotThrow(() => requireExamRoundDeleteReceipt({ deleted: true, alreadyDeleted: false }));
  for (const value of [null, { deleted: true }, { deleted: false, alreadyDeleted: false }, { deleted: true, alreadyDeleted: true }]) {
    assert.throws(() => requireExamRoundDeleteReceipt(value));
  }
});
test('mutation response strings reject empty and invalid date values', () => {
  for (const value of [null, undefined, '', '   ', 0, {}]) assert.equal(isNonEmptyResponseString(value), false);
  assert.equal(isNonEmptyResponseString('saved'), true);
  for (const value of ['', '2026-2-03', '2026-02-29', '2026-02-30', '2026-04-31', 'not-a-date']) {
    assert.equal(isValidYmdResponse(value), false);
  }
  assert.equal(isValidYmdResponse('2026-02-28'), true);
  assert.equal(isValidYmdResponse('2028-02-29'), true);
  for (const value of ['', 'unknown', ' DRAFT ', 'final-link-sent ']) assert.equal(isValidFcStatusResponse(value), false);
  assert.equal(isValidFcStatusResponse('final-link-sent'), true);
  for (const value of [
    '',
    '/relative',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'http://storage.example.test/upload',
    'https://user:secret@storage.example.test/upload',
  ]) {
    assert.equal(isHttpsResponseUrl(value), false);
  }
  assert.equal(isHttpsResponseUrl('https://storage.example.test/upload?token=synthetic'), true);
});
