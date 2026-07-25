import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  parseNotificationTargetV1,
  requireNotificationTargetV1,
} from '../notification-target.ts';

const uuid = '123e4567-e89b-42d3-a456-426614174000';

Deno.test('accepts every frozen notification target v1 shape', () => {
  const targets = [
    { version: 1, kind: 'fc_profile', fcId: uuid },
    { version: 1, kind: 'onboarding_section', fcId: uuid, section: 'docs_upload' },
    { version: 1, kind: 'board_post', postId: uuid },
    { version: 1, kind: 'notice', noticeId: uuid },
    { version: 1, kind: 'exam', examType: 'life', examRegistrationId: uuid },
    { version: 1, kind: 'exam', examType: 'nonlife', examRoundId: uuid },
    { version: 1, kind: 'garamin_direct_chat', conversationId: uuid },
    { version: 1, kind: 'group_chat', roomId: uuid },
    { version: 1, kind: 'request', requestId: 1 },
    { version: 1, kind: 'request_chat', requestDesignerId: Number.MAX_SAFE_INTEGER },
    { version: 1, kind: 'request_direct_chat', directConversationId: 9 },
  ];
  targets.forEach((target) => assertEquals<unknown>(parseNotificationTargetV1(target), target));
});

Deno.test('rejects extra keys, malformed UUIDs, unsafe integers, and non-exclusive exam keys', () => {
  const invalid = [
    { version: 1, kind: 'fc_profile', fcId: uuid, extra: true },
    { version: 1, kind: 'board_post', postId: 'not-a-uuid' },
    { version: 1, kind: 'request', requestId: Number.MAX_SAFE_INTEGER + 1 },
    { version: 1, kind: 'request_chat', requestDesignerId: 0 },
    {
      version: 1,
      kind: 'exam',
      examType: 'life',
      examRegistrationId: uuid,
      examRoundId: uuid,
    },
    { version: 1, kind: 'exam', examType: 'third', examRegistrationId: uuid },
  ];
  invalid.forEach((target) => assertEquals(parseNotificationTargetV1(target), null));
  assertThrows(() => requireNotificationTargetV1(invalid[0]));
});
