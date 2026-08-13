import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '..', '..');

const readSource = (...segments: string[]) => fs.readFileSync(
  path.join(repositoryRoot, ...segments),
  'utf8',
);

describe('Messenger V2 profile and new-conversation contract', () => {
  test('opens a restrained profile sheet before starting a one-to-one chat', () => {
    const hubSource = readSource('app', 'messenger.tsx');
    const sheetSource = readSource(
      'components',
      'messenger',
      'MessengerPersonProfileSheet.tsx',
    );

    expect(hubSource).toContain('setSelectedPerson(item)');
    expect(hubSource).toContain('<MessengerPersonProfileSheet');
    expect(hubSource).toContain('handleProfileStartChat');
    expect(hubSource).not.toContain(
      '<MessengerHubPersonRow item={item} onPress={() => void openRoute(item.route)} />',
    );
    expect(sheetSource).toContain('{person.name}');
    expect(sheetSource).toContain('{person.detail}');
    expect(sheetSource).toContain('{person.sourceLabel}');
    expect(sheetSource).toContain('1:1 대화</Text>');
    expect(sheetSource).toContain('width: 44,');
    expect(sheetSource).toContain('height: 44,');
  });

  test('exposes the new-conversation entry only as navigation from the People hub', () => {
    const hubSource = readSource('app', 'messenger.tsx');

    expect(hubSource).toContain("accessibilityElementsHidden={activeTab !== 'people'}");
    expect(hubSource).toContain('ListHeaderComponent={(');
    expect(hubSource).toContain('onPress={handleNewConversation}');
    expect(hubSource).toContain("router.push('/new-conversation' as never)");
    expect(hubSource).toContain('새 대화</Text>');
  });

  test('reloads canonical role-gated people and keeps search and selection local', () => {
    const source = readSource('app', 'new-conversation.tsx');

    expect(source).toContain('fetchFcChatTargets(residentId)');
    expect(source).toContain('fetchInternalChatList(viewerContext)');
    expect(source).toContain('rbGetConversationsOrThrow()');
    expect(source).toContain('rbGetDmConversationsOrThrow()');
    expect(source).toContain('if (capabilities.canLoadRequestBoardDirectory)');
    expect(source).toContain('rbGetDirectMessageUsersOrThrow()');
    expect(source).toContain('dedupePeople(sources.flat())');
    expect(source).toContain('canonicalPeople.filter((person) => isExactExistingRoute(person.route))');
    expect(source).toContain('people.filter((person) => matchesSearch(person, query))');
    expect(source).toContain('[person.name, person.detail]');
    expect(source).toContain('setSelectedKey(item.key)');
    expect(source).toContain("useLocalSearchParams<{ participantId?: string | string[] }>()");
    expect(source).toContain("/^\\d+$/.test(raw)");
    expect(source).toContain('Number.isSafeInteger(participantId)');
    expect(source).toContain('person.identityKey === `request-user:${preferredParticipantId}`');
    expect(source).toContain('preferredSelectionAppliedRef.current = preferredParticipantId');
    expect(source).toContain('setSelectedKey(preferred.key)');
    expect(source).not.toContain('Date.now()');
  });

  test('creates a GaramLink DM only in the guarded bottom CTA handler', () => {
    const source = readSource('app', 'new-conversation.tsx');
    const callCount = source.match(/rbCreateDmConversation\(/g)?.length ?? 0;
    const handlerStart = source.indexOf('const handleStartChat = useCallback');
    const handlerEnd = source.indexOf('const handleRefresh = useCallback');
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(callCount).toBe(1);
    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerSource).toContain('startActionRef.current');
    expect(handlerSource).toContain('capabilities.canCreateRequestBoardDm');
    expect(handlerSource).toContain('readOnly && !isExactExistingRoute(route)');
    expect(handlerSource).toContain('rbCreateDmConversation(route.participantId)');
    expect(handlerSource).toContain("pathname: '/request-board-messenger'");
    expect(source).toContain('읽기 전용 계정은 기존 대화 상대만 선택할 수 있습니다.');
    expect(source).toContain('disabled={!selectedPerson || starting}');
  });

  test('registers the hidden route in both authenticated layout stacks', () => {
    const layoutSource = readSource('app', '_layout.tsx');
    const registrations = layoutSource.match(
      /<Stack\.Screen name="new-conversation" options=\{\{ headerShown: false \}\} \/>/g,
    ) ?? [];

    expect(registrations).toHaveLength(2);
  });
});
