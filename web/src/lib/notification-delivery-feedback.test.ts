import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  getNotificationDeliveryFeedback,
  parseNotificationDeliveryFeedback,
} from './notification-delivery-feedback.ts';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (path: string) => readFileSync(resolve(sourceRoot, path), 'utf8');

test('treats a stored notification without a registered device as user-visible success', () => {
  assert.deepEqual(
    parseNotificationDeliveryFeedback({
      stored: true,
      push_status: 'no_registered_device',
    }),
    getNotificationDeliveryFeedback('no_registered_device'),
  );
  assert.equal(
    getNotificationDeliveryFeedback('no_registered_device').retryable,
    false,
  );
  assert.equal(
    getNotificationDeliveryFeedback('no_registered_device').severity,
    'success',
  );
});

test('distinguishes provider, persistence, and recipient failures', () => {
  const storedProviderFailure = parseNotificationDeliveryFeedback({
    delivery: {
      notificationStored: true,
      pushStatus: 'provider_rejected',
      retryable: false,
    },
  });
  assert.equal(storedProviderFailure?.state, 'provider_failed');
  assert.equal(storedProviderFailure?.severity, 'success');
  assert.equal(
    parseNotificationDeliveryFeedback({
      delivery: {
        notificationStored: false,
        pushStatus: 'not_attempted',
        retryable: true,
      },
    })?.state,
    'persistence_failed',
  );
  assert.equal(
    parseNotificationDeliveryFeedback({
      notification_delivery: { state: 'invalid_recipient' },
    })?.state,
    'invalid_recipient',
  );
});

test('both direct chat surfaces commit the returned message before delivery feedback', () => {
  const fcChat = readSource('app/chat/page.tsx');
  assert.match(
    fcChat,
    /upsertLocalMessage\(\{[\s\S]*?\.\.\.inserted,[\s\S]*?\}\);[\s\S]*?notifications\.show\(/,
  );

  const dashboardChat = readSource('app/dashboard/chat/page.tsx');
  assert.match(
    dashboardChat,
    /const insertedMessage: Message = \{[\s\S]*?setMessages\(next\);[\s\S]*?notifications\.show\(/,
  );
});

test('direct chat surfaces send stable client message ids', () => {
  const fcChat = readSource('app/chat/page.tsx');
  const dashboardChat = readSource('app/dashboard/chat/page.tsx');
  const proxy = readSource('lib/fc-notify-proxy-policy.ts');
  assert.match(fcChat, /client_message_id: localId/);
  assert.match(fcChat, /reuseLocalId \?\? crypto\.randomUUID\(\)/);
  assert.match(fcChat, /aria-label="알림만 재시도"/);
  assert.match(dashboardChat, /client_message_id: clientMessageId/);
  assert.match(dashboardChat, /pendingRetryRef\.current = \{ content: trimmed, clientMessageId \}/);
  assert.match(dashboardChat, /handleRetryNotification/);
  assert.match(dashboardChat, /aria-label="알림만 재시도"/);
  assert.match(proxy, /client_message_id: clientMessageId/);
  assert.match(proxy, /Invalid direct message client id/);
});

test('board and both exam schedule screens surface committed-write delivery feedback', () => {
  const board = readSource('app/dashboard/board/page.tsx');
  assert.match(board, /작성 완료 · 알림함 등록 실패/);
  assert.match(board, /수정 완료 · 알림함 등록 실패/);
  assert.doesNotMatch(board, /color: notificationWarningMessage \?/);

  const schedule = readSource('app/dashboard/exam/schedule/page.tsx');
  const alternate = readSource('app/admin/exams/new/page.tsx');
  assert.match(schedule, /result\.notificationDelivery\.severity !== 'success'/);
  assert.match(alternate, /result\.notificationDelivery\.severity !== 'success'/);
});

test('dashboard senders expose only inbox persistence or invalid-recipient failures', () => {
  const dashboard = readSource('app/dashboard/page.tsx');
  assert.match(dashboard, /!notificationResult\.inbox\?\.logged/);
  assert.match(dashboard, /failure === 'missing_recipient' \|\| failure === 'recipient_mismatch'/);
  assert.doesNotMatch(dashboard, /if \(!notificationResult\.success\)/);

  const noticeCreate = readSource('app/dashboard/notifications/create/page.tsx');
  assert.match(noticeCreate, /notification_persistence_incomplete/);
  assert.match(noticeCreate, /notification_persistence_and_delivery_incomplete/);
  assert.doesNotMatch(noticeCreate, /result\.notificationWarning === 'notification_delivery_incomplete'/);
});

test('board and group chat name the failed inbox write explicitly', () => {
  const boardApi = readSource('lib/board-api.ts');
  const groupChat = readSource('app/dashboard/group-chat/page.tsx');
  const exactCopy = /요청은 처리됐지만 수신자 알림함에 등록하지 못했습니다\./;
  assert.match(boardApi, exactCopy);
  assert.match(groupChat, exactCopy);
  assert.doesNotMatch(boardApi, /알림 전달을 확인하지 못했습니다/);
  assert.doesNotMatch(groupChat, /일부 알림 전송을 확인하지 못했습니다/);
});

test('group chat never renders sender-facing read-state or unread delivery warnings', () => {
  const groupChat = readSource('app/dashboard/group-chat/page.tsx');

  assert.doesNotMatch(groupChat, /showGroupChatReadStateWarning/);
  assert.doesNotMatch(groupChat, /warning\.message\.includes\(['"]읽음 상태['"]\)/);
  assert.doesNotMatch(groupChat, /notification_delivery_partial/);
  assert.match(
    groupChat,
    /notification\.delivery\.notificationStored === false[\s\S]*showGroupChatInboxWarning\(\)/,
  );
  assert.match(
    groupChat,
    /요청은 처리됐지만 수신자 알림함에 등록하지 못했습니다\./,
  );
});
