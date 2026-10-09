import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidCareerType, requireMutationSuccess, shouldSubmitOnEnter } from './user-intent-policy.ts';

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
