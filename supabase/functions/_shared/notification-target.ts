export const NOTIFICATION_TARGET_VERSION = 1 as const;

export type NotificationTargetV1 =
  | { version: 1; kind: 'fc_profile'; fcId: string }
  | {
      version: 1;
      kind: 'onboarding_section';
      fcId: string;
      section: 'home' | 'consent' | 'docs_upload' | 'hanwha_commission' | 'appointment';
    }
  | { version: 1; kind: 'board_post'; postId: string }
  | { version: 1; kind: 'notice'; noticeId: string }
  | { version: 1; kind: 'exam'; examType: 'life' | 'nonlife'; examRegistrationId: string }
  | { version: 1; kind: 'exam'; examType: 'life' | 'nonlife'; examRoundId: string }
  | { version: 1; kind: 'garamin_direct_chat'; conversationId: string }
  | { version: 1; kind: 'group_chat'; roomId: string }
  | { version: 1; kind: 'request'; requestId: number }
  | { version: 1; kind: 'request_chat'; requestDesignerId: number }
  | { version: 1; kind: 'request_direct_chat'; directConversationId: number };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ONBOARDING_SECTIONS = new Set([
  'home',
  'consent',
  'docs_upload',
  'hanwha_commission',
  'appointment',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parseNotificationTargetV1(value: unknown): NotificationTargetV1 | null {
  if (!isRecord(value) || value.version !== NOTIFICATION_TARGET_VERSION || typeof value.kind !== 'string') {
    return null;
  }

  switch (value.kind) {
    case 'fc_profile':
      return hasExactKeys(value, ['version', 'kind', 'fcId']) && isUuid(value.fcId)
        ? value as NotificationTargetV1
        : null;
    case 'onboarding_section':
      return hasExactKeys(value, ['version', 'kind', 'fcId', 'section'])
          && isUuid(value.fcId)
          && typeof value.section === 'string'
          && ONBOARDING_SECTIONS.has(value.section)
        ? value as NotificationTargetV1
        : null;
    case 'board_post':
      return hasExactKeys(value, ['version', 'kind', 'postId']) && isUuid(value.postId)
        ? value as NotificationTargetV1
        : null;
    case 'notice':
      return hasExactKeys(value, ['version', 'kind', 'noticeId']) && isUuid(value.noticeId)
        ? value as NotificationTargetV1
        : null;
    case 'exam': {
      if (value.examType !== 'life' && value.examType !== 'nonlife') return null;
      const byRegistration =
        hasExactKeys(value, ['version', 'kind', 'examType', 'examRegistrationId'])
        && isUuid(value.examRegistrationId);
      const byRound =
        hasExactKeys(value, ['version', 'kind', 'examType', 'examRoundId'])
        && isUuid(value.examRoundId);
      return byRegistration || byRound ? value as NotificationTargetV1 : null;
    }
    case 'garamin_direct_chat':
      return hasExactKeys(value, ['version', 'kind', 'conversationId']) && isUuid(value.conversationId)
        ? value as NotificationTargetV1
        : null;
    case 'group_chat':
      return hasExactKeys(value, ['version', 'kind', 'roomId']) && isUuid(value.roomId)
        ? value as NotificationTargetV1
        : null;
    case 'request':
      return hasExactKeys(value, ['version', 'kind', 'requestId']) && isPositiveSafeInteger(value.requestId)
        ? value as NotificationTargetV1
        : null;
    case 'request_chat':
      return hasExactKeys(value, ['version', 'kind', 'requestDesignerId'])
          && isPositiveSafeInteger(value.requestDesignerId)
        ? value as NotificationTargetV1
        : null;
    case 'request_direct_chat':
      return hasExactKeys(value, ['version', 'kind', 'directConversationId'])
          && isPositiveSafeInteger(value.directConversationId)
        ? value as NotificationTargetV1
        : null;
    default:
      return null;
  }
}

export function requireNotificationTargetV1(value: unknown): NotificationTargetV1 {
  const parsed = parseNotificationTargetV1(value);
  if (!parsed) throw new Error('invalid_notification_target');
  return parsed;
}
