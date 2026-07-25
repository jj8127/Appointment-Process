import {
  buildNotificationTargetRoute,
  parseNotificationPushData,
  parseNotificationTarget,
  type NotificationTarget,
} from '../notification-target';

const UUIDS = {
  notification: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  entity: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

const targets: NotificationTarget[] = [
  { version: 1, kind: 'fc_profile', fcId: UUIDS.entity },
  {
    version: 1,
    kind: 'onboarding_section',
    fcId: UUIDS.entity,
    section: 'docs_upload',
  },
  { version: 1, kind: 'board_post', postId: UUIDS.entity },
  { version: 1, kind: 'notice', noticeId: UUIDS.entity },
  {
    version: 1,
    kind: 'exam',
    examType: 'life',
    examRegistrationId: UUIDS.entity,
  },
  {
    version: 1,
    kind: 'exam',
    examType: 'nonlife',
    examRoundId: UUIDS.entity,
  },
  {
    version: 1,
    kind: 'garamin_direct_chat',
    conversationId: UUIDS.entity,
  },
  { version: 1, kind: 'group_chat', roomId: UUIDS.entity },
  { version: 1, kind: 'request', requestId: 12 },
  { version: 1, kind: 'request_chat', requestDesignerId: 13 },
  {
    version: 1,
    kind: 'request_direct_chat',
    directConversationId: 14,
  },
];

describe('notification target v1', () => {
  test.each(targets)('strictly parses $kind', (target) => {
    expect(parseNotificationTarget(target)).toEqual(target);
    expect(parseNotificationTarget(JSON.stringify(target))).toEqual(target);
    expect(parseNotificationTarget({ ...target, extra: true })).toBeNull();
  });

  it('rejects malformed UUIDs, unsafe ids, unknown kinds, and exam ambiguity', () => {
    expect(
      parseNotificationTarget({
        version: 1,
        kind: 'board_post',
        postId: 'not-a-uuid',
      }),
    ).toBeNull();
    expect(
      parseNotificationTarget({
        version: 1,
        kind: 'board_post',
        postId: 'bbbbbbbb-bbbb-0bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).toBeNull();
    expect(
      parseNotificationTarget({
        version: 1,
        kind: 'board_post',
        postId: 'bbbbbbbb-bbbb-4bbb-0bbb-bbbbbbbbbbbb',
      }),
    ).toBeNull();
    expect(
      parseNotificationTarget({
        version: 1,
        kind: 'request',
        requestId: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBeNull();
    expect(
      parseNotificationTarget({
        version: 1,
        kind: 'request',
        requestId: '12',
      }),
    ).toBeNull();
    expect(
      parseNotificationTarget({
        version: 1,
        kind: 'unknown',
        id: UUIDS.entity,
      }),
    ).toBeNull();
    expect(
      parseNotificationTarget({
        version: 1,
        kind: 'exam',
        examType: 'life',
        examRegistrationId: UUIDS.entity,
        examRoundId: UUIDS.entity,
      }),
    ).toBeNull();
  });

  it('requires exact notificationId + target push data and never guesses', () => {
    expect(
      parseNotificationPushData({
        notificationId: UUIDS.notification,
        target: targets[2],
        title: 'ignored',
        body: 'ignored',
        url: '/dashboard',
      }),
    ).toEqual({
      notificationId: UUIDS.notification,
      target: targets[2],
    });
    expect(parseNotificationPushData({ target: targets[2] })).toBeNull();
    expect(
      parseNotificationPushData({
        notificationId: 'aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa',
        target: targets[2],
      }),
    ).toBeNull();
    expect(
      parseNotificationPushData({
        notificationId: 'aaaaaaaa-aaaa-4aaa-0aaa-aaaaaaaaaaaa',
        target: targets[2],
      }),
    ).toBeNull();
    expect(
      parseNotificationPushData({
        notificationId: UUIDS.notification,
        title: '게시글',
        url: '/board',
      }),
    ).toBeNull();
  });

  it('maps every exact target to an internal route with receipt handoff', () => {
    for (const target of targets) {
      const route = buildNotificationTargetRoute({
        target,
        notificationId: UUIDS.notification,
        viewerRole: target.kind === 'fc_profile' ? 'admin' : 'fc',
      });
      expect(route).toContain(`notificationId=${UUIDS.notification}`);
      expect(route).toContain('notificationTarget=');
      expect(route).not.toMatch(/^https?:/);
    }
  });

  it('keeps request chat and direct chat selectors distinct', () => {
    const requestChatRoute = buildNotificationTargetRoute({
      target: {
        version: 1,
        kind: 'request_chat',
        requestDesignerId: 41,
      },
      notificationId: UUIDS.notification,
      viewerRole: 'fc',
    });
    const directChatRoute = buildNotificationTargetRoute({
      target: {
        version: 1,
        kind: 'request_direct_chat',
        directConversationId: 42,
      },
      notificationId: UUIDS.notification,
      viewerRole: 'fc',
    });
    expect(requestChatRoute).toContain('requestDesignerId=41');
    expect(requestChatRoute).not.toContain('directConversationId');
    expect(directChatRoute).toContain('directConversationId=42');
    expect(directChatRoute).not.toContain('requestDesignerId');
  });
});
