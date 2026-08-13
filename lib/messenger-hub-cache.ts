import type { MessengerHubConversation, MessengerHubPerson } from './messenger-hub-model';
import type { MessengerRoomPreference } from './notification-preferences-api';
import type { RbMessengerRoomPreference } from './request-board-api';

export type MessengerHubSources = {
  internalPeople: MessengerHubPerson[];
  internalConversations: MessengerHubConversation[];
  groupConversations: MessengerHubConversation[];
  requestConversations: MessengerHubConversation[];
  requestDmConversations: MessengerHubConversation[];
  requestPeople: MessengerHubPerson[];
};

export type MessengerHubSnapshot = {
  sources: MessengerHubSources;
  garaminRoomPreferences: MessengerRoomPreference[];
  requestRoomPreferences: RbMessengerRoomPreference[];
  updatedAt: number;
};

const CACHE_VERSION = 2;
const MAX_SCOPES = 8;
const snapshots = new Map<string, MessengerHubSnapshot>();

export function buildMessengerHubCacheScope(input: {
  role?: string | null;
  actorId?: string | null;
  readOnly?: boolean;
  staffType?: string | null;
  isRequestBoardDesigner?: boolean;
}): string | null {
  const role = input.role?.trim().toLowerCase();
  const actorId = input.actorId?.trim();
  if (!role || !actorId) return null;
  return [
    `v${CACHE_VERSION}`,
    role,
    actorId,
    input.readOnly ? 'readonly' : 'write',
    input.staffType?.trim().toLowerCase() || 'staff-none',
    input.isRequestBoardDesigner ? 'designer' : 'standard',
  ].join(':');
}

function cloneSnapshot(snapshot: MessengerHubSnapshot): MessengerHubSnapshot {
  return {
    sources: {
      internalPeople: [...snapshot.sources.internalPeople],
      internalConversations: [...snapshot.sources.internalConversations],
      groupConversations: [...snapshot.sources.groupConversations],
      requestConversations: [...snapshot.sources.requestConversations],
      requestDmConversations: [...snapshot.sources.requestDmConversations],
      requestPeople: [...snapshot.sources.requestPeople],
    },
    garaminRoomPreferences: [...snapshot.garaminRoomPreferences],
    requestRoomPreferences: [...snapshot.requestRoomPreferences],
    updatedAt: snapshot.updatedAt,
  };
}

export function getMessengerHubSnapshot(scope: string | null): MessengerHubSnapshot | null {
  if (!scope) return null;
  const snapshot = snapshots.get(scope);
  if (!snapshot) return null;
  snapshots.delete(scope);
  snapshots.set(scope, snapshot);
  return cloneSnapshot(snapshot);
}

export function setMessengerHubSnapshot(scope: string | null, snapshot: MessengerHubSnapshot): void {
  if (!scope) return;
  snapshots.delete(scope);
  snapshots.set(scope, cloneSnapshot(snapshot));
  while (snapshots.size > MAX_SCOPES) {
    const oldest = snapshots.keys().next().value as string | undefined;
    if (!oldest) break;
    snapshots.delete(oldest);
  }
}

export function clearMessengerHubSnapshot(scope?: string | null): void {
  if (scope) snapshots.delete(scope);
  else snapshots.clear();
}
