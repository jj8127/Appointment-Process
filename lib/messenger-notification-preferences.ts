import {
  parseNotificationTarget,
  type NotificationTarget,
} from './notification-target';

type MessengerNotificationTargetKind =
  | 'garamin_direct_chat'
  | 'group_chat'
  | 'request_chat'
  | 'request_direct_chat';

export type MessengerNotificationRoomRef = Readonly<
  Extract<NotificationTarget, { kind: MessengerNotificationTargetKind }>
>;

export type MessengerNotificationPreference = Readonly<{
  room: MessengerNotificationRoomRef;
  muted: boolean;
}>;

export type MessengerNotificationPreferenceChange = MessengerNotificationPreference;

export type MessengerNotificationPreferenceFailure = Readonly<
  | { operation: 'load'; message: string }
  | { operation: 'save'; attemptedMuted: boolean; message: string }
>;

const ROOM_LABELS: Record<MessengerNotificationTargetKind, string> = {
  garamin_direct_chat: '가람In 1:1 대화',
  group_chat: '가람PA 단톡방',
  request_chat: '가람Link 설계요청 대화',
  request_direct_chat: '가람Link 1:1 대화',
};

export const MESSENGER_NOTIFICATION_SAVE_ERROR =
  '알림 설정을 저장하지 못했습니다. 다시 시도해 주세요.';
export const MESSENGER_NOTIFICATION_LOAD_ERROR =
  '알림 설정을 불러오지 못했습니다. 다시 시도해 주세요.';

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
  const expected = [...expectedKeys].sort();
  return (
    actualKeys.length === expected.length
    && actualKeys.every((key, index) => key === expected[index])
  );
}

export function parseMessengerNotificationRoomRef(
  input: unknown,
): MessengerNotificationRoomRef | null {
  const target = parseNotificationTarget(input);
  if (!target) return null;

  switch (target.kind) {
    case 'garamin_direct_chat':
    case 'group_chat':
    case 'request_chat':
    case 'request_direct_chat':
      return target;
    default:
      return null;
  }
}

export function parseMessengerNotificationPreference(
  input: unknown,
): MessengerNotificationPreference | null {
  if (!isPlainRecord(input) || !hasExactKeys(input, ['room', 'muted'])) {
    return null;
  }
  const room = parseMessengerNotificationRoomRef(input.room);
  if (!room || typeof input.muted !== 'boolean') return null;
  return { room, muted: input.muted };
}

export function getMessengerNotificationRoomLabel(
  room: MessengerNotificationRoomRef,
): string {
  return ROOM_LABELS[room.kind];
}

export function buildMessengerNotificationPreferenceChange(
  room: MessengerNotificationRoomRef,
  muted: boolean,
): MessengerNotificationPreferenceChange {
  return { room, muted };
}

export function buildMessengerNotificationPreferenceFailure(
  attemptedMuted: boolean,
  error?: unknown,
): MessengerNotificationPreferenceFailure {
  const candidate =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
  const message = candidate.trim().slice(0, 160) || MESSENGER_NOTIFICATION_SAVE_ERROR;
  return { operation: 'save', attemptedMuted, message };
}

export function buildMessengerNotificationPreferenceLoadFailure(
  error?: unknown,
): MessengerNotificationPreferenceFailure {
  const candidate =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
  return {
    operation: 'load',
    message: candidate.trim().slice(0, 160) || MESSENGER_NOTIFICATION_LOAD_ERROR,
  };
}
