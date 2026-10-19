import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAdminChatTargets } from './admin-chat-targets.ts';

test('buildAdminChatTargets keeps completed non-designer FCs visible and merges conversation summaries', () => {
  const targets = buildAdminChatTargets(
    [
      {
        id: 'recent',
        name: '최근 상담 FC',
        phone: '010-5555-6666',
        signup_completed: true,
        affiliation: '임의 외부 조직',
      },
      {
        id: 'designer',
        name: '설계 매니저',
        phone: '01099998888',
        signup_completed: true,
        affiliation: '한화 설계매니저',
      },
      {
        id: 'draft',
        name: '미완료 FC',
        phone: '01011112222',
        signup_completed: false,
        affiliation: '1본부 서선미',
      },
      {
        id: 'older',
        name: '기존 대화 FC',
        phone: '01033334444',
        signup_completed: true,
        affiliation: '2본부 박성훈',
      },
      {
        id: 'quiet-b',
        name: '나다라',
        phone: '010-1234-5678',
        signup_completed: true,
        affiliation: '3본부 김태희',
      },
      {
        id: 'quiet-a',
        name: '가나다',
        phone: '010-7777-8888',
        signup_completed: true,
        affiliation: '4본부 현경숙',
      },
    ],
    {
      '01055556666': {
        last_message: '가장 최근 응답',
        last_time: '2026-04-22T10:30:00.000Z',
        unread_count: 2,
      },
      '01033334444': {
        last_message: '이전 상담 내역',
        last_time: '2026-04-20T09:15:00.000Z',
        unread_count: 0,
      },
    },
  );

  assert.deepStrictEqual(targets, [
    {
      fc_id: 'recent',
      name: '최근 상담 FC',
      phone: '01055556666',
      last_message: '가장 최근 응답',
      last_time: '2026-04-22T10:30:00.000Z',
      unread_count: 2,
    },
    {
      fc_id: 'older',
      name: '기존 대화 FC',
      phone: '01033334444',
      last_message: '이전 상담 내역',
      last_time: '2026-04-20T09:15:00.000Z',
      unread_count: 0,
    },
    {
      fc_id: 'quiet-a',
      name: '가나다',
      phone: '01077778888',
      last_message: null,
      last_time: null,
      unread_count: 0,
    },
    {
      fc_id: 'quiet-b',
      name: '나다라',
      phone: '01012345678',
      last_message: null,
      last_time: null,
      unread_count: 0,
    },
  ]);
});

test('buildAdminChatTargets sorts by last message time instead of unread count', () => {
  const targets = buildAdminChatTargets(
    [
      {
        id: 'newer',
        name: 'Newest',
        phone: '010-1111-2222',
        signup_completed: true,
        affiliation: '1branch',
      },
      {
        id: 'unread',
        name: 'Unread',
        phone: '010-3333-4444',
        signup_completed: true,
        affiliation: '1branch',
      },
      {
        id: 'empty',
        name: 'Empty',
        phone: '010-5555-6666',
        signup_completed: true,
        affiliation: '1branch',
      },
    ],
    {
      '01011112222': {
        last_message: 'newer reply',
        last_time: '2026-07-02T09:00:00.000Z',
        unread_count: 0,
      },
      '01033334444': {
        last_message: 'older unread',
        last_time: '2026-07-01T09:00:00.000Z',
        unread_count: 5,
      },
    },
  );

  assert.deepStrictEqual(targets.map((target) => target.fc_id), ['newer', 'unread', 'empty']);
  assert.equal(targets[1].unread_count, 5);
});

test('target ordering uses deterministic identity tie-breakers', () => {
  const targets = buildAdminChatTargets([
    { id: 'fc-a', name: 'Same', phone: '01011112222', signup_completed: true, affiliation: '' },
    { id: 'fc-b', name: 'Same', phone: '01033334444', signup_completed: true, affiliation: '' },
  ], {
    '01011112222': { last_message: 'a', last_time: '2026-06-25T10:00:00.000Z', unread_count: 0 },
    '01033334444': { last_message: 'b', last_time: '2026-06-25T10:00:00.000Z', unread_count: 0 },
  });
  assert.deepStrictEqual(targets.map((target) => target.fc_id), ['fc-b', 'fc-a']);
});

test('targets reject malformed and duplicate identities', () => {
  assert.throws(() => buildAdminChatTargets([
    { id: 'fc-a', name: 'A', phone: '01011112222', signup_completed: true, affiliation: '' },
    { id: 'fc-b', name: 'B', phone: '010-1111-2222', signup_completed: true, affiliation: '' },
  ]), /admin_chat_participant_identity_contract_invalid/);

  assert.throws(() => buildAdminChatTargets([
    { id: 'fc-a', name: '', phone: '01011112222', signup_completed: true, affiliation: '' },
  ]), /admin_chat_participant_row_contract_invalid/);
  assert.throws(() => buildAdminChatTargets([
    { id: 'fc-a', name: 'A', phone: 'not-a-phone', signup_completed: true, affiliation: '' },
  ]), /admin_chat_participant_row_contract_invalid/);
});
