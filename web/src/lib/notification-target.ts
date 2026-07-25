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
  | {
      version: 1;
      kind: 'exam';
      examType: 'life' | 'nonlife';
      examRegistrationId: string;
    }
  | {
      version: 1;
      kind: 'exam';
      examType: 'life' | 'nonlife';
      examRoundId: string;
    }
  | { version: 1; kind: 'garamin_direct_chat'; conversationId: string }
  | { version: 1; kind: 'group_chat'; roomId: string }
  | { version: 1; kind: 'request'; requestId: number }
  | { version: 1; kind: 'request_chat'; requestDesignerId: number }
  | { version: 1; kind: 'request_direct_chat'; directConversationId: number };

export type NotificationDestination =
  | { scope: 'same-origin'; href: string }
  | { scope: 'request-board'; href: string };

export type RequestBoardNotificationTargetV1 = Extract<
  NotificationTargetV1,
  { kind: 'request' | 'request_chat' | 'request_direct_chat' }
>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export function parseNotificationTargetV1(value: unknown): NotificationTargetV1 | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.kind !== 'string') return null;

  switch (value.kind) {
    case 'fc_profile':
      return hasExactKeys(value, ['version', 'kind', 'fcId']) && isUuid(value.fcId)
        ? { version: 1, kind: 'fc_profile', fcId: value.fcId }
        : null;
    case 'onboarding_section': {
      const section = value.section;
      return hasExactKeys(value, ['version', 'kind', 'fcId', 'section'])
        && isUuid(value.fcId)
        && (
          section === 'home'
          || section === 'consent'
          || section === 'docs_upload'
          || section === 'hanwha_commission'
          || section === 'appointment'
        )
        ? { version: 1, kind: 'onboarding_section', fcId: value.fcId, section }
        : null;
    }
    case 'board_post':
      return hasExactKeys(value, ['version', 'kind', 'postId']) && isUuid(value.postId)
        ? { version: 1, kind: 'board_post', postId: value.postId }
        : null;
    case 'notice':
      return hasExactKeys(value, ['version', 'kind', 'noticeId']) && isUuid(value.noticeId)
        ? { version: 1, kind: 'notice', noticeId: value.noticeId }
        : null;
    case 'exam': {
      if (value.examType !== 'life' && value.examType !== 'nonlife') return null;
      if (
        hasExactKeys(value, ['version', 'kind', 'examType', 'examRegistrationId'])
        && isUuid(value.examRegistrationId)
      ) {
        return {
          version: 1,
          kind: 'exam',
          examType: value.examType,
          examRegistrationId: value.examRegistrationId,
        };
      }
      if (
        hasExactKeys(value, ['version', 'kind', 'examType', 'examRoundId'])
        && isUuid(value.examRoundId)
      ) {
        return {
          version: 1,
          kind: 'exam',
          examType: value.examType,
          examRoundId: value.examRoundId,
        };
      }
      return null;
    }
    case 'garamin_direct_chat':
      return hasExactKeys(value, ['version', 'kind', 'conversationId'])
        && isUuid(value.conversationId)
        ? { version: 1, kind: 'garamin_direct_chat', conversationId: value.conversationId }
        : null;
    case 'group_chat':
      return hasExactKeys(value, ['version', 'kind', 'roomId']) && isUuid(value.roomId)
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
        ? { version: 1, kind: 'request_chat', requestDesignerId: value.requestDesignerId }
        : null;
    case 'request_direct_chat':
      return hasExactKeys(value, ['version', 'kind', 'directConversationId'])
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

const sectionRoutes: Record<
  Extract<NotificationTargetV1, { kind: 'onboarding_section' }>['section'],
  (fcId: string) => string
> = {
  home: (fcId) => `/dashboard/profile/${encodeURIComponent(fcId)}`,
  consent: (fcId) => `/dashboard/profile/${encodeURIComponent(fcId)}?section=consent`,
  docs_upload: (fcId) => `/dashboard/profile/${encodeURIComponent(fcId)}?section=docs-upload`,
  hanwha_commission: (fcId) =>
    `/dashboard/profile/${encodeURIComponent(fcId)}?section=hanwha-commission`,
  appointment: (fcId) => `/dashboard/profile/${encodeURIComponent(fcId)}?section=appointment`,
};

export function resolveNotificationDestination(
  target: NotificationTargetV1,
): NotificationDestination {
  switch (target.kind) {
    case 'fc_profile':
      return { scope: 'same-origin', href: `/dashboard/profile/${encodeURIComponent(target.fcId)}` };
    case 'onboarding_section':
      return { scope: 'same-origin', href: sectionRoutes[target.section](target.fcId) };
    case 'board_post':
      return {
        scope: 'same-origin',
        href: `/dashboard/board?postId=${encodeURIComponent(target.postId)}`,
      };
    case 'notice':
      return {
        scope: 'same-origin',
        href: `/dashboard/notifications/${encodeURIComponent(target.noticeId)}`,
      };
    case 'exam':
      return 'examRegistrationId' in target
        ? {
            scope: 'same-origin',
            href: `/dashboard/exam/applicants/${encodeURIComponent(target.examRegistrationId)}`,
          }
        : {
            scope: 'same-origin',
            href: `/dashboard/exam/schedule?roundId=${encodeURIComponent(target.examRoundId)}`,
          };
    case 'garamin_direct_chat':
      return {
        scope: 'same-origin',
        href: `/dashboard/chat?conversationId=${encodeURIComponent(target.conversationId)}`,
      };
    case 'group_chat':
      return {
        scope: 'same-origin',
        href: `/dashboard/group-chat?roomId=${encodeURIComponent(target.roomId)}`,
      };
    case 'request':
      return { scope: 'request-board', href: `/request/${target.requestId}` };
    case 'request_chat':
      return {
        scope: 'request-board',
        href: `/chat?room=${encodeURIComponent(`request:${target.requestDesignerId}`)}`,
      };
    case 'request_direct_chat':
      return {
        scope: 'request-board',
        href: `/chat?room=${encodeURIComponent(`direct:${target.directConversationId}`)}`,
      };
  }
}

export function parseRequestBoardTargetForFc(value: unknown): RequestBoardNotificationTargetV1 | null {
  const parsed = parseNotificationTargetV1(value);
  if (
    parsed?.kind === 'request'
    || parsed?.kind === 'request_chat'
    || parsed?.kind === 'request_direct_chat'
  ) {
    return parsed;
  }
  return null;
}

export function buildTrustedNotificationHref(input: {
  destination: NotificationDestination;
  requestBoardOrigin?: string | null;
}): string | null {
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const sameOriginRoutes = [
    new RegExp(`^/dashboard/profile/${uuid}(?:\\?section=(?:consent|docs-upload|hanwha-commission|appointment))?$`, 'i'),
    new RegExp(`^/dashboard/board\\?postId=${uuid}$`, 'i'),
    new RegExp(`^/dashboard/notifications/${uuid}$`, 'i'),
    new RegExp(`^/dashboard/exam/applicants/${uuid}$`, 'i'),
    new RegExp(`^/dashboard/exam/schedule\\?roundId=${uuid}$`, 'i'),
    new RegExp(`^/dashboard/chat\\?conversationId=${uuid}$`, 'i'),
    new RegExp(`^/dashboard/group-chat\\?roomId=${uuid}$`, 'i'),
  ];
  const requestBoardRoutes = [
    /^\/request\/[1-9]\d*$/,
    /^\/chat\?room=(?:request|direct)%3A[1-9]\d*$/,
  ];
  const isSafeAllowlistedRoute = (href: string, allowlist: RegExp[]) => {
    if (
      !href.startsWith('/')
      || href.startsWith('//')
      || /[\\\u0000-\u001f\u007f]/.test(href)
      || /%(?:2e|2f|5c)/i.test(href)
      || href.includes('#')
    ) {
      return false;
    }
    try {
      const decoded = decodeURIComponent(href);
      if (
        decoded.includes('\\')
        || decoded.split(/[?#]/, 1)[0].split('/').some((part) => part === '..')
      ) {
        return false;
      }
    } catch {
      return false;
    }
    return allowlist.some((pattern) => pattern.test(href));
  };

  if (input.destination.scope === 'same-origin') {
    const href = input.destination.href;
    return isSafeAllowlistedRoute(href, sameOriginRoutes) ? href : null;
  }

  if (!isSafeAllowlistedRoute(input.destination.href, requestBoardRoutes)) return null;
  const rawOrigin = String(input.requestBoardOrigin ?? '').trim();
  if (!rawOrigin) return null;
  try {
    const origin = new URL(rawOrigin);
    if (
      (origin.protocol !== 'https:' && origin.protocol !== 'http:')
      || origin.username
      || origin.password
      || origin.pathname !== '/'
      || origin.search
      || origin.hash
    ) {
      return null;
    }
    return new URL(input.destination.href, `${origin.origin}/`).href;
  } catch {
    return null;
  }
}
