import assert from 'node:assert/strict';
import test from 'node:test';

import { mapExamCancellationError } from '../exam-cancellation-error.ts';

test('RPC deadline rejection returns the stable code and exact administrator guidance', () => {
  assert.deepEqual(mapExamCancellationError({
    code: 'P0001', message: 'exam_cancellation_deadline_passed',
  }), {
    code: 'exam_cancellation_deadline_passed',
    message: '마감된 시험입니다. 취소·변경은 관리자에게 문의해 주세요',
    status: 409,
  });
});

test('unrelated database errors retain generic envelopes without exposing diagnostics', () => {
  const generic = {
    code: 'cancel_failed', message: '현재 상태에서는 시험 신청을 취소할 수 없습니다.', status: 409,
  };
  for (const error of [
    { code: '55000', message: 'invalid_exam_transition' },
    { code: '42501', message: 'exam_transition_forbidden' },
    { code: 'XX000', message: 'private internal diagnostic' },
    { code: '55000', message: 'exam_cancellation_deadline_passed' },
  ]) assert.deepEqual(mapExamCancellationError(error), generic);
  assert.deepEqual(mapExamCancellationError({ code: 'P0002', message: 'exam_registration_not_found' }), {
    code: 'cancel_failed', message: '취소할 시험 신청 내역이 없습니다.', status: 404,
  });
});
