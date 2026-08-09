import { isNotificationUuid } from './notification-target';

export const MESSENGER_SEARCH_MAX_LENGTH = 100;
export const MESSENGER_SEARCH_DEBOUNCE_MS = 250;
export const MESSENGER_SEARCH_RESULT_LIMIT = 50;

export type MessengerSearchTab = 'all' | 'people' | 'rooms' | 'messages';
export type MessengerSearchSource = 'internal' | 'group' | 'garamlink';
export type MessengerSearchSourceStatus = 'loading' | 'ready' | 'empty' | 'error' | 'retrying' | 'hint';

export type MessengerSearchRouteTarget =
  | { kind: 'internal'; conversationId: string; targetName?: string; anchorMessageId?: string }
  | { kind: 'internal'; targetId: string; targetName: string }
  | { kind: 'group'; roomId: string; anchorMessageId?: string }
  | { kind: 'new-conversation'; participantId: number }
  | { kind: 'garamlink-request'; requestDesignerId: number; anchorMessageId?: number }
  | { kind: 'garamlink-direct'; directConversationId: number; anchorMessageId?: number };

export type MessengerSearchRoute = {
  pathname: '/chat' | '/group-chat' | '/new-conversation' | '/request-board-messenger';
  params: Record<string, string>;
};

export type MessengerSearchPerson = {
  kind: 'person';
  key: string;
  source: MessengerSearchSource;
  name: string;
  detail: string;
  route: MessengerSearchRouteTarget | null;
};

export type MessengerSearchRoom = {
  kind: 'room';
  key: string;
  source: MessengerSearchSource;
  title: string;
  detail: string;
  route: MessengerSearchRouteTarget;
};

export type MessengerSearchMessage = {
  kind: 'message';
  key: string;
  source: MessengerSearchSource;
  senderName: string;
  text: string;
  createdAt: string | null;
  coverage: 'complete' | 'partial';
  route: MessengerSearchRouteTarget;
};

export type MessengerSearchResult =
  | MessengerSearchPerson
  | MessengerSearchRoom
  | MessengerSearchMessage;

export type MessengerSearchSourceResult = {
  source: MessengerSearchSource;
  status: MessengerSearchSourceStatus;
  items: MessengerSearchResult[];
  error?: string;
};

export type MessengerSearchKindSection = {
  kind: MessengerSearchResult['kind'];
  items: MessengerSearchResult[];
};

export function normalizeMessengerSearchQuery(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Array.from(value.trim()).slice(0, MESSENGER_SEARCH_MAX_LENGTH).join('');
}

export function containsPrivateIdentifierShape(value: string): boolean {
  const query = normalizeMessengerSearchQuery(value);
  if (!query) return false;

  const digitRuns = query.match(/(?<!\d)(?:\d[\s-]?){9,13}(?!\d)/g) ?? [];
  return digitRuns.some((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    return /^01\d{8,9}$/.test(digits) || /^\d{13}$/.test(digits);
  }) || /(?<!\d)\d{6}[\s-]?[1-4]\d{6}(?!\d)/.test(query);
}

export function isSafeRecentSearchQuery(value: string): boolean {
  const query = normalizeMessengerSearchQuery(value);
  return Boolean(query) && !containsPrivateIdentifierShape(query);
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function buildMessengerSearchRoute(
  target: MessengerSearchRouteTarget,
): MessengerSearchRoute | null {
  if (target.kind === 'internal') {
    const targetName = normalizeMessengerSearchQuery(target.targetName ?? '');
    if ('conversationId' in target) {
      if (!isNotificationUuid(target.conversationId)) return null;
      if (target.anchorMessageId !== undefined && !isNotificationUuid(target.anchorMessageId)) return null;
      return {
        pathname: '/chat',
        params: {
          conversationId: target.conversationId.toLowerCase(),
          ...(targetName ? { targetName } : {}),
          ...(target.anchorMessageId && isNotificationUuid(target.anchorMessageId)
            ? { anchorMessageId: target.anchorMessageId.toLowerCase() }
            : {}),
        },
      };
    }
    const targetId = target.targetId === 'admin'
      ? 'admin'
      : /^\d{11}$/.test(target.targetId) ? target.targetId : null;
    if (!targetId || !targetName) return null;
    return { pathname: '/chat', params: { targetId, targetName } };
  }
  if (target.kind === 'group') {
    if (!isNotificationUuid(target.roomId)) return null;
    if (target.anchorMessageId !== undefined && !isNotificationUuid(target.anchorMessageId)) return null;
    return {
      pathname: '/group-chat',
      params: {
        roomId: target.roomId.toLowerCase(),
        ...(target.anchorMessageId && isNotificationUuid(target.anchorMessageId)
          ? { anchorMessageId: target.anchorMessageId.toLowerCase() }
          : {}),
      },
    };
  }
  if (target.kind === 'new-conversation') {
    if (!isPositiveSafeInteger(target.participantId)) return null;
    return {
      pathname: '/new-conversation',
      params: { participantId: String(target.participantId) },
    };
  }
  if (target.kind === 'garamlink-request') {
    if (!isPositiveSafeInteger(target.requestDesignerId)) return null;
    if (target.anchorMessageId !== undefined && !isPositiveSafeInteger(target.anchorMessageId)) return null;
    return {
      pathname: '/request-board-messenger',
      params: {
        requestDesignerId: String(target.requestDesignerId),
        ...(isPositiveSafeInteger(target.anchorMessageId ?? 0)
          ? { anchorMessageId: String(target.anchorMessageId) }
          : {}),
      },
    };
  }
  if (
    !isPositiveSafeInteger(target.directConversationId)
    || (target.anchorMessageId !== undefined && !isPositiveSafeInteger(target.anchorMessageId))
  ) return null;
  return {
    pathname: '/request-board-messenger',
    params: {
      directConversationId: String(target.directConversationId),
      ...(isPositiveSafeInteger(target.anchorMessageId ?? 0)
        ? { anchorMessageId: String(target.anchorMessageId) }
        : {}),
    },
  };
}

export function buildInternalMessengerSearchTarget(input: {
  conversationId?: string | null;
  targetId?: string | null;
  targetName: string;
}): Extract<MessengerSearchRouteTarget, { kind: 'internal' }> | null {
  const targetName = normalizeMessengerSearchQuery(input.targetName);
  if (!targetName) return null;
  if (typeof input.conversationId === 'string' && isNotificationUuid(input.conversationId)) {
    return { kind: 'internal', conversationId: input.conversationId.toLowerCase(), targetName };
  }
  const rawTargetId = String(input.targetId ?? '').trim().toLowerCase();
  const targetId = rawTargetId === 'admin'
    ? 'admin'
    : rawTargetId.replace(/\D/g, '');
  if (targetId !== 'admin' && !/^\d{11}$/.test(targetId)) return null;
  return { kind: 'internal', targetId, targetName };
}

export function messengerSearchResultKey(
  source: MessengerSearchSource,
  kind: MessengerSearchResult['kind'],
  canonicalId: string | number,
): string {
  return `${source}:${kind}:${String(canonicalId).trim().toLowerCase()}`;
}

export function filterMessengerSearchItems(
  items: readonly MessengerSearchResult[],
  rawQuery: string,
): MessengerSearchResult[] {
  const query = normalizeMessengerSearchQuery(rawQuery).toLocaleLowerCase('ko-KR');
  if (!query) return [];
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    const searchable = item.kind === 'person'
      ? `${item.name} ${item.detail}`
      : item.kind === 'room'
        ? `${item.title} ${item.detail}`
        : `${item.senderName} ${item.text}`;
    return searchable.toLocaleLowerCase('ko-KR').includes(query);
  });
}

export function filterMessengerSearchTab(
  items: readonly MessengerSearchResult[],
  tab: MessengerSearchTab,
): MessengerSearchResult[] {
  if (tab === 'all') return [...items];
  const kind = tab === 'people' ? 'person' : tab === 'rooms' ? 'room' : 'message';
  return items.filter((item) => item.kind === kind);
}

export function aggregateMessengerSearchSources(
  sources: readonly MessengerSearchSourceResult[],
): MessengerSearchResult[] {
  const seen = new Set<string>();
  const aggregated: MessengerSearchResult[] = [];
  sources.forEach((source) => {
    source.items.forEach((item) => {
      if (seen.has(item.key)) return;
      seen.add(item.key);
      aggregated.push(item);
    });
  });
  return aggregated;
}

export function groupMessengerSearchResultsByKind(
  sources: readonly MessengerSearchSourceResult[],
  tab: MessengerSearchTab,
): MessengerSearchKindSection[] {
  const kinds: MessengerSearchResult['kind'][] = tab === 'all'
    ? ['person', 'room', 'message']
    : [tab === 'people' ? 'person' : tab === 'rooms' ? 'room' : 'message'];
  const items = aggregateMessengerSearchSources(sources);
  return kinds.map((kind) => ({
    kind,
    items: items.filter((item) => item.kind === kind).sort((a, b) => {
      if (a.kind !== 'message' || b.kind !== 'message') return 0;
      const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0)
        || a.key.localeCompare(b.key);
    }),
  }));
}

export class LatestMessengerSearchSequence {
  private current = 0;

  issue(): number {
    this.current += 1;
    return this.current;
  }

  owns(sequence: number): boolean {
    return sequence === this.current;
  }
}

export async function settleMessengerSearchSources<T extends string>(
  requests: Readonly<Record<T, Promise<unknown>>>,
): Promise<Record<T, { status: 'ready'; value: unknown } | { status: 'error'; error: unknown }>> {
  const entries = await Promise.all(
    Object.entries(requests).map(async ([source, request]) => {
      try {
        return [source, { status: 'ready' as const, value: await request }] as const;
      } catch (error) {
        return [source, { status: 'error' as const, error }] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<
    T,
    { status: 'ready'; value: unknown } | { status: 'error'; error: unknown }
  >;
}
