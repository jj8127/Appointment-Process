import {
  buildMessengerHubCacheScope,
  clearMessengerHubSnapshot,
  getMessengerHubSnapshot,
  setMessengerHubSnapshot,
  type MessengerHubSnapshot,
} from '../messenger-hub-cache';

const EMPTY_SNAPSHOT: MessengerHubSnapshot = {
  sources: {
    internalPeople: [],
    internalConversations: [],
    groupConversations: [],
    requestConversations: [],
    requestDmConversations: [],
    requestPeople: [],
  },
  garaminRoomPreferences: [],
  requestRoomPreferences: [],
  updatedAt: 1,
};

describe('messenger hub process-memory cache', () => {
  afterEach(() => clearMessengerHubSnapshot());

  test('isolates snapshots by actor and permission scope', () => {
    const first = buildMessengerHubCacheScope({ role: 'admin', actorId: 'actor-a' });
    const second = buildMessengerHubCacheScope({ role: 'admin', actorId: 'actor-b' });
    const readOnly = buildMessengerHubCacheScope({ role: 'admin', actorId: 'actor-a', readOnly: true });

    expect(first).not.toBe(second);
    expect(first).not.toBe(readOnly);
    setMessengerHubSnapshot(first, EMPTY_SNAPSHOT);
    expect(getMessengerHubSnapshot(second)).toBeNull();
    expect(getMessengerHubSnapshot(readOnly)).toBeNull();
  });

  test('returns defensive copies and never writes to persistent storage', () => {
    const scope = buildMessengerHubCacheScope({ role: 'fc', actorId: 'actor-a' });
    setMessengerHubSnapshot(scope, EMPTY_SNAPSHOT);
    const cached = getMessengerHubSnapshot(scope);
    expect(cached).not.toBeNull();
    cached!.garaminRoomPreferences.push({
      roomKey: 'garamin:group:00000000-0000-4000-8000-000000000001',
      muted: true,
      updatedAt: new Date(0).toISOString(),
    });
    expect(getMessengerHubSnapshot(scope)?.garaminRoomPreferences).toEqual([]);
  });

  test('refuses anonymous scopes', () => {
    expect(buildMessengerHubCacheScope({ role: 'fc' })).toBeNull();
    expect(buildMessengerHubCacheScope({ actorId: 'actor-a' })).toBeNull();
  });
});
