export const NOTIFICATION_TARGET_VERSION = 1 as const;

export type NotificationOnboardingSection =
  | 'home'
  | 'consent'
  | 'docs_upload'
  | 'hanwha_commission'
  | 'appointment';

export type NotificationExamType = 'life' | 'nonlife';

export type NotificationTarget =
  | { version: 1; kind: 'fc_profile'; fcId: string }
  | {
      version: 1;
      kind: 'onboarding_section';
      fcId: string;
      section: NotificationOnboardingSection;
    }
  | { version: 1; kind: 'board_post'; postId: string }
  | { version: 1; kind: 'notice'; noticeId: string }
  | {
      version: 1;
      kind: 'exam';
      examType: NotificationExamType;
      examRegistrationId: string;
    }
  | {
      version: 1;
      kind: 'exam';
      examType: NotificationExamType;
      examRoundId: string;
    }
  | { version: 1; kind: 'garamin_direct_chat'; conversationId: string }
  | { version: 1; kind: 'group_chat'; roomId: string }
  | { version: 1; kind: 'request'; requestId: number }
  | { version: 1; kind: 'request_chat'; requestDesignerId: number }
  | {
      version: 1;
      kind: 'request_direct_chat';
      directConversationId: number;
    };

export type NotificationTargetViewerRole = 'admin' | 'fc';

export type ParsedNotificationPush = {
  notificationId: string;
  target: NotificationTarget;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ONBOARDING_SECTIONS = new Set<NotificationOnboardingSection>([
  'home',
  'consent',
  'docs_upload',
  'hanwha_commission',
  'appointment',
]);

const EXAM_TYPES = new Set<NotificationExamType>(['life', 'nonlife']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

export function isNotificationUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
  );
}

function decodeTargetInput(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function parseNotificationTarget(input: unknown): NotificationTarget | null {
  const value = decodeTargetInput(input);
  if (!isPlainRecord(value) || value.version !== NOTIFICATION_TARGET_VERSION) {
    return null;
  }

  switch (value.kind) {
    case 'fc_profile':
      return hasExactKeys(value, ['version', 'kind', 'fcId'])
        && isNotificationUuid(value.fcId)
        ? { version: 1, kind: 'fc_profile', fcId: value.fcId }
        : null;
    case 'onboarding_section':
      return hasExactKeys(value, ['version', 'kind', 'fcId', 'section'])
        && isNotificationUuid(value.fcId)
        && typeof value.section === 'string'
        && ONBOARDING_SECTIONS.has(value.section as NotificationOnboardingSection)
        ? {
            version: 1,
            kind: 'onboarding_section',
            fcId: value.fcId,
            section: value.section as NotificationOnboardingSection,
          }
        : null;
    case 'board_post':
      return hasExactKeys(value, ['version', 'kind', 'postId'])
        && isNotificationUuid(value.postId)
        ? { version: 1, kind: 'board_post', postId: value.postId }
        : null;
    case 'notice':
      return hasExactKeys(value, ['version', 'kind', 'noticeId'])
        && isNotificationUuid(value.noticeId)
        ? { version: 1, kind: 'notice', noticeId: value.noticeId }
        : null;
    case 'exam': {
      if (
        typeof value.examType !== 'string'
        || !EXAM_TYPES.has(value.examType as NotificationExamType)
      ) {
        return null;
      }
      if (
        hasExactKeys(value, [
          'version',
          'kind',
          'examType',
          'examRegistrationId',
        ])
        && isNotificationUuid(value.examRegistrationId)
      ) {
        return {
          version: 1,
          kind: 'exam',
          examType: value.examType as NotificationExamType,
          examRegistrationId: value.examRegistrationId,
        };
      }
      if (
        hasExactKeys(value, ['version', 'kind', 'examType', 'examRoundId'])
        && isNotificationUuid(value.examRoundId)
      ) {
        return {
          version: 1,
          kind: 'exam',
          examType: value.examType as NotificationExamType,
          examRoundId: value.examRoundId,
        };
      }
      return null;
    }
    case 'garamin_direct_chat':
      return hasExactKeys(value, ['version', 'kind', 'conversationId'])
        && isNotificationUuid(value.conversationId)
        ? {
            version: 1,
            kind: 'garamin_direct_chat',
            conversationId: value.conversationId,
          }
        : null;
    case 'group_chat':
      return hasExactKeys(value, ['version', 'kind', 'roomId'])
        && isNotificationUuid(value.roomId)
        ? { version: 1, kind: 'group_chat', roomId: value.roomId }
        : null;
    case 'request':
      return hasExactKeys(value, ['version', 'kind', 'requestId'])
        && isPositiveSafeInteger(value.requestId)
        ? { version: 1, kind: 'request', requestId: value.requestId }
        : null;
    case 'request_chat':
      return hasExactKeys(value, ['version', 'kind', 'requestDesignerId'])
        && isPositiveSafeInteger(value.requestDesignerId)
        ? {
            version: 1,
            kind: 'request_chat',
            requestDesignerId: value.requestDesignerId,
          }
        : null;
    case 'request_direct_chat':
      return hasExactKeys(value, [
        'version',
        'kind',
        'directConversationId',
      ])
        && isPositiveSafeInteger(value.directConversationId)
        ? {
            version: 1,
            kind: 'request_direct_chat',
            directConversationId: value.directConversationId,
          }
        : null;
    default:
      return null;
  }
}

export function serializeNotificationTarget(target: NotificationTarget): string {
  return JSON.stringify(target);
}

export function notificationTargetsEqual(
  left: NotificationTarget,
  right: NotificationTarget,
): boolean {
  return serializeNotificationTarget(left) === serializeNotificationTarget(right);
}

export function parseNotificationPushData(
  input: unknown,
): ParsedNotificationPush | null {
  if (!isPlainRecord(input)) return null;
  const notificationId = input.notificationId;
  const target = parseNotificationTarget(input.target);
  if (!isNotificationUuid(notificationId) || !target) return null;
  return { notificationId, target };
}

function appendNotificationReceiptParams(
  path: string,
  notificationId: string,
  target: NotificationTarget,
): string {
  const separator = path.includes('?') ? '&' : '?';
  const params = new URLSearchParams({
    notificationId,
    notificationTarget: serializeNotificationTarget(target),
  });
  return `${path}${separator}${params.toString()}`;
}

export function buildNotificationTargetRoute(input: {
  target: NotificationTarget;
  notificationId: string;
  viewerRole: NotificationTargetViewerRole;
}): string | null {
  const { target, notificationId, viewerRole } = input;
  if (!isNotificationUuid(notificationId)) return null;

  let path: string | null = null;
  switch (target.kind) {
    case 'fc_profile':
      path = viewerRole === 'admin'
        ? `/dashboard?fcId=${encodeURIComponent(target.fcId)}`
        : null;
      break;
    case 'onboarding_section':
      if (viewerRole === 'admin') {
        path =
          `/dashboard?fcId=${encodeURIComponent(target.fcId)}`
          + `&section=${encodeURIComponent(target.section)}`;
        break;
      }
      path = {
        home: '/',
        consent: '/consent',
        docs_upload: `/docs-upload?userId=${encodeURIComponent(target.fcId)}`,
        hanwha_commission: '/hanwha-commission',
        appointment: '/appointment',
      }[target.section];
      break;
    case 'board_post':
      path = `/board?postId=${encodeURIComponent(target.postId)}`;
      break;
    case 'notice':
      path = `/notice-detail?id=${encodeURIComponent(target.noticeId)}`;
      break;
    case 'exam': {
      const suffix = target.examType === 'life' ? '' : '2';
      if ('examRegistrationId' in target) {
        const page = viewerRole === 'admin' ? `/exam-manage${suffix}` : `/exam-apply${suffix}`;
        path =
          `${page}?registrationId=${encodeURIComponent(target.examRegistrationId)}`;
      } else {
        const page = viewerRole === 'admin' ? `/exam-register${suffix}` : `/exam-apply${suffix}`;
        path = `${page}?roundId=${encodeURIComponent(target.examRoundId)}`;
      }
      break;
    }
    case 'garamin_direct_chat':
      path =
        `/chat?conversationId=${encodeURIComponent(target.conversationId)}`;
      break;
    case 'group_chat':
      path = `/group-chat?roomId=${encodeURIComponent(target.roomId)}`;
      break;
    case 'request':
      path = `/request-board-review?id=${target.requestId}`;
      break;
    case 'request_chat':
      path =
        `/request-board-messenger?requestDesignerId=${target.requestDesignerId}`;
      break;
    case 'request_direct_chat':
      path =
        `/request-board-messenger?directConversationId=${target.directConversationId}`;
      break;
  }

  return path
    ? appendNotificationReceiptParams(path, notificationId, target)
    : null;
}
