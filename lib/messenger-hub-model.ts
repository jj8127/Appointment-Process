import type { GroupChatBootstrapResponse } from './group-chat-api';
import type {
  ChatTargetWithUnread,
  InternalChatListItem,
} from './internal-chat-api';
import { formatManagerMessengerDetail, sanitizePhone } from './messenger-participants';
import { isNotificationUuid } from './notification-target';
import type { MessengerRoomPreference } from './notification-preferences-api';
import type {
  RbConversation,
  RbDirectMessageUser,
  RbDmConversation,
  RbMessengerRoomPreference,
} from './request-board-api';

export type MessengerHubRoute =
  | { kind: 'internal'; conversationId?: string; targetId?: string; targetName: string }
  | { kind: 'group' }
  | { kind: 'request'; requestDesignerId: number }
  | { kind: 'request-dm'; directConversationId: number }
  | { kind: 'request-directory'; participantId: number; targetName: string };

export type MessengerPersonRole =
  | 'operations'
  | 'manager'
  | 'designer'
  | 'developer'
  | 'fc'
  | 'other';

export type MessengerPersonRoleFilter = 'all' | Exclude<MessengerPersonRole, 'fc' | 'other'>;

export const MESSENGER_PERSON_ROLE_ORDER: readonly MessengerPersonRole[] = [
  'operations',
  'manager',
  'designer',
  'developer',
  'fc',
  'other',
];

export const MESSENGER_PERSON_ROLE_LABELS: Record<MessengerPersonRole, string> = {
  operations: '총무',
  manager: '본부장',
  designer: '설계 매니저',
  developer: '개발자',
  fc: 'FC',
  other: '기타',
};

export type MessengerHubPerson = {
  key: string;
  identityKey?: string;
  name: string;
  detail: string;
  role: MessengerPersonRole;
  sourceLabel: '가람in' | '가람Link';
  route: MessengerHubRoute;
};

export type MessengerHubConversation = MessengerHubPerson & {
  preview: string;
  timestamp: string | null;
  timestampMs: number;
  unreadCount: number;
  muted?: boolean;
  pinnedAt?: string | null;
  leftAt?: string | null;
  garaminRoomKey?: string;
  requestConversationIds?: readonly number[];
};

export const MESSENGER_TAB_BADGE_UNDERLINE_GAP = 8;
export const MESSENGER_TAB_TOUCH_TARGET = 44;

export function parseMessengerHubTab(
  value: string | string[] | undefined,
): 'people' | 'chats' {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim().toLowerCase() === 'people' ? 'people' : 'chats';
}

const SOURCE_ORDER: Record<MessengerHubPerson['sourceLabel'], number> = {
  '가람in': 0,
  '가람Link': 1,
};

export function parseMessengerTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortMessengerConversations(
  rows: readonly MessengerHubConversation[],
): MessengerHubConversation[] {
  return [...rows].sort((a, b) =>
    Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt))
    || parseMessengerTimestamp(b.pinnedAt) - parseMessengerTimestamp(a.pinnedAt)
    || b.timestampMs - a.timestampMs
    || SOURCE_ORDER[a.sourceLabel] - SOURCE_ORDER[b.sourceLabel]
    || a.key.localeCompare(b.key, 'ko-KR'),
  );
}

export function sortMessengerPeople(
  rows: readonly MessengerHubPerson[],
): MessengerHubPerson[] {
  return [...rows].sort((a, b) =>
    SOURCE_ORDER[a.sourceLabel] - SOURCE_ORDER[b.sourceLabel]
    || a.name.localeCompare(b.name, 'ko-KR')
    || a.key.localeCompare(b.key, 'ko-KR'),
  );
}

export function groupMessengerPeopleByRole(
  rows: readonly MessengerHubPerson[],
  filter: MessengerPersonRoleFilter = 'all',
): { role: MessengerPersonRole; title: string; data: MessengerHubPerson[] }[] {
  const rowsByRole = new Map<MessengerPersonRole, MessengerHubPerson[]>();
  rows.forEach((row) => {
    const items = rowsByRole.get(row.role) ?? [];
    items.push(row);
    rowsByRole.set(row.role, items);
  });

  return MESSENGER_PERSON_ROLE_ORDER
    .filter((role) => filter === 'all' || role === filter)
    .map((role) => ({
      role,
      title: MESSENGER_PERSON_ROLE_LABELS[role],
      data: sortMessengerPeople(rowsByRole.get(role) ?? []),
    }))
    .filter((section) => section.data.length > 0);
}

export function getMessengerTotalUnread(
  rows: readonly MessengerHubConversation[],
): number {
  return rows.reduce((sum, row) => sum + Math.max(0, row.unreadCount), 0);
}

const safeUnread = (value: number) =>
  Number.isSafeInteger(value) && value > 0 ? value : 0;

const BRAND_SUFFIX = /\s*(?:·\s*)?(?:가람in|가람link)\s*$/i;
const DESIGNER_TITLE_SUFFIX = /\s*설계\s*매니저\s*$/;

export function formatMessengerPersonDetail({
  affiliation,
  role,
  fallback,
}: {
  affiliation?: string | null;
  role?: string | null;
  fallback: string;
}): string {
  const raw = affiliation?.trim() ?? '';
  const normalized = raw.replace(BRAND_SUFFIX, '').trim();
  const isDesigner = role?.trim().toLowerCase() === 'designer'
    || /가람link\s*$/i.test(raw);

  if (isDesigner) {
    const company = normalized.replace(DESIGNER_TITLE_SUFFIX, '').trim();
    return company ? `${company} 설계 매니저` : '설계 매니저';
  }

  return normalized || fallback;
}

const targetDetail = (kind: 'manager' | 'developer' | 'admin') => {
  if (kind === 'manager') return '본부장';
  if (kind === 'developer') return '개발자';
  return '총무';
};

export function formatOperationsMessengerName(value?: string | null): string {
  const realName = String(value ?? '').trim().replace(/\s*총무\s*$/, '').trim();
  return realName ? `${realName}총무` : '총무';
}

const isDesignerRole = (role?: string | null, affiliation?: string | null) =>
  role?.trim().toLowerCase() === 'designer'
  || /가람Link\s*$/i.test(affiliation?.trim() ?? '');

export function classifyMessengerPersonRole({
  role,
  affiliation,
}: {
  role?: string | null;
  affiliation?: string | null;
}): MessengerPersonRole {
  if (isDesignerRole(role, affiliation)) return 'designer';
  const normalized = String(affiliation ?? '')
    .replace(BRAND_SUFFIX, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (normalized.includes('총무') || normalized.includes('가람in운영')) return 'operations';
  if (normalized.includes('본부장')) return 'manager';
  if (normalized.includes('개발자')) return 'developer';
  return 'fc';
}

export function buildFcTargetRows(input: {
  managers: ChatTargetWithUnread[];
  developers: ChatTargetWithUnread[];
  admins: ChatTargetWithUnread[];
  adminUnreadCount: number;
}): { people: MessengerHubPerson[]; conversations: MessengerHubConversation[] } {
  const people: MessengerHubPerson[] = [];
  const conversations: MessengerHubConversation[] = [];

  const appendTarget = (
    target: ChatTargetWithUnread,
    kind: 'manager' | 'developer' | 'operations',
  ) => {
    const phone = sanitizePhone(target.phone);
    if (!phone) return;
    const name = kind === 'operations'
      ? formatOperationsMessengerName(target.name)
      : kind === 'developer'
        ? '개발자'
        : String(target.name ?? '').trim() || targetDetail(kind);
    const detail = kind === 'operations'
      ? '총무'
      : kind === 'manager'
        ? formatManagerMessengerDetail(target.affiliation)
        : targetDetail(kind);
    const base: MessengerHubPerson = {
      key: `internal-target:${phone}`,
      name,
      detail,
      role: kind,
      sourceLabel: '가람in',
      route: isNotificationUuid(target.conversation_id)
        ? { kind: 'internal', conversationId: target.conversation_id, targetName: name }
        : { kind: 'internal', targetId: phone, targetName: name },
    };
    people.push(base);
    if (target.last_message || target.last_time || target.unread_count > 0) {
      conversations.push({
        ...base,
        ...(isNotificationUuid(target.conversation_id)
          ? { garaminRoomKey: `garamin:direct-thread:${target.conversation_id}` }
          : {}),
        preview: target.last_message?.trim() || '새 대화를 시작해 보세요.',
        timestamp: target.last_time ?? null,
        timestampMs: parseMessengerTimestamp(target.last_time),
        unreadCount: safeUnread(target.unread_count),
      });
    }
  };

  input.managers.forEach((target) => appendTarget(target, 'manager'));
  input.developers.forEach((target) => appendTarget(target, 'developer'));
  input.admins.forEach((target) => appendTarget(target, 'operations'));

  return { people: dedupePeople(people), conversations: sortMessengerConversations(conversations) };
}

export function buildInternalListRows(items: readonly InternalChatListItem[]) {
  const people = items.map<MessengerHubPerson>((item) => {
    const targetId = sanitizePhone(item.target_id ?? item.phone);
    return {
      key: item.conversation_id
        ? `internal-conversation:${item.conversation_id}`
        : `internal-target:${targetId}`,
      name: item.name,
      detail: formatMessengerPersonDetail({
        affiliation: item.affiliation,
        fallback: 'FC',
      }),
      role: classifyMessengerPersonRole({ affiliation: item.affiliation }),
      sourceLabel: '가람in',
      route: item.conversation_id
        ? {
            kind: 'internal',
            conversationId: item.conversation_id,
            targetName: item.name,
          }
        : {
            kind: 'internal',
            targetId,
            targetName: item.name,
          },
    };
  });
  const conversations = items.flatMap<MessengerHubConversation>((item, index) => {
    if (!item.last_message?.trim() && !item.last_time && safeUnread(item.unread_count) === 0) {
      return [];
    }
    return [{
      ...people[index],
      ...(isNotificationUuid(item.conversation_id)
        ? { garaminRoomKey: `garamin:direct-thread:${item.conversation_id}` }
        : {}),
      preview: item.last_message?.trim() || '대화를 시작해 보세요.',
      timestamp: item.last_time,
      timestampMs: parseMessengerTimestamp(item.last_time),
      unreadCount: safeUnread(item.unread_count),
    }];
  });
  return { people: sortMessengerPeople(people), conversations: sortMessengerConversations(conversations) };
}

export function buildGroupConversation(
  summary: GroupChatBootstrapResponse,
): MessengerHubConversation {
  const last = summary.last_message;
  const sender = last?.sender_name?.trim() || '참여자';
  const preview = !last
    ? 'FC와 운영진이 함께 이야기하는 공간입니다.'
    : last.message_type === 'image'
      ? `${sender}: 사진`
      : last.message_type === 'file'
        ? `${sender}: ${last.file_name?.trim() || '파일'}`
        : `${sender}: ${last.content}`;
  return {
    key: `internal-group:${summary.room.id}`,
    name: summary.room.title?.trim() || '가람in 단체방',
    detail: `${summary.member_count.toLocaleString('ko-KR')}명 참여`,
    role: 'other',
    sourceLabel: '가람in',
    route: { kind: 'group' },
    garaminRoomKey: `garamin:group:${summary.room.id}`,
    muted: summary.muted === true,
    preview,
    timestamp: last?.created_at ?? null,
    timestampMs: parseMessengerTimestamp(last?.created_at),
    unreadCount: safeUnread(summary.unread_count),
  };
}

export function buildRequestConversationRows(
  items: readonly RbConversation[],
): MessengerHubConversation[] {
  return items.filter((item) => item.lastMessage !== null).map((item) => {
    const participant = item.participantRole === 'designer'
      ? item.designer?.users
      : item.fc;
    const name = participant?.name?.trim() || item.request?.customer_name?.trim() || '설계요청 대화';
    return {
      key: `request:${item.primaryConversationId}`,
      ...(item.participantUserId
        ? { identityKey: `request-user:${item.participantUserId}` }
        : {}),
      name,
      detail: item.request?.customer_name?.trim() || '설계요청',
      role: item.participantRole === 'designer' ? 'designer' : 'fc',
      sourceLabel: '가람Link',
      route: { kind: 'request', requestDesignerId: item.primaryConversationId },
      requestConversationIds: item.conversationIds,
      preview: item.lastMessage?.message?.trim() || '아직 메시지가 없습니다.',
      timestamp: item.lastMessage?.created_at ?? null,
      timestampMs: parseMessengerTimestamp(item.lastMessage?.created_at),
      unreadCount: safeUnread(item.unreadCount),
    };
  });
}

export function buildRequestDmRows(
  items: readonly RbDmConversation[],
): MessengerHubConversation[] {
  return items.filter((item) => item.lastMessage !== null).map((item) => ({
    key: `request-dm:${item.id}`,
    ...(item.participant?.id
      ? { identityKey: `request-user:${item.participant.id}` }
      : {}),
    name: item.participant?.name?.trim() || '가람Link 사용자',
    detail: formatMessengerPersonDetail({
      affiliation: item.participant?.company_name?.trim()
        || item.participant?.affiliation?.trim(),
      role: item.participant?.role,
      fallback: item.participant?.role === 'designer' ? '설계 매니저' : 'FC',
    }),
    role: classifyMessengerPersonRole({
      role: item.participant?.role,
      affiliation: item.participant?.company_name ?? item.participant?.affiliation,
    }),
    sourceLabel: '가람Link',
    route: { kind: 'request-dm', directConversationId: item.id },
    requestConversationIds: [item.id],
    preview: item.lastMessage?.message?.trim() || '아직 메시지가 없습니다.',
    timestamp: item.lastMessage?.created_at ?? item.updated_at ?? null,
    timestampMs: parseMessengerTimestamp(item.lastMessage?.created_at ?? item.updated_at),
    unreadCount: safeUnread(item.unreadCount),
  }));
}

export function buildRequestDirectoryPeople(
  users: readonly RbDirectMessageUser[],
): MessengerHubPerson[] {
  return users.filter((user) => Number.isSafeInteger(user.id) && user.id > 0).map((user) => ({
    key: `request-user:${user.id}`,
    identityKey: `request-user:${user.id}`,
    name: user.name?.trim() || '가람Link 사용자',
    detail: formatMessengerPersonDetail({
      affiliation: user.company_name?.trim() || user.affiliation?.trim(),
      role: user.role,
      fallback: user.role === 'designer' ? '설계 매니저' : 'FC',
    }),
    role: classifyMessengerPersonRole({
      role: user.role,
      affiliation: user.company_name ?? user.affiliation,
    }),
    sourceLabel: '가람Link',
    route: {
      kind: 'request-directory',
      participantId: user.id,
      targetName: user.name?.trim() || '가람Link 사용자',
    },
  }));
}

export function applyMessengerRoomPreferences(
  rows: readonly MessengerHubConversation[],
  garaminPreferences: readonly MessengerRoomPreference[],
  requestPreferences: readonly RbMessengerRoomPreference[],
): MessengerHubConversation[] {
  return rows.map((row) => {
    const garaminPreference = row.garaminRoomKey
      ? garaminPreferences.find((preference) => preference.roomKey === row.garaminRoomKey)
      : undefined;
    const requestPreference = row.requestConversationIds?.flatMap((conversationId) =>
      requestPreferences.filter((preference) => {
        if (row.route.kind === 'request' && preference.room.type === 'request') {
          return preference.room.requestDesignerId === conversationId;
        }
        if (row.route.kind === 'request-dm' && preference.room.type === 'direct') {
          return preference.room.conversationId === conversationId;
        }
        return false;
      }))[0];
    return {
      ...row,
      muted: garaminPreference
        ? garaminPreference.muted
        : requestPreference
          ? requestPreference.muted
          : row.muted === true,
      pinnedAt: garaminPreference?.pinnedAt ?? requestPreference?.pinnedAt ?? null,
      leftAt: garaminPreference?.leftAt ?? requestPreference?.leftAt ?? null,
    };
  });
}

export function isMessengerConversationVisible(row: MessengerHubConversation): boolean {
  const leftAtMs = parseMessengerTimestamp(row.leftAt);
  return leftAtMs === 0 || row.timestampMs > leftAtMs;
}

export function peopleFromConversations(
  rows: readonly MessengerHubConversation[],
): MessengerHubPerson[] {
  return rows.map(({
    preview: _preview,
    timestamp: _timestamp,
    timestampMs: _timestampMs,
    unreadCount: _unreadCount,
    muted: _muted,
    pinnedAt: _pinnedAt,
    leftAt: _leftAt,
    garaminRoomKey: _garaminRoomKey,
    requestConversationIds: _requestConversationIds,
    ...person
  }) => person);
}

export function dedupePeople(rows: readonly MessengerHubPerson[]): MessengerHubPerson[] {
  const byIdentity = new Map<string, MessengerHubPerson>();
  const routePriority = (route: MessengerHubRoute): number => {
    if (route.kind === 'request-dm') return 3;
    if (route.kind === 'request') return 2;
    if (route.kind === 'request-directory') return 1;
    return 3;
  };
  rows.forEach((row) => {
    const identity = row.identityKey ?? row.key;
    const current = byIdentity.get(identity);
    if (!current || routePriority(row.route) > routePriority(current.route)) {
      byIdentity.set(identity, row);
    }
  });
  return sortMessengerPeople(Array.from(byIdentity.values()));
}
