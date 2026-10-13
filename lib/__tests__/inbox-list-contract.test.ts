import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseInboxListPayload,
  parseLatestNoticePayload,
} from '../inbox-list-contract';

const NOTIFICATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOTICE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const notification = {
  id: NOTIFICATION_ID,
  title: '알림',
  body: '본문',
  category: 'request_board_message',
  target: null,
  target_url: null,
  created_at: '2026-10-13T01:02:03.456Z',
  resident_id: null,
  read_at: null,
  dismissed_at: null,
};

const notice = {
  id: NOTICE_ID,
  title: '공지',
  body: '본문',
  category: null,
  created_at: '2026-10-13T00:00:00.000Z',
  images: ['https://files.example.test/notice.png'],
  files: [{ name: 'notice.pdf', url: 'https://files.example.test/notice.pdf', type: 'application/pdf' }],
  target: { version: 1, kind: 'notice', noticeId: NOTICE_ID },
};

describe('mobile inbox list response contract', () => {
  test('accepts exact notification and legacy or board notice rows', () => {
    const olderBoardNotice = {
      ...notice,
      id: `board_notice:${NOTIFICATION_ID}`,
      created_at: '2026-10-12T00:00:00.000Z',
    };
    expect(parseInboxListPayload({
      ok: true,
      notifications: [notification],
      notices: [notice, olderBoardNotice],
    })).toEqual({
      ok: true,
      notifications: [notification],
      notices: [notice, olderBoardNotice],
      notification_has_more: false,
      notification_next_cursor: null,
      notice_has_more: false,
      notice_next_cursor: null,
    });
  });

  test('accepts independent stable cursors for notification and notice pages', () => {
    expect(parseInboxListPayload({
      ok: true,
      notifications: [notification],
      notices: [notice],
      notification_has_more: true,
      notification_next_cursor: {
        created_at: notification.created_at,
        id: notification.id,
      },
      notice_has_more: true,
      notice_next_cursor: {
        created_at: notice.created_at,
        id: notice.id,
      },
    })).toMatchObject({
      notification_has_more: true,
      notice_has_more: true,
    });
  });

  test.each([
    ['missing notification array', { ok: true, notices: [] }],
    ['missing notice array', { ok: true, notifications: [] }],
    ['invalid notification UUID', { ok: true, notifications: [{ ...notification, id: 'not-a-uuid' }], notices: [] }],
    ['invalid notification timestamp', { ok: true, notifications: [{ ...notification, created_at: 'not-a-date' }], notices: [] }],
    ['missing receipt timestamp', { ok: true, notifications: [{ ...notification, read_at: undefined }], notices: [] }],
    ['duplicate notifications', { ok: true, notifications: [notification, notification], notices: [] }],
    ['invalid notice ID', { ok: true, notifications: [], notices: [{ ...notice, id: 'board_notice:not-a-uuid' }] }],
    ['invalid notice timestamp', { ok: true, notifications: [], notices: [{ ...notice, created_at: null }] }],
    ['malformed notice image', { ok: true, notifications: [], notices: [{ ...notice, images: ['ok', 1] }] }],
    ['malformed notice file', { ok: true, notifications: [], notices: [{ ...notice, files: [{ name: 'missing fields' }] }] }],
    ['duplicate notices', { ok: true, notifications: [], notices: [notice, notice] }],
    ['partial paging metadata', {
      ok: true,
      notifications: [],
      notices: [],
      notification_has_more: false,
    }],
    ['missing notification cursor', {
      ok: true,
      notifications: [],
      notices: [],
      notification_has_more: true,
      notification_next_cursor: null,
      notice_has_more: false,
      notice_next_cursor: null,
    }],
    ['cursor present without more rows', {
      ok: true,
      notifications: [],
      notices: [],
      notification_has_more: false,
      notification_next_cursor: { created_at: notification.created_at, id: notification.id },
      notice_has_more: false,
      notice_next_cursor: null,
    }],
    ['malformed notice cursor', {
      ok: true,
      notifications: [],
      notices: [],
      notification_has_more: false,
      notification_next_cursor: null,
      notice_has_more: true,
      notice_next_cursor: { created_at: notice.created_at, id: 'not-a-notice-id' },
    }],
    ['unstable notification tuple order', {
      ok: true,
      notifications: [
        { ...notification, id: NOTIFICATION_ID },
        { ...notification, id: NOTICE_ID },
      ],
      notices: [],
    }],
  ])('rejects %s instead of converting it to empty data', (_label, payload) => {
    expect(() => parseInboxListPayload(payload)).toThrow('notification inbox response is invalid');
  });

  test('all mobile inbox surfaces use the shared fail-closed parser', () => {
    const root = join(__dirname, '..', '..');
    const notificationsSource = readFileSync(join(root, 'app', 'notifications.tsx'), 'utf8');
    const noticeSource = readFileSync(join(root, 'app', 'notice.tsx'), 'utf8');
    const requestBoardSource = readFileSync(join(root, 'app', 'request-board.tsx'), 'utf8');

    for (const source of [notificationsSource, noticeSource, requestBoardSource]) {
      expect(source).toContain('parseInboxListPayload(data)');
    }
    expect(notificationsSource).not.toContain('(data.notifications ?? [])');
    expect(notificationsSource).not.toContain('(data.notices ?? [])');
    expect(notificationsSource).toContain('notification_cursor: options.notificationCursor');
    expect(notificationsSource).toContain('notice_cursor: options.noticeCursor');
    expect(notificationsSource).toContain('setNotificationHasMore(page.notificationHasMore)');
    expect(notificationsSource).toContain('setNoticeHasMore(page.noticeHasMore)');
    expect(notificationsSource).toContain('이전 알림 더 보기');
    expect(noticeSource).not.toContain('item.created_at ?? new Date().toISOString()');
    expect(noticeSource).not.toContain('.filter(isAttachedFile)');
    expect(noticeSource).toContain('notice_cursor: cursor');
    expect(noticeSource).toContain('inbox.notice_has_more ? inbox.notice_next_cursor : null');
    expect(noticeSource).toContain('이전 공지 더 보기');
    expect(requestBoardSource).toContain(
      "setRequestBoardAccessError('최근 활동을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')",
    );
  });
});

describe('mobile latest notice response contract', () => {
  const latestNotice = {
    id: NOTICE_ID,
    title: '최신 공지',
    body: '본문',
    category: '공지',
    created_at: '2026-10-13T00:00:00.000Z',
    target: { version: 1, kind: 'notice', noticeId: NOTICE_ID },
  };

  test('accepts an exact notice or an explicit empty result', () => {
    expect(parseLatestNoticePayload({ ok: true, notice: latestNotice })).toEqual({
      ok: true,
      notice: latestNotice,
    });
    expect(parseLatestNoticePayload({ ok: true, notice: null })).toEqual({
      ok: true,
      notice: null,
    });
  });

  test('accepts a board notice only when its typed target matches its prefixed id', () => {
    const boardNotice = {
      ...latestNotice,
      id: `board_notice:${NOTICE_ID}`,
      target: { version: 1, kind: 'board_post', postId: NOTICE_ID },
    };
    expect(parseLatestNoticePayload({ ok: true, notice: boardNotice }).notice).toEqual(boardNotice);
  });

  test.each([
    ['missing notice', { ok: true }],
    ['malformed notice', { ok: true, notice: {} }],
    ['invalid timestamp', { ok: true, notice: { ...latestNotice, created_at: 'not-a-date' } }],
    ['missing target', { ok: true, notice: { ...latestNotice, target: undefined } }],
    ['mismatched target', {
      ok: true,
      notice: {
        ...latestNotice,
        target: { version: 1, kind: 'notice', noticeId: NOTIFICATION_ID },
      },
    }],
  ])('rejects %s instead of treating it as no notice', (_label, payload) => {
    expect(() => parseLatestNoticePayload(payload)).toThrow('latest notice response is invalid');
  });

  test('the home query uses the shared fail-closed parser', () => {
    const root = join(__dirname, '..', '..');
    const homeSource = readFileSync(join(root, 'app', 'index.tsx'), 'utf8');
    expect(homeSource).toContain('parseLatestNoticePayload(data).notice');
    expect(homeSource).not.toContain('return data.notice ?? null');
  });
});
