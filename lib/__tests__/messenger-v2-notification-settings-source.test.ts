import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '..', '..');
const readSource = (...segments: string[]) => fs.readFileSync(
  path.join(repositoryRoot, ...segments),
  'utf8',
);

describe('Messenger V2 notification settings UI contract', () => {
  test('registers settings and muted-room screens in both authenticated stacks', () => {
    const layout = readSource('app', '_layout.tsx');
    expect(layout.match(/name="notification-settings"/g)).toHaveLength(2);
    expect(layout.match(/name="muted-conversations"/g)).toHaveLength(2);
    expect(readSource('app', 'settings.tsx')).toContain("router.push('/notification-settings' as never)");
  });

  test('keeps child preferences while the master is off and asks before disabling', () => {
    const source = readSource('app', 'notification-settings.tsx');
    expect(source).toContain('messages: {');
    expect(source).toContain('request_activity: {');
    expect(source).toContain('notices: {');
    expect(source).toContain('operations: {');
    expect(source).toContain('setConfirmGlobalOff(true)');
    expect(source).toContain('전체 알림을 끌까요?');
    expect(source).toContain('이 계정으로 로그인한 모든 기기에서 가람in 알림을 받지 않습니다.');
    expect(source).toContain('!preferences.globalPushEnabled || pendingKey !== null');
    expect(source).toContain('알림을 꺼도 앱 안의 메시지와 읽지 않은 개수는 유지됩니다.');
  });

  test('requests OS permission only from the explicit master-on action', () => {
    const source = readSource('app', 'notification-settings.tsx');
    const registrationCalls = source.match(/registerPushToken\(/g) ?? [];
    expect(registrationCalls).toHaveLength(1);
    expect(source).toContain('{ requestPermission: true }');
    expect(source).toContain('openPushNotificationSettings');
    expect(source).toContain("state === 'active'");
  });

  test('aggregates both products and supports optimistic unmute rollback', () => {
    const source = readSource('app', 'muted-conversations.tsx');
    expect(source).toContain('getMutedMessengerRooms()');
    expect(source).toContain('rbGetMessengerRoomPreferences()');
    expect(source).toContain('setRoomMuted(item.room as MessengerRoomRef, false)');
    expect(source).toContain('rbSetMessengerRoomMuted(');
    expect(source).toContain('setItems((current) => current.filter');
    expect(source).toContain('setItems((current) => [...current, item])');
    expect(source).not.toContain('<Text>{item.key}</Text>');
  });

  test('shows the success empty state only after every requested source loaded', () => {
    const source = readSource('app', 'muted-conversations.tsx');
    expect(source).toContain('items.length === 0 && errors.length === 0');
    expect(source).toContain("nextErrors.push('가람in')");
    expect(source).toContain("nextErrors.push('가람Link')");
  });

  test('resolves muted direct-room titles from the role-scoped internal source with a safe fallback', () => {
    const source = readSource('app', 'muted-conversations.tsx');
    expect(source).toContain("capabilities.internalPeopleSource === 'fc-targets'");
    expect(source).toContain('fetchFcChatTargets(residentId)');
    expect(source).toContain("capabilities.internalPeopleSource === 'internal-list'");
    expect(source).toContain('fetchInternalChatList(viewerContext)');
    expect(source).toContain('addDirectRoomTitle(titles, target.conversation_id, target.name)');
    expect(source).toContain('directTitle || unresolvedDirectTitle');
    expect(source).toContain("nextErrors.push('가람in 대화 이름')");
    expect(source).toContain('상대방 이름을 불러오지 못함');
    expect(source).not.toContain('loadDirectRoomTitles().catch(() => new Map<string, string>())');
  });

  test('connects the common room sheet to all four supported room types', () => {
    const direct = readSource('app', 'chat.tsx');
    const group = readSource('app', 'group-chat.tsx');
    const garamlink = readSource('app', 'request-board-messenger.tsx');

    expect(direct).toContain('<ConversationSettingsSheet');
    expect(direct).toContain("buildMessengerRoomRef('direct-thread'");
    expect(direct).toContain('setRoomMuted(roomRef, nextMuted)');
    expect(group).toContain('<ConversationSettingsSheet');
    expect(group).toContain("buildMessengerRoomRef('group'");
    expect(group).toContain('groupChatSetMuted(nextMuted)');
    expect(garamlink).toContain('<ConversationSettingsSheet');
    expect(garamlink).toContain("type: 'request' as const");
    expect(garamlink).toContain("type: 'direct' as const");
    expect(garamlink).toContain('rbSetMessengerRoomMuted(requestBoardRoomRef, nextMuted)');
  });

  test('uses the established group-chat preference endpoint from the hub bell', () => {
    const hub = readSource('app', 'messenger.tsx');
    const rows = readSource('components', 'messenger', 'MessengerHubRows.tsx');
    expect(hub).toContain('groupChatSetMuted(nextMuted)');
    expect(hub).toContain("if (conversation.route.kind === 'group')");
    expect(hub).toContain("conversation.route.kind === 'internal'");
    expect(hub).toContain('resolveGaraminDirectConversation');
    expect(rows).toContain('item.muted ? \'bell-off\' : \'bell\'');
    expect(rows).toContain('<ActivityIndicator color={ACCENT} size={10} />');
    expect(rows).toContain('event.stopPropagation();');
  });

  test('loads canonical direct and group room preferences before enabling their toggles', () => {
    const direct = readSource('app', 'chat.tsx');
    const group = readSource('app', 'group-chat.tsx');

    for (const source of [direct, group]) {
      expect(source).toContain('const [roomPreferenceLoading, setRoomPreferenceLoading] = useState(false)');
      expect(source).toContain('const [roomPreferenceReady, setRoomPreferenceReady] = useState(false)');
      expect(source).toContain('const roomPreferenceSequenceRef = useRef(0)');
      expect(source).toContain('const sequence = ++roomPreferenceSequenceRef.current');
      expect(source).toContain('if (sequence !== roomPreferenceSequenceRef.current) return;');
      expect(source).toContain('setRoomPreferenceReady(false)');
      expect(source).toContain('setRoomPreferenceLoadedKey(null)');
      expect(source).toContain('setRoomPreferenceReady(true)');
      expect(source).toContain("? '이 대화의 알림 설정을 불러오는 중입니다.'");
      expect(source).toContain("? '알림 설정을 다시 불러와 주세요.'");
    }

    expect(direct).toContain('disabled={roomPreferenceLoading || !directRoomPreferenceReady}');
    expect(direct).toContain('|| !directRoomPreferenceReady');
    expect(group).toContain('disabled={roomPreferenceLoading || !groupRoomPreferenceReady}');
    expect(group).toContain('|| !groupRoomPreferenceReady');
  });

  test('invalidates stale room preference loads and saves when the room changes', () => {
    const direct = readSource('app', 'chat.tsx');
    const group = readSource('app', 'group-chat.tsx');

    expect(direct).toContain('roomPreferenceLoadedKey === directRoomRef.key');
    expect(group).toContain('roomPreferenceLoadedKey === groupRoomRef.key');
    for (const source of [direct, group]) {
      expect(source).toContain('roomPreferenceSequenceRef.current += 1');
      expect(source).toContain('if (sequence === roomPreferenceSequenceRef.current)');
      expect(source).toContain('setRoomPreferencePending(false)');
    }
  });

  test('keeps room mute independently editable when native push is off', () => {
    const direct = readSource('app', 'chat.tsx');
    const group = readSource('app', 'group-chat.tsx');
    const garamlink = readSource('app', 'request-board-messenger.tsx');

    expect(direct).not.toContain('disabled={!globalPushEnabled}');
    expect(group).not.toContain('disabled={!globalPushEnabled}');
    expect(garamlink).not.toContain('|| !globalPushEnabled');
    expect(garamlink).not.toContain('getNotificationPreferences()');
    expect(garamlink).toContain('disabled={roomPreferenceLoading || !roomPreferenceReady}');
  });
});
