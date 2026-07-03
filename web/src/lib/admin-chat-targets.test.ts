import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminChatConversationSummaries,
  buildAdminChatTargets,
  mergeAdminChatSummaryRows,
} from './admin-chat-targets.ts';

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
      {
        id: 'duplicate-phone',
        name: '중복 FC',
        phone: '010 5555 6666',
        signup_completed: true,
        affiliation: '다른 소속',
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

test('buildAdminChatConversationSummaries derives latest messages and unread counts in one pass', () => {
  const summaries = buildAdminChatConversationSummaries({
    viewerId: 'admin-1',
    counterpartPhones: ['010-1111-2222', '01033334444'],
    messages: [
      {
        sender_id: '01011112222',
        receiver_id: 'admin-1',
        content: 'first unread',
        created_at: '2026-06-25T10:00:00.000Z',
        is_read: false,
      },
      {
        sender_id: 'admin-1',
        receiver_id: '01011112222',
        content: 'latest reply',
        created_at: '2026-06-25T10:05:00.000Z',
        is_read: true,
      },
      {
        sender_id: '01033334444',
        receiver_id: 'admin-1',
        content: 'other unread',
        created_at: '2026-06-25T09:30:00.000Z',
        is_read: false,
      },
      {
        sender_id: '01099998888',
        receiver_id: 'admin-1',
        content: 'outside scoped FC list',
        created_at: '2026-06-25T11:00:00.000Z',
        is_read: false,
      },
    ],
  });

  assert.deepStrictEqual(summaries, {
    '01011112222': {
      last_message: 'latest reply',
      last_time: '2026-06-25T10:05:00.000Z',
      unread_count: 1,
    },
    '01033334444': {
      last_message: 'other unread',
      last_time: '2026-06-25T09:30:00.000Z',
      unread_count: 1,
    },
  });
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

test('mergeAdminChatSummaryRows keeps unread backfill rows from double-counting recent messages', () => {
  const rows = mergeAdminChatSummaryRows(
    [
      {
        id: 'already-recent-unread',
        sender_id: '01011112222',
        receiver_id: 'admin-1',
        content: 'recent unread',
        created_at: '2026-06-25T10:00:00.000Z',
        is_read: false,
      },
      {
        id: 'recent-reply',
        sender_id: 'admin-1',
        receiver_id: '01011112222',
        content: 'latest reply',
        created_at: '2026-06-25T10:05:00.000Z',
        is_read: true,
      },
    ],
    [
      {
        id: 'already-recent-unread',
        sender_id: '01011112222',
        receiver_id: 'admin-1',
        content: 'recent unread',
        created_at: '2026-06-25T10:00:00.000Z',
        is_read: false,
      },
      {
        id: 'older-unread-backfill',
        sender_id: '01033334444',
        receiver_id: 'admin-1',
        content: 'older unread',
        created_at: '2026-06-24T09:00:00.000Z',
        is_read: false,
      },
    ],
  );

  assert.deepStrictEqual(rows.map((row) => row.id), [
    'already-recent-unread',
    'recent-reply',
    'older-unread-backfill',
  ]);
});
