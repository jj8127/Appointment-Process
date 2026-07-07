import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExamRoundNotificationPayload,
  getExamRoundTargetUrl,
} from './exam-round-notification.ts';

test('routes life and nonlife exam-round notifications to the matching mobile screen', () => {
  assert.equal(getExamRoundTargetUrl('life'), '/exam-apply');
  assert.equal(getExamRoundTargetUrl('nonlife'), '/exam-apply2');
});

test('builds the shared fc-notify broadcast payload for exam schedule changes', () => {
  assert.deepEqual(
    buildExamRoundNotificationPayload({
      title: '2026-06-17 (공통 7차 생명보험) 일정 등록',
      body: '시험 일정이 등록되었습니다.',
      examType: 'life',
    }),
    {
      type: 'notify',
      target_role: 'fc',
      target_id: null,
      title: '2026-06-17 (공통 7차 생명보험) 일정 등록',
      body: '시험 일정이 등록되었습니다.',
      category: 'exam_round',
      url: '/exam-apply',
    },
  );
});
