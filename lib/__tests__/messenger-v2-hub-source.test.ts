import fs from 'node:fs';
import path from 'node:path';

import {
  MESSENGER_TAB_BADGE_UNDERLINE_GAP,
  MESSENGER_TAB_TOUCH_TARGET,
  parseMessengerHubTab,
} from '../messenger-hub-model';

const repositoryRoot = path.resolve(__dirname, '..', '..');

describe('Messenger V2 hub UI contract', () => {
  test('defaults invalid or absent tab params to chats', () => {
    expect(parseMessengerHubTab(undefined)).toBe('chats');
    expect(parseMessengerHubTab('unexpected')).toBe('chats');
    expect(parseMessengerHubTab('people')).toBe('people');
  });

  test('fixes the badge-to-underline gap at exactly 8px and touch targets at 44px', () => {
    expect(MESSENGER_TAB_BADGE_UNDERLINE_GAP).toBe(8);
    expect(MESSENGER_TAB_TOUCH_TARGET).toBeGreaterThanOrEqual(44);

    const source = fs.readFileSync(
      path.join(repositoryRoot, 'components', 'messenger', 'MessengerTabBar.tsx'),
      'utf8',
    );
    const hubRowsSource = fs.readFileSync(
      path.join(repositoryRoot, 'components', 'messenger', 'MessengerHubRows.tsx'),
      'utf8',
    );
    expect(source).toContain('tabTopSpace: { height: 8 }');
    expect(source).toMatch(/tabContent:\s*\{\s*height: 20,/);
    expect(source).toContain('badgeSlot: { height: 20,');
    expect(source).toContain('badgeUnderlineGap: { height: MESSENGER_TAB_BADGE_UNDERLINE_GAP }');
    expect(8 + 20 + 20 + MESSENGER_TAB_BADGE_UNDERLINE_GAP + 2)
      .toBeGreaterThanOrEqual(MESSENGER_TAB_TOUCH_TARGET);
    const labelIndex = source.indexOf('<View style={styles.tabContent}>');
    const badgeIndex = source.indexOf('<View style={styles.badgeSlot}>');
    const gapIndex = source.indexOf('<View style={styles.badgeUnderlineGap} />');
    const underlineIndex = source.indexOf('<View style={[styles.underline, selected && styles.underlineActive]} />');
    expect(labelIndex).toBeGreaterThan(-1);
    expect(labelIndex).toBeLessThan(badgeIndex);
    expect(badgeIndex).toBeLessThan(gapIndex);
    expect(gapIndex).toBeLessThan(underlineIndex);
    expect(source).toContain("fontVariant: ['tabular-nums']");
    expect(source).toContain('badge > 0 ?');
    expect(source).toContain('onPressIn={() => onChange(tab)}');
    expect(source).not.toContain('onPress={() => onChange(tab)}');
    expect(hubRowsSource).toContain('onBack: () => void;');
    expect(hubRowsSource).toContain('width: 44, height: 44');
    expect(hubRowsSource).toContain('name="arrow-left"');
  });

  test('routes search and gates GaramLink calls behind capabilities', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'app', 'messenger.tsx'), 'utf8');
    const hubRowsSource = fs.readFileSync(
      path.join(repositoryRoot, 'components', 'messenger', 'MessengerHubRows.tsx'),
      'utf8',
    );
    expect(source).toContain("router.push('/messenger-search' as never)");
    expect(source).toContain("const handleBack = useCallback(() => goBackOrReplace(router, '/'), [router]);");
    expect(source).toContain('onBack={handleBack}');
    expect(source).toContain('if (capabilities.canReadRequestBoard)');
    expect(source).toContain('if (capabilities.canLoadRequestBoardDirectory)');
    expect(source).toContain('rbGetDirectMessageUsersOrThrow()');
    expect(source).toContain('rbCreateDmConversation(route.participantId)');
    expect(source).toContain('capabilities.canCreateRequestBoardDm');
    expect(source).toContain("!source.endsWith('알림 설정')");
    expect(source).toContain('visibleFailedSources');
    expect(hubRowsSource).toContain('{item.detail}</Text>');
    expect(hubRowsSource).not.toContain('{item.detail} · {item.sourceLabel}');
    expect(hubRowsSource).toContain("name={item.muted ? 'bell-off' : 'bell'}");
    expect(source).toContain('toggleConversationMuted');
    expect(source).toContain('rbSetMessengerRoomMuted');
  });

  test('keeps the request-board messenger shortcut on the v2 hub', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'app', 'request-board.tsx'), 'utf8');

    expect(source).toContain("router.push('/messenger' as any)");
    expect(source).not.toContain("router.push('/request-board-messenger' as any)");
  });

  test('opens exactly four room actions on long press with lightweight read handling', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'app', 'messenger.tsx'), 'utf8');
    const rows = fs.readFileSync(
      path.join(repositoryRoot, 'components', 'messenger', 'MessengerHubRows.tsx'),
      'utf8',
    );
    const sheet = fs.readFileSync(
      path.join(repositoryRoot, 'components', 'messenger', 'MessengerConversationActionsSheet.tsx'),
      'utf8',
    );
    expect(rows).toContain('delayLongPress={380}');
    expect(rows).toContain('onLongPress(item)');
    expect(source).toContain('onLongPress={handleConversationLongPress}');
    expect(source).toContain("import * as Haptics from 'expo-haptics'");
    expect(source).toContain('Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)');
    expect(source).toContain("'채팅방 알림을 껐습니다.'");
    expect(source).toContain("'채팅방을 상단에 고정했습니다.'");
    expect(source).toContain("showConversationActionSuccess('채팅방에서 나갔습니다.')");
    expect(source).toContain('styles.actionToast');
    expect(source).toContain("backgroundColor: 'rgba(17, 24, 39, 0.86)'");
    expect((sheet.match(/<ActionRow/g) ?? [])).toHaveLength(4);
    expect(sheet).toContain("action=\"pin\"");
    expect(sheet).toContain("action=\"mute\"");
    expect(sheet).toContain("action=\"read\"");
    expect(sheet).toContain("action=\"leave\"");
    expect(source).toContain('rbMarkMessagesRead(');
    expect(source).toContain('rbMarkDmMessagesRead(');
    expect(source).toContain('markGaraminDirectMessagesRead(');
    expect(source).toContain('groupChatMarkRead()');
    expect(source).toContain('새 메시지가 오면 다시 표시됩니다.');
  });

  test('keeps the hub shell interactive while all sources revalidate', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'app', 'messenger.tsx'), 'utf8');
    const hubRowsSource = fs.readFileSync(
      path.join(repositoryRoot, 'components', 'messenger', 'MessengerHubRows.tsx'),
      'utf8',
    );
    const internalLoad = source.indexOf('const internalFailure = await loadInternal();');
    const deferredSources = source.indexOf('const deferredLoads = Promise.all([loadExternal(), loadNotificationPreferences()]);', internalLoad);

    expect(internalLoad).toBeGreaterThan(-1);
    expect(deferredSources).toBeLessThan(internalLoad);
    expect(source).toContain('getMessengerHubSnapshot(cacheScope)');
    expect(source).toContain('actorId: residentId');
    expect(source).toContain('setSelectedPerson(null);');
    expect(source).toContain('setRequestCreateRetry(null);');
    expect(source).toContain('<MessengerHubSourceLoading labels={peopleLoadingLabels} />');
    expect(source).toContain('<MessengerHubSourceLoading labels={conversationLoadingLabels} />');
    expect(source).toContain("markSourceSettled('internal')");
    expect(source).toContain("markSourceSettled('request-people')");
    expect(source).toContain("markSourceSettled('request-conversations')");
    expect(source).toContain("markSourceSettled('request-dms')");
    expect(source).toContain('const conversationLoadingLabels = useMemo(() => {');
    expect(hubRowsSource).toContain('accessibilityRole="progressbar"');
    expect(hubRowsSource).toContain('<BrandedLoadingSpinner size="sm" />');
    expect(source).not.toContain('{loading ? (\n        <MessengerLoadingState');
    expect(source).not.toContain('void loadAll();\n  }, [hydrated, loadAll, role, router]);');
  });

  test('coalesces hub refreshes and never timer-polls while the screen is interactive', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'app', 'messenger.tsx'), 'utf8');
    expect(source).toContain('const loadAllPromiseRef = useRef<Promise<void> | null>(null);');
    expect(source).toContain('if (loadAllPromiseRef.current) return loadAllPromiseRef.current;');
    expect(source).toContain('const HUB_REFRESH_COOLDOWN_MS = 120_000;');
    expect(source).toContain("router.prefetch('/chat')");
    expect(source).toContain("router.prefetch('/group-chat')");
    expect(source).toContain("router.prefetch('/request-board-messenger')");
    expect(source).toContain('if (previousUnread > 0) updateConversationUnreadCount(item.key, 0);');
    expect(source).toContain("|| conversation.route.kind === 'internal'");
    expect(source).toContain('resolveGaraminConversationRoom');
    expect(source).toContain('setMutingTargetMuted(nextMuted)');
    expect(source).toContain("if (nextState === 'active') refreshIfStale();");
    expect(source).not.toContain('setInterval(');
    expect(source).toContain('startTransition(() => {');
  });

  test('uses expandable text-labelled role sections with an on-demand filter', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'app', 'messenger.tsx'), 'utf8');
    const hubRowsSource = fs.readFileSync(
      path.join(repositoryRoot, 'components', 'messenger', 'MessengerHubRows.tsx'),
      'utf8',
    );
    expect(source).toContain('<SectionList');
    expect(source).toContain('<MessengerRoleSectionHeader');
    expect(source).toContain('<MessengerRoleFilterPanel');
    expect(source).toContain('groupMessengerPeopleByRole(people, roleFilter)');
    expect(hubRowsSource).toContain("accessibilityLabel={filterActive ? '역할 필터, 적용됨' : '역할 필터'}");
    expect(source).toContain("filterActive={roleFilter !== 'all'}");
    expect(source).toContain('filterExpanded={roleFilterVisible}');
    expect(source).toContain("setRoleFilter('all');");
    expect(source).toContain('onRetry={handleHubRetry}');
    expect(hubRowsSource).toContain('accessibilityState={{ expanded: filterExpanded }}');
    expect(hubRowsSource).toContain('MESSENGER_PERSON_ROLE_LABELS[item.role]');
    expect(hubRowsSource).toContain('personRoleLine');
  });

  test('keeps accordion work local and does not navigate on a tab press', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'app', 'messenger.tsx'), 'utf8');
    const hubRowsSource = fs.readFileSync(
      path.join(repositoryRoot, 'components', 'messenger', 'MessengerHubRows.tsx'),
      'utf8',
    );
    expect(source).toContain('const groupedPeople = useMemo(');
    expect(source).toContain('() => groupMessengerPeopleByRole(people, roleFilter)');
    expect(source).toContain('})), [expandedRoles, groupedPeople]);');
    expect(source).toContain('() => new Set<MessengerPersonRole>()');
    expect(source).not.toContain('router.setParams({ tab });');
    expect(hubRowsSource).toContain(
      "name={expanded ? 'chevron-down' : 'chevron-right'}",
    );
  });

  test('keeps both virtualized lists mounted while removing the inactive pane from layout work', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'app', 'messenger.tsx'), 'utf8');
    const rows = fs.readFileSync(
      path.join(repositoryRoot, 'components', 'messenger', 'MessengerHubRows.tsx'),
      'utf8',
    );
    expect(source).toContain("pointerEvents={activeTab === 'people' ? 'auto' : 'none'}");
    expect(source).toContain("pointerEvents={activeTab === 'chats' ? 'auto' : 'none'}");
    expect(source).toContain('styles.tabPaneInactive');
    expect(source).toContain("tabPaneInactive: { display: 'none' }");
    expect(source).not.toContain('tabPaneInactive: { opacity: 0 }');
    expect(source).toContain('renderItem={renderPersonItem}');
    expect(source).toContain('renderItem={renderConversationItem}');
    expect(source).toContain('onEndReached={handleConversationEndReached}');
    expect(source).toContain('rbGetConversationsPageOrThrow(requestCursor)');
    expect(source).toContain('rbGetDmConversationsPageOrThrow(dmCursor)');
    expect(source).toContain('fetchInternalChatListPage(viewerContext, internalCursor)');
    expect(source).toContain('initialNumToRender={8}');
    expect(source).toContain('maxToRenderPerBatch={8}');
    expect(source).toContain('removeClippedSubviews');
    expect(rows).toContain('memo(function MessengerHubPersonRow');
    expect(rows).toContain('memo(function MessengerHubConversationRow');
    expect(rows).toContain('memo(function MessengerRoleSectionHeader');
  });

  test('keeps cursor-less legacy responses complete while current servers paginate', () => {
    const api = fs.readFileSync(path.join(repositoryRoot, 'lib', 'request-board-api.ts'), 'utf8');
    const internalApi = fs.readFileSync(path.join(repositoryRoot, 'lib', 'internal-chat-api.ts'), 'utf8');
    expect(api).toContain('async function rbReadAllPagesOrThrow<T>');
    expect(api).toContain("throw new Error('GaramLink conversation pagination did not advance')");
    expect(api).toContain('export async function rbGetConversationsPageOrThrow');
    expect(api).toContain('export async function rbGetDmConversationsPageOrThrow');
    expect(api).toContain("cursor=${encodeURIComponent(cursor)}");
    expect(api).toContain('const items = result.data;');
    expect(api).not.toContain('result.data.slice(0, limit)');
    expect(internalApi).toContain('return parseInternalChatListResponse(data);');
    expect(internalApi).not.toContain('data.items.slice(0, maxItems)');
  });

  test('starts an existing direct room history request while resolving its route', () => {
    const chat = fs.readFileSync(path.join(repositoryRoot, 'app', 'chat.tsx'), 'utf8');
    expect(chat).toContain('const directMessagePrefetchRef = useRef<');
    expect(chat).toContain('request: fetchGaraminDirectMessages(conversationIdValue).then(');
    expect(chat).toContain("if (prefetched?.conversationId === resolvedConversation.id)");
  });

  test('keeps room refreshes focus-bound and prevents slow requests from overlapping', () => {
    const directChat = fs.readFileSync(path.join(repositoryRoot, 'app', 'chat.tsx'), 'utf8');
    const groupChat = fs.readFileSync(path.join(repositoryRoot, 'app', 'group-chat.tsx'), 'utf8');
    const requestChat = fs.readFileSync(
      path.join(repositoryRoot, 'app', 'request-board-messenger.tsx'),
      'utf8',
    );

    expect(directChat).not.toContain('DIRECT_MESSAGE_POLL_INTERVAL_MS');
    expect(directChat).not.toContain('setInterval(');
    expect(groupChat).not.toContain('GROUP_CHAT_REFRESH_INTERVAL_MS');
    expect(groupChat).not.toContain('setInterval(');
    expect(requestChat).toContain('await loadMessages(activeConv);');
    expect(requestChat).toContain('pollRef.current = setTimeout(() => {');
    expect(requestChat).toContain('if (pollRef.current) clearTimeout(pollRef.current);');
    expect(requestChat).toContain('requestAnimationFrame(() => {');
  });
});
