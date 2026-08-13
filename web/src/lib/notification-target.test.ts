import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTrustedNotificationHref,
  parseNotificationTargetV1,
  parseRequestBoardTargetForFc,
  resolveNotificationDestination,
} from './notification-target.ts';

const UUID = '018f4f87-1ad4-7e39-9f5f-a89f2bdd9c11';

test('strictly parses every notification target v1 variant', () => {
  const values = [
    { version: 1, kind: 'fc_profile', fcId: UUID },
    { version: 1, kind: 'onboarding_section', fcId: UUID, section: 'docs_upload' },
    { version: 1, kind: 'board_post', postId: UUID },
    { version: 1, kind: 'notice', noticeId: UUID },
    { version: 1, kind: 'exam', examType: 'life', examRegistrationId: UUID },
    { version: 1, kind: 'exam', examType: 'nonlife', examRoundId: UUID },
    { version: 1, kind: 'garamin_direct_chat', conversationId: UUID },
    { version: 1, kind: 'group_chat', roomId: UUID },
    { version: 1, kind: 'request', requestId: 3 },
    { version: 1, kind: 'request_chat', requestDesignerId: 4 },
    { version: 1, kind: 'request_direct_chat', directConversationId: 5 },
  ];

  for (const value of values) assert.deepEqual(parseNotificationTargetV1(value), value);
});

test('rejects malformed identifiers, XOR violations, unsafe integers, and extra keys', () => {
  assert.equal(parseNotificationTargetV1({ version: 1, type: 'notice', noticeId: UUID }), null);
  assert.equal(parseNotificationTargetV1({ version: 1, kind: 'fc_profile', fcId: '1' }), null);
  assert.equal(parseNotificationTargetV1({
    version: 1,
    kind: 'exam',
    examType: 'life',
    examRegistrationId: UUID,
    examRoundId: UUID,
  }), null);
  assert.equal(parseNotificationTargetV1({
    version: 1,
    kind: 'request',
    requestId: Number.MAX_SAFE_INTEGER + 1,
  }), null);
  assert.equal(parseNotificationTargetV1({
    version: 1,
    kind: 'notice',
    noticeId: UUID,
    target_url: '/dashboard',
  }), null);
});

test('normalizes only exact Request Board target kinds', () => {
  assert.deepEqual(
    parseRequestBoardTargetForFc({ version: 1, kind: 'request_chat', requestDesignerId: 17 }),
    { version: 1, kind: 'request_chat', requestDesignerId: 17 },
  );
  assert.equal(
    parseRequestBoardTargetForFc({
      version: 1,
      kind: 'request_chat',
      requestDesignerId: 17,
      extra: true,
    }),
    null,
  );
});

test('resolves stable direct conversation IDs without fabricated names', () => {
  const destination = resolveNotificationDestination({
    version: 1,
    kind: 'garamin_direct_chat',
    conversationId: UUID,
  });
  assert.deepEqual(destination, {
    scope: 'same-origin',
    href: `/dashboard/chat?conversationId=${UUID}`,
  });
});

test('allows only relative same-origin routes or the configured Request Board origin', () => {
  assert.equal(
    buildTrustedNotificationHref({
      destination: { scope: 'same-origin', href: `/dashboard/board?postId=${UUID}` },
    }),
    `/dashboard/board?postId=${UUID}`,
  );
  assert.equal(
    buildTrustedNotificationHref({
      destination: { scope: 'request-board', href: '/request/7' },
      requestBoardOrigin: 'https://requests.example.test',
    }),
    'https://requests.example.test/request/7',
  );
  assert.equal(
    buildTrustedNotificationHref({
      destination: { scope: 'same-origin', href: '//evil.test/path' },
    }),
    null,
  );
  for (const href of [
    'https://evil.test/x',
    '//evil.test/x',
    '/dashboard\\admin',
    '/dashboard/../admin',
    '/dashboard/%2e%2e/admin',
    '/dashboard/%2E%2E%2Fadmin',
    `/dashboard/board?postId=${UUID}#unexpected`,
  ]) {
    assert.equal(
      buildTrustedNotificationHref({ destination: { scope: 'same-origin', href } }),
      null,
    );
  }
  for (const href of [
    'https://evil.test/x',
    '//evil.test/x',
    '/request/../admin',
    '/request/%2e%2e/admin',
  ]) {
    assert.equal(
      buildTrustedNotificationHref({
        destination: { scope: 'request-board', href },
        requestBoardOrigin: 'https://requests.example.test',
      }),
      null,
    );
  }
});
